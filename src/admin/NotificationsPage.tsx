import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { CheckCheck } from 'lucide-react'
import { buttonClass } from '../components/ui/buttonClass'
import { useAdmin, friendlyError } from './context'
import { Spinner } from './AdminApp'

interface Notification {
  id: string
  created_at: string
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

  const load = useCallback(async () => {
    const [notes, reads] = await Promise.all([
      db.from('notifications').select('id, created_at, title, link').order('created_at', { ascending: false }).limit(200),
      db.from('notification_reads').select('notification_id'),
    ])
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

  const unreadIds = (items ?? []).filter((n) => !read.has(n.id)).map((n) => n.id)

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
      ) : items && items.length === 0 ? (
        <p className="mt-8 text-muted">No notifications yet. You’ll be told here when a new story arrives.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-paper">
          {items?.map((n) => {
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
    </div>
  )
}
