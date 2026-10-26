import { useState } from 'react'
import { Link } from 'react-router'
import { Download } from 'lucide-react'
import { buttonClass } from '../components/ui/buttonClass'
import { toCsv } from '../lib/newsroom'
import { PLATFORM_KEYS, PLATFORMS } from '../lib/social'
import { useAdmin } from './context'
import { Spinner } from './AdminApp'
import { BarList, LineChart, type Point } from './charts'
import { compact, downloadCsv, useLoad } from './lib'
import { Card, NeedsMigration, Notice, PageHeader } from './ui'

interface Snapshot {
  source: string
  metric: string
  subject: string
  value: number
  captured_on: string
}

const RANGES = { 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days', 365: 'Last 12 months' } as const
type Range = keyof typeof RANGES

const SOURCE_LABEL: Record<string, string> = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', x: 'X', website: 'Website', newsletter: 'Newsletter', stories: 'Story submissions' }
const METRIC_LABEL: Record<string, string> = {
  views: 'Total views',
  subscribers: 'Subscribers',
  videos: 'Videos',
  followers: 'Followers',
  page_likes: 'Page likes',
  posts: 'Posts',
  likes: 'Likes',
  total: 'Submissions (all time)',
  mailchimp_members: 'Mailchimp audience',
  daily_views: 'Views per day',
  daily_estimatedMinutesWatched: 'Minutes watched per day',
  daily_subscribersGained: 'Subscribers gained per day',
  daily_likes: 'Likes per day',
  daily_comments: 'Comments per day',
  daily_shares: 'Shares per day',
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

export default function AnalyticsPage() {
  const { db, canReadStories } = useAdmin()
  const [range, setRange] = useState<Range>(30)
  // The moment the page opened: periods are measured from here so they don't shift while you read.
  const [now] = useState(() => Date.now())
  const [state] = useLoad(async () => {
    const since = new Date(Date.now() - range * 2 * 86_400_000)
    const [snaps, posts, articles, videos, stories] = await Promise.all([
      db.from('analytics_snapshots').select('source, metric, subject, value, captured_on').gte('captured_on', isoDay(since)).order('captured_on').limit(50_000),
      db.from('social_posts').select('platform, published_at').eq('status', 'published').gte('published_at', since.toISOString()),
      db.from('news_articles').select('published_at').eq('status', 'published').gte('published_at', since.toISOString()),
      db.from('youtube_videos').select('youtube_id, title, kind, view_count, like_count, comment_count, published_at').order('view_count', { ascending: false, nullsFirst: false }).limit(200),
      canReadStories ? db.from('story_submissions').select('received_at').gte('received_at', since.toISOString()) : Promise.resolve({ data: null, error: null }),
    ])
    return {
      data: {
        snaps: (snaps.data ?? []) as Snapshot[],
        posts: (posts.data ?? []) as { platform: string; published_at: string }[],
        articles: (articles.data ?? []) as { published_at: string }[],
        videos: (videos.data ?? []) as { youtube_id: string; title: string; kind: string; view_count: number | null; like_count: number | null; comment_count: number | null }[],
        stories: (stories.data as { received_at: string }[] | null) ?? null,
      },
      error: snaps.error ?? posts.error,
    }
  }, [db, range, canReadStories])

  if (state.status === 'missing') return <NeedsMigration title="Analytics" />
  const start = now - range * 86_400_000
  const prevStart = now - range * 2 * 86_400_000
  const inRange = (iso: string) => Date.parse(iso) >= start
  const inPrev = (iso: string) => Date.parse(iso) >= prevStart && Date.parse(iso) < start

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Analytics"
        intro="Numbers exactly as each connected service reported them, saved once a day. Anything not connected says so; nothing here is estimated or sample data."
        actions={
          <>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Date range">
              {(Object.keys(RANGES).map(Number) as Range[]).map((r) => (
                <button key={r} type="button" aria-pressed={range === r} className={buttonClass(range === r ? 'dark' : 'outline', 'sm')} onClick={() => setRange(r)}>
                  {RANGES[r]}
                </button>
              ))}
            </div>
            {state.status === 'ready' && (
              <button
                type="button"
                className={buttonClass('outline', 'sm')}
                onClick={() => downloadCsv(`noisemakers-analytics-${isoDay(new Date())}.csv`, toCsv([['Date', 'Source', 'Metric', 'Subject', 'Value'], ...state.data.snaps.filter((s) => inRange(s.captured_on)).map((s) => [s.captured_on, s.source, s.metric, s.subject, s.value])]))}
              >
                <Download className="size-4" aria-hidden /> Export CSV
              </button>
            )}
          </>
        }
      />
      {state.status === 'loading' && <Spinner label="Loading analytics…" />}
      {state.status === 'error' && <div className="mt-6"><Notice kind="error">{state.message}</Notice></div>}
      {state.status === 'ready' && (() => {
        const { snaps, posts, articles, videos, stories } = state.data
        const series = (source: string, metric: string, subject = 'channel'): Point[] => {
          const byDay = new Map<string, number>()
          for (const s of snaps) if (s.source === source && s.metric === metric && s.subject === subject && inRange(s.captured_on)) byDay.set(s.captured_on, Number(s.value))
          return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ label: label(d), value: v }))
        }
        const metricsOf = (source: string) => [...new Set(snaps.filter((s) => s.source === source && (s.subject === 'channel' || s.subject === 'all' || /^\d{4}-/.test(s.subject))).map((s) => s.metric))]
        const latest = (source: string, metric: string, subject = 'channel') => {
          const list = snaps.filter((s) => s.source === source && s.metric === metric && s.subject === subject).sort((a, b) => a.captured_on.localeCompare(b.captured_on))
          return list.length ? Number(list[list.length - 1].value) : null
        }
        // YouTube Analytics saves one row per day with the day as the subject.
        const dailySeries = (metric: string): Point[] =>
          snaps.filter((s) => s.source === 'youtube' && s.metric === metric && inRange(s.subject)).sort((a, b) => a.subject.localeCompare(b.subject)).map((s) => ({ label: label(s.subject), value: Number(s.value) }))
        const views = series('youtube', 'views')
        const viewsGained = views.length > 1 ? views[views.length - 1].value - views[0].value : null
        const gained = (id: string) => {
          const list = snaps.filter((s) => s.source === 'youtube' && s.metric === 'views' && s.subject === id && inRange(s.captured_on)).sort((a, b) => a.captured_on.localeCompare(b.captured_on))
          return list.length > 1 ? Number(list[list.length - 1].value) - Number(list[0].value) : null
        }
        const delta = (now: number, before: number) => (before === 0 ? (now ? 'new this period' : 'no change') : `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}% vs previous ${range} days`)

        const tiles = [
          { label: 'Channel views', value: latest('youtube', 'views'), note: viewsGained !== null ? `+${compact(viewsGained)} in this period` : 'YouTube Data API' },
          { label: 'YouTube subscribers', value: latest('youtube', 'subscribers'), note: 'Public count' },
          { label: 'Social posts published', value: posts.filter((p) => inRange(p.published_at)).length, note: delta(posts.filter((p) => inRange(p.published_at)).length, posts.filter((p) => inPrev(p.published_at)).length) },
          { label: 'Articles published', value: articles.filter((a) => inRange(a.published_at)).length, note: delta(articles.filter((a) => inRange(a.published_at)).length, articles.filter((a) => inPrev(a.published_at)).length) },
          { label: 'Newsletter subscribers', value: latest('newsletter', 'subscribers', 'all'), note: 'Confirmed' },
          stories
            ? { label: 'Story submissions', value: stories.filter((s) => inRange(s.received_at)).length, note: delta(stories.filter((s) => inRange(s.received_at)).length, stories.filter((s) => inPrev(s.received_at)).length) }
            : { label: 'Story submissions (all time)', value: latest('stories', 'total', 'all'), note: 'Daily count' },
        ]

        return (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
              {tiles.map((t) => (
                <div key={t.label} className="rounded-xl border border-line bg-paper p-4">
                  <p className="text-sm font-semibold text-muted">{t.label}</p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums">{t.value === null ? <span className="text-lg text-muted">Not available yet</span> : compact(t.value)}</p>
                  <p className="mt-1 text-xs text-muted">{t.note}</p>
                </div>
              ))}
            </div>

            <h2 className="mt-10 text-xl font-semibold">By platform</h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {(['youtube', 'instagram', 'facebook', 'tiktok', 'x', 'newsletter', 'website'] as const).map((source) => {
                const metrics = metricsOf(source).filter((m) => m !== 'likes' && m !== 'comments')
                return (
                  <Card key={source} title={SOURCE_LABEL[source]}>
                    {metrics.length === 0 ? (
                      <p className="text-sm text-muted">
                        Not connected.{' '}
                        {source === 'website' ? 'Visitor numbers are available in Vercel → Analytics.' : (
                          <Link to="/admin/settings?tab=integrations" className="font-semibold text-blue-ink underline">
                            See how to connect it
                          </Link>
                        )}
                      </p>
                    ) : (
                      <div className="space-y-6">
                        {metrics.map((m) =>
                          m.startsWith('daily_') ? (
                            <LineChart key={m} title={METRIC_LABEL[m] ?? m} points={dailySeries(m)} />
                          ) : (
                            <LineChart key={m} title={METRIC_LABEL[m] ?? m} points={series(source, m, source === 'newsletter' ? 'all' : 'channel')} />
                          ),
                        )}
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2">
              <Card title="Social posts published, by platform">
                <BarList title={RANGES[range]} items={PLATFORM_KEYS.map((p) => ({ label: PLATFORMS[p].label, value: posts.filter((x) => x.platform === p && inRange(x.published_at)).length }))} />
                <p className="mt-3 text-xs text-muted">From the Social Media Manager’s own records, including posts published by hand.</p>
              </Card>
              {stories && (
                <Card title="Story submissions per week">
                  <LineChart
                    title={RANGES[range]}
                    points={(() => {
                      const weeks = new Map<string, number>()
                      for (let t = start; t <= now; t += 7 * 86_400_000) weeks.set(isoDay(new Date(t)), 0)
                      const keys = [...weeks.keys()]
                      for (const s of stories.filter((x) => inRange(x.received_at))) {
                        const k = keys.filter((w) => w <= s.received_at.slice(0, 10)).pop() ?? keys[0]
                        weeks.set(k, (weeks.get(k) ?? 0) + 1)
                      }
                      return [...weeks].map(([d, v]) => ({ label: label(d), value: v }))
                    })()}
                  />
                </Card>
              )}
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {(['episode', 'short'] as const).map((kind) => (
                <Card key={kind} title={kind === 'episode' ? 'Best-performing videos' : 'Best-performing Shorts'}>
                  {videos.filter((v) => v.kind === kind && v.view_count !== null).length === 0 ? (
                    <p className="text-sm text-muted">No view counts yet. They arrive with the hourly YouTube sync.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted uppercase">
                        <tr>
                          <th className="py-1 text-left">Video</th>
                          <th className="py-1 text-right">Views</th>
                          <th className="py-1 text-right">In period</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {videos.filter((v) => v.kind === kind && v.view_count !== null).slice(0, 8).map((v) => {
                          const g = gained(v.youtube_id)
                          return (
                            <tr key={v.youtube_id}>
                              <td className="py-1.5 pr-2">
                                <Link to={`/admin/youtube?open=${v.youtube_id}`} className="line-clamp-1 hover:underline">{v.title}</Link>
                              </td>
                              <td className="py-1.5 text-right tabular-nums">{v.view_count!.toLocaleString()}</td>
                              <td className="py-1.5 text-right text-muted tabular-nums">{g === null ? '–' : `+${g.toLocaleString()}`}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                  <p className="mt-2 text-xs text-muted">All-time public view counts. “In period” needs at least two daily snapshots.</p>
                </Card>
              ))}
            </div>
          </>
        )
      })()}
    </div>
  )
}
