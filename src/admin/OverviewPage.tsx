import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { STATUS_LABEL, STATUSES, type StoryStatus } from '../lib/supabase'
import { useAdmin, friendlyError } from './context'
import { Spinner } from './AdminApp'

interface Activity {
  id: string | number
  at: string
  text: string
  link?: string
}

const AUDIT_TEXT: Record<string, (target: string, details: Record<string, unknown>) => string> = {
  'story.status': (ref, d) => `${ref} moved from ${STATUS_LABEL[d.from as StoryStatus] ?? d.from} to ${STATUS_LABEL[d.to as StoryStatus] ?? d.to}`,
  'story.deleted': (ref) => `${ref} was deleted`,
  'member.invited': () => 'A team member was invited',
  'member.access': () => 'A team member’s access was changed',
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function OverviewPage() {
  const { db, profile, canReadStories, isOwner, newStories, pendingPosts } = useAdmin()
  const [counts, setCounts] = useState<Record<StoryStatus | 'total', number> | null>(null)
  const [activity, setActivity] = useState<Activity[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    async function load() {
      try {
        if (canReadStories) {
          const results = await Promise.all(
            [undefined, ...STATUSES].map((status) => {
              const q = db.from('story_submissions').select('id', { count: 'exact', head: true })
              return status ? q.eq('status', status) : q
            }),
          )
          const failed = results.find((r) => r.error)
          if (failed?.error) throw failed.error
          const [total, ...byStatus] = results.map((r) => r.count ?? 0)
          if (live) setCounts({ total, ...Object.fromEntries(STATUSES.map((s, i) => [s, byStatus[i]])) } as Record<StoryStatus | 'total', number>)
        }
        // The owner sees the audit log; everyone else sees their notifications.
        if (isOwner) {
          const { data, error: e } = await db.from('audit_logs').select('id, at, action, target, details').order('at', { ascending: false }).limit(8)
          if (e) throw e
          if (live) setActivity((data ?? []).map((r) => ({ id: r.id, at: r.at, text: AUDIT_TEXT[r.action]?.(r.target, r.details ?? {}) ?? r.action })))
        } else {
          const { data, error: e } = await db.from('notifications').select('id, created_at, title, link').order('created_at', { ascending: false }).limit(8)
          if (e) throw e
          if (live) setActivity((data ?? []).map((r) => ({ id: r.id, at: r.created_at, text: r.title, link: r.link })))
        }
      } catch (e) {
        if (live) setError(friendlyError(e as { message?: string }))
      }
    }
    void load()
    return () => {
      live = false
    }
    // newStories changes when a story arrives or is triaged, so the cards stay current.
  }, [db, canReadStories, isOwner, newStories])

  const first = profile.full_name.split(' ')[0]

  return (
    <div className="max-w-6xl">
      <h1 className="font-display text-3xl font-[800] tracking-[-0.02em] md:text-4xl">{first ? `Welcome back, ${first}` : 'Overview'}</h1>
      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-danger/10 px-4 py-3 text-danger">
          {error}
        </p>
      )}

      {canReadStories && (
        <section aria-labelledby="stories-heading" className="mt-8">
          <h2 id="stories-heading" className="kicker text-muted">
            Story submissions
          </h2>
          {!counts && !error ? (
            <Spinner label="Counting submissions…" />
          ) : counts ? (
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Link to="/admin/stories?status=new" className="group col-span-2 rounded-xl bg-blue p-5 text-white transition-transform hover:-translate-y-0.5 lg:col-span-1">
                <p className="text-sm font-semibold text-white/80">New, waiting for you</p>
                <p className="mt-2 font-display text-5xl font-[800]">{counts.new}</p>
                <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold">
                  Open Story Inbox <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </p>
              </Link>
              <Stat label="Total submissions" value={counts.total} to="/admin/stories" />
              <Stat label="Under review" value={counts.under_review} to="/admin/stories?status=under_review" />
              <Stat label="Contacted" value={counts.contacted} to="/admin/stories?status=contacted" />
              <Stat label="Approved" value={counts.approved} to="/admin/stories?status=approved" />
              <Stat label="Declined" value={counts.declined} to="/admin/stories?status=declined" />
            </div>
          ) : null}
        </section>
      )}

      {pendingPosts !== null && (
        <section aria-labelledby="social-heading" className="mt-10">
          <h2 id="social-heading" className="kicker text-muted">
            Social media
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Link to="/admin/social?status=pending_approval" className="group col-span-2 rounded-xl bg-yellow p-5 text-ink transition-transform hover:-translate-y-0.5 lg:col-span-1">
              <p className="text-sm font-semibold">Posts awaiting approval</p>
              <p className="mt-2 font-display text-5xl font-[800]">{pendingPosts}</p>
              <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold">
                {isOwner ? 'Review them' : 'View them'} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </p>
            </Link>
            <Stat label="Create posts from a video" value={null} to="/admin/social?tab=create" />
            <Stat label="Content calendar" value={null} to="/admin/social?tab=calendar" />
          </div>
        </section>
      )}

      <section aria-labelledby="activity-heading" className="mt-10">
        <h2 id="activity-heading" className="kicker text-muted">
          Recent activity
        </h2>
        {!activity && !error ? (
          <Spinner label="Loading activity…" />
        ) : activity && activity.length === 0 ? (
          <p className="mt-4 text-muted">Nothing yet. New stories and changes will show up here.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-paper">
            {activity?.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
                {a.link ? (
                  <Link to={a.link} className="font-medium underline-offset-4 hover:underline">
                    {a.text}
                  </Link>
                ) : (
                  <span className="font-medium">{a.text}</span>
                )}
                <time dateTime={a.at} className="text-sm text-muted">
                  {when(a.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="next-heading" className="mt-10 rounded-xl border border-dashed border-ink/20 p-5">
        <h2 id="next-heading" className="font-semibold">
          Not connected yet
        </h2>
        <p className="mt-1 text-muted">Video production, newsletters, news and analytics will appear here as each one is built and connected. Nothing on this page is sample data.</p>
      </section>
    </div>
  )
}

function Stat({ label, value, to }: { label: string; value: number | null; to: string }) {
  return (
    <Link to={to} className="rounded-xl border border-line bg-paper p-5 transition-colors hover:border-ink/40">
      <p className="text-sm font-semibold text-muted">{label}</p>
      {value === null ? <ArrowRight className="mt-3 size-6" aria-hidden /> : <p className="mt-2 font-display text-4xl font-[800]">{value}</p>}
    </Link>
  )
}
