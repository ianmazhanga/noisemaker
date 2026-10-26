import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { CheckCheck } from 'lucide-react'
import { NOTIFICATION_KINDS } from '../lib/newsroom'
import { buttonClass } from '../components/ui/buttonClass'
import { useAdmin, friendlyError } from './context'
import { Spinner } from './AdminApp'

interface Notification {
  id: string
  created_at: string
  kind: string
  title: string
  link: string
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function NotificationsPage() {
  const { db, unread, refreshCounts, toast } = useAdmin()
  const navigate = useNavigate()
  const [items, setItems] = useState<Notification[] | null>(null)
  const [read, setRead] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [muted, setMuted] = useState<Set<string>>(new Set())
  const [emailOn, setEmailOn] = useState(false)
  const [prefsAvailable, setPrefsAvailable] = useState(false)
  const [showMuted, setShowMuted] = useState(false)

  const load = useCallback(async () => {
    const [notes, reads, prefs] = await Promise.all([
      db.from('notifications').select('id, created_at, kind, title, link').order('created_at', { ascending: false }).limit(200),
      db.from('notification_reads').select('notification_id'),
      db.from('notification_preferences').select('muted_kinds, email_enabled').maybeSingle(),
    ])
    setPrefsAvailable(!prefs.error)
    const p = prefs.data as { muted_kinds: string[]; email_enabled: boolean } | null
    setMuted(new Set(p?.muted_kinds ?? []))
    setEmailOn(Boolean(p?.email_enabled))
    if (notes.error || reads.error) return setError(friendlyError(notes.error ?? reads.error))
    setItems(notes.data as Notification[])
    setRead(new Set((reads.data ?? []).map((r) => r.notification_id as string)))
  }, [db])

  // The unread count changes when a notification arrives, so reload with it.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loads from Supabase; state is set when the request returns
    void load()
  }, [load, unread])

  async function markRead(ids: string[]) {
    const fresh = ids.filter((id) => !read.has(id))
    if (!fresh.length) return true
    const { error: e } = await db.from('notification_reads').upsert(fresh.map((notification_id) => ({ notification_id })), { onConflict: 'notification_id,user_id', ignoreDuplicates: true })
    if (e) {
      toast(friendlyError(e), 'error')
      return false
    }
    setRead((r) => new Set([...r, ...fresh]))
    refreshCounts()
    return true
  }

  async function savePrefs(nextMuted: Set<string>, nextEmail: boolean) {
    const row = { muted_kinds: [...nextMuted], email_enabled: nextEmail }
    const { data: existing } = await db.from('notification_preferences').select('user_id').maybeSingle()
    const { error: e } = existing ? await db.from('notification_preferences').update(row).eq('user_id', existing.user_id as string) : await db.from('notification_preferences').insert(row)
    if (e) return toast(friendlyError(e), 'error')
    setMuted(nextMuted)
    setEmailOn(nextEmail)
    refreshCounts()
    toast('Preferences saved')
  }

  const visible = (items ?? []).filter((n) => showMuted || !muted.has(n.kind))
  const unreadIds = visible.filter((n) => !read.has(n.id)).map((n) => n.id)

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl font-[800] tracking-[-0.02em] md:text-4xl">Notifications</h1>
        {unreadIds.length > 0 && (
          <button type="button" className={buttonClass('outline', 'sm')} onClick={() => void markRead(unreadIds).then((ok) => ok && toast('All marked as read'))}>
            <CheckCheck className="size-4" aria-hidden /> Mark all as read
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-danger/10 px-4 py-3 text-danger">
          {error}
        </p>
      )}
      {!items && !error ? (
        <Spinner label="Loading notifications…" />
      ) : items && visible.length === 0 ? (
        <p className="mt-8 text-muted">No notifications yet. You’ll be told here when a new story arrives.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-paper">
          {visible.map((n) => {
            const isUnread = !read.has(n.id)
            return (
              <li key={n.id}>
                <button
                  type="button"
                  className="flex w-full items-baseline gap-3 px-4 py-4 text-left hover:bg-bone"
                  onClick={() => void markRead([n.id]).then(() => navigate(n.link.startsWith('/admin') ? n.link : '/admin'))}
                >
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${isUnread ? 'bg-blue' : 'bg-transparent'}`} aria-hidden />
                  <span className={`flex-1 ${isUnread ? 'font-semibold' : 'text-muted'}`}>
                    {n.title}
                    {isUnread && <span className="sr-only"> (unread)</span>}
                  </span>
                  <time dateTime={n.created_at} className="shrink-0 text-sm text-muted">
                    {when(n.created_at)}
                  </time>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {prefsAvailable && (
        <section aria-labelledby="prefs-heading" className="mt-10 rounded-xl border border-line bg-paper p-5">
          <h2 id="prefs-heading" className="text-xl font-semibold">
            Preferences
          </h2>
          <p className="mt-1 text-sm text-muted">Choose what you’re told about. Muted notifications are hidden from your list and your unread count.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {Object.entries(NOTIFICATION_KINDS).map(([kind, label]) => (
              <li key={kind}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-blue"
                    checked={!muted.has(kind)}
                    onChange={(e) => {
                      const next = new Set(muted)
                      if (e.target.checked) next.delete(kind)
                      else next.add(kind)
                      void savePrefs(next, emailOn)
                    }}
                  />
                  {label}
                </label>
              </li>
            ))}
          </ul>
          <label className="mt-5 flex items-start gap-2">
            <input type="checkbox" className="mt-1 size-4 accent-blue" checked={emailOn} onChange={(e) => void savePrefs(muted, e.target.checked)} />
            <span>
              Also email me these (needs the email service in Settings → Integrations)
              <span className="block text-sm text-muted">Each notification is emailed once, only if you haven’t read it in the dashboard first.</span>
            </span>
          </label>
          {muted.size > 0 && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-blue" checked={showMuted} onChange={(e) => setShowMuted(e.target.checked)} /> Show muted notifications in the list
            </label>
          )}
        </section>
      )}
    </div>
  )
}
