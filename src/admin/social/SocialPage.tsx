import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { RefreshCw, Search } from 'lucide-react'
import { buttonClass } from '../../components/ui/buttonClass'
import { inputClass } from '../../components/inbox/shared'
import { PLATFORM_KEYS, PLATFORMS, POST_STATUSES, STATUS_LABEL, TIME_ZONES, type Platform, type PostStatus } from '../../lib/social'
import { useAdmin, friendlyError } from '../context'
import { Spinner } from '../AdminApp'
import { PostCard } from './PostCard'
import { CreateTab } from './CreateTab'
import { AccountsTab, AnalyticsTab, CalendarTab } from './InfoTabs'
import { channelVideos, defaultZone, isMissingTable, type AccountRow, type PostRow } from './shared'

const TABS = { posts: 'Posts', create: 'Create', calendar: 'Calendar', accounts: 'Accounts', analytics: 'Analytics' } as const
type Tab = keyof typeof TABS

export default function SocialPage() {
  const { db, isOwner, pendingPosts, refreshCounts } = useAdmin()
  const [params, setParams] = useSearchParams()
  const [posts, setPosts] = useState<PostRow[] | null>(null)
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<'missing' | string>('')
  const [zone, setZone] = useState(() => defaultZone(TIME_ZONES))
  const [platform, setPlatform] = useState<Platform | 'all'>('all')
  const [query, setQuery] = useState('')
  const videos = useMemo(() => channelVideos(), [])

  const tab = ((params.get('tab') ?? 'posts') in TABS ? params.get('tab') ?? 'posts' : 'posts') as Tab
  const status = (POST_STATUSES as string[]).includes(params.get('status') ?? '') ? (params.get('status') as PostStatus) : 'all'
  const openId = params.get('open')

  const load = useCallback(async () => {
    const [p, a, n] = await Promise.all([
      db.from('social_posts').select('*').order('updated_at', { ascending: false }).limit(1000),
      db.from('social_accounts').select('platform, display_name, profile_url, provider, connected_at'),
      db.from('profiles').select('id, full_name, email'),
    ])
    if (isMissingTable(p.error) || isMissingTable(a.error)) return setError('missing')
    if (p.error || a.error) return setError(friendlyError(p.error ?? a.error))
    setError('')
    setPosts(p.data as PostRow[])
    setAccounts(a.data as AccountRow[])
    setNames(Object.fromEntries(((n.data ?? []) as { id: string; full_name: string; email: string }[]).map((x) => [x.id, x.full_name || x.email])))
  }, [db])

  // Reloads when the live count of posts awaiting approval changes, e.g. the other owner approved one.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loads from Supabase; state is set when the request returns
    void load()
  }, [load, pendingPosts])

  useEffect(() => {
    if (openId && posts) document.getElementById(`post-${openId}`)?.scrollIntoView({ block: 'center' })
  }, [openId, posts])

  const changed = () => {
    void load()
    refreshCounts()
  }

  const go = (next: Record<string, string | null>) =>
    setParams((p) => {
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v)
        else p.delete(k)
      }
      return p
    })

  if (error === 'missing') return <NeedsDatabaseUpdate />

  const q = query.trim().toLowerCase()
  const shown = (posts ?? []).filter(
    (p) => (status === 'all' || p.status === status) && (platform === 'all' || p.platform === platform) && (!q || `${p.caption} ${p.hashtags.join(' ')} ${p.source_title}`.toLowerCase().includes(q)),
  )

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-[800] tracking-[-0.02em] md:text-4xl">Social Media Manager</h1>
          <p className="mt-1 text-muted">
            The AI writes drafts; {isOwner ? 'you and the other owner' : 'an owner'} approve{isOwner ? '' : 's'} them before anything goes out.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm">
            <span className="sr-only">Time zone</span>
            <select className={`${inputClass} min-h-10 w-auto py-1`} value={zone} onChange={(e) => setZone(e.target.value)}>
              {TIME_ZONES.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={buttonClass('outline', 'sm')} onClick={() => void load()} aria-label="Refresh">
            <RefreshCw className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <nav aria-label="Social Media Manager" className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-current={tab === t ? 'page' : undefined}
            onClick={() => go({ tab: t === 'posts' ? null : t, open: null })}
            className={`-mb-px min-h-11 border-b-2 px-4 font-semibold whitespace-nowrap ${tab === t ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {TABS[t]}
            {t === 'posts' && !!pendingPosts && <span className="ml-1.5 rounded-full bg-yellow px-1.5 text-xs text-ink">{pendingPosts}</span>}
          </button>
        ))}
      </nav>

      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-danger/10 px-4 py-3 text-danger">
          {error}
        </p>
      )}

      <div className="mt-6">
        {!posts && !error ? (
          <Spinner label="Loading posts…" />
        ) : !posts ? null : tab === 'create' ? (
          <CreateTab videos={videos} posts={posts} onSaved={changed} />
        ) : tab === 'calendar' ? (
          <CalendarTab posts={posts} zone={zone} />
        ) : tab === 'accounts' ? (
          <AccountsTab accounts={accounts} onChanged={changed} />
        ) : tab === 'analytics' ? (
          <AnalyticsTab posts={posts} />
        ) : (
          <>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
              {(['all', ...POST_STATUSES] as const).map((s) => (
                <button key={s} type="button" aria-pressed={status === s} className={buttonClass(status === s ? 'dark' : 'outline', 'sm')} onClick={() => go({ status: s === 'all' ? null : s, open: null })}>
                  {s === 'all' ? 'All' : STATUS_LABEL[s]}
                  {s !== 'all' && <span className="tabular-nums opacity-70">{posts.filter((p) => p.status === s).length}</span>}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
              <label className="relative">
                <span className="sr-only">Search posts</span>
                <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <input type="search" className={`${inputClass} min-h-11 pl-10`} placeholder="Search captions, hashtags, videos…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <select aria-label="Platform" className={`${inputClass} min-h-11 sm:w-auto`} value={platform} onChange={(e) => setPlatform(e.target.value as Platform | 'all')}>
                <option value="all">All platforms</option>
                {PLATFORM_KEYS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORMS[p].label}
                  </option>
                ))}
              </select>
            </div>

            {posts.length === 0 ? (
              <div className="mt-8 rounded-xl border border-dashed border-ink/20 p-6">
                <p className="font-semibold">No posts yet.</p>
                <p className="mt-1 text-muted">Go to Create, pick a YouTube video and let the AI write drafts, or write one yourself.</p>
                <button type="button" className={buttonClass('primary', 'md', 'mt-4')} onClick={() => go({ tab: 'create' })}>
                  Create posts
                </button>
              </div>
            ) : shown.length === 0 ? (
              <p className="mt-8 text-muted">Nothing matches these filters.</p>
            ) : (
              <ul className="mt-6 space-y-3">
                {shown.map((post) => (
                  <li key={`${post.id}-${post.updated_at}`}>
                    <PostCard
                      post={post}
                      account={accounts.find((a) => a.platform === post.platform)}
                      video={post.source_type === 'youtube' ? videos.find((v) => v.youtubeId === post.source_ref) : undefined}
                      names={names}
                      zone={zone}
                      open={post.id === openId}
                      onChanged={changed}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function NeedsDatabaseUpdate() {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl font-[800] tracking-[-0.02em] md:text-4xl">Social Media Manager</h1>
      <div className="mt-6 rounded-xl border border-yellow bg-yellow/15 p-5">
        <p className="font-semibold">One database update is needed before this section works.</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted">
          <li>Open your Supabase project → SQL Editor → New query.</li>
          <li>
            Paste the whole of <code className="font-mono text-sm">supabase/migrations/20261027000000_social_media.sql</code> from the GitHub repository and press Run.
          </li>
          <li>Reload this page.</li>
        </ol>
      </div>
    </div>
  )
}
