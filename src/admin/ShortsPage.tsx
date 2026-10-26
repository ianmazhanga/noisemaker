import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Check, Download, Film, Pencil, RefreshCw, Scissors, Send, Sparkles, Upload, X } from 'lucide-react'
import { buttonClass } from '../components/ui/buttonClass'
import { inputClass } from '../components/inbox/shared'
import { clipLength, formatSeconds, readCues, retimeCue, type Cue } from '../lib/clips'
import { CLIP_CATEGORY, CLIP_LENGTHS, CLIP_STATUS, CROP_MODES, DEFAULT_SUBTITLES, readCrop, readStyle, SUBTITLE_FONTS, type ClipCaptions, type ClipStatus, type ClipStyle, type Crop, type CropMode } from '../lib/newsroom'
import { PLATFORM_KEYS, PLATFORMS, type Platform } from '../lib/social'
import { useAdmin, friendlyError } from './context'
import { Spinner } from './AdminApp'
import { Badge, Card, ConfirmButton, Drawer, Empty, NeedsMigration, Notice, PageHeader, Tabs, Warnings } from './ui'
import { api, ApiError, day, labelClass, money, STATUS_TONE, uploadFile, useLoad, videoDuration, when } from './lib'

interface Asset {
  id: string
  filename: string
  kind: string
  status: string
  size_bytes: number
  duration_seconds: number | null
  width: number | null
  height: number | null
  project_id: string | null
  youtube_id: string
  license_note: string
  bucket: string
  path: string
  created_at: string
}

interface Job {
  id: string
  kind: string
  status: string
  progress: number
  message: string
  error: string
  payload: { assetId?: string; clipId?: string; final?: boolean }
  estimated_cost_usd: number
  created_at: string
}

interface Clip {
  id: string
  asset_id: string
  title: string
  start_s: number
  end_s: number
  cuts: [number, number][]
  category: keyof typeof CLIP_CATEGORY
  reason: string
  score: number
  status: ClipStatus
  crop: unknown
  subtitles: unknown
  style: unknown
  captions: ClipCaptions
  preview_asset_id: string | null
  final_asset_id: string | null
  approved_at: string | null
  rejection_reason: string
  updated_at: string
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

export default function ShortsPage() {
  const { db } = useAdmin()
  const [params, setParams] = useSearchParams()
  const [state, reload] = useLoad(async () => {
    const [assets, jobs, clips] = await Promise.all([
      db.from('media_assets').select('*').in('kind', ['source_video', 'logo', 'music', 'intro', 'outro']).neq('status', 'deleted').order('created_at', { ascending: false }).limit(300),
      db.from('jobs').select('id, kind, status, progress, message, error, payload, estimated_cost_usd, created_at').in('kind', ['analyze', 'render', 'transcribe']).order('created_at', { ascending: false }).limit(100),
      db.from('video_clips').select('*').order('start_s').limit(1000),
    ])
    return { data: { assets: (assets.data ?? []) as Asset[], jobs: (jobs.data ?? []) as Job[], clips: (clips.data ?? []) as Clip[] }, error: assets.error ?? jobs.error ?? clips.error }
  }, [db])

  // Live progress: jobs and clips change as the worker runs.
  useEffect(() => {
    const channel = db
      .channel('shorts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => void reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'video_clips' }, () => void reload())
      .subscribe()
    // Realtime can miss updates on a sleeping laptop, so check every 15 s while work is in progress too.
    const timer = setInterval(() => void reload(), 15_000)
    return () => {
      void db.removeChannel(channel)
      clearInterval(timer)
    }
  }, [db, reload])

  if (state.status === 'missing') return <NeedsMigration title="AI Shorts Generator" />
  if (state.status !== 'ready') return state.status === 'error' ? <Notice kind="error">{state.message}</Notice> : <Spinner label="Loading…" />

  const { assets, jobs, clips } = state.data
  const sources = assets.filter((a) => a.kind === 'source_video')
  const assetId = params.get('asset')
  const clipParam = params.get('clip')
  const selectedClip = clips.find((c) => c.id === clipParam)
  const current = sources.find((a) => a.id === (assetId ?? selectedClip?.asset_id))
  const go = (next: Record<string, string | null>) =>
    setParams((p) => {
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v)
        else p.delete(k)
      }
      return p
    })

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="AI Shorts Generator"
        intro="Turn long interviews into vertical clips for TikTok, Reels and Shorts. The AI suggests moments; you edit, render, approve and send them to the Social Media Manager. Nothing is posted without approval."
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Sources sources={sources} jobs={jobs} clips={clips} selected={current?.id ?? null} onSelect={(id) => go({ asset: id, clip: null })} onUploaded={(id) => (void reload(), go({ asset: id }))} projectId={params.get('project')} />
        <div className="min-w-0">
          {current ? (
            <Recording asset={current} jobs={jobs.filter((j) => j.payload.assetId === current.id || clips.some((c) => c.asset_id === current.id && c.id === j.payload.clipId))} clips={clips.filter((c) => c.asset_id === current.id)} onChanged={() => void reload()} onEdit={(id) => go({ clip: id })} />
          ) : (
            <Empty title="Choose or upload a recording">
              Upload the original video file of an interview (MP4 or MOV). YouTube doesn’t let anyone download videos through its API, even the channel’s own, so clips are made from your original recordings.
            </Empty>
          )}
        </div>
      </div>
      {selectedClip && current && <ClipEditor clip={selectedClip} source={current} assets={assets} onClose={() => go({ clip: null })} onChanged={() => void reload()} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------

function Sources({ sources, jobs, clips, selected, onSelect, onUploaded, projectId }: { sources: Asset[]; jobs: Job[]; clips: Clip[]; selected: string | null; onSelect: (id: string) => void; onUploaded: (id: string) => void; projectId: string | null }) {
  const { db, session, isWriter, toast } = useAdmin()
  const [tab, setTab] = useState<'uploads' | 'youtube'>('uploads')
  const [busy, setBusy] = useState(false)
  const [youtubeId, setYoutubeId] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const [videos] = useLoad(async () => db.from('youtube_videos').select('youtube_id, title, thumbnail_url, duration_seconds, published_at').eq('kind', 'episode').order('published_at', { ascending: false }).limit(100), [db])

  async function upload(file: File) {
    setBusy(true)
    try {
      const duration = await videoDuration(file)
      const { assetId } = await uploadFile(db, session.access_token, file, 'source_video', { projectId, durationSeconds: duration || undefined })
      if (youtubeId) await db.from('media_assets').update({ youtube_id: youtubeId }).eq('id', assetId)
      toast('Uploaded. Next: find clips.')
      onUploaded(assetId)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const uploader = isWriter && (
    <div className="mt-3">
      <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska" className="sr-only" id="upload-recording" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      <label htmlFor="upload-recording" className={buttonClass('primary', 'sm', `w-full cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`)}>
        <Upload className="size-4" aria-hidden /> {busy ? 'Uploading… keep this page open' : 'Upload a recording'}
      </label>
      <p className="mt-1 text-xs text-muted">The size and length limits are in Settings → AI and costs. Uploads go to private storage.</p>
    </div>
  )

  return (
    <Card>
      <Tabs label="Recording source" tabs={{ uploads: 'Recordings', youtube: 'From YouTube' }} value={tab} onChange={setTab} />
      {tab === 'uploads' ? (
        <>
          {uploader}
          {sources.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No recordings yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {sources.map((a) => {
                const job = jobs.find((j) => j.payload.assetId === a.id && j.kind !== 'render')
                const count = clips.filter((c) => c.asset_id === a.id).length
                return (
                  <li key={a.id}>
                    <button type="button" onClick={() => onSelect(a.id)} className={`block w-full rounded-lg border p-3 text-left ${selected === a.id ? 'border-ink bg-bone' : 'border-line hover:border-ink/40'}`}>
                      <span className="flex items-center gap-2 font-semibold">
                        <Film className="size-4 shrink-0" aria-hidden /> <span className="truncate">{a.filename}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted">
                        {a.duration_seconds ? <span>{formatSeconds(Number(a.duration_seconds))}</span> : null}
                        <span>{mb(Number(a.size_bytes))}</span>
                        <span>{day(a.created_at)}</span>
                        {a.status !== 'ready' && <Badge className={STATUS_TONE.failed}>{a.status === 'pending_upload' ? 'Upload unfinished' : a.status}</Badge>}
                        {job && job.status !== 'succeeded' && <Badge className={STATUS_TONE[job.status]}>{job.status === 'running' ? `${job.progress}%` : job.status}</Badge>}
                        {count > 0 && <Badge className="bg-blue/10 text-blue-ink">{count} clips</Badge>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-muted">Pick the published video the recording belongs to, then upload your original file of it. Clips are linked to that video.</p>
          {videos.status === 'missing' || (videos.status === 'ready' && !(videos.data as unknown[]).length) ? (
            <p className="mt-3 text-sm text-muted">No channel videos synced yet. They appear after the YouTube sync runs (YouTube Manager).</p>
          ) : videos.status !== 'ready' ? (
            <Spinner label="Loading videos…" />
          ) : (
            <ul className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto">
              {(videos.data as { youtube_id: string; title: string; thumbnail_url: string; duration_seconds: number }[]).map((v) => (
                <li key={v.youtube_id}>
                  <button type="button" onClick={() => setYoutubeId(v.youtube_id === youtubeId ? '' : v.youtube_id)} className={`flex w-full gap-2 rounded-lg border p-2 text-left ${youtubeId === v.youtube_id ? 'border-ink bg-bone' : 'border-line'}`}>
                    <img src={v.thumbnail_url} alt="" className="aspect-video w-20 shrink-0 rounded object-cover" loading="lazy" />
                    <span className="min-w-0 text-sm">
                      <span className="line-clamp-2 font-semibold">{v.title}</span>
                      <span className="text-xs text-muted">{formatSeconds(v.duration_seconds)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {youtubeId && uploader}
        </div>
      )}
    </Card>
  )
}

function Recording({ asset, jobs, clips, onChanged, onEdit }: { asset: Asset; jobs: Job[]; clips: Clip[]; onChanged: () => void; onEdit: (id: string) => void }) {
  const { db, session, isWriter, isOwner, toast } = useAdmin()
  const [lengths, setLengths] = useState<number[]>([30, 60])
  const [custom, setCustom] = useState('')
  const [count, setCount] = useState(6)
  const [estimate, setEstimate] = useState<{ usd: number; lines: string[]; regenerate: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const activeJob = jobs.find((j) => j.kind !== 'render' && ['queued', 'running'].includes(j.status))
  const lastJob = jobs.find((j) => j.kind !== 'render')
  const chosen = [...lengths, ...(Number(custom) >= 10 && Number(custom) <= 180 ? [Number(custom)] : [])]

  async function ask(regenerate: boolean) {
    setBusy(true)
    try {
      const { estimate: e } = await api<{ estimate: { usd: number; lines: string[] } }>(session.access_token, '/api/admin/estimate', { kind: 'analyze', assetId: asset.id, lengths: chosen, count })
      setEstimate({ ...e, regenerate })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    if (!estimate) return
    setBusy(true)
    try {
      const r = await api<{ duplicate: boolean; status?: string }>(session.access_token, '/api/admin/start-job', { kind: 'analyze', assetId: asset.id, lengths: chosen, count, regenerate: estimate.regenerate, confirm: true })
      toast(r.duplicate ? `This recording is already ${r.status === 'succeeded' ? 'analysed with these settings. Use Regenerate for new suggestions' : 'being analysed'}.` : 'Started. The video worker picks it up within 15 minutes, often sooner.')
      setEstimate(null)
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function cancel(jobId: string) {
    const { error } = await db.rpc('cancel_job', { job_id: jobId })
    if (error) return toast(friendlyError(error), 'error')
    toast('Cancelled')
    onChanged()
  }

  async function remove() {
    try {
      await api(session.access_token, '/api/admin/delete-asset', { assetId: asset.id })
      toast('Recording deleted')
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <div className="space-y-5">
      <Card title={asset.filename} actions={isOwner && <ConfirmButton label="Delete recording" confirm="Delete the file permanently?" danger onConfirm={() => void remove()} />}>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          <div>Length: {asset.duration_seconds ? formatSeconds(Number(asset.duration_seconds)) : 'unknown'}</div>
          {asset.width ? <div>Size: {asset.width}×{asset.height}</div> : null}
          <div>{mb(Number(asset.size_bytes))}</div>
          <div>Uploaded {when(asset.created_at)}</div>
          {asset.youtube_id && (
            <a className="font-semibold text-blue-ink underline" href={`https://www.youtube.com/watch?v=${asset.youtube_id}`} target="_blank" rel="noopener noreferrer">
              On YouTube
            </a>
          )}
        </dl>

        {activeJob ? (
          <div className="mt-4 rounded-lg bg-bone p-3" role="status">
            <p className="font-semibold">{activeJob.status === 'queued' ? 'Waiting for the video worker…' : activeJob.message || 'Working…'}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-line" aria-hidden>
              <div className="h-full bg-blue transition-all" style={{ width: `${activeJob.progress}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">
              {activeJob.progress}% · estimated cost {money(Number(activeJob.estimated_cost_usd))}
            </p>
            <ConfirmButton label="Cancel" confirm="Stop this job?" onConfirm={() => void cancel(activeJob.id)} className="mt-2" />
          </div>
        ) : (
          isWriter && (
            <div className="mt-4 rounded-lg border border-line p-3">
              <p className="font-semibold">{clips.length ? 'Find more clips' : 'Find clips'}</p>
              <p className="text-sm text-muted">Transcribes the recording with word timings, then picks moments that start and end on full sentences.</p>
              <fieldset className="mt-3">
                <legend className={labelClass}>Clip lengths</legend>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  {CLIP_LENGTHS.map((n) => (
                    <label key={n} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" className="size-4 accent-blue" checked={lengths.includes(n)} onChange={(e) => setLengths((l) => (e.target.checked ? [...l, n] : l.filter((x) => x !== n)))} /> {n} s
                    </label>
                  ))}
                  <label className="flex items-center gap-1.5 text-sm">
                    Custom
                    <input type="number" min={10} max={180} className={`${inputClass} min-h-9 w-20 px-2`} value={custom} onChange={(e) => setCustom(e.target.value)} /> s
                  </label>
                </div>
              </fieldset>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <span className="font-semibold">How many clips</span>
                <input type="number" min={1} max={30} className={`${inputClass} min-h-9 w-20 px-2`} value={count} onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
              </label>
              {estimate ? (
                <div className="mt-3 rounded-lg bg-yellow/15 p-3">
                  <p className="font-semibold">Estimated cost: {money(estimate.usd)}</p>
                  <ul className="mt-1 list-disc pl-5 text-sm">{estimate.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                  <p className="mt-1 text-xs text-muted">Estimates only. Actual costs are recorded in Settings → AI and costs.</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={busy} className={buttonClass('primary', 'sm')} onClick={() => void start()}>
                      Confirm and start
                    </button>
                    <button type="button" className={buttonClass('outline', 'sm')} onClick={() => setEstimate(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={busy || !chosen.length || asset.status !== 'ready'} className={buttonClass('primary', 'sm')} onClick={() => void ask(false)}>
                    <Sparkles className="size-4" aria-hidden /> {clips.length ? 'Check cost' : 'Check cost to find clips'}
                  </button>
                  {clips.length > 0 && (
                    <button type="button" disabled={busy || !chosen.length} className={buttonClass('outline', 'sm')} onClick={() => void ask(true)}>
                      <RefreshCw className="size-4" aria-hidden /> Regenerate suggestions
                    </button>
                  )}
                </div>
              )}
              {lastJob?.status === 'failed' && <p className="mt-2 text-sm text-danger">Last attempt failed: {lastJob.error}</p>}
            </div>
          )
        )}
      </Card>

      {clips.length === 0 ? (
        <Empty title="No clips for this recording yet.">{activeJob ? 'They appear here when the analysis finishes.' : 'Use Find clips above.'}</Empty>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {clips.map((c) => (
            <li key={c.id}>
              <ClipCard clip={c} job={jobs.find((j) => j.payload.clipId === c.id && ['queued', 'running'].includes(j.status))} onEdit={() => onEdit(c.id)} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Short-lived link to a private file, for previews and downloads. */
function useSignedUrl(bucket: string, path: string | undefined) {
  const { db } = useAdmin()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (path) void db.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => live && setUrl(data?.signedUrl ?? null))
    return () => {
      live = false
    }
  }, [db, bucket, path])
  return path ? url : null
}

function ClipCard({ clip, job, onEdit, onChanged }: { clip: Clip; job: Job | undefined; onEdit: () => void; onChanged: () => void }) {
  const { db, session, isWriter, isOwner, toast } = useAdmin()
  const [busy, setBusy] = useState(false)
  const [sendTo, setSendTo] = useState<Platform[] | null>(null)
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [renderEstimate, setRenderEstimate] = useState<{ final: boolean; usd: number; lines: string[] } | null>(null)
  const [paths, setPaths] = useState<{ preview?: string; final?: string }>({})
  useEffect(() => {
    const ids = [clip.preview_asset_id, clip.final_asset_id].filter(Boolean) as string[]
    if (!ids.length) return
    void db.from('media_assets').select('id, path').in('id', ids).then(({ data }) => {
      const rows = (data ?? []) as { id: string; path: string }[]
      setPaths({ preview: rows.find((r) => r.id === clip.preview_asset_id)?.path, final: rows.find((r) => r.id === clip.final_asset_id)?.path })
    })
  }, [db, clip.preview_asset_id, clip.final_asset_id])
  const video = useSignedUrl('media', paths.final ?? paths.preview)
  const length = clipLength(Number(clip.start_s), Number(clip.end_s), clip.cuts)

  async function render(final: boolean, confirm: boolean) {
    setBusy(true)
    try {
      if (!confirm) {
        const { estimate } = await api<{ estimate: { usd: number; lines: string[] } }>(session.access_token, '/api/admin/estimate', { kind: 'render', clipId: clip.id, final })
        setRenderEstimate({ final, ...estimate })
      } else {
        const r = await api<{ duplicate: boolean }>(session.access_token, '/api/admin/start-job', { kind: 'render', clipId: clip.id, final, confirm: true })
        toast(r.duplicate ? 'This version is already rendering or rendered.' : 'Rendering. It appears here when it’s ready.')
        setRenderEstimate(null)
        onChanged()
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function rpc(name: string, args: Record<string, unknown>, done: string) {
    setBusy(true)
    const { error } = await db.rpc(name, args)
    setBusy(false)
    if (error) return toast(friendlyError(error), 'error')
    toast(done)
    onChanged()
  }

  return (
    <article className="rounded-xl border border-line bg-paper p-4">
      <header className="flex flex-wrap items-center gap-2">
        <Badge className={STATUS_TONE[clip.status]}>{CLIP_STATUS[clip.status]}</Badge>
        <Badge className="bg-bone text-ink">{CLIP_CATEGORY[clip.category] ?? clip.category}</Badge>
        <span className="ml-auto text-xs text-muted tabular-nums">
          {formatSeconds(Number(clip.start_s))}–{formatSeconds(Number(clip.end_s))} · {Math.round(length)} s{clip.score ? ` · score ${clip.score}` : ''}
        </span>
      </header>
      <h3 className="mt-2 text-lg font-semibold">{clip.title}</h3>
      {clip.reason && <p className="text-sm text-muted">{clip.reason}</p>}
      {video ? (
        <video src={video} controls playsInline preload="metadata" className="mt-3 aspect-[9/16] max-h-96 rounded-lg bg-ink" aria-label={`${paths.final ? 'Final' : 'Preview'} of ${clip.title}`} />
      ) : job ? (
        <p className="mt-3 rounded-lg bg-bone p-3 text-sm" role="status">
          {job.status === 'queued' ? 'Waiting for the video worker…' : `${job.message} (${job.progress}%)`}
        </p>
      ) : null}
      {clip.status === 'rejected' && clip.rejection_reason && <p className="mt-2 text-sm text-danger">Rejected: {clip.rejection_reason}</p>}
      <Warnings items={clip.captions?.warnings} />

      {renderEstimate && (
        <div className="mt-3 rounded-lg bg-yellow/15 p-3 text-sm">
          <p className="font-semibold">Estimated cost: {money(renderEstimate.usd)}</p>
          <p>{renderEstimate.lines.join(' ')}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} className={buttonClass('primary', 'sm')} onClick={() => void render(renderEstimate.final, true)}>
              Confirm and render
            </button>
            <button type="button" className={buttonClass('outline', 'sm')} onClick={() => setRenderEstimate(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {isWriter && !['sent_to_social', 'rendering'].includes(clip.status) && (
          <button type="button" className={buttonClass('outline', 'sm')} onClick={onEdit}>
            <Pencil className="size-4" aria-hidden /> Edit
          </button>
        )}
        {isWriter && !['approved', 'sent_to_social', 'rendering'].includes(clip.status) && !job && (
          <>
            <button type="button" disabled={busy} className={buttonClass('outline', 'sm')} onClick={() => void render(false, false)}>
              Preview
            </button>
            <button type="button" disabled={busy} className={buttonClass('dark', 'sm')} onClick={() => void render(true, false)}>
              Render final
            </button>
          </>
        )}
        {isOwner && clip.final_asset_id && ['rendered', 'preview_ready', 'rejected'].includes(clip.status) && (
          <button type="button" disabled={busy} className={buttonClass('primary', 'sm', '!border-[#1f7a4d] !bg-[#1f7a4d]')} onClick={() => void rpc('approve_clip', { clip_id: clip.id }, 'Approved')}>
            <Check className="size-4" aria-hidden /> Approve
          </button>
        )}
        {isOwner && !['sent_to_social', 'rejected'].includes(clip.status) && (
          <button type="button" className={buttonClass('outline', 'sm')} onClick={() => setRejecting(!rejecting)}>
            <X className="size-4" aria-hidden /> Reject
          </button>
        )}
        {clip.status === 'approved' && isWriter && (
          <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setSendTo(sendTo ? null : ['tiktok', 'instagram', 'youtube', 'facebook'])}>
            <Send className="size-4" aria-hidden /> Send to Social
          </button>
        )}
        {paths.final && video && (
          <a href={video} download className={buttonClass('outline', 'sm')}>
            <Download className="size-4" aria-hidden /> Download
          </a>
        )}
      </div>

      {rejecting && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className={labelClass}>Why? (optional)</span>
            <input className={`${inputClass} mt-1 min-h-10`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" className={buttonClass('dark', 'sm', '!border-danger !bg-danger')} onClick={() => void rpc('reject_clip', { clip_id: clip.id, reason }, 'Rejected').then(() => setRejecting(false))}>
            Reject clip
          </button>
        </div>
      )}

      {sendTo && (
        <div className="mt-3 rounded-lg border border-line p-3">
          <p className="text-sm font-semibold">Create posts for:</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {PLATFORM_KEYS.map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="size-4 accent-blue" checked={sendTo.includes(p)} onChange={(e) => setSendTo((s) => (e.target.checked ? [...(s ?? []), p] : (s ?? []).filter((x) => x !== p)))} /> {PLATFORMS[p].label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Each post uses this clip’s caption for that platform and waits for an owner’s approval in the Social Media Manager.</p>
          <button type="button" disabled={busy || !sendTo.length} className={buttonClass('primary', 'sm', 'mt-2')} onClick={() => void rpc('send_clip_to_social', { clip_id: clip.id, platforms: sendTo }, 'Posts created and waiting for approval').then(() => setSendTo(null))}>
            Create {sendTo.length} post{sendTo.length === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </article>
  )
}

// ---------------------------------------------------------------------------
// Clip editor
// ---------------------------------------------------------------------------

function ClipEditor({ clip, source, assets, onClose, onChanged }: { clip: Clip; source: Asset; assets: Asset[]; onClose: () => void; onChanged: () => void }) {
  const { db, session, toast } = useAdmin()
  const [tab, setTab] = useState<'trim' | 'frame' | 'subtitles' | 'look' | 'captions'>('trim')
  const [start, setStart] = useState(Number(clip.start_s))
  const [end, setEnd] = useState(Number(clip.end_s))
  const [cuts, setCuts] = useState<[number, number][]>(clip.cuts ?? [])
  const [crop, setCrop] = useState<Crop>(() => readCrop(clip.crop))
  const [cues, setCues] = useState<Cue[]>(() => readCues(clip.subtitles))
  const [style, setStyle] = useState<ClipStyle>(() => readStyle(clip.style))
  const [title, setTitle] = useState(clip.title)
  const [captions, setCaptions] = useState<ClipCaptions>(clip.captions ?? {})
  const [busy, setBusy] = useState(false)
  const [mark, setMark] = useState<number | null>(null)
  const player = useRef<HTMLVideoElement>(null)
  const sourceUrl = useSignedUrl(source.bucket, source.path)
  const length = clipLength(start, end, cuts)
  const now = () => Math.round((player.current?.currentTime ?? 0) * 10) / 10
  const changedVideo = start !== Number(clip.start_s) || end !== Number(clip.end_s) || JSON.stringify(cuts) !== JSON.stringify(clip.cuts ?? []) || JSON.stringify(crop) !== JSON.stringify(readCrop(clip.crop))

  useEffect(() => {
    if (player.current && sourceUrl) player.current.currentTime = start
    // Only when the video first loads.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [sourceUrl])

  async function save() {
    if (end <= start || end - start > 180) return toast('A clip must end after it starts and be at most 3 minutes.', 'error')
    setBusy(true)
    const { error } = await db.from('video_clips').update({ title: title.trim(), start_s: start, end_s: end, cuts, crop, subtitles: cues, style, captions }).eq('id', clip.id)
    setBusy(false)
    if (error) return toast(friendlyError(error), 'error')
    toast(clip.status === 'approved' ? 'Saved. The clip needs rendering and approving again.' : 'Saved. Render a preview to see it.')
    onChanged()
  }

  /** Split: this clip ends here and a new clip starts here. */
  async function split() {
    const t = now()
    if (t <= start + 3 || t >= end - 3) return toast('Move the player to a point inside the clip (at least 3 s from either end).', 'error')
    setBusy(true)
    const { error } = await db.from('video_clips').insert({ asset_id: clip.asset_id, project_id: null, title: `${title} (part 2)`, start_s: t, end_s: end, category: clip.category, reason: clip.reason, crop, style, captions })
    if (!error) await db.from('video_clips').update({ end_s: t }).eq('id', clip.id)
    setBusy(false)
    if (error) return toast(friendlyError(error), 'error')
    setEnd(t)
    toast('Split into two clips')
    onChanged()
  }

  async function regenerateCaptions() {
    setBusy(true)
    try {
      setCaptions(await api<ClipCaptions>(session.access_token, '/api/ai/clip-captions', { clipId: clip.id }))
      toast('New captions written. Review them, then save.')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function subtitlesFromTranscript() {
    const { data } = await db.from('transcripts').select('segments').eq('asset_id', clip.asset_id).maybeSingle()
    if (!data) return toast('No transcript for this recording.', 'error')
    const { allWords, buildCues } = await import('../lib/clips')
    setCues(buildCues(allWords((data as { segments: never }).segments), start, end, cuts))
    toast('Subtitles rebuilt from the transcript for the current trim.')
  }

  const extras = (kind: string) => assets.filter((a) => a.kind === kind && a.status === 'ready')
  const x = crop.mode === 'left' ? 0.15 : crop.mode === 'right' ? 0.85 : crop.mode === 'center' ? 0.5 : crop.x
  const sourceRatio = source.width && source.height ? source.width / source.height : 16 / 9
  const boxWidth = Math.min(1, (9 / 16) / sourceRatio) * 100

  return (
    <Drawer title={`Edit clip: ${clip.title}`} onClose={onClose} wide>
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <div className="relative overflow-hidden rounded-lg bg-ink">
            {sourceUrl ? <video ref={player} src={sourceUrl} controls playsInline preload="metadata" className="w-full" aria-label="Original recording" /> : <div className="aspect-video" />}
            {tab === 'frame' && crop.mode !== 'split' && (
              <div className="pointer-events-none absolute inset-y-0 border-2 border-yellow bg-yellow/10" style={{ width: `${boxWidth}%`, left: `${x * (100 - boxWidth)}%` }} aria-hidden />
            )}
          </div>
          <p className="mt-1 text-xs text-muted">The original recording. Play it to find the moments you want; the buttons below use the player’s current time.</p>
          <div className="mt-4">
            <Tabs label="Editing" value={tab} onChange={setTab} tabs={{ trim: 'Trim and cut', frame: 'Framing', subtitles: 'Subtitles', look: 'Branding and sound', captions: 'Titles and captions' }} />
          </div>

          <div className="mt-4">
            {tab === 'trim' && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <TimeField label="Starts at" value={start} onChange={setStart} onNow={() => setStart(now())} />
                  <TimeField label="Ends at" value={end} onChange={setEnd} onNow={() => setEnd(now())} />
                </div>
                <p className="text-sm">
                  Length after cuts: <strong>{Math.round(length)} seconds</strong>
                  {length > 60 && ' (YouTube Shorts and Reels work best under 60 s)'}
                </p>
                <div>
                  <p className={labelClass}>Remove parts from the middle</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button type="button" className={buttonClass('outline', 'sm')} onClick={() => setMark(now())}>
                      {mark === null ? 'Mark start of the part to remove' : `Marked ${formatSeconds(mark)}`}
                    </button>
                    {mark !== null && (
                      <button type="button" className={buttonClass('dark', 'sm')} onClick={() => (now() > mark ? (setCuts((c) => [...c, [mark, now()]]), setMark(null)) : toast('Play forward past the mark first.', 'error'))}>
                        Remove up to here
                      </button>
                    )}
                    <button type="button" disabled={busy} className={buttonClass('outline', 'sm')} onClick={() => void split()}>
                      <Scissors className="size-4" aria-hidden /> Split into two clips here
                    </button>
                  </div>
                  {cuts.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm">
                      {cuts.map(([a, b], i) => (
                        <li key={`${a}-${b}`} className="flex items-center gap-2">
                          Removed {formatSeconds(a)}–{formatSeconds(b)}
                          <button type="button" className="font-semibold text-blue-ink underline" onClick={() => setCuts((c) => c.filter((_, k) => k !== i))}>
                            Put back
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {changedVideo && cues.length > 0 && <Notice kind="warn">You’ve changed the timing. Rebuild the subtitles (Subtitles tab) so they match.</Notice>}
              </div>
            )}

            {tab === 'frame' && (
              <div className="space-y-4">
                <label className="block">
                  <span className={labelClass}>What stays in the vertical frame</span>
                  <select className={`${inputClass} mt-1 min-h-11`} value={crop.mode} onChange={(e) => setCrop({ ...crop, mode: e.target.value as CropMode })}>
                    {Object.entries(CROP_MODES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                {(crop.mode === 'custom' || crop.mode === 'split') && (
                  <label className="block">
                    <span className={labelClass}>{crop.mode === 'split' ? 'Top speaker position' : 'Position'}</span>
                    <input type="range" min={0} max={1} step={0.01} className="mt-1 w-full accent-blue" value={crop.x} onChange={(e) => setCrop({ ...crop, x: Number(e.target.value) })} />
                  </label>
                )}
                {crop.mode === 'split' && (
                  <label className="block">
                    <span className={labelClass}>Bottom speaker position</span>
                    <input type="range" min={0} max={1} step={0.01} className="mt-1 w-full accent-blue" value={crop.x2 ?? 0.5} onChange={(e) => setCrop({ ...crop, x2: Number(e.target.value) })} />
                  </label>
                )}
                <p className="text-sm text-muted">The yellow box on the player shows the part that stays. Automatic speaker tracking isn’t available, so choose the framing that keeps the person speaking in view; use Split screen for two people side by side.</p>
              </div>
            )}

            {tab === 'subtitles' && (
              <div className="space-y-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="size-5 accent-blue" checked={Boolean(style.subtitles)} onChange={(e) => setStyle({ ...style, subtitles: e.target.checked ? (style.subtitles ?? DEFAULT_SUBTITLES) : null })} /> Burn in subtitles
                </label>
                {style.subtitles && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label>
                      <span className={labelClass}>Font</span>
                      <select className={`${inputClass} mt-1 min-h-10`} value={style.subtitles.font} onChange={(e) => setStyle({ ...style, subtitles: { ...style.subtitles!, font: e.target.value as never } })}>
                        {SUBTITLE_FONTS.map((f) => <option key={f}>{f}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className={labelClass}>Background</span>
                      <select className={`${inputClass} mt-1 min-h-10`} value={style.subtitles.background} onChange={(e) => setStyle({ ...style, subtitles: { ...style.subtitles!, background: e.target.value as never } })}>
                        <option value="shadow">Outline and shadow</option>
                        <option value="box">Dark box</option>
                        <option value="none">Outline only</option>
                      </select>
                    </label>
                    <label>
                      <span className={labelClass}>Size</span>
                      <input type="range" min={0.03} max={0.07} step={0.002} className="mt-2 w-full accent-blue" value={style.subtitles.size} onChange={(e) => setStyle({ ...style, subtitles: { ...style.subtitles!, size: Number(e.target.value) } })} />
                    </label>
                    <label>
                      <span className={labelClass}>Height from the bottom</span>
                      <input type="range" min={0.08} max={0.6} step={0.01} className="mt-2 w-full accent-blue" value={style.subtitles.position} onChange={(e) => setStyle({ ...style, subtitles: { ...style.subtitles!, position: Number(e.target.value) } })} />
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="size-4 accent-blue" checked={style.subtitles.highlight} onChange={(e) => setStyle({ ...style, subtitles: { ...style.subtitles!, highlight: e.target.checked } })} /> Highlight each word as it’s spoken
                      <input type="color" aria-label="Highlight colour" value={style.subtitles.highlightColor} onChange={(e) => setStyle({ ...style, subtitles: { ...style.subtitles!, highlightColor: e.target.value } })} />
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="size-4 accent-blue" checked={style.subtitles.uppercase} onChange={(e) => setStyle({ ...style, subtitles: { ...style.subtitles!, uppercase: e.target.checked } })} /> Capital letters
                    </label>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <p className={labelClass}>Subtitle text ({cues.length} lines)</p>
                  <button type="button" className={buttonClass('outline', 'sm')} onClick={() => void subtitlesFromTranscript()}>
                    Rebuild from transcript
                  </button>
                </div>
                <p className="text-sm text-muted">Correct any transcription mistakes. Times are seconds from the start of the clip.</p>
                <ol className="space-y-2">
                  {cues.map((c, i) => (
                    <li key={`${c.start}-${i}`} className="flex gap-2">
                      <span className="w-20 shrink-0 pt-2 text-xs text-muted tabular-nums">
                        {c.start.toFixed(1)}–{c.end.toFixed(1)}
                      </span>
                      <textarea rows={2} aria-label={`Subtitle ${i + 1}`} className={`${inputClass} py-1.5 text-sm`} value={c.text} onChange={(e) => setCues((list) => list.map((x, k) => (k === i ? retimeCue(x, e.target.value) : x)))} />
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {tab === 'look' && (
              <div className="space-y-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="size-5 accent-blue" checked={style.watermark} onChange={(e) => setStyle({ ...style, watermark: e.target.checked })} /> Noisemakers logo in the corner
                </label>
                <label className="block">
                  <span className={labelClass}>Title at the top (optional)</span>
                  <input maxLength={80} className={`${inputClass} mt-1 min-h-11`} value={style.titleOverlay} onChange={(e) => setStyle({ ...style, titleOverlay: e.target.value })} />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <AssetSelect label="Intro video (final render only)" kind="intro" options={extras('intro')} value={style.introAssetId} onChange={(v) => setStyle({ ...style, introAssetId: v })} onUploaded={onChanged} />
                  <AssetSelect label="Outro video (final render only)" kind="outro" options={extras('outro')} value={style.outroAssetId} onChange={(v) => setStyle({ ...style, outroAssetId: v })} onUploaded={onChanged} />
                </div>
                <label className="block">
                  <span className={labelClass}>Voice volume: {Math.round(style.volume * 100)}%</span>
                  <input type="range" min={0} max={2} step={0.05} className="mt-1 w-full accent-blue" value={style.volume} onChange={(e) => setStyle({ ...style, volume: Number(e.target.value) })} />
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="size-5 accent-blue" checked={style.denoise} onChange={(e) => setStyle({ ...style, denoise: e.target.checked })} /> Reduce background noise
                </label>
                <AssetSelect label="Background music" kind="music" options={extras('music')} value={style.musicAssetId} onChange={(v) => setStyle({ ...style, musicAssetId: v })} onUploaded={onChanged} />
                {style.musicAssetId && !extras('music').find((m) => m.id === style.musicAssetId)?.license_note.trim() && (
                  <Notice kind="warn">This track has no licence details, so it won’t be used. Only use music you have the rights to, and record where it came from when you upload it.</Notice>
                )}
                {style.musicAssetId && (
                  <label className="block">
                    <span className={labelClass}>Music volume: {Math.round(style.musicVolume * 100)}%</span>
                    <input type="range" min={0} max={0.6} step={0.01} className="mt-1 w-full accent-blue" value={style.musicVolume} onChange={(e) => setStyle({ ...style, musicVolume: Number(e.target.value) })} />
                  </label>
                )}
              </div>
            )}

            {tab === 'captions' && (
              <div className="space-y-3">
                <button type="button" disabled={busy} className={buttonClass('outline', 'sm')} onClick={() => void regenerateCaptions()}>
                  <Sparkles className="size-4" aria-hidden /> Write captions with AI
                </button>
                <p className="text-sm text-muted">Written only from what’s said in the clip. Check names and facts before approving.</p>
                <Warnings items={captions.warnings} />
                {(['youtube_title', 'youtube', 'tiktok', 'instagram', 'facebook', 'x', 'description'] as const).map((k) => (
                  <label key={k} className="block">
                    <span className={labelClass}>{{ youtube_title: 'YouTube Shorts title', youtube: 'YouTube Shorts description', tiktok: 'TikTok caption', instagram: 'Instagram Reels caption', facebook: 'Facebook Reels caption', x: 'X post', description: 'Short description' }[k]}</span>
                    <textarea rows={k === 'youtube_title' ? 1 : 3} className={`${inputClass} mt-1 py-2 text-sm`} value={captions[k] ?? ''} onChange={(e) => setCaptions({ ...captions, [k]: e.target.value })} />
                  </label>
                ))}
                <label className="block">
                  <span className={labelClass}>Hashtags (separated by spaces)</span>
                  <input className={`${inputClass} mt-1 min-h-10`} value={(captions.hashtags ?? []).join(' ')} onChange={(e) => setCaptions({ ...captions, hashtags: e.target.value.split(/\s+/).map((t) => t.replace(/^#/, '')).filter(Boolean).slice(0, 15) })} />
                </label>
                {captions.suggested_time && <p className="text-sm text-muted">Suggested posting time: {captions.suggested_time}</p>}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <Card title="Clip">
            <label className="block">
              <span className={labelClass}>Working title</span>
              <input maxLength={200} className={`${inputClass} mt-1 min-h-11`} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <p className="mt-3 text-sm">
              Status: <Badge className={STATUS_TONE[clip.status]}>{CLIP_STATUS[clip.status]}</Badge>
            </p>
            {['approved', 'rendered', 'preview_ready'].includes(clip.status) && changedVideo && <p className="mt-2 text-sm text-danger">Saving video changes clears the renders{clip.status === 'approved' ? ' and the approval' : ''}.</p>}
            <button type="button" disabled={busy} className={buttonClass('primary', 'md', 'mt-3 w-full')} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <p className="mt-2 text-xs text-muted">After saving, use Preview or Render final on the clip.</p>
          </Card>
        </div>
      </div>
    </Drawer>
  )
}

function TimeField({ label, value, onChange, onNow }: { label: string; value: number; onChange: (v: number) => void; onNow: () => void }) {
  return (
    <div>
      <span className={labelClass}>{label}</span>
      <div className="mt-1 flex items-center gap-1">
        <button type="button" className={buttonClass('outline', 'sm', '!px-3')} aria-label={`${label}: half a second earlier`} onClick={() => onChange(Math.max(0, Math.round((value - 0.5) * 10) / 10))}>
          −
        </button>
        <input type="number" step={0.1} min={0} aria-label={`${label} (seconds)`} className={`${inputClass} min-h-10 !w-24 px-2 tabular-nums`} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value)))} />
        <button type="button" className={buttonClass('outline', 'sm', '!px-3')} aria-label={`${label}: half a second later`} onClick={() => onChange(Math.round((value + 0.5) * 10) / 10)}>
          +
        </button>
        <button type="button" className="ml-1 text-sm font-semibold whitespace-nowrap text-blue-ink underline" onClick={onNow}>
          Use player time
        </button>
      </div>
      <span className="text-xs text-muted">{formatSeconds(value)}</span>
    </div>
  )
}

function AssetSelect({ label, kind, options, value, onChange, onUploaded }: { label: string; kind: 'intro' | 'outro' | 'music'; options: Asset[]; value: string; onChange: (v: string) => void; onUploaded: () => void }) {
  const { db, session, toast } = useAdmin()
  const [license, setLicense] = useState('')
  const [busy, setBusy] = useState(false)
  const id = `upload-${kind}`
  const accept = useMemo(() => (kind === 'music' ? 'audio/mpeg,audio/mp4,audio/wav' : 'video/mp4,video/quicktime,video/webm'), [kind])

  async function upload(file: File) {
    if (kind === 'music' && !license.trim()) return toast('First write where the music comes from and its licence.', 'error')
    setBusy(true)
    try {
      const { assetId } = await uploadFile(db, session.access_token, file, kind)
      if (license.trim()) await db.from('media_assets').update({ license_note: license.trim() }).eq('id', assetId)
      onChange(assetId)
      onUploaded()
      toast('Uploaded')
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : 'Upload failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label className="block">
        <span className={labelClass}>{label}</span>
        <select className={`${inputClass} mt-1 min-h-10`} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">None</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.filename}
            </option>
          ))}
        </select>
      </label>
      {kind === 'music' && (
        <label className="mt-2 block">
          <span className="text-xs font-semibold">Licence and source for a new track (required)</span>
          <input className={`${inputClass} mt-1 min-h-9 text-sm`} placeholder="e.g. Track name, from <library>, licence <ID>" value={license} onChange={(e) => setLicense(e.target.value)} />
        </label>
      )}
      <input id={id} type="file" accept={accept} className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      <label htmlFor={id} className="mt-1 inline-block cursor-pointer text-sm font-semibold text-blue-ink underline">
        {busy ? 'Uploading…' : 'Upload a new one'}
      </label>
    </div>
  )
}
