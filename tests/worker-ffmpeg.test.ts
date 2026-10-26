/**
 * The video worker's FFmpeg command, and (when FFmpeg is installed) real renders of a
 * generated test video. Set FFMPEG and FFPROBE to the binaries' paths if they aren't on PATH.
 * Without FFmpeg the render tests are skipped, and say so.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { filterPath, outputSeconds, renderArgs, type RenderPlan } from '../worker/ffmpeg.ts'
import { mergeChunks } from '../worker/index.ts'
import { buildCues, toAss } from '../src/lib/clips.ts'

const base: RenderPlan = {
  source: '/tmp/in.mp4',
  sourceHasAudio: true,
  start: 100,
  end: 130,
  cuts: [],
  crop: { mode: 'center', x: 0.5 },
  subtitles: null,
  fontsDir: '/usr/share/fonts',
  logo: null,
  volume: 1,
  denoise: false,
  music: null,
  intro: null,
  outro: null,
  final: true,
  output: '/tmp/out.mp4',
}
const graphOf = (args: string[]) => args[args.indexOf('-filter_complex') + 1]

test('seeks to the clip and reframes to 1080×1920', () => {
  const args = renderArgs(base)
  assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 6), ['-ss', '100', '-to', '130', '-i', '/tmp/in.mp4'])
  const g = graphOf(args)
  assert.match(g, /crop=w=trunc\(min\(iw\\,ih\*9\/16\)\/2\)\*2/)
  assert.match(g, /scale=1080:1920/)
  assert.ok(args.includes('libx264') && args.includes('+faststart'))
})

test('cuts are removed and the parts joined', () => {
  const g = graphOf(renderArgs({ ...base, cuts: [[110, 115]] }))
  assert.match(g, /split=2\[sv0\]\[sv1\]/)
  assert.match(g, /trim=start=0:end=10/)
  assert.match(g, /trim=start=15:end=30/)
  assert.match(g, /concat=n=2:v=1:a=1\[vc\]\[ac\]/)
  assert.equal(outputSeconds({ ...base, cuts: [[110, 115]] }), 25)
})

test('split screen stacks two 9:8 crops', () => {
  const g = graphOf(renderArgs({ ...base, crop: { mode: 'split', x: 0.2, x2: 0.8 } }))
  assert.match(g, /x=\(iw-ow\)\*0\.2/)
  assert.match(g, /x=\(iw-ow\)\*0\.8/)
  assert.match(g, /scale=1080:960/)
  assert.match(g, /vstack=inputs=2/)
})

test('subtitles, logo, music, noise reduction, intro and outro', () => {
  const args = renderArgs({
    ...base,
    subtitles: 'C:/work dir/sub.ass',
    logo: '/logo.png',
    denoise: true,
    volume: 1.2,
    music: { path: '/music.mp3', volume: 0.1 },
    intro: { path: '/intro.mp4', hasAudio: false, duration: 2 },
    outro: { path: '/outro.mp4', hasAudio: true, duration: 3 },
  })
  const g = graphOf(args)
  assert.match(g, /ass=filename='C\\:\/work dir\/sub\.ass'/)
  assert.match(g, /\[1:v\]scale=151:-1/)
  assert.match(g, /afftdn/)
  assert.match(g, /volume=1\.2/)
  assert.match(g, /amix=inputs=2:duration=first/)
  assert.match(g, /aevalsrc=0:c=stereo:s=48000:d=2\[introa\]/)
  assert.match(g, /\[introv\]\[introa\]\[vmain\]\[amain\]\[outrov\]\[outroa\]concat=n=3/)
  assert.deepEqual(args.slice(args.indexOf('-stream_loop'), args.indexOf('-stream_loop') + 4), ['-stream_loop', '-1', '-i', '/music.mp3'])
  assert.equal(filterPath('C:\\a,b;[c]'), "'C\\:/a,b;[c]'")
  assert.throws(() => filterPath("it's"))
})

test('previews are smaller and faster', () => {
  const args = renderArgs({ ...base, final: false })
  assert.match(graphOf(args), /scale=540:960/)
  assert.ok(args.includes('veryfast'))
})

test('a silent recording still gets an audio track', () => {
  assert.match(graphOf(renderArgs({ ...base, sourceHasAudio: false })), /aevalsrc=0:c=stereo:s=48000:d=30\[ac\]/)
})

test('transcript chunks are joined with their times shifted', () => {
  const segs = mergeChunks([
    { offset: 0, segments: [{ start: 0, end: 2, text: ' Hello there.' }], words: [{ word: 'Hello', start: 0, end: 0.5 }, { word: 'there.', start: 0.6, end: 1.2 }] },
    { offset: 1200, segments: [{ start: 1, end: 3, text: 'Second part.' }], words: [{ word: 'Second', start: 1, end: 1.5 }, { word: 'part.', start: 1.6, end: 2.2 }] },
  ])
  assert.equal(segs.length, 2)
  assert.equal(segs[0].text, 'Hello there.')
  assert.deepEqual(segs[1].words?.map((w) => w.s), [1201, 1201.6])
})

// ---------------------------------------------------------------------------
// Real renders
// ---------------------------------------------------------------------------

const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const FFPROBE = process.env.FFPROBE || 'ffprobe'
const hasFfmpeg = (() => {
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' })
    execFileSync(FFPROBE, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const skip = hasFfmpeg ? false : 'FFmpeg not installed (set FFMPEG and FFPROBE to run real renders)'

function probe(file: string) {
  const out = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file]).toString()) as { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number }[] }
  const v = out.streams.find((s) => s.codec_type === 'video')!
  return { duration: Number(out.format.duration), width: v.width!, height: v.height!, audio: out.streams.some((s) => s.codec_type === 'audio') }
}

test('renders a real 9:16 Short with burned-in subtitles and the logo', { skip, timeout: 240_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-render-'))
  try {
    const source = join(dir, 'interview.mp4')
    // A 16:9 "interview": moving test pattern with a tone.
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', source])
    const words = 'We moved with nothing and we built it together step by step'.split(' ').map((w, i) => ({ w, s: 2 + i * 0.5, e: 2.4 + i * 0.5 }))
    const cues = buildCues(words, 2, 9)
    const ass = join(dir, 'subs.ass')
    writeFileSync(ass, toAss(cues, { width: 1080, height: 1920, font: 'Arial', size: 0.05, position: 0.2, background: 'box', highlight: true, highlightColor: '#F7D046', uppercase: false, title: 'Noisemakers test', duration: 7 }))
    const logo = fileURLToPath(new URL('../src/assets/brand/logo-mark.png', import.meta.url))
    const fonts = process.platform === 'win32' ? 'C:/Windows/Fonts' : '/usr/share/fonts'

    const withSubs = join(dir, 'final.mp4')
    execFileSync(FFMPEG, renderArgs({ ...base, source, start: 2, end: 9, cuts: [[5, 6]], subtitles: ass, fontsDir: fonts, logo, output: withSubs }), { stdio: 'ignore' })
    const out = probe(withSubs)
    assert.equal(out.width, 1080)
    assert.equal(out.height, 1920)
    assert.ok(out.audio)
    assert.ok(Math.abs(out.duration - 6) < 0.35, `expected ~6s after the 1s cut, got ${out.duration}`)

    // The subtitles are really drawn: the same frame without them looks different.
    const plain = join(dir, 'plain.mp4')
    execFileSync(FFMPEG, renderArgs({ ...base, source, start: 2, end: 9, cuts: [[5, 6]], output: plain }), { stdio: 'ignore' })
    const frame = (file: string, png: string) => (execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'crop=1080:500:0:1300', png]), readFileSync(png))
    assert.notDeepEqual(frame(withSubs, join(dir, 'a.png')), frame(plain, join(dir, 'b.png')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('renders a split-screen preview at 540×960', { skip, timeout: 120_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-render-'))
  try {
    const source = join(dir, 'two.mp4')
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-an', source])
    const output = join(dir, 'preview.mp4')
    execFileSync(FFMPEG, renderArgs({ ...base, source, sourceHasAudio: false, start: 0, end: 4, crop: { mode: 'split', x: 0.1, x2: 0.9 }, final: false, output }), { stdio: 'ignore' })
    const out = probe(output)
    assert.deepEqual([out.width, out.height], [540, 960])
    assert.ok(out.audio, 'a silent track is added so every platform accepts the file')
    assert.ok(existsSync(output))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
