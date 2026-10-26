import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Lock, RefreshCw, Search } from 'lucide-react'
import { Seo } from '../components/seo/Seo'
import { PageIntro } from '../components/ui/PageIntro'
import { buttonClass } from '../components/ui/buttonClass'
import { isCallRequest, matchesSearch, preferredContact, receivedWithin, safeWebLink, type ContactMethod, type InboxEntry, type InboxResponse } from '../lib/inbox'
import { ContactPanel } from '../components/inbox/ContactPanel'
import { METHOD_LABEL, inputClass as input } from '../components/inbox/shared'

/**
 * Private inbox for "Tell your story" submissions. Not linked anywhere on the site.
 * The password stays in memory only: reloading or closing the tab locks the inbox again.
 */

const ERRORS: Record<string, string> = {
  'wrong-password': 'That password isn’t right. Please try again.',
  'not-configured': 'The inbox isn’t set up yet. INBOX_PASSWORD and NETLIFY_API_TOKEN need to be added in Netlify.',
  'netlify-unavailable': 'Netlify didn’t respond. Please try again in a minute.',
  'too-many': 'Too many attempts. Please wait a minute and try again.',
}

type Filter = 'all' | 'story' | 'call'
type Period = 'any' | '7' | '30' | '90'
type State = { kind: 'locked' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'open'; data: InboxResponse; loadedAt: Date }

async function fetchInbox(password: string): Promise<InboxResponse> {
  const res = await fetch('/api/inbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(30_000),
  })
  const body: unknown = await res.json().catch(() => null)
  if (res.status === 429) throw new Error(ERRORS['too-many'])
  if (!res.ok || !body || typeof body !== 'object' || !('entries' in body)) {
    const code = body && typeof body === 'object' && 'error' in body ? String(body.error) : ''
    throw new Error(ERRORS[code] ?? 'The inbox couldn’t be loaded. Please try again.')
  }
  return body as InboxResponse
}

const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function InboxPage() {
  const password = useRef('')
  const [typed, setTyped] = useState('')
  const [state, setState] = useState<State>({ kind: 'locked' })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [method, setMethod] = useState<ContactMethod | 'any'>('any')
  const [period, setPeriod] = useState<Period>('any')

  async function load(pw: string) {
    setState({ kind: 'loading' })
    try {
      const data = await fetchInbox(pw)
      password.current = pw
      setTyped('')
      setState({ kind: 'open', data, loadedAt: new Date() })
    } catch (error) {
      password.current = ''
      setState({ kind: 'error', message: error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'The inbox took too long to load. Please try again.' })
    }
  }

  function lock() {
    password.current = ''
    setQuery('')
    setFilter('all')
    setMethod('any')
    setPeriod('any')
    setState({ kind: 'locked' })
  }

  const entries = state.kind === 'open' ? state.data.entries : []
  const shown = entries.filter(
    (e) =>
      (filter === 'all' || (filter === 'call') === isCallRequest(e)) &&
      (method === 'any' || preferredContact(e) === method) &&
      (period === 'any' || receivedWithin(e, Number(period))) &&
      matchesSearch(e, query),
  )
  const calls = entries.filter(isCallRequest).length

  return (
    <>
      <Seo title="Inbox" description="Private inbox for Noisemakers story submissions." noindex />
      <PageIntro kicker="Private" title="Story inbox" />
      <div className="wrap pb-20 md:pb-28">
        {state.kind !== 'open' ? (
          <form
            className="measure max-w-md space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              if (typed) void load(typed)
            }}
          >
            <label htmlFor="inbox-password" className="block font-semibold text-ink">
              Inbox password
            </label>
            <input
              id="inbox-password"
              type="password"
              autoComplete="current-password"
              className={`${input} min-h-12`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-describedby={state.kind === 'error' ? 'inbox-error' : undefined}
              autoFocus
            />
            {state.kind === 'error' && (
              <p id="inbox-error" role="alert" className="text-danger">
                {state.message}
              </p>
            )}
            <button type="submit" className={buttonClass('primary', 'lg')} disabled={!typed || state.kind === 'loading'}>
              {state.kind === 'loading' ? 'Opening…' : 'Open inbox'}
            </button>
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink pb-4">
              <p className="text-muted">
                <span className="font-semibold text-ink">{entries.length}</span> {entries.length === 1 ? 'submission' : 'submissions'} · {entries.length - calls} stories ·{' '}
                {calls} call requests · updated {state.loadedAt.toLocaleTimeString(undefined, { timeStyle: 'short' })}
              </p>
              <div className="flex gap-2">
                <button type="button" className={buttonClass('outline', 'sm')} onClick={() => void load(password.current)}>
                  <RefreshCw className="size-4" aria-hidden /> Refresh
                </button>
                <button type="button" className={buttonClass('dark', 'sm')} onClick={lock}>
                  <Lock className="size-4" aria-hidden /> Lock
                </button>
              </div>
            </div>

            {!state.data.formFound ? (
              <p className="measure mt-8 text-lg text-muted">
                Netlify hasn’t detected the “Tell your story” form yet. Turn on form detection in Netlify (Forms → Enable form detection), then redeploy the site.
              </p>
            ) : entries.length === 0 ? (
              <p className="mt-8 text-lg text-muted">No submissions yet.</p>
            ) : (
              <>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <label className="relative flex-1">
                    <span className="sr-only">Search submissions</span>
                    <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
                    <input type="search" className={`${input} min-h-11 pl-10`} placeholder="Search name, email, reference, story…" value={query} onChange={(e) => setQuery(e.target.value)} />
                  </label>
                  <label>
                    <span className="sr-only">Preferred contact</span>
                    <select className={`${input} min-h-11 sm:w-auto`} value={method} onChange={(e) => setMethod(e.target.value as ContactMethod | 'any')}>
                      <option value="any">Any contact method</option>
                      {(Object.keys(METHOD_LABEL) as ContactMethod[]).map((m) => (
                        <option key={m} value={m}>
                          Prefers {METHOD_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">Received</span>
                    <select className={`${input} min-h-11 sm:w-auto`} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                      <option value="any">Any time</option>
                      <option value="7">Last 7 days</option>
                      <option value="30">Last 30 days</option>
                      <option value="90">Last 90 days</option>
                    </select>
                  </label>
                  <div role="group" aria-label="Show" className="flex gap-2">
                    {(['all', 'story', 'call'] as const).map((f) => (
                      <button key={f} type="button" aria-pressed={filter === f} className={buttonClass(filter === f ? 'dark' : 'outline', 'sm')} onClick={() => setFilter(f)}>
                        {f === 'all' ? 'All' : f === 'story' ? 'Stories' : 'Call requests'}
                      </button>
                    ))}
                  </div>
                </div>
                {shown.length === 0 ? (
                  <p className="mt-8 text-muted">Nothing matches these filters.</p>
                ) : (
                  <ul className="mt-6 space-y-3">
                    {shown.map((entry) => (
                      <li key={entry.id}>
                        <Submission entry={entry} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}

function Submission({ entry }: { entry: InboxEntry }) {
  const f = entry.fields
  const call = isCallRequest(entry)
  const link = 'font-semibold text-blue-ink underline underline-offset-4'
  const preferred = preferredContact(entry)
  const profile = safeWebLink(f.profile_link)
  return (
    <details className="group rounded-xl border border-line bg-white open:border-ink/30">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-4 gap-y-1 p-4 md:p-5">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${call ? 'bg-yellow text-ink' : 'bg-blue text-white'}`}>{call ? 'Call request' : 'Story'}</span>
        <span className="font-semibold text-ink">{f.full_name || 'No name'}</span>
        {f.story_title && <span className="min-w-0 flex-1 truncate text-muted">“{f.story_title}”</span>}
        <span className="ml-auto flex items-center gap-3 text-sm text-muted">
          {preferred && <span className="rounded-full bg-bone px-2.5 py-0.5 text-xs font-semibold text-ink">Prefers {METHOD_LABEL[preferred]}</span>}
          {formatDate(entry.receivedAt)}
        </span>
      </summary>
      <ContactPanel entry={entry} preferred={preferred} />
      <dl className="grid gap-x-6 gap-y-4 border-t border-line p-4 md:grid-cols-[12rem_1fr] md:p-5">
        <Row label="Reference"><span className="font-mono">{f.reference}</span></Row>
        <Row label="Request">{f.request_type}</Row>
        <Row label="Email">{f.email}</Row>
        <Row label="Phone">{f.phone}</Row>
        <Row label="Preferred contact">{f.preferred_contact}</Row>
        <Row label="Profile">{profile ? <a className={`${link} break-all`} href={profile} target="_blank" rel="noopener noreferrer">{f.profile_link}</a> : f.profile_link}</Row>
        <Row label={call ? 'Topic' : 'Story title'}>{f.story_title}</Row>
        <Row label="Story">{f.story_summary}</Row>
        <Row label="Why share it">{f.why_share}</Row>
        <Row label="Topics">{f.topics}</Row>
        <Row label="Interview format">{f.interview_format}</Row>
        <Row label="Availability">{f.availability}</Row>
        <Row label="Anything else">{f.additional_info}</Row>
        <Row label="Consents">{f.consents}</Row>
      </dl>
    </details>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (!children) return null
  return (
    <>
      <dt className="kicker text-muted">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-ink">{children}</dd>
    </>
  )
}
