/**
 * Builds the FFmpeg command that turns part of a long recording into a vertical Short:
 * trim and cuts, 9:16 reframing (or a two-speaker split screen), burned-in subtitles,
 * logo watermark, volume, noise reduction, background music, and intro/outro.
 *
 * A plain function of its inputs, so it's tested without running FFmpeg (tests/worker-ffmpeg.test.ts).
 */
import { keptRanges } from '../src/lib/clips.ts'
import type { Crop } from '../src/lib/newsroom.ts'

export interface Bumper {
  path: string
  hasAudio: boolean
  duration: number
}

export interface RenderPlan {
  source: string
  sourceHasAudio: boolean
  /** Source seconds */
  start: number
  end: number
  cuts: [number, number][]
  crop: Crop
  /** ASS subtitle file, or null for none */
  subtitles: string | null
  fontsDir: string
  logo: string | null
  volume: number
  denoise: boolean
  music: { path: string; volume: number } | null
  intro: Bumper | null
  outro: Bumper | null
  final: boolean
  output: string
}

export const SIZE = { final: [1080, 1920], preview: [540, 960] } as const

/**
 * A path as a filter option value. Single quotes protect it from the filter graph parser;
 * colons (as in "C:/") are escaped for the option parser. The worker makes its own paths,
 * so they never contain quotes.
 */
export function filterPath(p: string): string {
  if (p.includes("'")) throw new Error('Paths for FFmpeg filters must not contain quotes')
  return `'${p.replace(/\\/g, '/').replace(/:/g, '\\:')}'`
}

const n = (x: number) => String(Math.round(x * 1000) / 1000)

/** Horizontal position for a crop mode: 0 = left edge, 1 = right edge. */
export function cropX(crop: Crop, which: 'top' | 'bottom' = 'top'): number {
  if (crop.mode === 'left') return 0.15
  if (crop.mode === 'right') return 0.85
  if (crop.mode === 'custom') return crop.x
  if (crop.mode === 'split') return which === 'top' ? crop.x : (crop.x2 ?? 0.5)
  return 0.5
}

export function renderArgs(p: RenderPlan): string[] {
  const [W, H] = p.final ? SIZE.final : SIZE.preview
  const length = p.end - p.start
  const ranges = keptRanges(0, length, p.cuts.map(([a, b]) => [a - p.start, b - p.start] as [number, number]))
  const args = ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y']
  const graph: string[] = []

  // Input 0: just the clip's span of the recording (fast, accurate seeking).
  args.push('-ss', n(p.start), '-to', n(p.end), '-i', p.source)
  let next = 1
  const logoIn = p.logo ? next++ : -1
  if (p.logo) args.push('-i', p.logo)
  const musicIn = p.music ? next++ : -1
  if (p.music) args.push('-stream_loop', '-1', '-i', p.music.path)
  const introIn = p.intro ? next++ : -1
  if (p.intro) args.push('-i', p.intro.path)
  const outroIn = p.outro ? next++ : -1
  if (p.outro) args.push('-i', p.outro.path)

  // Keep the uncut parts, joined end to end.
  const audioFmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'
  const k = ranges.length
  if (k === 1) {
    const [a, b] = ranges[0]
    graph.push(`[0:v]trim=start=${n(a)}:end=${n(b)},setpts=PTS-STARTPTS[vc]`)
    graph.push(p.sourceHasAudio ? `[0:a]atrim=start=${n(a)}:end=${n(b)},asetpts=PTS-STARTPTS,${audioFmt}[ac]` : `aevalsrc=0:c=stereo:s=48000:d=${n(b - a)}[ac]`)
  } else {
    graph.push(`[0:v]split=${k}${ranges.map((_, i) => `[sv${i}]`).join('')}`)
    if (p.sourceHasAudio) graph.push(`[0:a]asplit=${k}${ranges.map((_, i) => `[sa${i}]`).join('')}`)
    ranges.forEach(([a, b], i) => {
      graph.push(`[sv${i}]trim=start=${n(a)}:end=${n(b)},setpts=PTS-STARTPTS[v${i}]`)
      graph.push(p.sourceHasAudio ? `[sa${i}]atrim=start=${n(a)}:end=${n(b)},asetpts=PTS-STARTPTS,${audioFmt}[a${i}]` : `aevalsrc=0:c=stereo:s=48000:d=${n(b - a)}[a${i}]`)
    })
    graph.push(`${ranges.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${k}:v=1:a=1[vc][ac]`)
  }

  // Reframe to 9:16. Commas inside expressions are escaped for the filter graph.
  const vertical = (x: number, w: number, h: number) => `crop=w=trunc(min(iw\\,ih*${w}/${h})/2)*2:h=trunc(min(ih\\,iw*${h}/${w})/2)*2:x=(iw-ow)*${n(x)}:y=(ih-oh)/2`
  if (p.crop.mode === 'split') {
    graph.push('[vc]split=2[top][bottom]')
    graph.push(`[top]${vertical(cropX(p.crop, 'top'), 9, 8)},scale=${W}:${H / 2},setsar=1[t]`)
    graph.push(`[bottom]${vertical(cropX(p.crop, 'bottom'), 9, 8)},scale=${W}:${H / 2},setsar=1[b]`)
    graph.push('[t][b]vstack=inputs=2[vr]')
  } else {
    graph.push(`[vc]${vertical(cropX(p.crop), 9, 16)},scale=${W}:${H},setsar=1[vr]`)
  }

  let v = 'vr'
  if (p.subtitles) {
    graph.push(`[${v}]ass=filename=${filterPath(p.subtitles)}:fontsdir=${filterPath(p.fontsDir)}[vs]`)
    v = 'vs'
  }
  if (p.logo) {
    const size = Math.round(W * 0.14)
    graph.push(`[${logoIn}:v]scale=${size}:-1,format=rgba,colorchannelmixer=aa=0.85[logo]`)
    graph.push(`[${v}][logo]overlay=x=W-w-${Math.round(W * 0.05)}:y=${Math.round(H * 0.035)}[vl]`)
    v = 'vl'
  }
  graph.push(`[${v}]fps=30,format=yuv420p[vmain]`)

  const audio = [`volume=${n(p.volume)}`, p.denoise ? 'afftdn=nf=-25' : '', audioFmt].filter(Boolean).join(',')
  if (p.music) {
    graph.push(`[ac]${audio}[voice]`)
    graph.push(`[${musicIn}:a]${audioFmt},volume=${n(p.music.volume)}[music]`)
    graph.push('[voice][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amain]')
  } else graph.push(`[ac]${audio}[amain]`)

  // Intro and outro are fitted into the same 9:16 frame and joined around the clip.
  const bumper = (b: Bumper, input: number, name: string) => {
    graph.push(`[${input}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p[${name}v]`)
    graph.push(b.hasAudio ? `[${input}:a]${audioFmt}[${name}a]` : `aevalsrc=0:c=stereo:s=48000:d=${n(b.duration)}[${name}a]`)
  }
  const parts: string[] = []
  if (p.intro) {
    bumper(p.intro, introIn, 'intro')
    parts.push('[introv][introa]')
  }
  parts.push('[vmain][amain]')
  if (p.outro) {
    bumper(p.outro, outroIn, 'outro')
    parts.push('[outrov][outroa]')
  }
  if (parts.length > 1) graph.push(`${parts.join('')}concat=n=${parts.length}:v=1:a=1[vout][aout]`)
  else {
    graph.push('[vmain]null[vout]')
    graph.push('[amain]anull[aout]')
  }

  args.push('-filter_complex', graph.join(';'), '-map', '[vout]', '-map', '[aout]')
  args.push('-c:v', 'libx264', '-preset', p.final ? 'medium' : 'veryfast', '-crf', p.final ? '20' : '28', '-pix_fmt', 'yuv420p', '-r', '30')
  args.push('-c:a', 'aac', '-b:a', p.final ? '160k' : '96k', '-ar', '48000', '-movflags', '+faststart', '-shortest', p.output)
  return args
}

/** Expected output length, for progress: the clip plus intro and outro. */
export const outputSeconds = (p: Pick<RenderPlan, 'start' | 'end' | 'cuts' | 'intro' | 'outro'>) =>
  keptRanges(p.start, p.end, p.cuts).reduce((t, [a, b]) => t + b - a, 0) + (p.intro?.duration ?? 0) + (p.outro?.duration ?? 0)
