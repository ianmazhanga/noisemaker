import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AlertTriangle, Check, Copy, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { buttonClass } from '../../components/ui/buttonClass'
import { inputClass } from '../../components/inbox/shared'
import { fullText, PLATFORMS, TIME_ZONES, formatInZone, zonedToUtc } from '../../lib/social'
import { CONNECTION_LABEL, connectionOf, groupPosts, hashtagsFrom, MANUAL_URL, OUTCOME_LABEL, outcomeOf, VIDEO_PLATFORM_LABEL, VIDEO_PLATFORMS, videoPosting, type Outcome, type Platform } from '../../lib/posting'
import { useAdmin, friendlyError } from '../context'
import { Spinner } from '../AdminApp'
import { Badge, Notice } from '../ui'
import { api, labelClass, when } from '../lib'
import { UploadVideo } from '../VideoLibrary'
import { useLibrary, type LibraryVideo } from '../videoLibraryData'
import { defaultZone, type AccountRow, type PostRow } from './shared'

const OUTCOME_TONE: Record<Outcome, string> = {
  published: 'bg-[#1f7a4d] text-white',
  failed: 'bg-danger text-white',
  scheduled: 'bg-blue text-white',
  draft: 'bg-line text-ink',
  waiting_approval: 'bg-yellow text-ink',
  manual: 'bg-yellow text-ink',
  publishing: 'bg-blue/15 text-blue-ink',
}

type When = 'now' | 'later'

/** Upload or pick a video → choose platforms → write the caption → publish, schedule or save. */
export function PostVideoTab({ posts, accounts, onChanged }: { posts: PostRow[]; accounts: AccountRow[]; onChanged: () => void }) {
  const { db, isOwner, isWriter, session, toast } = useAdmin()
  const [params, setParams] = useSearchParams()
  const library = useLibrary()
  const [videoId, setVideoId] = useState(params.get('video') ?? '')
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [caption, setCaption] = useState('')
  const [tags, setTags] = useState('')
  const [custom, setCustom] = useState<Partial<Record<Platform, { caption: string; tags: string }>>>({})
  const [showCustom, setShowCustom] = useState(false)
  const [whenMode, setWhenMode] = useState<When>('now')
  const [zone, setZone] = useState(() => defaultZone(TIME_ZONES))
  const [at, setAt] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [schedulerOn, setSchedulerOn] = useState<boolean | null>(null)

  // Is the scheduler actually running? It records a run every 15 minutes.
  useEffect(() => {
    void db
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .like('idempotency_key', 'cron:tick:%')
      .gte('created_at', new Date(Date.now() - 2 * 3600_000).toISOString())
      .then(({ count, error }) => setSchedulerOn(error ? null : (count ?? 0) > 0))
  }, [db])

  const videos = library.state.status === 'ready' ? library.state.data : []
  const video = videos.find((v) => v.id === videoId)
  const account = (p: Platform) => accounts.find((a) => a.platform === p)
  const textFor = (p: Platform) => (showCustom && custom[p] ? custom[p]! : { caption, tags })
  const tooLong = platforms.filter((p) => textFor(p).caption.trim().length > PLATFORMS[p].maxCaption)
  const ready = Boolean(video && platforms.length && platforms.every((p) => textFor(p).caption.trim()) && !tooLong.length)

  function toggle(p: Platform) {
    setPlatforms((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]))
  }

  async function create(action: 'draft' | 'now' | 'later') {
    if (!video) return
    let scheduledAt: string | null = null
    if (action === 'later') {
      try {
        scheduledAt = zonedToUtc(at, zone).toISOString()
      } catch {
        return toast('Choose the date and time to post.', 'error')
      }
      if (Date.parse(scheduledAt) < Date.now() + 60_000) return toast('Choose a time in the future.', 'error')
    }
    setBusy(action)
    try {
      const group = `video-post:${crypto.randomUUID()}`
      const rows = platforms.map((p) => ({
        platform: p,
        caption: textFor(p).caption.trim(),
        hashtags: hashtagsFrom(textFor(p).tags, PLATFORMS[p].maxHashtags),
        media_asset_id: video.id,
        source_type: 'manual',
        source_ref: group,
        source_title: video.filename.slice(0, 200),
        timezone: zone,
      }))
      const { data, error } = await db.from('social_posts').insert(rows).select('id, platform')
      if (error) throw new Error(friendlyError(error))
      const created = (data ?? []) as { id: string; platform: Platform }[]

      if (action === 'draft') toast('Saved as a draft')
      else if (!isOwner) {
        for (const c of created) await db.rpc('submit_post', { post_id: c.id })
        toast('Sent to an owner for approval')
      } else {
        const results: string[] = []
        for (const c of created) {
          const approve = await db.rpc('approve_post', { post_id: c.id })
          if (approve.error) throw new Error(friendlyError(approve.error))
          if (action === 'later') {
            const s = await db.rpc('schedule_post', { post_id: c.id, at: scheduledAt, tz: zone })
            if (s.error) throw new Error(friendlyError(s.error))
          } else if (videoPosting(c.platform, account(c.platform)).auto) {
            const { result } = await api<{ result: string }>(session.access_token, '/api/admin/publish-post', { postId: c.id }, 280_000).catch((e: Error) => ({ result: `error: ${e.message}` }))
            results.push(`${VIDEO_PLATFORM_LABEL[c.platform]}: ${result === 'published' ? 'published' : result === 'failed' || result === 'manual' ? 'failed (see below)' : result}`)
          }
        }
        toast(action === 'later' ? `Scheduled for ${formatInZone(scheduledAt!, zone)}` : results.length ? results.join(' · ') : 'Ready to post by hand: see below')
      }
      setPlatforms([])
      setCaption('')
      setTags('')
      setCustom({})
      setParams((p) => (p.delete('video'), p))
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const groups = useMemo(() => groupPosts(posts), [posts])

  if (!isWriter) return <History groups={groups} videos={videos} urls={library.urls} accounts={accounts} schedulerOn={schedulerOn} onChanged={onChanged} />

  return (
    <div className="space-y-10">
      <section aria-labelledby="new-post" className="space-y-6">
        <h2 id="new-post" className="sr-only">
          Post a video
        </h2>

        <Step n={1} title="Choose a video">
          {library.state.status === 'loading' ? (
            <Spinner label="Loading your videos…" />
          ) : (
            <>
              {videos.length > 0 && (
                <ul className="flex gap-3 overflow-x-auto pb-2">
                  {videos.slice(0, 30).map((v) => (
                    <li key={v.id} className="w-28 shrink-0">
                      <button type="button" onClick={() => setVideoId(v.id)} aria-pressed={videoId === v.id} className={`block w-full overflow-hidden rounded-lg border-2 text-left ${videoId === v.id ? 'border-blue' : 'border-transparent'}`}>
                        {library.urls[v.id] ? <video src={`${library.urls[v.id]}#t=0.5`} muted playsInline preload="metadata" className="pointer-events-none aspect-[9/16] w-full bg-ink object-cover" aria-hidden /> : <span className="block aspect-[9/16] bg-ink" />}
                        <span className="block truncate px-1 py-1 text-xs font-semibold">{v.filename}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <details className="mt-2" open={videos.length === 0}>
                <summary className="cursor-pointer font-semibold text-blue-ink">Upload a new video</summary>
                <div className="mt-3">
                  <UploadVideo compact onSaved={(id) => (void library.reload(), setVideoId(id))} />
                </div>
              </details>
              {video && (
                <div className="mt-4 flex flex-col gap-4 rounded-xl bg-bone p-3 sm:flex-row">
                  {library.urls[video.id] && <video src={library.urls[video.id]} controls playsInline className="aspect-[9/16] max-h-80 w-full rounded-lg bg-ink object-contain sm:w-44" aria-label={`Preview of ${video.filename}`} />}
                  <div>
                    <p className="text-sm font-semibold text-muted">Chosen video</p>
                    <p className="text-lg font-semibold">{video.filename}</p>
                    {video.license_note && <p className="mt-1 text-sm text-muted">{video.license_note}</p>}
                  </div>
                </div>
              )}
            </>
          )}
        </Step>

        <Step n={2} title="Choose where to post">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {VIDEO_PLATFORMS.map((p) => {
              const c = connectionOf(account(p))
              const how = videoPosting(p, account(p))
              const on = platforms.includes(p)
              return (
                <li key={p}>
                  <label className={`flex h-full cursor-pointer items-start gap-3 rounded-xl border-2 p-3 ${on ? 'border-blue bg-blue/5' : 'border-line bg-paper'}`}>
                    <input type="checkbox" className="mt-1 size-5 accent-blue" checked={on} onChange={() => toggle(p)} />
                    <span>
                      <span className="block font-semibold">{VIDEO_PLATFORM_LABEL[p]}</span>
                      <span className={`block text-xs font-semibold ${c === 'connected' ? 'text-[#1f7a4d]' : 'text-muted'}`}>{CONNECTION_LABEL[c]}</span>
                      <span className="block text-xs text-muted">{how.auto ? 'Posts automatically' : 'You post it yourself (we help)'}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-sm text-muted">
            Connect accounts in the{' '}
            <Link to="/admin/social?tab=accounts" className="font-semibold text-blue-ink underline">
              Accounts
            </Link>{' '}
            tab. Until then, the dashboard gives you the video and caption to post yourself.
          </p>
        </Step>

        <Step n={3} title="Write the caption">
          <label className="block">
            <span className={labelClass}>Caption</span>
            <textarea rows={5} className={`${inputClass} mt-1 py-3`} placeholder="Write your caption here, or paste one from ChatGPT." value={caption} onChange={(e) => setCaption(e.target.value)} />
          </label>
          <label className="mt-3 block">
            <span className={labelClass}>Hashtags</span>
            <input className={`${inputClass} mt-1 min-h-12`} placeholder="#Noisemakers #Family #Hope" value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          {platforms.length > 1 && (
            <label className="mt-3 flex items-center gap-2">
              <input type="checkbox" className="size-5 accent-blue" checked={showCustom} onChange={(e) => setShowCustom(e.target.checked)} /> Use a different caption for some platforms
            </label>
          )}
          {showCustom && (
            <div className="mt-3 space-y-3">
              {platforms.map((p) => (
                <div key={p} className="rounded-lg border border-line p-3">
                  <p className="font-semibold">{VIDEO_PLATFORM_LABEL[p]}</p>
                  <textarea
                    rows={3}
                    aria-label={`${VIDEO_PLATFORM_LABEL[p]} caption`}
                    className={`${inputClass} mt-1 py-2`}
                    value={custom[p]?.caption ?? caption}
                    onChange={(e) => setCustom((c) => ({ ...c, [p]: { caption: e.target.value, tags: c[p]?.tags ?? tags } }))}
                  />
                  <input aria-label={`${VIDEO_PLATFORM_LABEL[p]} hashtags`} className={`${inputClass} mt-2 min-h-10`} value={custom[p]?.tags ?? tags} onChange={(e) => setCustom((c) => ({ ...c, [p]: { caption: c[p]?.caption ?? caption, tags: e.target.value } }))} />
                </div>
              ))}
            </div>
          )}
          {platforms.map((p) => {
            const n = textFor(p).caption.trim().length
            return n > PLATFORMS[p].maxCaption ? (
              <p key={p} className="mt-2 text-sm font-semibold text-danger">
                Too long for {VIDEO_PLATFORM_LABEL[p]}: {n} of {PLATFORMS[p].maxCaption} characters.
              </p>
            ) : null
          })}
        </Step>

        <Step n={4} title="Post it">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="When">
            {(['now', 'later'] as When[]).map((w) => (
              <button key={w} type="button" role="radio" aria-checked={whenMode === w} className={buttonClass(whenMode === w ? 'dark' : 'outline', 'md')} onClick={() => setWhenMode(w)}>
                {w === 'now' ? 'Now' : 'Later'}
              </button>
            ))}
          </div>
          {whenMode === 'later' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label>
                <span className={labelClass}>Date and time</span>
                <input type="datetime-local" className={`${inputClass} mt-1 min-h-12`} value={at} onChange={(e) => setAt(e.target.value)} />
              </label>
              <label>
                <span className={labelClass}>Time zone</span>
                <select className={`${inputClass} mt-1 min-h-12`} value={zone} onChange={(e) => setZone(e.target.value)}>
                  {TIME_ZONES.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </label>
              {schedulerOn === false && (
                <div className="sm:col-span-2">
                  <Notice kind="warn">Automatic scheduled posting isn’t running yet (the scheduler needs setting up: Settings → Integrations → Scheduler). Scheduled posts will wait for you to post them yourself.</Notice>
                </div>
              )}
            </div>
          )}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {isOwner ? (
              whenMode === 'now' ? (
                <button type="button" disabled={!ready || busy !== null} className={buttonClass('primary', 'lg')} onClick={() => void create('now')}>
                  {busy === 'now' ? 'Publishing… keep this page open' : 'Publish now'}
                </button>
              ) : (
                <button type="button" disabled={!ready || !at || busy !== null} className={buttonClass('primary', 'lg')} onClick={() => void create('later')}>
                  {busy === 'later' ? 'Scheduling…' : 'Schedule'}
                </button>
              )
            ) : (
              <button type="button" disabled={!ready || busy !== null} className={buttonClass('primary', 'lg')} onClick={() => void create('now')}>
                Send to an owner for approval
              </button>
            )}
            <button type="button" disabled={!video || !platforms.length || busy !== null} className={buttonClass('outline', 'lg')} onClick={() => void create('draft')}>
              {busy === 'draft' ? 'Saving…' : 'Save draft'}
            </button>
          </div>
          {!ready && <p className="mt-2 text-sm text-muted">Choose a video, at least one platform and write a caption.</p>}
        </Step>
      </section>

      <History groups={groups} videos={videos} urls={library.urls} accounts={accounts} schedulerOn={schedulerOn} onChanged={onChanged} />
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-4 md:p-5">
      <h3 className="flex items-center gap-3 text-xl font-semibold">
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-ink text-base text-paper" aria-hidden>
          {n}
        </span>
        {title}
      </h3>
      <div className="mt-4">{children}</div>
    </div>
  )
}

/** Each video post, with the real result on every platform it went to. */
function History({ groups, videos, urls, accounts, schedulerOn, onChanged }: { groups: { id: string; posts: PostRow[] }[]; videos: LibraryVideo[]; urls: Record<string, string>; accounts: AccountRow[]; schedulerOn: boolean | null; onChanged: () => void }) {
  return (
    <section aria-labelledby="video-posts">
      <h2 id="video-posts" className="text-2xl font-semibold">
        Your video posts
      </h2>
      {groups.length === 0 ? (
        <p className="mt-2 text-muted">Nothing posted yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {groups.slice(0, 50).map((g) => {
            const v = videos.find((x) => x.id === g.posts[0].media_asset_id)
            return (
              <li key={g.id} className="flex flex-col gap-4 rounded-xl border border-line bg-paper p-4 sm:flex-row">
                {v && urls[v.id] ? <video src={`${urls[v.id]}#t=0.5`} muted playsInline preload="metadata" className="aspect-[9/16] w-24 shrink-0 rounded-lg bg-ink object-cover" aria-hidden /> : <span className="hidden aspect-[9/16] w-24 shrink-0 rounded-lg bg-ink sm:block" />}
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold">{g.posts[0].source_title || 'Video post'}</p>
                  <p className="text-sm text-muted">Created {when(g.posts[0].created_at)}</p>
                  <ul className="mt-3 space-y-3">
                    {g.posts.map((p) => (
                      <PlatformRow key={p.id} post={p} video={v} url={v ? urls[v.id] : undefined} account={accounts.find((a) => a.platform === p.platform)} schedulerOn={schedulerOn} onChanged={onChanged} />
                    ))}
                  </ul>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function PlatformRow({ post, video, url, account, schedulerOn, onChanged }: { post: PostRow; video: LibraryVideo | undefined; url: string | undefined; account: AccountRow | undefined; schedulerOn: boolean | null; onChanged: () => void }) {
  const { db, session, isOwner, toast } = useAdmin()
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const how = videoPosting(post.platform as Platform, account)
  const outcome = outcomeOf(post, how.auto && (post.status !== 'scheduled' || schedulerOn !== false))
  const label = VIDEO_PLATFORM_LABEL[post.platform as Platform] ?? post.platform

  async function rpc(name: string, args: Record<string, unknown>, done: string) {
    setBusy(true)
    const { error } = await db.rpc(name, args)
    setBusy(false)
    if (error) return toast(friendlyError(error), 'error')
    toast(done)
    onChanged()
  }

  async function publish() {
    setBusy(true)
    try {
      const { result } = await api<{ result: string }>(session.access_token, '/api/admin/publish-post', { postId: post.id }, 280_000)
      toast(result === 'published' ? `Published to ${label}` : `Not published: ${result}. The reason is shown on the post.`, result === 'published' ? 'success' : 'error')
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullText(post.caption, post.hashtags))
      toast('Caption copied. Paste it into the app.')
    } catch {
      toast('Couldn’t copy. Select the text and copy it instead.', 'error')
    }
  }

  async function download() {
    if (!video) return
    const { data } = await db.storage.from(video.bucket).createSignedUrl(video.path, 600, { download: `${video.filename.replace(/[^\w\- ]+/g, '').trim() || 'video'}.${/\.mov$/i.test(video.path) ? 'mov' : 'mp4'}` })
    if (data?.signedUrl) window.location.assign(data.signedUrl)
  }

  return (
    <li className="rounded-lg bg-bone p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{label}</span>
        <Badge className={OUTCOME_TONE[outcome]}>{OUTCOME_LABEL[outcome]}</Badge>
        {post.scheduled_at && post.status === 'scheduled' && <span className="text-sm text-muted">{formatInZone(post.scheduled_at, post.timezone)} ({TIME_ZONES.find((z) => z.id === post.timezone)?.label ?? post.timezone})</span>}
        {post.published_at && <span className="text-sm text-muted">{when(post.published_at)}</span>}
        {post.published_url && (
          <a href={post.published_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-ink underline">
            View post
          </a>
        )}
      </div>
      {post.error_message && (
        <p className="mt-1 flex gap-1.5 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {post.error_message}
        </p>
      )}
      {(outcome === 'manual' || (outcome === 'scheduled' && !how.auto)) && <p className="mt-1 text-sm text-muted">{how.reason}</p>}

      <div className="mt-2 flex flex-wrap gap-2">
        {(outcome === 'manual' || outcome === 'failed' || (outcome === 'scheduled' && !how.auto)) && isOwner && (
          <button type="button" className={buttonClass('dark', 'sm')} onClick={() => setOpen(!open)}>
            Post it yourself
          </button>
        )}
        {outcome === 'failed' && isOwner && how.auto && (
          <button type="button" disabled={busy} className={buttonClass('outline', 'sm')} onClick={() => void rpc('retry_post', { post_id: post.id }, 'Ready to try again. Check the platform first so it isn’t posted twice.')}>
            <RefreshCw className="size-4" aria-hidden /> Try again
          </button>
        )}
        {isOwner && how.auto && post.status === 'approved' && !post.publish_started_at && (
          <button type="button" disabled={busy} className={buttonClass('primary', 'sm')} onClick={() => void publish()}>
            {busy ? 'Publishing…' : 'Publish now'}
          </button>
        )}
        {isOwner && post.status === 'scheduled' && (
          <button type="button" disabled={busy} className={buttonClass('outline', 'sm')} onClick={() => void rpc('schedule_post', { post_id: post.id, at: null, tz: null }, 'Schedule cancelled. The post is kept, ready to post or reschedule.')}>
            Cancel schedule
          </button>
        )}
        {post.status === 'draft' && isOwner && (
          <button type="button" disabled={busy} className={buttonClass('outline', 'sm')} onClick={() => void rpc('approve_post', { post_id: post.id }, 'Approved. Publish or schedule it from here or the All posts tab.')}>
            <Check className="size-4" aria-hidden /> Approve
          </button>
        )}
        {post.status !== 'published' && (
          <Link to={`/admin/social?status=${post.status}&open=${post.id}`} className={buttonClass('outline', 'sm')}>
            Edit or reschedule
          </Link>
        )}
      </div>

      {open && (
        <div className="mt-3 rounded-lg border border-line bg-paper p-3">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              <button type="button" className="inline-flex items-center gap-1 font-semibold text-blue-ink underline" onClick={() => void download()} disabled={!url}>
                <Download className="size-4" aria-hidden /> Download the video
              </button>
            </li>
            <li>
              <button type="button" className="inline-flex items-center gap-1 font-semibold text-blue-ink underline" onClick={() => void copy()}>
                <Copy className="size-4" aria-hidden /> Copy the caption
              </button>
            </li>
            <li>
              <a href={MANUAL_URL[post.platform as Platform]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-ink underline">
                <ExternalLink className="size-4" aria-hidden /> Open {label} and post it
              </a>
            </li>
            <li>Come back and confirm below once it’s live.</li>
          </ol>
          {post.approved_by ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex-1">
                <span className="text-sm font-semibold">Link to the post (optional)</span>
                <input type="url" className={`${inputClass} mt-1 min-h-11`} placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
              </label>
              <button type="button" disabled={busy || (link.trim() !== '' && !link.trim().startsWith('https://'))} className={buttonClass('primary', 'md')} onClick={() => void rpc('mark_post_published', { post_id: post.id, url: link.trim() }, `Marked as published on ${label}`)}>
                I’ve posted it
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">Approve it first, then confirm here once it’s live.</p>
          )}
        </div>
      )}
    </li>
  )
}
