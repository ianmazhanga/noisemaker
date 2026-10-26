import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { buttonClass } from '../../components/ui/buttonClass'
import { inputClass } from '../../components/inbox/shared'
import { PLATFORM_KEYS, PLATFORMS, POST_STATUSES, STATUS_LABEL, utcToZoned, type Platform } from '../../lib/social'
import { useAdmin, friendlyError } from '../context'
import { PLATFORM_STYLE, type AccountRow, type PostRow } from './shared'
import { ConfirmButton, Notice } from '../ui'
import { API_ERRORS, api } from '../lib'

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
  instagram: 'Needs an Instagram Business or Creator account linked to your Facebook Page. Connecting Facebook connects Instagram too. Instagram posts need an image or video.',
  facebook: 'Needs a Facebook Page you manage and a Meta developer app (Settings → Integrations has the steps). Text, link, image and video posts.',
  tiktok: 'Needs a TikTok developer app. Until TikTok audits the app, videos posted through it are visible only to the account; post publicly by hand until then.',
  youtube: 'Approved Shorts (clips) upload to the channel. Community posts can’t be made through YouTube’s API, so those are always posted by hand in YouTube Studio.',
  x: 'Needs an X developer app with an API plan that allows posting. Text posts go out automatically; posts with video are published by hand.',
}

const CONNECTION: Record<string, { label: string; style: string }> = {
  connected: { label: 'Connected', style: 'bg-[#1f7a4d] text-white' },
  expired: { label: 'Sign-in expired', style: 'bg-yellow text-ink' },
  error: { label: 'Connection error', style: 'bg-danger text-white' },
  not_connected: { label: 'Not connected', style: 'bg-line text-ink' },
}

const OAUTH_ERRORS: Record<string, string> = {
  declined: 'The connection was cancelled on the platform’s page.',
  expired: 'That sign-in took too long. Try connecting again.',
  forbidden: 'Only an owner can connect accounts.',
  invalid: 'The platform sent back an unexpected answer. Try again.',
  'no-facebook-page': 'No Facebook Page was found on that account.',
  'no-youtube-channel': 'No YouTube channel was found on that Google account.',
}

/** Which accounts are connected. Owners connect with each platform’s own sign-in page; no passwords or keys are typed here. */
export function AccountsTab({ accounts, onChanged }: { accounts: AccountRow[]; onChanged: () => void }) {
  const { db, session, isOwner, toast } = useAdmin()
  const [params, setParams] = useSearchParams()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const connected = params.get('connected')
  const oauthError = params.get('oauth_error')
  const migrated = accounts.some((a) => a.status !== undefined)

  async function saveLink(platform: Platform) {
    const url = (drafts[platform] ?? '').trim()
    if (url && !url.startsWith('https://')) return toast('The link must start with https://', 'error')
    const { error } = await db.from('social_accounts').update({ profile_url: url }).eq('platform', platform)
    if (error) return toast(friendlyError(error), 'error')
    toast('Profile link saved')
    onChanged()
  }

  async function connect(platform: Platform) {
    setBusy(platform)
    try {
      const { url } = await api<{ url: string }>(session.access_token, '/api/admin/oauth-start', { platform })
      window.location.assign(url)
    } catch (e) {
      toast((e as Error).message, 'error')
      setBusy(null)
    }
  }

  async function disconnect(platform: Platform) {
    const { error } = await db.rpc('disconnect_account', { target: platform })
    if (error) return toast(friendlyError(error), 'error')
    toast('Disconnected')
    onChanged()
  }

  return (
    <div className="space-y-4">
      {connected && (
        <Notice kind="success">
          Connected: {connected.split(',').map((p) => PLATFORMS[p as Platform]?.label ?? p).join(', ')}.{' '}
          <button type="button" className="font-semibold underline" onClick={() => setParams((p) => (p.delete('connected'), p))}>
            Dismiss
          </button>
        </Notice>
      )}
      {oauthError && <Notice kind="error">{OAUTH_ERRORS[oauthError] ?? API_ERRORS[oauthError] ?? 'The account couldn’t be connected. Try again.'}</Notice>}
      <p className="max-w-3xl text-muted">
        Drafting, approving and scheduling work without connecting anything. Connected accounts publish approved posts automatically at their scheduled time; the rest are published by hand with the Publish button. Setup steps for each
        platform’s developer app are in{' '}
        <Link to="/admin/settings?tab=integrations" className="font-semibold text-blue-ink underline">
          Settings → Integrations
        </Link>
        .
      </p>
      <ul className="grid gap-4 md:grid-cols-2">
        {PLATFORM_KEYS.map((p) => {
          const account = accounts.find((a) => a.platform === p)
          const status = account?.status ?? (account?.provider ? 'connected' : 'not_connected')
          const c = CONNECTION[status]
          return (
            <li key={p} className="rounded-xl border border-line bg-paper p-5">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PLATFORM_STYLE[p]}`}>{PLATFORMS[p].label}</span>
                <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.style}`}>{c.label}</span>
              </div>
              {account?.account_name && <p className="mt-2 font-semibold">{account.account_name}</p>}
              {account?.connected_at && status === 'connected' && (
                <p className="text-xs text-muted">
                  Connected {new Date(account.connected_at).toLocaleDateString()}
                  {account.expires_at ? ` · sign-in valid until ${new Date(account.expires_at).toLocaleDateString()}` : ''}
                </p>
              )}
              {account?.last_error && status !== 'connected' && <p className="mt-1 text-sm text-danger">{account.last_error}</p>}
              <p className="mt-3 text-sm text-muted">{SETUP[p]}</p>
              {isOwner && migrated && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {status === 'connected' ? (
                    <ConfirmButton label="Disconnect" confirm="Disconnect this account?" onConfirm={() => void disconnect(p)} />
                  ) : (
                    <button type="button" disabled={busy !== null} className={buttonClass('primary', 'sm')} onClick={() => void connect(p)}>
                      {busy === p ? 'Opening…' : status === 'expired' ? 'Reconnect' : `Connect ${PLATFORMS[p].label}`}
                    </button>
                  )}
                </div>
              )}
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
