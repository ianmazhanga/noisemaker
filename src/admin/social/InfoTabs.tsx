import { useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { buttonClass } from '../../components/ui/buttonClass'
import { inputClass } from '../../components/inbox/shared'
import { PLATFORM_KEYS, PLATFORMS, POST_STATUSES, STATUS_LABEL, utcToZoned, type Platform } from '../../lib/social'
import { useAdmin, friendlyError } from '../context'
import { PLATFORM_STYLE, type AccountRow, type PostRow } from './shared'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Month grid of scheduled and published posts, in the chosen time zone. */
export function CalendarTab({ posts, zone }: { posts: PostRow[]; zone: string }) {
  // The time the tab opened; good enough for highlighting today.
  const [now] = useState(() => new Date())
  const today = utcToZoned(now, zone).slice(0, 7)
  const [month, setMonth] = useState(today)
  const [platform, setPlatform] = useState<Platform | 'all'>('all')
  const [year, mon] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year, mon - 1, 1))
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const lead = (first.getUTCDay() + 6) % 7
  const shift = (n: number) => setMonth(new Date(Date.UTC(year, mon - 1 + n, 1)).toISOString().slice(0, 7))

  const byDay = new Map<string, { post: PostRow; time: string }[]>()
  for (const post of posts) {
    const at = post.status === 'published' ? post.published_at : post.status === 'scheduled' ? post.scheduled_at : null
    if (!at || (platform !== 'all' && post.platform !== platform)) continue
    const local = utcToZoned(new Date(at), zone)
    const list = byDay.get(local.slice(0, 10)) ?? []
    list.push({ post, time: local.slice(11, 16) })
    byDay.set(local.slice(0, 10), list)
  }

  const title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const todayKey = utcToZoned(now, zone).slice(0, 10)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass('outline', 'sm')} onClick={() => shift(-1)} aria-label="Previous month">
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <h2 className="min-w-44 text-center text-xl font-semibold">{title}</h2>
        <button type="button" className={buttonClass('outline', 'sm')} onClick={() => shift(1)} aria-label="Next month">
          <ChevronRight className="size-4" aria-hidden />
        </button>
        {month !== today && (
          <button type="button" className="text-sm font-semibold text-blue-ink underline underline-offset-4" onClick={() => setMonth(today)}>
            Today
          </button>
        )}
        <select aria-label="Platform" className={`${inputClass} ml-auto min-h-10 w-auto py-1`} value={platform} onChange={(e) => setPlatform(e.target.value as Platform | 'all')}>
          <option value="all">All platforms</option>
          {PLATFORM_KEYS.map((p) => (
            <option key={p} value={p}>
              {PLATFORMS[p].label}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-sm text-muted">Scheduled and published posts. Times are shown in the time zone chosen above. Open a post to change its time.</p>

      <div className="mt-4 overflow-x-auto">
        <div className="grid min-w-[44rem] grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line">
          {WEEKDAYS.map((d) => (
            <div key={d} className="bg-bone px-2 py-1.5 text-xs font-semibold text-muted">
              {d}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`lead-${i}`} className="min-h-24 bg-bone/60" />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const key = `${month}-${String(i + 1).padStart(2, '0')}`
            const items = (byDay.get(key) ?? []).sort((a, b) => a.time.localeCompare(b.time))
            return (
              <div key={key} className="min-h-24 bg-paper p-1.5">
                <p className={`text-xs font-semibold ${key === todayKey ? 'inline-flex size-6 items-center justify-center rounded-full bg-blue text-white' : 'text-muted'}`}>{i + 1}</p>
                <ul className="mt-1 space-y-1">
                  {items.map(({ post, time }) => (
                    <li key={post.id}>
                      <Link to={`/admin/social?status=${post.status}&open=${post.id}`} className={`block truncate rounded px-1.5 py-0.5 text-xs font-semibold ${PLATFORM_STYLE[post.platform]} ${post.status === 'published' ? 'opacity-60' : ''}`} title={post.caption}>
                        {time} {PLATFORMS[post.platform].label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const SETUP: Record<Platform, string> = {
  instagram: 'Needs an Instagram Business or Creator account linked to a Facebook Page. Automatic posting goes through Meta’s official API (app review required) or a scheduling service such as Buffer.',
  facebook: 'Needs a Facebook Page you manage. Automatic posting goes through Meta’s official API (app review required) or a scheduling service such as Buffer.',
  tiktok: 'Needs a TikTok Business account. TikTok’s Content Posting API requires an app audit before posts can be public; a scheduling service such as Buffer is usually quicker.',
  youtube: 'Community posts can’t be created through YouTube’s API, so these are always posted by hand in YouTube Studio. Video details can be managed with YouTube’s API later.',
  x: 'Needs an X account. Posting through X’s API requires a paid API plan; a scheduling service such as Buffer is an alternative.',
}

/** Which accounts are connected. Connections are made on the server, never by typing tokens in here. */
export function AccountsTab({ accounts, onChanged }: { accounts: AccountRow[]; onChanged: () => void }) {
  const { db, isOwner, toast } = useAdmin()
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  async function saveLink(platform: Platform) {
    const url = (drafts[platform] ?? '').trim()
    if (url && !url.startsWith('https://')) return toast('The link must start with https://', 'error')
    const { error } = await db.from('social_accounts').update({ profile_url: url }).eq('platform', platform)
    if (error) return toast(friendlyError(error), 'error')
    toast('Profile link saved')
    onChanged()
  }

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-muted">
        Drafting, approving and scheduling work without connecting anything. Until an account is connected, approved posts are published by hand: the Publish button copies the text and opens the app. No
        passwords or access keys are ever entered on this page.
      </p>
      <ul className="grid gap-4 md:grid-cols-2">
        {PLATFORM_KEYS.map((p) => {
          const account = accounts.find((a) => a.platform === p)
          const connected = Boolean(account?.provider)
          return (
            <li key={p} className="rounded-xl border border-line bg-paper p-5">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PLATFORM_STYLE[p]}`}>{PLATFORMS[p].label}</span>
                <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${connected ? 'bg-[#1f7a4d] text-white' : 'bg-line text-ink'}`}>{connected ? `Connected via ${account?.provider}` : 'Not connected'}</span>
              </div>
              <p className="mt-3 text-sm text-muted">{SETUP[p]}</p>
              {isOwner ? (
                <div className="mt-3 flex gap-2">
                  <label className="flex-1">
                    <span className="sr-only">{PLATFORMS[p].label} profile link</span>
                    <input
                      type="url"
                      className={`${inputClass} min-h-10`}
                      placeholder="Profile link, e.g. https://www.instagram.com/…"
                      value={drafts[p] ?? account?.profile_url ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p]: e.target.value }))}
                    />
                  </label>
                  <button type="button" className={buttonClass('outline', 'sm')} onClick={() => void saveLink(p)}>
                    Save
                  </button>
                </div>
              ) : (
                account?.profile_url && (
                  <a className="mt-3 inline-block text-sm font-semibold break-all text-blue-ink underline underline-offset-4" href={account.profile_url} target="_blank" rel="noopener noreferrer">
                    {account.profile_url}
                  </a>
                )
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Counts from the dashboard's own records. Platform statistics need connected accounts. */
export function AnalyticsTab({ posts }: { posts: PostRow[] }) {
  const [since] = useState(() => Date.now() - 30 * 86_400_000)
  const recent = posts.filter((p) => p.published_at && Date.parse(p.published_at) >= since)
  const approved = posts.filter((p) => p.approved_at && p.created_at)
  const hours = approved.map((p) => (Date.parse(p.approved_at!) - Date.parse(p.created_at)) / 3_600_000)
  const median = hours.length ? hours.sort((a, b) => a - b)[Math.floor(hours.length / 2)] : null

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-semibold">Posts by status</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {POST_STATUSES.map((s) => (
            <Link key={s} to={`/admin/social?status=${s}`} className="rounded-xl border border-line bg-paper p-4 hover:border-ink/40">
              <p className="text-xs font-semibold text-muted">{STATUS_LABEL[s]}</p>
              <p className="mt-1 font-display text-3xl font-[800]">{posts.filter((p) => p.status === s).length}</p>
            </Link>
          ))}
        </div>
      </section>
      <section>
        <h2 className="text-xl font-semibold">Last 30 days</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-paper">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="bg-bone text-xs text-muted uppercase">
              <tr>
                <th className="px-4 py-2">Platform</th>
                <th className="px-4 py-2">Published</th>
                <th className="px-4 py-2">Scheduled now</th>
                <th className="px-4 py-2">Views and engagement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {PLATFORM_KEYS.map((p) => (
                <tr key={p}>
                  <td className="px-4 py-2 font-semibold">{PLATFORMS[p].label}</td>
                  <td className="px-4 py-2 tabular-nums">{recent.filter((x) => x.platform === p).length}</td>
                  <td className="px-4 py-2 tabular-nums">{posts.filter((x) => x.platform === p && x.status === 'scheduled').length}</td>
                  <td className="px-4 py-2 text-muted">Not connected</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted">
          {median === null ? 'No approvals yet.' : `Typical time from draft to approval: ${median < 1 ? 'under an hour' : `${Math.round(median)} hours`}.`} Views, likes and follower numbers appear here once each account is
          connected. Nothing here is estimated.
        </p>
      </section>
    </div>
  )
}
