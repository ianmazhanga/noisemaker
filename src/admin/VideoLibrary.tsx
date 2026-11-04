import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Download, Pencil, Send, Upload, X } from 'lucide-react'
import { buttonClass } from '../components/ui/buttonClass'
import { inputClass } from '../components/inbox/shared'
import { isVideoFile, videoType } from '../lib/posting'
import { useAdmin, friendlyError } from './context'
import { Spinner } from './AdminApp'
import { ConfirmButton, Empty, Notice } from './ui'
import { api, day, labelClass, uploadFile, videoDuration } from './lib'
import { useLibrary, type LibraryVideo } from './videoLibraryData'

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`
const seconds = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '')

/** Upload a finished video: pick the file, check it, give it a title, save it. */
export function UploadVideo({ onSaved, compact = false }: { onSaved: (id: string) => void; compact?: boolean }) {
  const { db, session, isWriter, toast } = useAdmin()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [maxMb, setMaxMb] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void db.from('app_settings').select('max_upload_mb').maybeSingle().then(({ data }) => setMaxMb((data as { max_upload_mb: number } | null)?.max_upload_mb ?? null))
  }, [db])
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  if (!isWriter) return null

  function choose(f: File | undefined) {
    setError('')
    if (!f) return
    if (!isVideoFile(f)) return setError('Please choose an MP4 or MOV video. In CapCut, use Export and pick MP4.')
    if (maxMb && f.size > maxMb * 1024 * 1024) return setError(`This video is ${mb(f.size)}. The largest upload allowed is ${maxMb} MB (an owner can change this in Settings → AI and costs).`)
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 120))
  }

  async function save() {
    if (!file || !title.trim()) return
    setBusy(true)
    setError('')
    try {
      const typed = file.type === videoType(file) ? file : new File([file], file.name, { type: videoType(file) })
      const { assetId } = await uploadFile(db, session.access_token, typed, 'source_video', { durationSeconds: (await videoDuration(typed)) || undefined })
      const { error: e } = await db.from('media_assets').update({ filename: title.trim().slice(0, 255), license_note: description.trim().slice(0, 1000) }).eq('id', assetId)
      if (e) throw new Error(friendlyError(e))
      toast('Saved to your video library')
      setFile(null)
      setPreview('')
      setTitle('')
      setDescription('')
      if (input.current) input.current.value = ''
      onSaved(assetId)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const id = compact ? 'upload-video-compact' : 'upload-video'
  return (
    <div className="rounded-xl border border-line bg-paper p-4 md:p-5">
      {!file ? (
        <>
          <input ref={input} id={id} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
          <label htmlFor={id} className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink/20 p-6 text-center hover:border-blue hover:bg-blue/5">
            <Upload className="size-8 text-blue-ink" aria-hidden />
            <span className="text-lg font-semibold">Upload a finished video</span>
            <span className="text-sm text-muted">MP4 or MOV, straight from CapCut{maxMb ? ` · up to ${maxMb} MB` : ''}</span>
          </label>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <video src={preview} controls playsInline className="aspect-[9/16] w-full max-w-48 rounded-lg bg-ink object-contain" aria-label="Preview of the chosen video" />
          <div className="space-y-3">
            <label className="block">
              <span className={labelClass}>Title</span>
              <input maxLength={120} className={`${inputClass} mt-1 min-h-12`} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="block">
              <span className={labelClass}>Description (optional)</span>
              <textarea rows={3} maxLength={1000} className={`${inputClass} mt-1 py-2.5`} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <p className="text-sm text-muted">
              {file.name} · {mb(file.size)}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || !title.trim()} className={buttonClass('primary', 'lg')} onClick={() => void save()}>
                {busy ? 'Uploading… keep this page open' : 'Save to library'}
              </button>
              <button type="button" disabled={busy} className={buttonClass('outline', 'lg')} onClick={() => (setFile(null), setPreview(''), setError(''))}>
                Choose another
              </button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** The Video Production page's main view: upload, preview, edit, download and post. */
export default function VideoLibrary() {
  const { state, reload, urls } = useLibrary()
  if (state.status === 'loading') return <Spinner label="Loading your videos…" />
  if (state.status === 'missing') return <Notice kind="warn">The video library needs the newsroom database update (see docs/newsroom-setup.md).</Notice>
  if (state.status === 'error') return <Notice kind="error">{state.message}</Notice>
  return (
    <div className="space-y-6">
      <UploadVideo onSaved={() => void reload()} />
      {state.data.length === 0 ? (
        <Empty title="No videos yet.">Upload a video you’ve finished in CapCut, then post it to your social media.</Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {state.data.map((v) => (
            <li key={v.id}>
              <VideoCard video={v} url={urls[v.id]} onChanged={() => void reload()} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function VideoCard({ video, url, onChanged }: { video: LibraryVideo; url: string | undefined; onChanged: () => void }) {
  const { db, session, isOwner, isWriter, toast } = useAdmin()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(video.filename)
  const [description, setDescription] = useState(video.license_note)

  async function save() {
    const { error } = await db.from('media_assets').update({ filename: title.trim().slice(0, 255) || video.filename, license_note: description.trim().slice(0, 1000) }).eq('id', video.id)
    if (error) return toast(friendlyError(error), 'error')
    setEditing(false)
    toast('Saved')
    onChanged()
  }

  async function download() {
    const name = `${video.filename.replace(/[^\w\- ]+/g, '').trim() || 'video'}.${/\.mov$/i.test(video.path) ? 'mov' : 'mp4'}`
    const { data } = await db.storage.from(video.bucket).createSignedUrl(video.path, 600, { download: name })
    if (data?.signedUrl) window.location.assign(data.signedUrl)
    else toast('Couldn’t prepare the download. Try again.', 'error')
  }

  async function remove() {
    try {
      await api(session.access_token, '/api/admin/delete-asset', { assetId: video.id })
      toast('Video deleted')
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-paper">
      {url ? <video src={`${url}#t=0.5`} controls playsInline preload="metadata" className="aspect-[9/16] max-h-80 w-full bg-ink object-contain" aria-label={video.filename} /> : <div className="aspect-[9/16] max-h-80 bg-ink" />}
      <div className="flex flex-1 flex-col p-3">
        {editing ? (
          <div className="space-y-2">
            <input aria-label="Title" maxLength={120} className={`${inputClass} min-h-10`} value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea aria-label="Description" rows={2} maxLength={1000} className={`${inputClass} py-2 text-sm`} value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" className={buttonClass('dark', 'sm')} onClick={() => void save()}>
                Save
              </button>
              <button type="button" className={buttonClass('outline', 'sm')} onClick={() => setEditing(false)} aria-label="Cancel editing">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        ) : (
          <>
            <h3 className="font-semibold leading-snug">{video.filename}</h3>
            {video.license_note && <p className="mt-1 line-clamp-3 text-sm text-muted">{video.license_note}</p>}
            <p className="mt-1 text-xs text-muted">
              {day(video.created_at)} · {mb(Number(video.size_bytes))}
              {video.duration_seconds ? ` · ${seconds(Number(video.duration_seconds))}` : ''}
            </p>
          </>
        )}
        <div className="mt-auto flex flex-wrap gap-2 pt-3">
          {isWriter && (
            <Link to={`/admin/social?tab=new&video=${video.id}`} className={buttonClass('primary', 'sm')}>
              <Send className="size-4" aria-hidden /> Post this video
            </Link>
          )}
          <button type="button" className={buttonClass('outline', 'sm')} onClick={() => void download()} aria-label={`Download ${video.filename}`}>
            <Download className="size-4" aria-hidden />
          </button>
          {isWriter && !editing && (
            <button type="button" className={buttonClass('outline', 'sm')} onClick={() => setEditing(true)} aria-label={`Edit ${video.filename}`}>
              <Pencil className="size-4" aria-hidden />
            </button>
          )}
          {isOwner && <ConfirmButton label="Delete" confirm="Delete this video?" danger onConfirm={() => void remove()} />}
        </div>
      </div>
    </article>
  )
}
