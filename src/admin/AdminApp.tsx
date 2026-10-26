import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import type { Session } from '@supabase/supabase-js'
import { BarChart3, Bell, CalendarDays, Clapperboard, Inbox, LayoutDashboard, LogOut, Mail, Megaphone, Menu, Newspaper, Radar, Scissors, Settings, Users, X } from 'lucide-react'
import { YouTubeIcon } from '../components/ui/BrandIcons'
import { supabase, ROLE_LABEL, type Profile } from '../lib/supabase'
import { Seo } from '../components/seo/Seo'
import { LogoMark } from '../components/brand/Logo'
import { buttonClass } from '../components/ui/buttonClass'
import { inputClass } from '../components/inbox/shared'
import { AdminContext, friendlyError, type AdminState } from './context'

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-muted" role="status">
      <span className="size-5 animate-spin-slow rounded-full border-2 border-ink/15 border-t-ink" aria-hidden />
      {label}
    </div>
  )
}

/** Centred card used by the sign-in, setup and no-access screens. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bone px-4 py-12">
      <Seo title={title} description="Noisemakers owner dashboard." noindex />
      <div className="w-full max-w-md rounded-2xl border border-line bg-paper p-7 shadow-[0_20px_40px_-28px_rgb(11_11_12_/_0.45)] md:p-9">
        <Link to="/" className="inline-flex items-center gap-2.5 font-display text-lg font-[800] tracking-[-0.02em]">
          <LogoMark className="size-9" /> Noisemakers
        </Link>
        <h1 className="mt-6 font-display text-3xl font-[800] tracking-[-0.02em]">{title}</h1>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  )
}

function NotConfigured() {
  return (
    <AuthCard title="Dashboard not set up yet">
      <p className="text-muted">
        The owner dashboard needs a Supabase project. Add <code className="font-mono text-sm">VITE_SUPABASE_URL</code> and <code className="font-mono text-sm">VITE_SUPABASE_KEY</code> in Vercel, then redeploy. The
        steps are in <code className="font-mono text-sm">docs/admin-setup.md</code>.
      </p>
    </AuthCard>
  )
}

function SignIn() {
  const db = supabase!
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'reset'>('signin')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    if (mode === 'signin') {
      const { error } = await db.auth.signInWithPassword({ email: email.trim(), password })
      if (error) setMessage({ kind: 'error', text: error.message === 'Invalid login credentials' ? 'That email and password don’t match an account.' : friendlyError(error) })
    } else {
      const { error } = await db.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/admin/reset` })
      // Same answer whether or not the address has an account, so the form can't be used to find team members.
      setMessage(error ? { kind: 'error', text: friendlyError(error) } : { kind: 'info', text: 'If that address has an account, a link to choose a new password is on its way.' })
    }
    setBusy(false)
  }

  return (
    <AuthCard title={mode === 'signin' ? 'Sign in' : 'Reset your password'}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="font-semibold">Email</span>
          <input type="email" required autoComplete="username" className={`${inputClass} mt-1.5 min-h-12`} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === 'signin' && (
          <label className="block">
            <span className="font-semibold">Password</span>
            <input type="password" required autoComplete="current-password" className={`${inputClass} mt-1.5 min-h-12`} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        {message && (
          <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-danger' : 'text-ink'}>
            {message.text}
          </p>
        )}
        <button type="submit" disabled={busy} className={buttonClass('primary', 'lg', 'w-full')}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Email me a reset link'}
        </button>
        <button type="button" className="text-sm font-semibold text-blue-ink underline underline-offset-4" onClick={() => (setMode(mode === 'signin' ? 'reset' : 'signin'), setMessage(null))}>
          {mode === 'signin' ? 'Forgot your password?' : 'Back to sign in'}
        </button>
      </form>
    </AuthCard>
  )
}

function NoAccess({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <AuthCard title="No access yet">
      <p className="text-muted">
        You’re signed in as <span className="font-semibold text-ink">{email}</span>, but this account hasn’t been given a role. Ask the owner to give you access in Settings → Team.
      </p>
      <button type="button" className={buttonClass('outline', 'md', 'mt-6')} onClick={onSignOut}>
        Sign out
      </button>
    </AuthCard>
  )
}

export default function AdminApp() {
  if (!supabase) return <NotConfigured />
  return <AuthGate />
}

function AuthGate() {
  const db = supabase!
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    void db.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = db.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [db])

  const userId = session?.user.id
  const refreshProfile = useCallback(async () => {
    if (!userId) return
    const { data, error } = await db.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) setLoadError(friendlyError(error))
    else setProfile((data as Profile | null) ?? null)
  }, [db, userId])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loads from Supabase; state is set when the request returns
    void refreshProfile()
  }, [refreshProfile])

  const signOut = () => void db.auth.signOut()

  if (session === undefined) return <AuthCard title="Loading"><Spinner label="Checking your sign-in…" /></AuthCard>
  if (!session) return <SignIn />
  if (loadError) return <AuthCard title="Couldn’t load your account"><p role="alert" className="text-danger">{loadError}</p></AuthCard>
  // A profile from a previous sign-in doesn't count for a different user.
  if (profile === undefined || (profile && profile.id !== session.user.id)) return <AuthCard title="Loading"><Spinner label="Loading your account…" /></AuthCard>
  if (!profile?.role) return <NoAccess email={session.user.email ?? ''} onSignOut={signOut} />
  return <Dashboard session={session} profile={profile} refreshProfile={refreshProfile} onSignOut={signOut} />
}

function Dashboard({ session, profile, refreshProfile, onSignOut }: { session: Session; profile: Profile; refreshProfile: () => Promise<void>; onSignOut: () => void }) {
  const db = supabase!
  const isOwner = profile.role === 'owner'
  const isWriter = profile.role !== 'viewer'
  // The database applies the same rule: viewers never see story submissions.
  const canReadStories = isOwner || (isWriter && profile.can_view_stories)
  const [newStories, setNewStories] = useState<number | null>(null)
  const [unread, setUnread] = useState<number | null>(null)
  const [pendingPosts, setPendingPosts] = useState<number | null>(null)
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: 'success' | 'error' }[]>([])
  const toastId = useRef(0)
  const [menuOpen, setMenuOpen] = useState(false)

  const refreshCounts = useCallback(async () => {
    if (canReadStories) {
      const { count } = await db.from('story_submissions').select('id', { count: 'exact', head: true }).eq('status', 'new')
      setNewStories(count ?? 0)
    }
    const posts = await db.from('social_posts').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval')
    setPendingPosts(posts.error ? null : (posts.count ?? 0))
    const [{ data: notes }, { data: reads }, prefs] = await Promise.all([
      db.from('notifications').select('id, kind').order('created_at', { ascending: false }).limit(200),
      db.from('notification_reads').select('notification_id'),
      // Fails harmlessly before the newsroom migration adds preferences.
      db.from('notification_preferences').select('muted_kinds').maybeSingle(),
    ])
    const read = new Set((reads ?? []).map((r) => r.notification_id as string))
    const muted = new Set(((prefs.data as { muted_kinds: string[] } | null)?.muted_kinds ?? []))
    setUnread((notes ?? []).filter((n) => !read.has(n.id as string) && !muted.has(n.kind as string)).length)
  }, [db, canReadStories])

  // Counts update live: Supabase Realtime sends only rows this person may read.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loads from Supabase; state is set when the request returns
    void refreshCounts()
    const channel = db
      .channel('admin-counts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'story_submissions' }, () => void refreshCounts())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => void refreshCounts())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'social_posts' }, () => void refreshCounts())
      .subscribe()
    return () => void db.removeChannel(channel)
  }, [db, refreshCounts])

  const toast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  const state = useMemo<AdminState>(
    () => ({ db, session, profile, canReadStories, isOwner, isWriter, newStories, unread, pendingPosts, refreshCounts: () => void refreshCounts(), refreshProfile, toast }),
    [db, session, profile, canReadStories, isOwner, isWriter, newStories, unread, pendingPosts, refreshCounts, refreshProfile, toast],
  )

  const icon = 'size-4.5'
  const nav = (
    <nav aria-label="Dashboard" className="flex flex-col gap-1">
      <SideLink to="/admin" end icon={<LayoutDashboard className={icon} aria-hidden />}>
        Overview
      </SideLink>
      <NavGroup label="Newsroom" />
      {canReadStories && (
        <SideLink to="/admin/stories" icon={<Inbox className={icon} aria-hidden />} badge={newStories ? `${newStories} new` : undefined}>
          Story Inbox
        </SideLink>
      )}
      <SideLink to="/admin/news-agent" icon={<Radar className={icon} aria-hidden />}>
        AI News Agent
      </SideLink>
      <SideLink to="/admin/news" icon={<Newspaper className={icon} aria-hidden />}>
        News Manager
      </SideLink>
      <SideLink to="/admin/newsletter" icon={<Mail className={icon} aria-hidden />}>
        Newsletter Manager
      </SideLink>
      <NavGroup label="Video" />
      <SideLink to="/admin/video" icon={<Clapperboard className={icon} aria-hidden />}>
        Video Production
      </SideLink>
      <SideLink to="/admin/shorts" icon={<Scissors className={icon} aria-hidden />}>
        AI Shorts Generator
      </SideLink>
      <SideLink to="/admin/youtube" icon={<YouTubeIcon className={icon} />}>
        YouTube Manager
      </SideLink>
      <NavGroup label="Publishing" />
      <SideLink to="/admin/social" icon={<Megaphone className={icon} aria-hidden />} badge={pendingPosts ? `${pendingPosts} to approve` : undefined}>
        Social Media Manager
      </SideLink>
      <SideLink to="/admin/calendar" icon={<CalendarDays className={icon} aria-hidden />}>
        Content Calendar
      </SideLink>
      <SideLink to="/admin/analytics" icon={<BarChart3 className={icon} aria-hidden />}>
        Analytics
      </SideLink>
      <NavGroup label="Team" />
      <SideLink to="/admin/notifications" icon={<Bell className={icon} aria-hidden />} badge={unread ? String(unread) : undefined}>
        Notifications
      </SideLink>
      {isOwner && (
        <SideLink to="/admin/team" icon={<Users className={icon} aria-hidden />}>
          Team Management
        </SideLink>
      )}
      <SideLink to="/admin/settings" icon={<Settings className={icon} aria-hidden />}>
        Settings
      </SideLink>
    </nav>
  )

  return (
    <AdminContext.Provider value={state}>
      <Seo title="Dashboard" description="Noisemakers owner dashboard." noindex />
      <div className="min-h-screen bg-bone lg:grid lg:grid-cols-[16rem_1fr]">
        <aside className="on-dark hidden bg-ink p-5 text-paper lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto">
          <Brand />
          <div className="mt-8">{nav}</div>
        </aside>

        {menuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Dashboard menu">
            <button type="button" className="absolute inset-0 bg-ink/50" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
            <aside className="on-dark absolute inset-y-0 left-0 w-72 overflow-y-auto bg-ink p-5 text-paper">
              <div className="flex items-center justify-between">
                <Brand />
                <button type="button" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-ink-3" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
                  <X className="size-5" aria-hidden />
                </button>
              </div>
              {/* Choosing a link closes the menu. */}
              <div className="mt-8" onClick={(e) => (e.target as HTMLElement).closest('a') && setMenuOpen(false)}>
                {nav}
              </div>
            </aside>
          </div>
        )}

        <div className="min-w-0">
          <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-line bg-paper px-4 md:px-8">
            <button type="button" className="-ml-2 inline-flex size-11 items-center justify-center rounded-full hover:bg-bone lg:hidden" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
              <Menu className="size-5" aria-hidden />
            </button>
            <span className="lg:hidden">
              <Brand compact />
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Link to="/admin/notifications" className="relative inline-flex size-11 items-center justify-center rounded-full hover:bg-bone" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                <Bell className="size-5" aria-hidden />
                {!!unread && (
                  <span className="absolute top-1.5 right-1.5 min-w-5 rounded-full bg-danger px-1 text-center text-[0.6875rem] leading-5 font-semibold text-white" aria-hidden>
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
              <div className="hidden text-right text-sm leading-tight sm:block">
                <p className="font-semibold">{profile.full_name || session.user.email}</p>
                <p className="text-muted">{ROLE_LABEL[profile.role!]}</p>
              </div>
              <button type="button" className={buttonClass('outline', 'sm')} onClick={onSignOut}>
                <LogOut className="size-4" aria-hidden /> <span className="max-sm:sr-only">Sign out</span>
              </button>
            </div>
          </header>
          <main id="main" className="px-4 py-8 md:px-8 md:py-10">
            <Suspense fallback={<Spinner label="Loading…" />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>

      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <p key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={`pointer-events-auto rounded-lg px-4 py-3 font-semibold shadow-lg ${t.kind === 'error' ? 'bg-danger text-white' : 'bg-ink text-paper'}`}>
            {t.message}
          </p>
        ))}
      </div>
    </AdminContext.Provider>
  )
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/admin" className="inline-flex items-center gap-2.5">
      <LogoMark className="size-8 shrink-0" />
      <span className="leading-tight">
        <span className="block font-display text-[1.05rem] font-[800] tracking-[-0.02em]">Noisemakers</span>
        {!compact && <span className="block text-xs text-muted-dark">Owner dashboard</span>}
      </span>
    </Link>
  )
}

function NavGroup({ label }: { label: string }) {
  return <p className="kicker mt-5 mb-1 px-3 text-muted-dark">{label}</p>
}

function SideLink({ to, end, icon, badge, children }: { to: string; end?: boolean; icon: ReactNode; badge?: string; children: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium transition-colors ${isActive ? 'bg-paper text-ink' : 'text-paper/80 hover:bg-ink-3 hover:text-paper'}`}
    >
      {icon}
      {children}
      {badge && <span className="ml-auto rounded-full bg-yellow px-2 py-0.5 text-xs font-semibold text-ink">{badge}</span>}
    </NavLink>
  )
}
