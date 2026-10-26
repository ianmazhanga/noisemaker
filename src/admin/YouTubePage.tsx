import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Copy, ExternalLink, Megaphone, RefreshCw, Scissors, Sparkles } from 'lucide-react'
import { buttonClass } from '../components/ui/buttonClass'
import { inputClass } from '../components/inbox/shared'
import { formatSeconds } from '../lib/clips'
import { useAdmin } from './context'
import { Spinner } from './AdminApp'
import { Badge, Card, Drawer, Empty, NeedsMigration, Notice, PageHeader, Warnings } from './ui'
import { api, day, useLoad, when } from './lib'

interface Video {
  youtube_id: string
  title: string
  description: string
  published_at: string | null
  duration_seconds: number
  kind: 'episode' | 'short'
  thumbnail_url: string
  view_count: number | null
  like_count: number | null
  comment_count: number | null
  synced_at: string
}

interface Meta {
  titles: string[]
  description: string
  thumbnail_text: string[]
  hashtags: string[]
  warnings: string[]
}

export default function YouTubePage() {
  const { db, session, isWriter, toast } = useAdmin()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<'all' | 'no-posts' | 'no-shorts' | 'shorts'>('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [state, reload] = useLoad(async () => {
    const [v, posts, assets, status] = await Promise.all([
      db.from('youtube_videos').select('*').order('published_at', { ascending: false }).limit(1000),
      db.from('social_posts').select('source_ref').eq('source_type', 'youtube'),
      db.from('media_assets').select('id, youtube_id').eq('kind', 'source_video').neq('youtube_id', ''),
      db.from('integration_status').select('last_sync_at, last_error, last_error_at').eq('key', 'youtube_data').maybeSingle(),
    ])
    const withClips = await db.from('video_clips').select('asset_id').in('asset_id', ((assets.data ?? []) as { id: string }[]).map((a) => a.id))
    const assetVideo = new Map(((assets.data ?? []) as { id: string; youtube_id: string }[]).map((a) => [a.id, a.youtube_id]))
    return {
      data: {
        videos: (v.data ?? []) as Video[],
        posted: new Set(((posts.data ?? []) as { source_ref: string }[]).map((p) => p.source_ref)),
        clipped: new Set(((withClips.data ?? []) as { asset_id: string }[]).map((c) => assetVideo.get(c.asset_id))),
        status: status.data as { last_sync_at: string | null; last_error: string; last_error_at: string | null } | null,
      },
      error: v.error ?? posts.error,
    }
  }, [db])
  if (state.status === 'missing') return <NeedsMigration title="YouTube Manager" />

  async function sync() {
    setBusy(true)
    try {
      const r = await api<{ videos?: number; new?: number; skipped?: string }>(session.access_token, '/api/admin/run', { task: 'youtube' }, 120_000)
      toast(r.skipped ? 'YouTube isn’t connected: add YOUTUBE_API_KEY in Vercel (Settings → Integrations).' : `Synced ${r.videos} videos (${r.new} new).`, r.skipped ? 'error' : 'success')
      void reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const openId = params.get('open')
  const ready = state.status === 'ready' ? state.data : null
  const q = query.trim().toLowerCase()
  const shown = (ready?.videos ?? []).filter(
    (v) =>
      (!q || v.title.toLowerCase().includes(q)) &&
      (filter === 'all' || (filter === 'shorts' ? v.kind === 'short' : filter === 'no-posts' ? !ready!.posted.has(v.youtube_id) : v.kind === 'episode' && !ready!.clipped.has(v.youtube_id))),
  )

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="YouTube Manager"
        intro="The channel’s videos, synced every hour with the official YouTube API. See which have no social posts or Shorts yet, and prepare titles, descriptions and thumbnail text."
        actions={
          isWriter && (
            <button type="button" disabled={busy} className={buttonClass('outline', 'sm')} onClick={() => void sync()}>
              <RefreshCw className="size-4" aria-hidden /> {busy ? 'Syncing…' : 'Sync now'}
            </button>
          )
        }
      />
      {ready?.status && (
        <p className="mt-2 text-sm text-muted">
          Last synced {when(ready.status.last_sync_at) || 'never'}.{ready.status.last_error && ready.status.last_error_at && (!ready.status.last_sync_at || ready.status.last_error_at > ready.status.last_sync_at) && <span className="text-danger"> Last attempt failed: {ready.status.last_error}</span>}
        </p>
      )}
      <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto]">
        <input type="search" aria-label="Search videos" placeholder="Search titles…" className={`${inputClass} min-h-11`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Filter" className={`${inputClass} min-h-11 sm:w-auto`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All videos</option>
          <option value="no-posts">Without social posts</option>
          <option value="no-shorts">Episodes without Shorts</option>
          <option value="shorts">Shorts only</option>
        </select>
      </div>
      <div className="mt-5">
        {state.status === 'loading' && <Spinner label="Loading videos…" />}
        {state.status === 'error' && <Notice kind="error">{state.message}</Notice>}
        {ready &&
          (ready.videos.length === 0 ? (
            <Empty title="No videos synced yet.">Press Sync now. The sync needs YOUTUBE_API_KEY in Vercel (the same key the website’s own video list uses).</Empty>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((v) => (
                <li key={v.youtube_id} className="overflow-hidden rounded-xl border border-line bg-paper">
                  <button type="button" className="block w-full text-left" onClick={() => setParams((p) => (p.set('open', v.youtube_id), p))}>
                    <img src={v.thumbnail_url} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                    <div className="p-3">
                      <p className="line-clamp-2 font-semibold">{v.title}</p>
                      <p className="mt-1 text-xs text-muted">
                        {day(v.published_at)} · {formatSeconds(v.duration_seconds)} · {v.view_count?.toLocaleString() ?? '–'} views
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge className={v.kind === 'short' ? 'bg-[#ff0000] text-white' : 'bg-bone text-ink'}>{v.kind === 'short' ? 'Short' : 'Episode'}</Badge>
                        {!ready.posted.has(v.youtube_id) && <Badge className="bg-yellow text-ink">No social posts</Badge>}
                        {v.kind === 'episode' && !ready.clipped.has(v.youtube_id) && <Badge className="bg-line text-ink">No Shorts yet</Badge>}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </div>
      {ready && openId && ready.videos.find((v) => v.youtube_id === openId) && <VideoDrawer video={ready.videos.find((v) => v.youtube_id === openId)!} onClose={() => setParams((p) => (p.delete('open'), p))} />}
    </div>
  )
}

function VideoDrawer({ video, onClose }: { video: Video; onClose: () => void }) {
  const { session, isWriter, toast } = useAdmin()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [busy, setBusy] = useState(false)
  const url = video.kind === 'short' ? `https://www.youtube.com/shorts/${video.youtube_id}` : `https://www.youtube.com/watch?v=${video.youtube_id}`
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast('Copied'))

  async function suggest() {
    setBusy(true)
    try {
      setMeta(await api<Meta>(session.access_token, '/api/ai/youtube-meta', { youtubeId: video.youtube_id }))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer title={video.title} onClose={onClose}>
      <img src={video.thumbnail_url} alt="" className="w-full rounded-lg" />
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClass('outline', 'sm')}>
          <ExternalLink className="size-4" aria-hidden /> Open on YouTube
        </a>
        {isWriter && (
          <>
            <Link to={`/admin/social?tab=create&video=${video.youtube_id}`} className={buttonClass('outline', 'sm')}>
              <Megaphone className="size-4" aria-hidden /> Create social posts
            </Link>
            {video.kind === 'episode' && (
              <Link to="/admin/shorts" className={buttonClass('outline', 'sm')}>
                <Scissors className="size-4" aria-hidden /> Make Shorts
              </Link>
            )}
          </>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {(['view_count', 'like_count', 'comment_count'] as const).map((k) => (
          <div key={k} className="rounded-lg bg-paper p-3 ring-1 ring-line">
            <dt className="text-xs text-muted">{{ view_count: 'Views', like_count: 'Likes', comment_count: 'Comments' }[k]}</dt>
            <dd className="font-display text-2xl font-[800]">{video[k]?.toLocaleString() ?? 'Hidden'}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-xs text-muted">Public counts from YouTube at {when(video.synced_at)}. Watch time needs YouTube Analytics connected (Settings → Integrations).</p>
      {video.kind === 'episode' && <p className="mt-3 text-sm text-muted">To make Shorts, upload your original recording in the AI Shorts Generator and choose this video under “From YouTube”. YouTube’s API doesn’t provide video files.</p>}

      <Card title="Description" className="mt-4">
        <pre className="max-h-64 overflow-y-auto font-sans text-sm whitespace-pre-wrap">{video.description || 'No description.'}</pre>
      </Card>

      {isWriter && (
        <Card title="Suggestions" className="mt-4">
          <p className="text-sm text-muted">Titles, a description, thumbnail text and hashtags written from this video’s current title and description. Update them in YouTube Studio if you like them.</p>
          <button type="button" disabled={busy} className={buttonClass('primary', 'sm', 'mt-3')} onClick={() => void suggest()}>
            <Sparkles className="size-4" aria-hidden /> {busy ? 'Writing…' : 'Suggest'}
          </button>
          {meta && (
            <div className="mt-4 space-y-4 text-sm">
              <Warnings items={meta.warnings} />
              <Section title="Titles" items={meta.titles} onCopy={copy} />
              <Section title="Thumbnail text" items={meta.thumbnail_text} onCopy={copy} />
              <div>
                <p className="font-semibold">Description</p>
                <pre className="mt-1 rounded-lg bg-bone p-3 font-sans whitespace-pre-wrap">{meta.description}</pre>
                <button type="button" className="mt-1 text-sm font-semibold text-blue-ink underline" onClick={() => copy(meta.description)}>Copy</button>
              </div>
              <Section title="Hashtags" items={[meta.hashtags.map((h) => `#${h}`).join(' ')]} onCopy={copy} />
            </div>
          )}
        </Card>
      )}
    </Drawer>
  )
}

function Section({ title, items, onCopy }: { title: string; items: string[]; onCopy: (t: string) => void }) {
  return (
    <div>
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((t) => (
          <li key={t} className="flex items-start gap-2 rounded-lg bg-bone px-3 py-2">
            <span className="flex-1">{t}</span>
            <button type="button" aria-label={`Copy “${t}”`} onClick={() => onCopy(t)}>
              <Copy className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
