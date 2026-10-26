/**
 * The video worker for AI Shorts. It runs outside Vercel (whose functions are too short-lived
 * for video): as the "Video worker" GitHub Action, or as the Docker image in this folder.
 *
 *   node --experimental-strip-types worker/index.ts
 *
 * It takes queued jobs from the database one at a time and:
 *   analyze  downloads the recording, transcribes it with word timings, asks the AI for the
 *            strongest moments, snaps them to sentence boundaries and saves clip suggestions
 *            with subtitles and captions
 *   render   cuts, reframes to 1080×1920, burns in subtitles and branding, mixes audio and
 *            uploads the preview or final MP4
 *
 * Environment: SUPABASE_URL, SUPABASE_SECRET_KEY, OPENAI_API_KEY; optional FFMPEG, FFPROBE,
 * WORKER_RUN_MINUTES (default 50), WORKER_ID.
 */
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { allWords, buildCues, checkSuggestions, readCues, spokenText, toAss, transcriptForAi, type Segment, type Word } from '../src/lib/clips.ts'
import { RENDER_USD_PER_RUNNER_MINUTE, transcribeCost, TRANSCRIBE_USD_PER_MINUTE } from '../src/lib/costs.ts'
import { readCrop, readStyle } from '../src/lib/newsroom.ts'
import { chatJson, HOUSE_RULES, recordUsage } from '../api/_lib/ai.ts'
import { writeClipCaptions } from '../api/_lib/captions.ts'
import { notify, rest, rpc, secretHeaders, settings, supabaseConfig } from '../api/_lib/server.ts'
import { signedDownloadUrl } from '../api/_lib/storage.ts'
import { outputSeconds, renderArgs, type Bumper, type RenderPlan } from './ffmpeg.ts'

const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const FFPROBE = process.env.FFPROBE || 'ffprobe'
const WORKER = process.env.WORKER_ID || `worker-${process.pid}`
const LOGO = fileURLToPath(new URL('../src/assets/brand/logo-mark.png', import.meta.url))
const FONTS = process.env.FONTS_DIR || '/usr/share/fonts'

interface Job {
  id: string
  kind: 'analyze' | 'render' | 'transcribe'
  payload: Record<string, unknown>
  requested_by: string | null
}

class Cancelled extends Error {}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function run(cmd: string, args: string[], onLine?: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => {
      out += d
      if (onLine) for (const line of String(d).split('\n')) onLine(line)
    })
    child.stderr.on('data', (d: Buffer) => (err = (err + d).slice(-4000)))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd.split(/[\\/]/).pop()} failed (${code}): ${err.split('\n').filter(Boolean).slice(-3).join(' | ')}`))))
  })
}

export interface Probe {
  duration: number
  width: number
  height: number
  hasAudio: boolean
}

export async function probe(file: string): Promise<Probe> {
  const out = JSON.parse(await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file])) as {
    format?: { duration?: string }
    streams?: { codec_type: string; width?: number; height?: number }[]
  }
  const video = out.streams?.find((s) => s.codec_type === 'video')
  return { duration: Number(out.format?.duration ?? 0), width: video?.width ?? 0, height: video?.height ?? 0, hasAudio: Boolean(out.streams?.some((s) => s.codec_type === 'audio')) }
}

async function download(url: string, to: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000) })
  if (!res.ok || !res.body) throw new Error(`Couldn’t download the file (${res.status})`)
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(to))
}

async function upload(bucket: string, path: string, file: string, contentType: string) {
  const { url, key } = supabaseConfig()
  const body = await readFile(file)
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { ...secretHeaders(key), 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': '3600' },
    body,
    signal: AbortSignal.timeout(10 * 60_000),
  })
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  return body.length
}

async function update(jobId: string, patch: Record<string, unknown>) {
  await rest(`jobs?id=eq.${jobId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...patch, heartbeat_at: new Date().toISOString() }) })
}

/** Stops work early if someone pressed Cancel. */
async function checkCancelled(jobId: string) {
  const [row] = await rest<{ status: string }[]>(`jobs?select=status&id=eq.${jobId}`)
  if (row?.status === 'cancelled') throw new Cancelled('Cancelled')
}

/** Cached per run: the same recording is downloaded once even for several renders. */
const sources = new Map<string, Promise<{ file: string; info: Probe }>>()
function sourceFile(workDir: string, assetId: string) {
  if (!sources.has(assetId)) {
    sources.set(
      assetId,
      (async () => {
        const [asset] = await rest<{ bucket: string; path: string; status: string }[]>(`media_assets?select=bucket,path,status&id=eq.${assetId}`)
        if (!asset || asset.status !== 'ready') throw new Error('The recording is missing or still uploading')
        const file = join(workDir, `${assetId}${/\.[a-z0-9]+$/i.exec(asset.path)?.[0] ?? '.mp4'}`)
        await download(await signedDownloadUrl(asset.bucket, asset.path, 6 * 3600), file)
        const info = await probe(file)
        await rest(`media_assets?id=eq.${assetId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ duration_seconds: info.duration, width: info.width, height: info.height }) })
        return { file, info }
      })(),
    )
    sources.get(assetId)!.catch(() => sources.delete(assetId))
  }
  return sources.get(assetId)!
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/** Joins transcript pieces from several audio chunks, shifting each chunk's times by its start. */
export function mergeChunks(chunks: { offset: number; segments: { start: number; end: number; text: string }[]; words: { word: string; start: number; end: number }[] }[]): Segment[] {
  const out: Segment[] = []
  for (const c of chunks) {
    const words: Word[] = c.words.map((w) => ({ w: w.word.trim(), s: round(w.start + c.offset), e: round(w.end + c.offset) })).filter((w) => w.w)
    for (const s of c.segments) {
      const start = round(s.start + c.offset)
      const end = round(s.end + c.offset)
      out.push({ start, end, text: s.text.trim(), words: words.filter((w) => w.s >= start - 0.05 && w.s < end + 0.05) })
    }
  }
  // A word belongs to one segment only.
  const seen = new Set<string>()
  for (const s of out) s.words = s.words!.filter((w) => !seen.has(`${w.s}:${w.w}`) && seen.add(`${w.s}:${w.w}`))
  return out.filter((s) => s.text)
}

const round = (n: number) => Math.round(n * 100) / 100
const CHUNK_SECONDS = 20 * 60

async function transcribe(job: Job, assetId: string, workDir: string): Promise<Segment[]> {
  const [existing] = await rest<{ segments: Segment[] }[]>(`transcripts?select=segments&asset_id=eq.${assetId}`)
  if (existing?.segments?.length) return existing.segments
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY isn’t set for the worker')

  const { file, info } = await sourceFile(workDir, assetId)
  if (!info.hasAudio) throw new Error('This recording has no sound to transcribe')
  const s = await settings()
  if (info.duration > s.max_video_minutes * 60) throw new Error(`The recording is longer than the ${s.max_video_minutes}-minute limit in Settings`)

  const chunks = []
  for (let offset = 0, i = 0; offset < info.duration; offset += CHUNK_SECONDS, i++) {
    await checkCancelled(job.id)
    await update(job.id, { progress: Math.round(10 + (offset / info.duration) * 50), message: `Transcribing ${Math.round(offset / 60)}–${Math.round(Math.min(info.duration, offset + CHUNK_SECONDS) / 60)} min` })
    const audio = join(workDir, `${assetId}-${i}.ogg`)
    // Mono speech at 24 kbps: 20 minutes is about 3.6 MB, well under the 25 MB upload limit.
    await run(FFMPEG, ['-hide_banner', '-y', '-ss', String(offset), '-t', String(CHUNK_SECONDS), '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', audio])
    const form = new FormData()
    form.append('file', new Blob([await readFile(audio)], { type: 'audio/ogg' }), 'audio.ogg')
    form.append('model', 'whisper-1')
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'word')
    form.append('timestamp_granularities[]', 'segment')
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(10 * 60_000) })
    if (!res.ok) throw new Error(`Transcription failed (OpenAI ${res.status})`)
    const body = (await res.json()) as { language?: string; segments?: { start: number; end: number; text: string }[]; words?: { word: string; start: number; end: number }[] }
    chunks.push({ offset, segments: body.segments ?? [], words: body.words ?? [], language: body.language ?? '' })
    const seconds = Math.min(CHUNK_SECONDS, info.duration - offset)
    await recordUsage({ user_id: job.requested_by, feature: 'transcription', model: 'whisper-1', audio_seconds: seconds, cost_usd: transcribeCost(seconds), job_id: job.id })
    await rm(audio, { force: true })
  }
  const segments = mergeChunks(chunks)
  await rest('transcripts?on_conflict=asset_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ asset_id: assetId, language: chunks[0]?.language ?? '', text: segments.map((x) => x.text).join(' '), segments, provider: 'openai', model: 'whisper-1' }),
  })
  return segments
}

// ---------------------------------------------------------------------------
// Finding clips
// ---------------------------------------------------------------------------

async function analyze(job: Job, workDir: string) {
  const assetId = String(job.payload.assetId)
  const segments = await transcribe(job, assetId, workDir)
  if (job.kind === 'transcribe') return { segments: segments.length }
  await checkCancelled(job.id)
  await update(job.id, { progress: 65, message: 'Finding the strongest moments' })

  const s = await settings()
  const lengths = (job.payload.lengths as number[]) ?? [30, 60]
  const count = Math.min(Number(job.payload.count) || 6, s.max_clips_per_video)
  const min = Math.max(8, Math.min(...lengths) * 0.7)
  const max = Math.min(180, Math.max(...lengths) * 1.15)
  const duration = segments.at(-1)?.end ?? 0
  const [asset] = await rest<{ filename: string; project_id: string | null; project: { title: string } | null }[]>(`media_assets?select=filename,project_id,project:video_projects(title)&id=eq.${assetId}`)

  const raw = await chatJson({
    feature: 'clip-analysis',
    userId: job.requested_by,
    maxTokens: 400 * count + 300,
    temperature: 0.3,
    system: [
      HOUSE_RULES,
      'You are a video editor choosing moments from a long interview to cut into short vertical clips.',
      `Find up to ${count + 2} moments that work on their own: strong or emotional answers, personal stories, useful lessons, and engaging exchanges.`,
      `Each clip should be about ${lengths.join(' or ')} seconds long (never shorter than ${Math.round(min)} or longer than ${Math.round(max)}).`,
      'Start where a thought begins and end where it finishes: never mid-sentence. Use the [start–end] times in the transcript.',
      'category is one of: emotional, insight, educational, story, discussion, other. score is 0–100 for how well it would work on its own.',
      'title: a short working title in your own words. reason: one sentence on why it works, without quoting anything not in the transcript.',
      'Reply with JSON only: {"clips": [{"start": seconds, "end": seconds, "title", "category", "reason", "score"}]}.',
    ].join('\n'),
    user: `TRANSCRIPT (seconds):\n${transcriptForAi(segments)}`,
  })
  const picks = checkSuggestions(raw, segments, { min, max, limit: count, duration })
  if (!picks.length) throw new Error('No clips of the chosen lengths could be found in this recording. Try different lengths.')

  // Regenerating replaces earlier suggestions nobody has worked on yet.
  if (job.payload.regenerate) await rest(`video_clips?asset_id=eq.${assetId}&status=eq.suggested`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
  const words = allWords(segments)
  let i = 0
  for (const pick of picks) {
    await checkCancelled(job.id)
    await update(job.id, { progress: 70 + Math.round((i++ / picks.length) * 28), message: `Writing captions for clip ${i} of ${picks.length}` })
    const captions = await writeClipCaptions({ userId: job.requested_by, title: pick.title, spoken: spokenText(segments, pick.start, pick.end), videoTitle: asset?.project?.title ?? asset?.filename ?? '' }).catch(() => ({}))
    await rest('video_clips', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ asset_id: assetId, project_id: asset?.project_id ?? null, title: pick.title, start_s: pick.start, end_s: pick.end, category: pick.category, reason: pick.reason, score: pick.score, subtitles: buildCues(words, pick.start, pick.end), captions, created_by: job.requested_by }),
    })
  }
  await notify('clip.ready', `${picks.length} clip suggestions are ready: ${asset?.project?.title ?? asset?.filename ?? 'recording'}`.slice(0, 200), `/admin/shorts?asset=${assetId}`, 'staff', `clip.ready:${job.id}`)
  return { clips: picks.length, transcriptMinutes: Math.round(duration / 60), transcribeRate: TRANSCRIBE_USD_PER_MINUTE }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function bumper(workDir: string, assetId: string): Promise<Bumper | null> {
  if (!assetId) return null
  const [a] = await rest<{ bucket: string; path: string; status: string }[]>(`media_assets?select=bucket,path,status&id=eq.${assetId}`)
  if (!a || a.status !== 'ready') return null
  const file = join(workDir, `bumper-${assetId}.mp4`)
  await download(await signedDownloadUrl(a.bucket, a.path), file)
  const info = await probe(file)
  return { path: file, hasAudio: info.hasAudio, duration: info.duration }
}

async function render(job: Job, workDir: string) {
  const clipId = String(job.payload.clipId)
  const final = job.payload.final === true
  const [clip] = await rest<{ id: string; asset_id: string; title: string; start_s: number; end_s: number; cuts: [number, number][]; crop: unknown; style: unknown; subtitles: unknown; preview_asset_id: string | null; final_asset_id: string | null; updated_at: string }[]>(
    `video_clips?select=*&id=eq.${clipId}`,
  )
  if (!clip) throw new Error('The clip was deleted')
  const style = readStyle(clip.style)
  const start = Number(clip.start_s)
  const end = Number(clip.end_s)
  await update(job.id, { progress: 5, message: 'Downloading the recording' })
  const { file, info } = await sourceFile(workDir, clip.asset_id)
  if (end > info.duration + 0.5) throw new Error('The clip ends after the recording does')

  let cues = readCues(clip.subtitles)
  if (!cues.length && style.subtitles) {
    const [t] = await rest<{ segments: Segment[] }[]>(`transcripts?select=segments&asset_id=eq.${clip.asset_id}`)
    if (t) cues = buildCues(allWords(t.segments), start, end, clip.cuts ?? [])
  }
  const [W, H] = final ? [1080, 1920] : [540, 960]
  let assFile: string | null = null
  if ((style.subtitles && cues.length) || style.titleOverlay) {
    assFile = join(workDir, `${clipId}.ass`)
    const sub = style.subtitles
    await writeFile(
      assFile,
      toAss(sub ? cues : [], {
        width: W,
        height: H,
        font: sub?.font ?? 'Inter',
        size: sub?.size ?? 0.05,
        position: sub?.position ?? 0.2,
        background: sub?.background ?? 'shadow',
        highlight: sub?.highlight ?? false,
        highlightColor: sub?.highlightColor ?? '#F7D046',
        uppercase: sub?.uppercase ?? false,
        title: style.titleOverlay,
        duration: end - start,
      }),
    )
  }

  let music: RenderPlan['music'] = null
  if (style.musicAssetId) {
    const [m] = await rest<{ bucket: string; path: string; license_note: string; status: string }[]>(`media_assets?select=bucket,path,license_note,status&id=eq.${style.musicAssetId}`)
    // Background music is only used once someone has recorded where it came from and its licence.
    if (m?.status === 'ready' && m.license_note.trim()) {
      const path = join(workDir, `music-${style.musicAssetId}${/\.[a-z0-9]+$/i.exec(m.path)?.[0] ?? '.mp3'}`)
      await download(await signedDownloadUrl(m.bucket, m.path), path)
      music = { path, volume: style.musicVolume }
    }
  }

  const output = join(workDir, `${clipId}-${final ? 'final' : 'preview'}.mp4`)
  const plan: RenderPlan = {
    source: file,
    sourceHasAudio: info.hasAudio,
    start,
    end,
    cuts: clip.cuts ?? [],
    crop: readCrop(clip.crop),
    subtitles: assFile,
    fontsDir: FONTS,
    logo: style.watermark ? LOGO : null,
    volume: style.volume,
    denoise: style.denoise,
    music,
    intro: final ? await bumper(workDir, style.introAssetId) : null,
    outro: final ? await bumper(workDir, style.outroAssetId) : null,
    final,
    output,
  }
  await checkCancelled(job.id)
  const total = outputSeconds(plan)
  const began = Date.now()
  let lastReport = 0
  await run(FFMPEG, renderArgs(plan), (line) => {
    const m = /^out_time_us=(\d+)/.exec(line)
    if (!m || Date.now() - lastReport < 5000) return
    lastReport = Date.now()
    void update(job.id, { progress: Math.min(95, 10 + Math.round((Number(m[1]) / 1e6 / total) * 85)), message: `Rendering the ${final ? 'final video' : 'preview'}` })
  })
  await checkCancelled(job.id)
  const out = await probe(output)
  if (out.width !== W || out.height !== H) throw new Error(`The render came out ${out.width}×${out.height} instead of ${W}×${H}`)

  await update(job.id, { progress: 96, message: 'Uploading' })
  const path = `${final ? 'clip_final' : 'clip_preview'}/${new Date().toISOString().slice(0, 7)}/${clipId}/${Date.now()}.mp4`
  const size = await upload('media', path, output, 'video/mp4')
  const [asset] = await rest<{ id: string }[]>('media_assets', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ bucket: 'media', path, kind: final ? 'clip_final' : 'clip_preview', filename: `${(clip.title || 'clip').slice(0, 60)}.mp4`, mime_type: 'video/mp4', size_bytes: size, duration_seconds: out.duration, width: out.width, height: out.height, status: 'ready', created_by: job.requested_by }),
  })
  // Only attach the render if the clip hasn't been edited while it was rendering.
  const patched = await rest<unknown[]>(`video_clips?id=eq.${clipId}&updated_at=eq.${encodeURIComponent(clip.updated_at)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(final ? { final_asset_id: asset.id, status: 'rendered' } : { preview_asset_id: asset.id, status: 'preview_ready' }),
  })
  const old = final ? clip.final_asset_id : clip.preview_asset_id
  if (old) await rest(`media_assets?id=eq.${old}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ delete_after: new Date().toISOString() }) })
  if (!patched.length) await rest(`media_assets?id=eq.${asset.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ delete_after: new Date().toISOString() }) })

  const minutes = (Date.now() - began) / 60_000
  const cost = Math.round(Math.ceil(minutes) * RENDER_USD_PER_RUNNER_MINUTE * 10000) / 10000
  await recordUsage({ user_id: job.requested_by, feature: final ? 'render-final' : 'render-preview', model: 'ffmpeg', video_seconds: total, category: 'video', cost_usd: cost, job_id: job.id })
  if (final && patched.length) await notify('clip.ready', `Clip ready to review: ${clip.title}`.slice(0, 200), `/admin/shorts?clip=${clipId}`, 'owner', `clip.final:${clipId}:${job.id}`)
  return { assetId: asset.id, seconds: Math.round(total), attached: patched.length > 0, costUsd: cost }
}

// ---------------------------------------------------------------------------

async function handle(job: Job, workDir: string) {
  const beat = setInterval(() => void update(job.id, {}).catch(() => {}), 30_000)
  try {
    const result = job.kind === 'render' ? await render(job, workDir) : await analyze(job, workDir)
    const usage = await rest<{ cost_usd: string }[]>(`ai_usage?select=cost_usd&job_id=eq.${job.id}`)
    await update(job.id, { status: 'succeeded', progress: 100, message: 'Done', result, finished_at: new Date().toISOString(), actual_cost_usd: usage.reduce((t, u) => t + Number(u.cost_usd), 0) })
    console.log(`${job.kind} ${job.id}: done`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    const cancelled = error instanceof Cancelled
    if (!cancelled) await update(job.id, { status: 'failed', error: message.slice(0, 1000), message: 'Failed', finished_at: new Date().toISOString() })
    if (job.kind === 'render') await rest(`video_clips?id=eq.${job.payload.clipId}&status=eq.rendering`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'editing' }) })
    if (!cancelled) await notify('job.failed', `${job.kind === 'render' ? 'Render' : 'Clip analysis'} failed: ${message}`.slice(0, 200), job.kind === 'render' ? `/admin/shorts?clip=${job.payload.clipId}` : `/admin/shorts?asset=${job.payload.assetId}`, 'staff', `job.failed:${job.id}`)
    console.error(`${job.kind} ${job.id}: ${message}`)
  } finally {
    clearInterval(beat)
  }
}

export async function main() {
  const until = Date.now() + Number(process.env.WORKER_RUN_MINUTES || 50) * 60_000
  const workDir = await mkdtemp(join(tmpdir(), 'nm-worker-'))
  let done = 0
  try {
    while (Date.now() < until) {
      const [job] = await rpc<Job[]>('claim_job', { kinds: ['analyze', 'render', 'transcribe'], worker: WORKER })
      if (!job) break
      await handle(job, workDir)
      done++
    }
    console.log(`Video worker finished: ${done} job(s).`)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}


if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
