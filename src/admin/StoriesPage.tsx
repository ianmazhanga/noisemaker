import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { RefreshCw, Search, Trash2 } from 'lucide-react'
import { STATUS_LABEL, STATUSES, type StoryStatus } from '../lib/supabase'
import { isCallRequest, matchesSearch, preferredContact, receivedWithin, safeWebLink, type ContactMethod } from '../lib/inbox'
import { ContactPanel } from '../components/inbox/ContactPanel'
import { METHOD_LABEL, inputClass } from '../components/inbox/shared'
import { buttonClass } from '../components/ui/buttonClass'
import { useAdmin, friendlyError, toEntry, type StoryRow } from './context'
import { Spinner } from './AdminApp'

const STATUS_STYLE: Record<StoryStatus, string> = {
  new: 'bg-blue text-white',
  under_review: 'bg-yellow text-ink',
  contacted: 'bg-ink text-paper',
  approved: 'bg-[#1f7a4d] text-white',
  declined: 'bg-line text-ink',
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function StoriesPage() {
  const { db, canReadStories, newStories } = useAdmin()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<StoryRow[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState<ContactMethod | 'any'>('any')
  const [period, setPeriod] = useState<'any' | '7' | '30' | '90'>('any')
  const [kind, setKind] = useState<'all' | 'story' | 'call'>('all')

  const status = (STATUSES as string[]).includes(params.get('status') ?? '') ? (params.get('status') as StoryStatus) : 'all'
  const openId = params.get('open')

  const load = useCallback(async () => {
    const { data, error: e } = await db.from('story_submissions').select('*').order('received_at', { ascending: false }).limit(1000)
    if (e) setError(friendlyError(e))
    else {
      setError('')
      setRows(data as StoryRow[])
    }
  }, [db])

  // Reload when the live new-story count changes, i.e. a story arrived or someone else triaged one.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loads from Supabase; state is set when the request returns
    void load()
  }, [load, newStories])

  useEffect(() => {
    if (openId && rows) document.getElementById(`story-${openId}`)?.scrollIntoView({ block: 'start' })
  }, [openId, rows])

  if (!canReadStories) return <p className="text-muted">The owner hasn’t given your account access to story submissions.</p>

  const setParam = (key: string, value: string | null) =>
    setParams((p) => {
      if (value) p.set(key, value)
      else p.delete(key)
      return p
    })

  const shown = (rows ?? []).filter((r) => {
    const entry = toEntry(r)
    return (
      (status === 'all' || r.status === status) &&
      (kind === 'all' || (kind === 'call') === isCallRequest(entry)) &&
      (method === 'any' || preferredContact(entry) === method) &&
      (period === 'any' || receivedWithin(entry, Number(period))) &&
      matchesSearch(entry, query)
    )
  })

  const replace = (row: StoryRow | null, id: string) => setRows((all) => (all ? (row ? all.map((r) => (r.id === id ? row : r)) : all.filter((r) => r.id !== id)) : all))

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-[800] tracking-[-0.02em] md:text-4xl">Story Inbox</h1>
          <p className="mt-1 text-muted">Submissions from the Tell your story page. {newStories ? `${newStories} waiting for a first look.` : ''}</p>
        </div>
        <button type="button" className={buttonClass('outline', 'sm')} onClick={() => void load()}>
          <RefreshCw className="size-4" aria-hidden /> Refresh
        </button>
      </div>

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Status">
        {(['all', ...STATUSES] as const).map((s) => (
          <button key={s} type="button" aria-pressed={status === s} className={buttonClass(status === s ? 'dark' : 'outline', 'sm')} onClick={() => setParam('status', s === 'all' ? null : s)}>
            {s === 'all' ? 'All' : STATUS_LABEL[s]}
            {s !== 'all' && rows && <span className="tabular-nums opacity-70">{rows.filter((r) => r.status === s).length}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <label className="relative">
          <span className="sr-only">Search submissions</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" className={`${inputClass} min-h-11 pl-10`} placeholder="Search name, email, phone, reference, story…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Select label="Request type" value={kind} onChange={(v) => setKind(v as typeof kind)} options={{ all: 'Stories and calls', story: 'Stories', call: 'Call requests' }} />
        <Select label="Preferred contact" value={method} onChange={(v) => setMethod(v as typeof method)} options={{ any: 'Any contact method', whatsapp: 'Prefers WhatsApp', phone: 'Prefers phone', email: 'Prefers email' }} />
        <Select label="Received" value={period} onChange={(v) => setPeriod(v as typeof period)} options={{ any: 'Any time', 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days' }} />
      </div>

      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-danger/10 px-4 py-3 text-danger">
          {error}
        </p>
      )}
      {!rows && !error ? (
        <Spinner label="Loading submissions…" />
      ) : rows && rows.length === 0 ? (
        <p className="mt-10 text-lg text-muted">No submissions yet. When someone sends a story from the Tell your story page, it appears here.</p>
      ) : shown.length === 0 ? (
        <p className="mt-10 text-muted">Nothing matches these filters.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {shown.map((row) => (
            <li key={row.id} id={`story-${row.id}`} className="scroll-mt-24">
              <Submission row={row} open={row.id === openId} onChange={(next) => replace(next, row.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Record<string, string> }) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select className={`${inputClass} min-h-11 md:w-auto`} value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(options).map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}

function Submission({ row, open, onChange }: { row: StoryRow; open: boolean; onChange: (row: StoryRow | null) => void }) {
  const { db, isOwner, toast, refreshCounts } = useAdmin()
  const entry = toEntry(row)
  const f = entry.fields
  const call = isCallRequest(entry)
  const preferred = preferredContact(entry)
  const profile = safeWebLink(f.profile_link)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function setStatus(status: StoryStatus) {
    setSaving(true)
    const { data, error } = await db.from('story_submissions').update({ status }).eq('id', row.id).select().single()
    setSaving(false)
    if (error) return toast(friendlyError(error), 'error')
    onChange(data as StoryRow)
    refreshCounts()
    toast(`Marked as ${STATUS_LABEL[status]}`)
  }

  async function remove() {
    const { error } = await db.from('story_submissions').delete().eq('id', row.id)
    if (error) return toast(friendlyError(error), 'error')
    onChange(null)
    refreshCounts()
    toast(`Deleted ${f.reference}`)
  }

  return (
    <details open={open || undefined} className="group rounded-xl border border-line bg-paper open:border-ink/30">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 p-4 md:p-5">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
        <span className="text-xs font-semibold text-muted uppercase">{call ? 'Call request' : 'Story'}</span>
        <span className="font-semibold">{f.full_name || 'No name'}</span>
        {f.story_title && <span className="min-w-0 flex-1 truncate text-muted">“{f.story_title}”</span>}
        <span className="ml-auto flex items-center gap-3 text-sm text-muted">
          {preferred && <span className="rounded-full bg-bone px-2.5 py-0.5 text-xs font-semibold text-ink">Prefers {METHOD_LABEL[preferred]}</span>}
          <time dateTime={row.received_at}>{when(row.received_at)}</time>
        </span>
      </summary>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 md:px-5">
        <label className="flex items-center gap-2">
          <span className="text-sm font-semibold">Status</span>
          <select className={`${inputClass} min-h-10 w-auto py-1`} value={row.status} disabled={saving} onChange={(e) => void setStatus(e.target.value as StoryStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {row.status_changed_at && <span className="text-sm text-muted">changed {when(row.status_changed_at)}</span>}
        {isOwner && (
          <span className="ml-auto flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-sm font-semibold text-danger">Delete permanently?</span>
                <button type="button" className={buttonClass('dark', 'sm', '!border-danger !bg-danger')} onClick={() => void remove()}>
                  Yes, delete
                </button>
                <button type="button" className={buttonClass('outline', 'sm')} onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className={buttonClass('outline', 'sm')} onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" aria-hidden /> Delete
              </button>
            )}
          </span>
        )}
      </div>

      <ContactPanel entry={entry} preferred={preferred} />

      <dl className="grid gap-x-6 gap-y-4 border-t border-line p-4 md:grid-cols-[12rem_1fr] md:p-5">
        <Row label="Reference">
          <span className="font-mono">{f.reference}</span>
        </Row>
        <Row label="Request">{f.request_type}</Row>
        <Row label="Email">{f.email}</Row>
        <Row label="Phone">{f.phone}</Row>
        <Row label="Preferred contact">{f.preferred_contact}</Row>
        <Row label="Profile">
          {profile ? (
            <a className="font-semibold break-all text-blue-ink underline underline-offset-4" href={profile} target="_blank" rel="noopener noreferrer">
              {f.profile_link}
            </a>
          ) : (
            f.profile_link
          )}
        </Row>
        <Row label={call ? 'Topic' : 'Story title'}>{f.story_title}</Row>
        <Row label="Story">{f.story_summary}</Row>
        <Row label="Why share it">{f.why_share}</Row>
        <Row label="Topics">{f.topics}</Row>
        <Row label="Interview format">{f.interview_format}</Row>
        <Row label="Availability">{f.availability}</Row>
        <Row label="Anything else">{f.additional_info}</Row>
        <Row label="Consents">{f.consents}</Row>
      </dl>

      <Notes submissionId={row.id} />
    </details>
  )
}

interface Note {
  id: string
  body: string
  created_at: string
  author_id: string
  author: { full_name: string; email: string } | null
}

/** Private notes, loaded only when the submission is opened. */
function Notes({ submissionId }: { submissionId: string }) {
  const { db, session, toast } = useAdmin()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const id = `note-${submissionId}`

  const load = useCallback(async () => {
    const { data, error } = await db.from('story_notes').select('id, body, created_at, author_id, author:profiles(full_name, email)').eq('submission_id', submissionId).order('created_at')
    if (error) toast(friendlyError(error), 'error')
    else setNotes(data as unknown as Note[])
  }, [db, submissionId, toast])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loads from Supabase; state is set when the request returns
    void load()
  }, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!draft.trim()) return
    setBusy(true)
    const { error } = await db.from('story_notes').insert({ submission_id: submissionId, body: draft.trim() })
    setBusy(false)
    if (error) return toast(friendlyError(error), 'error')
    setDraft('')
    void load()
  }

  async function remove(noteId: string) {
    const { error } = await db.from('story_notes').delete().eq('id', noteId)
    if (error) return toast(friendlyError(error), 'error')
    void load()
  }

  return (
    <section className="border-t border-line p-4 md:p-5" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="kicker text-muted">
        Private notes
      </h3>
      {notes === null ? (
        <Spinner label="Loading notes…" />
      ) : notes.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No notes yet. Only your team can see them.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-bone px-4 py-3">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 flex items-center gap-3 text-xs text-muted">
                {n.author?.full_name || n.author?.email || 'A team member'} · {when(n.created_at)}
                {n.author_id === session.user.id && (
                  <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void remove(n.id)}>
                    Delete
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
        <label htmlFor={id} className="sr-only">
          Add a note
        </label>
        <textarea id={id} rows={2} maxLength={5000} className={`${inputClass} py-2.5`} placeholder="Add a private note…" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" disabled={busy || !draft.trim()} className={buttonClass('dark', 'md', 'shrink-0')}>
          Add note
        </button>
      </form>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (!children) return null
  return (
    <>
      <dt className="kicker text-muted">{label}</dt>
      <dd className="break-words whitespace-pre-wrap">{children}</dd>
    </>
  )
}
