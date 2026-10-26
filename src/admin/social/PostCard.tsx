import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, Paperclip, Pencil, RefreshCw, Send, Sparkles, Trash2, X } from 'lucide-react'
import { api, uploadFile, videoDuration } from '../lib'
import { buttonClass } from '../../components/ui/buttonClass'
import { inputClass } from '../../components/inbox/shared'
import { cleanHashtags, formatInZone, fullText, PLATFORMS, POSTING_GUIDANCE, STATUS_LABEL, TIME_ZONES, utcToZoned, zonedToUtc } from '../../lib/social'
import { useAdmin, friendlyError } from '../context'
import { PLATFORM_STYLE, requestDrafts, STATUS_STYLE, type AccountRow, type ChannelVideo, type PostRow } from './shared'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

interface Props {
  post: PostRow
  account: AccountRow | undefined
  video: ChannelVideo | undefined
  names: Record<string, string>
  zone: string
  open: boolean
  onChanged: () => void
}

/** One post, with the actions its status and the viewer's role allow. The database enforces the same rules. */
export function PostCard({ post, account, video, names, zone, open, onChanged }: Props) {
  const { db, isOwner, session, toast } = useAdmin()
  const info = PLATFORMS[post.platform]
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(post.caption)
  const [tags, setTags] = useState(post.hashtags.join(' '))
  const [link, setLink] = useState(post.link_url)
  const [busy, setBusy] = useState<string | null>(null)
  const [panel, setPanel] = useState<'reject' | 'schedule' | 'publish' | 'delete' | null>(null)
  const [reason, setReason] = useState('')
  const [scheduleZone, setScheduleZone] = useState(post.timezone || zone)
  const [scheduleAt, setScheduleAt] = useState(post.scheduled_at ? utcToZoned(new Date(post.scheduled_at), post.timezone || zone) : '')
  const [publishedUrl, setPublishedUrl] = useState('')

  const connected = account?.status ? account.status === 'connected' : Boolean(account?.provider)
  const hashtags = cleanHashtags(tags.split(/[\s,]+/), info.maxHashtags)
  const length = caption.trim().length
  const name = (id: string | null) => (id ? (names[id] ?? 'an owner') : '')

  async function run(label: string, action: () => PromiseLike<{ error: { message?: string; code?: string } | null }>, success: string) {
    setBusy(label)
    const { error } = await action()
    setBusy(null)
    if (error) {
      toast(friendlyError(error), 'error')
      return false
    }
    toast(success)
    setPanel(null)
    onChanged()
    return true
  }

  const save = () =>
    run('save', () => db.from('social_posts').update({ caption: caption.trim(), hashtags, link_url: link.trim() }).eq('id', post.id), post.status === 'approved' || post.status === 'scheduled' ? 'Saved. It needs approving again.' : 'Saved').then((ok) => ok && setEditing(false))

  async function regenerate() {
    if (!video) return
    setBusy('regenerate')
    try {
      const { drafts } = await requestDrafts(session.access_token, video, [post.platform], 1)
      const next = drafts[0]
      setCaption(next.caption)
      setTags(next.hashtags.join(' '))
      setEditing(true)
      toast(next.warnings.length ? `New wording ready. Check it: ${next.warnings[0]}` : 'New wording ready. Review it, then save.')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullText(post.caption, post.hashtags) + (post.link_url ? `\n\n${post.link_url}` : ''))
      toast('Copied. Paste it into the app.')
    } catch {
      toast('Couldn’t copy. Select the text and copy it instead.', 'error')
    }
  }

  function schedule() {
    let at: string
    try {
      at = zonedToUtc(scheduleAt, scheduleZone).toISOString()
    } catch {
      return toast('Choose a date and time.', 'error')
    }
    void run('schedule', () => db.rpc('schedule_post', { post_id: post.id, at, tz: scheduleZone }), `Scheduled for ${formatInZone(at, scheduleZone)}`)
  }

  async function publishNow() {
    setBusy('publish-now')
    try {
      const { result } = await api<{ result: string }>(session.access_token, '/api/admin/publish-post', { postId: post.id })
      const messages: Record<string, [string, 'success' | 'error']> = {
        published: [`Published to ${info.label}`, 'success'],
        failed: ['Publishing failed. The reason is on the post.', 'error'],
        manual: ['This post can’t be published automatically. The reason is on the post; publish it by hand.', 'error'],
        skipped: ['This post is already being published, or isn’t approved.', 'error'],
        'not-connected': [`${info.label} isn’t connected.`, 'error'],
      }
      const [text, kind] = messages[result] ?? ['Done', 'success']
      toast(text, kind)
      setPanel(null)
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const canEdit = post.status !== 'published' && !post.publish_started_at
  const showText = editing ? null : (
    <div className="rounded-lg bg-bone px-4 py-3">
      <p className="whitespace-pre-wrap">{post.caption || <span className="text-muted">No caption yet.</span>}</p>
      {post.hashtags.length > 0 && <p className="mt-2 text-sm font-semibold break-words text-blue-ink">{post.hashtags.map((h) => `#${h}`).join(' ')}</p>}
      {post.link_url && <p className="mt-2 text-sm break-all text-muted">{post.link_url}</p>}
    </div>
  )

  return (
    <article id={`post-${post.id}`} className={`scroll-mt-24 rounded-xl border bg-paper p-4 md:p-5 ${open ? 'border-ink/50 ring-2 ring-blue/30' : 'border-line'}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PLATFORM_STYLE[post.platform]}`}>{info.label}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[post.status]}`}>{STATUS_LABEL[post.status]}</span>
        {post.ai_generated && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue/10 px-2.5 py-0.5 text-xs font-semibold text-blue-ink">
            <Sparkles className="size-3" aria-hidden /> AI draft
          </span>
        )}
        {post.source_title && <span className="min-w-0 flex-1 truncate text-sm text-muted">From: {post.source_title}</span>}
        <span className="ml-auto text-xs text-muted">Updated {when(post.updated_at)}</span>
      </header>

      <div className="mt-3">
        {editing ? (
          <div className="space-y-3">
            <label className="block">
              <span className="flex justify-between text-sm font-semibold">
                Caption
                <span className={length > info.maxCaption ? 'text-danger' : 'text-muted'}>
                  {length} / {info.maxCaption}
                </span>
              </span>
              <textarea rows={6} className={`${inputClass} mt-1 py-3`} value={caption} onChange={(e) => setCaption(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Hashtags (up to {info.maxHashtags}, separated by spaces)</span>
              <input className={`${inputClass} mt-1 min-h-11`} value={tags} onChange={(e) => setTags(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Link (optional)</span>
              <input type="url" className={`${inputClass} mt-1 min-h-11`} placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
            </label>
            {(post.status === 'approved' || post.status === 'scheduled') && <p className="text-sm text-danger">Saving changes sends this post back for approval.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass('dark', 'sm')} disabled={busy !== null || !caption.trim() || length > info.maxCaption || (link.trim() !== '' && !link.trim().startsWith('https://'))} onClick={() => void save()}>
                Save
              </button>
              <button type="button" className={buttonClass('outline', 'sm')} onClick={() => (setEditing(false), setCaption(post.caption), setTags(post.hashtags.join(' ')), setLink(post.link_url))}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          showText
        )}
      </div>

      <Media post={post} editable={canEdit && editing} onChanged={onChanged} />

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
        {post.scheduled_at && (
          <div>
            <dt className="inline font-semibold text-ink">Scheduled: </dt>
            <dd className="inline">
              {formatInZone(post.scheduled_at, post.timezone)} ({TIME_ZONES.find((z) => z.id === post.timezone)?.label ?? post.timezone})
              {post.timezone !== zone && ` · ${formatInZone(post.scheduled_at, zone)} your time`}
            </dd>
          </div>
        )}
        {post.approved_at && (
          <div>
            <dt className="inline font-semibold text-ink">Approved: </dt>
            <dd className="inline">
              by {name(post.approved_by)}, {when(post.approved_at)}
            </dd>
          </div>
        )}
        {post.status === 'rejected' && post.rejected_at && (
          <div>
            <dt className="inline font-semibold text-ink">Rejected: </dt>
            <dd className="inline">
              by {name(post.rejected_by)}, {when(post.rejected_at)}
              {post.rejection_reason && ` · “${post.rejection_reason}”`}
            </dd>
          </div>
        )}
        {post.published_at && (
          <div>
            <dt className="inline font-semibold text-ink">Published: </dt>
            <dd className="inline">
              {when(post.published_at)}
              {post.published_url && (
                <>
                  {' · '}
                  <a className="font-semibold text-blue-ink underline underline-offset-2" href={post.published_url} target="_blank" rel="noopener noreferrer">
                    View post
                  </a>
                </>
              )}
            </dd>
          </div>
        )}
        {post.error_message && <div className="text-danger">Error: {post.error_message}</div>}
        {(post.status === 'approved' || post.status === 'pending_approval' || post.status === 'draft') && <div>Good times for {info.label}: {POSTING_GUIDANCE[post.platform]} (general guidance)</div>}
      </dl>

      {!editing && (
        <div className="mt-4 flex flex-wrap gap-2">
          {canEdit && (
            <button type="button" className={buttonClass('outline', 'sm')} onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden /> Edit
            </button>
          )}
          {canEdit && post.source_type === 'youtube' && video && (
            <button type="button" className={buttonClass('outline', 'sm')} disabled={busy !== null} onClick={() => void regenerate()}>
              <RefreshCw className="size-4" aria-hidden /> {busy === 'regenerate' ? 'Writing…' : 'Regenerate'}
            </button>
          )}
          {['draft', 'rejected', 'failed'].includes(post.status) && (
            <button type="button" className={buttonClass('dark', 'sm')} disabled={busy !== null} onClick={() => void run('submit', () => db.rpc('submit_post', { post_id: post.id }), 'Sent for approval')}>
              <Send className="size-4" aria-hidden /> Send for approval
            </button>
          )}
          {isOwner && ['draft', 'pending_approval', 'rejected'].includes(post.status) && (
            <button type="button" className={buttonClass('primary', 'sm', '!border-[#1f7a4d] !bg-[#1f7a4d]')} disabled={busy !== null} onClick={() => void run('approve', () => db.rpc('approve_post', { post_id: post.id }), 'Approved')}>
              <Check className="size-4" aria-hidden /> Approve
            </button>
          )}
          {isOwner && ['pending_approval', 'approved', 'scheduled'].includes(post.status) && (
            <button type="button" className={buttonClass('outline', 'sm')} onClick={() => setPanel(panel === 'reject' ? null : 'reject')}>
              <X className="size-4" aria-hidden /> Reject
            </button>
          )}
          {isOwner && ['approved', 'scheduled'].includes(post.status) && (
            <button type="button" className={buttonClass('outline', 'sm')} onClick={() => setPanel(panel === 'schedule' ? null : 'schedule')}>
              {post.status === 'scheduled' ? 'Change time' : 'Schedule'}
            </button>
          )}
          {isOwner && post.status === 'failed' && post.approved_by && (
            <button type="button" className={buttonClass('outline', 'sm')} disabled={busy !== null} onClick={() => void run('retry', () => db.rpc('retry_post', { post_id: post.id }), 'Back to Approved. Check the platform first, then publish or schedule it.')}>
              <RefreshCw className="size-4" aria-hidden /> Retry
            </button>
          )}
          {['approved', 'scheduled', 'failed'].includes(post.status) && post.approved_by && (
            <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setPanel(panel === 'publish' ? null : 'publish')}>
              Publish
            </button>
          )}
          {post.status !== 'published' && (isOwner || (post.created_by === session.user.id && ['draft', 'rejected'].includes(post.status))) && (
            <button type="button" className={buttonClass('outline', 'sm', 'ml-auto')} onClick={() => setPanel(panel === 'delete' ? null : 'delete')} aria-label="Delete post">
              <Trash2 className="size-4" aria-hidden />
            </button>
          )}
        </div>
      )}

      {panel === 'reject' && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-line p-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="text-sm font-semibold">Why? (optional, helps whoever rewrites it)</span>
            <input className={`${inputClass} mt-1 min-h-11`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" className={buttonClass('dark', 'sm', '!border-danger !bg-danger')} disabled={busy !== null} onClick={() => void run('reject', () => db.rpc('reject_post', { post_id: post.id, reason }), 'Rejected')}>
            Reject post
          </button>
        </div>
      )}

      {panel === 'schedule' && (
        <div className="mt-3 rounded-lg border border-line p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label>
              <span className="text-sm font-semibold">Date and time</span>
              <input type="datetime-local" className={`${inputClass} mt-1 min-h-11`} value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
            </label>
            <label>
              <span className="text-sm font-semibold">Time zone</span>
              <select className={`${inputClass} mt-1 min-h-11`} value={scheduleZone} onChange={(e) => setScheduleZone(e.target.value)}>
                {TIME_ZONES.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={buttonClass('dark', 'sm', 'sm:mb-0.5')} disabled={busy !== null || !scheduleAt} onClick={schedule}>
              Save time
            </button>
            {post.status === 'scheduled' && (
              <button type="button" className={buttonClass('outline', 'sm', 'sm:mb-0.5')} onClick={() => void run('unschedule', () => db.rpc('schedule_post', { post_id: post.id, at: null, tz: null }), 'Unscheduled')}>
                Unschedule
              </button>
            )}
          </div>
          {!connected && <p className="mt-2 text-sm text-muted">{info.label} isn’t connected yet, so a scheduled post won’t go out by itself. It shows on the calendar, and on the day you post it with the Publish button.</p>}
        </div>
      )}

      {panel === 'publish' && (
        <div className="mt-3 rounded-lg border border-line p-3">
          {connected ? (
            isOwner ? (
              <div className="mb-3">
                <p className="text-sm text-muted">{info.label} is connected, so this can be posted for you now. It’s published once: if anything goes wrong it’s marked Failed, never retried by itself.</p>
                <button type="button" className={buttonClass('primary', 'sm', 'mt-2')} disabled={busy !== null} onClick={() => void publishNow()}>
                  <Send className="size-4" aria-hidden /> {busy === 'publish-now' ? 'Publishing…' : `Publish to ${info.label} now`}
                </button>
                <p className="mt-3 text-sm text-muted">Or post it yourself:</p>
              </div>
            ) : (
              <p className="text-sm text-muted">An owner can publish this to {info.label} now, or it goes out at its scheduled time.</p>
            )
          ) : (
            <p className="text-sm text-muted">
              {info.label} isn’t connected, so the dashboard can’t post for you yet. Copy the text, post it in {info.label}, then mark it as published here.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClass('dark', 'sm')} onClick={() => void copy()}>
              <Copy className="size-4" aria-hidden /> Copy text
            </button>
            <a href={info.postUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('outline', 'sm')}>
              <ExternalLink className="size-4" aria-hidden /> Open {info.label}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
          {isOwner ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex-1">
                <span className="text-sm font-semibold">Link to the live post (optional)</span>
                <input type="url" className={`${inputClass} mt-1 min-h-11`} placeholder="https://" value={publishedUrl} onChange={(e) => setPublishedUrl(e.target.value)} />
              </label>
              <button
                type="button"
                className={buttonClass('primary', 'sm')}
                disabled={busy !== null || (publishedUrl.trim() !== '' && !publishedUrl.trim().startsWith('https://'))}
                onClick={() => void run('publish', () => db.rpc('mark_post_published', { post_id: post.id, url: publishedUrl.trim() }), 'Marked as published')}
              >
                Mark as published
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">An owner marks it as published once it’s live.</p>
          )}
        </div>
      )}

      {panel === 'delete' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 p-3">
          <span className="text-sm font-semibold text-danger">Delete this post permanently?</span>
          <button type="button" className={buttonClass('dark', 'sm', '!border-danger !bg-danger')} onClick={() => void run('delete', () => db.from('social_posts').delete().eq('id', post.id), 'Deleted')}>
            Yes, delete
          </button>
          <button type="button" className={buttonClass('outline', 'sm')} onClick={() => setPanel(null)}>
            Cancel
          </button>
        </div>
      )}
    </article>
  )
}

/** The image or video attached to a post (a rendered clip, or an upload). Changing it needs a new approval. */
function Media({ post, editable, onChanged }: { post: PostRow; editable: boolean; onChanged: () => void }) {
  const { db, session, toast } = useAdmin()
  const [file, setFile] = useState<{ url: string; mime: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const assetId = post.media_asset_id

  useEffect(() => {
    let live = true
    if (!assetId) return
    void db
      .from('media_assets')
      .select('bucket, path, mime_type, filename')
      .eq('id', assetId)
      .maybeSingle()
      .then(async ({ data }) => {
        const a = data as { bucket: string; path: string; mime_type: string; filename: string } | null
        if (!a) return
        const url = a.bucket === 'site-images' ? db.storage.from(a.bucket).getPublicUrl(a.path).data.publicUrl : (await db.storage.from(a.bucket).createSignedUrl(a.path, 3600)).data?.signedUrl
        if (live && url) setFile({ url, mime: a.mime_type, name: a.filename })
      })
    return () => {
      live = false
    }
  }, [db, assetId])

  async function attach(f: File) {
    setBusy(true)
    try {
      const kind = f.type.startsWith('image/') ? 'image' : 'source_video'
      const { assetId: id } = await uploadFile(db, session.access_token, f, kind, kind === 'source_video' ? { durationSeconds: (await videoDuration(f)) || undefined } : {})
      const { error } = await db.from('social_posts').update({ media_asset_id: id }).eq('id', post.id)
      if (error) throw new Error(friendlyError(error))
      toast(post.status === 'approved' || post.status === 'scheduled' ? 'Attached. The post needs approving again.' : 'Attached')
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function detach() {
    const { error } = await db.from('social_posts').update({ media_asset_id: null }).eq('id', post.id)
    if (error) return toast(friendlyError(error), 'error')
    setFile(null)
    onChanged()
  }

  // Before the newsroom migration there's no media column, so nothing to show.
  if (post.media_asset_id === undefined) return null
  const inputId = `media-${post.id}`
  return (
    <div className="mt-3">
      {assetId && file && (
        <div className="flex flex-wrap items-start gap-3">
          {file.mime.startsWith('image/') ? <img src={file.url} alt="" className="max-h-48 rounded-lg" /> : <video src={file.url} controls playsInline preload="metadata" className="max-h-64 rounded-lg bg-ink" aria-label={file.name} />}
          <div className="text-sm">
            <p className="font-semibold">{post.clip_id ? 'AI Short' : 'Attached file'}</p>
            <a href={file.url} download className="font-semibold text-blue-ink underline">
              Download
            </a>
            {editable && (
              <button type="button" className="ml-3 font-semibold text-danger underline" onClick={() => void detach()}>
                Remove
              </button>
            )}
          </div>
        </div>
      )}
      {editable && (
        <>
          <input id={inputId} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime" className="sr-only" onChange={(e) => e.target.files?.[0] && void attach(e.target.files[0])} />
          <label htmlFor={inputId} className={buttonClass('outline', 'sm', `mt-2 cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`)}>
            <Paperclip className="size-4" aria-hidden /> {busy ? 'Uploading…' : assetId ? 'Replace image or video' : 'Attach an image or video'}
          </label>
        </>
      )}
    </div>
  )
}
