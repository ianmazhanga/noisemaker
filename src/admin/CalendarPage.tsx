import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { buttonClass } from '../components/ui/buttonClass'
import { inputClass } from '../components/inbox/shared'
import { findConflicts, type CalendarItem } from '../lib/newsroom'
import { TIME_ZONES, utcToZoned, zonedToUtc } from '../lib/social'
import { defaultZone } from './social/shared'
import { useAdmin, friendlyError } from './context'
import { Spinner } from './AdminApp'
import { Drawer, NeedsMigration, Notice, PageHeader } from './ui'
import { labelClass, useLoad, memberName, type Member } from './lib'

/** Colour and label for each kind of item (and each social platform). */
const KIND: Record<string, { label: string; style: string }> = {
  youtube: { label: 'YouTube video', style: 'bg-[#ff0000] text-white' },
  recording: { label: 'Recording session', style: 'bg-[#6d28d9] text-white' },
  article: { label: 'News article', style: 'bg-[#0f766e] text-white' },
  newsletter: { label: 'Newsletter', style: 'bg-[#b45309] text-white' },
  instagram: { label: 'Instagram', style: 'bg-[#e1306c] text-white' },
  facebook: { label: 'Facebook', style: 'bg-[#1877f2] text-white' },
  tiktok: { label: 'TikTok', style: 'bg-ink text-white' },
  x: { label: 'X', style: 'bg-ink-3 text-white' },
  event: { label: 'Task or interview', style: 'bg-yellow text-ink' },
}

const kindOf = (i: CalendarItem) => (i.item_type === 'post' ? i.channel : i.item_type === 'youtube' ? 'youtube' : i.item_type)
/** Things that can be dragged to another day: unpublished posts, articles, newsletters, recordings and tasks. */
const movable = (i: CalendarItem) => i.item_type !== 'youtube' && i.item_id !== null && !['published', 'sent', 'sending', 'done', 'cancelled'].includes(i.status)

type View = 'month' | 'week' | 'day'

export default function CalendarPage() {
  const { db, isOwner, isWriter, toast } = useAdmin()
  const [zone, setZone] = useState(() => defaultZone(TIME_ZONES))
  // When the page opened; good enough for highlighting today and refusing past dates.
  const [now] = useState(() => Date.now())
  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState(() => utcToZoned(new Date(), defaultZone(TIME_ZONES)).slice(0, 10))
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [person, setPerson] = useState('all')
  const [adding, setAdding] = useState<string | null>(null)
  const [state, reload] = useLoad(async () => {
    const [items, members] = await Promise.all([db.from('content_calendar').select('*').order('at').limit(3000), db.rpc('team_members')])
    return { data: { items: (items.data ?? []) as CalendarItem[], members: (members.data ?? []) as Member[] }, error: items.error ?? members.error }
  }, [db])
  const conflicts = useMemo(() => (state.status === 'ready' ? findConflicts(state.data.items) : new Set<string>()), [state])
  if (state.status === 'missing') return <NeedsMigration title="Content Calendar" />

  const items = state.status === 'ready' ? state.data.items.filter((i) => i.at && !hidden.has(kindOf(i)) && (person === 'all' || i.person_id === person)) : []
  const byDay = new Map<string, (CalendarItem & { time: string })[]>()
  for (const i of items) {
    const local = utcToZoned(new Date(i.at), zone)
    byDay.set(local.slice(0, 10), [...(byDay.get(local.slice(0, 10)) ?? []), { ...i, time: local.slice(11, 16) }])
  }
  for (const list of byDay.values()) list.sort((a, b) => a.time.localeCompare(b.time))

  const date = new Date(`${cursor}T00:00:00Z`)
  const shift = (n: number) => {
    const d = new Date(date)
    if (view === 'month') d.setUTCMonth(d.getUTCMonth() + n, 1)
    else d.setUTCDate(d.getUTCDate() + n * (view === 'week' ? 7 : 1))
    setCursor(d.toISOString().slice(0, 10))
  }
  const today = utcToZoned(new Date(now), zone).slice(0, 10)

  /** Dropping an item on another day keeps its time of day; the database checks who may move what. */
  async function drop(uid: string, dayKey: string) {
    const item = items.find((i) => i.uid === uid)
    if (!item || !movable(item)) return
    if (['post', 'article', 'newsletter'].includes(item.item_type) && !isOwner) return toast('Only an owner can change when something is published.', 'error')
    const time = utcToZoned(new Date(item.at), zone).slice(11, 16)
    const at = zonedToUtc(`${dayKey}T${time}`, zone)
    if (at.getTime() < now && item.item_type !== 'event') return toast('Choose a day in the future.', 'error')
    const { error } = await db.rpc('reschedule_item', { item_type: item.item_type, item_id: item.item_id, at: at.toISOString() })
    if (error) return toast(friendlyError(error), 'error')
    toast(`Moved to ${dayKey}`)
    void reload()
  }

  let days: string[]
  let title: string
  if (view === 'month') {
    const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    const lead = (first.getUTCDay() + 6) % 7
    const count = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    days = [...Array.from({ length: lead }, () => ''), ...Array.from({ length: count }, (_, i) => new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), i + 1)).toISOString().slice(0, 10))]
    title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  } else if (view === 'week') {
    const monday = new Date(date)
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
    days = Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10))
    title = `Week of ${monday.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`
  } else {
    days = [cursor]
    title = date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  }

  const visibleConflicts = items.filter((i) => conflicts.has(i.uid))

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Content Calendar"
        intro="Everything with a date: videos, recordings, posts, articles and newsletters. Drag an item to another day to reschedule it. Publishing dates can only be changed by an owner."
        actions={
          <select aria-label="Time zone" className={`${inputClass} min-h-10 w-auto py-1`} value={zone} onChange={(e) => setZone(e.target.value)}>
            {TIME_ZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
        }
      />
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass('outline', 'sm')} onClick={() => shift(-1)} aria-label="Previous">
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <h2 className="min-w-48 text-center text-lg font-semibold">{title}</h2>
        <button type="button" className={buttonClass('outline', 'sm')} onClick={() => shift(1)} aria-label="Next">
          <ChevronRight className="size-4" aria-hidden />
        </button>
        <button type="button" className="text-sm font-semibold text-blue-ink underline underline-offset-4" onClick={() => setCursor(today)}>
          Today
        </button>
        <div className="ml-auto flex gap-1" role="group" aria-label="View">
          {(['month', 'week', 'day'] as View[]).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} className={buttonClass(view === v ? 'dark' : 'outline', 'sm')} onClick={() => setView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Show">
        {Object.entries(KIND).map(([k, v]) => (
          <button key={k} type="button" aria-pressed={!hidden.has(k)} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n })} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${hidden.has(k) ? 'bg-line text-muted line-through' : v.style}`}>
            {v.label}
          </button>
        ))}
        {state.status === 'ready' && (
          <select aria-label="Team member" className={`${inputClass} ml-auto min-h-9 w-auto py-1 text-sm`} value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="all">Everyone</option>
            {state.data.members.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
          </select>
        )}
      </div>

      {visibleConflicts.length > 0 && (
        <div className="mt-3">
          <Notice kind="warn">
            <span className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4" aria-hidden /> {visibleConflicts.length} items are scheduled within an hour of another on the same channel.
            </span>
            <span className="text-sm">They’re outlined in red. Spreading them out usually gets each one more attention.</span>
          </Notice>
        </div>
      )}

      {state.status === 'loading' && <Spinner label="Loading the calendar…" />}
      {state.status === 'error' && <div className="mt-4"><Notice kind="error">{state.message}</Notice></div>}
      {state.status === 'ready' && (
        <div className="mt-4 overflow-x-auto">
          <div className={`grid gap-px overflow-hidden rounded-xl border border-line bg-line ${view === 'day' ? 'grid-cols-1' : 'min-w-[48rem] grid-cols-7'}`}>
            {view !== 'day' && ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="bg-bone px-2 py-1.5 text-xs font-semibold text-muted">{d}</div>)}
            {days.map((key, i) =>
              !key ? (
                <div key={`blank-${i}`} className="min-h-28 bg-bone/60" />
              ) : (
                <div
                  key={key}
                  className={`bg-paper p-1.5 ${view === 'month' ? 'min-h-28' : 'min-h-72'}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => void drop(e.dataTransfer.getData('text/plain'), key)}
                  aria-label={key}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${key === today ? 'inline-flex size-6 items-center justify-center rounded-full bg-blue text-white' : 'text-muted'}`}>{Number(key.slice(8))}</span>
                    {isWriter && (
                      <button type="button" className="rounded p-0.5 text-muted hover:bg-bone hover:text-ink" aria-label={`Add a task on ${key}`} onClick={() => setAdding(key)}>
                        <Plus className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </div>
                  <ul className="mt-1 space-y-1">
                    {(byDay.get(key) ?? []).map((item) => (
                      <li key={item.uid}>
                        <Link
                          to={item.link}
                          draggable={movable(item)}
                          onDragStart={(e) => e.dataTransfer.setData('text/plain', item.uid)}
                          className={`block truncate rounded px-1.5 py-0.5 text-xs font-semibold ${KIND[kindOf(item)]?.style ?? 'bg-line'} ${['published', 'sent', 'done'].includes(item.status) ? 'opacity-60' : ''} ${conflicts.has(item.uid) ? 'ring-2 ring-danger' : ''} ${movable(item) ? 'cursor-grab' : ''}`}
                          title={`${item.title} · ${item.status.replace(/_/g, ' ')}${item.approved ? '' : ' · not approved'}${item.person_id ? ` · ${memberName(state.data.members, item.person_id)}` : ''}`}
                        >
                          {item.time} {view === 'month' ? (KIND[kindOf(item)]?.label ?? '') : item.title}
                          {!item.approved && ' ⚑'}
                        </Link>
                        {view !== 'month' && (
                          <p className="truncate px-1.5 text-[0.6875rem] text-muted">
                            {KIND[kindOf(item)]?.label} · {item.status.replace(/_/g, ' ')}
                            {item.person_id && ` · ${memberName(state.data.members, item.person_id)}`}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
          <p className="mt-2 text-xs text-muted">⚑ = not approved yet. Times are in {TIME_ZONES.find((z) => z.id === zone)?.label}, with daylight-saving time handled automatically.</p>
        </div>
      )}
      {adding && state.status === 'ready' && <NewEvent dayKey={adding} zone={zone} members={state.data.members} onClose={() => setAdding(null)} onSaved={() => (setAdding(null), void reload())} />}
    </div>
  )
}

function NewEvent({ dayKey, zone, members, onClose, onSaved }: { dayKey: string; zone: string; members: Member[]; onClose: () => void; onSaved: () => void }) {
  const { db, toast } = useAdmin()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('task')
  const [time, setTime] = useState('10:00')
  const [assigned, setAssigned] = useState('')
  const [notes, setNotes] = useState('')
  async function save(e: FormEvent) {
    e.preventDefault()
    const { error } = await db.from('calendar_events').insert({ title: title.trim(), kind, starts_at: zonedToUtc(`${dayKey}T${time}`, zone).toISOString(), timezone: zone, assigned_to: assigned || null, notes })
    if (error) return toast(friendlyError(error), 'error')
    toast('Added to the calendar')
    onSaved()
  }
  return (
    <Drawer title={`Add to ${dayKey}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <label className="block">
          <span className={labelClass}>What</span>
          <input required maxLength={200} className={`${inputClass} mt-1 min-h-11`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={labelClass}>Type</span>
            <select className={`${inputClass} mt-1 min-h-11`} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="task">Task</option>
              <option value="interview">Interview</option>
              <option value="recording">Recording</option>
              <option value="deadline">Deadline</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            <span className={labelClass}>Time</span>
            <input type="time" className={`${inputClass} mt-1 min-h-11`} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className={labelClass}>Who</span>
          <select className={`${inputClass} mt-1 min-h-11`} value={assigned} onChange={(e) => setAssigned(e.target.value)}>
            <option value="">Nobody in particular</option>
            {members.filter((m) => m.role !== 'viewer').map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Notes</span>
          <textarea rows={3} maxLength={2000} className={`${inputClass} mt-1 py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="submit" className={buttonClass('primary', 'md')} disabled={!title.trim()}>
          Add
        </button>
      </form>
    </Drawer>
  )
}
