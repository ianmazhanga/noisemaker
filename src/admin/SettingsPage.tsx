import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ROLE_LABEL, type Profile, type StaffRole } from '../lib/supabase'
import { inputClass } from '../components/inbox/shared'
import { buttonClass } from '../components/ui/buttonClass'
import { useAdmin, friendlyError, MIN_PASSWORD } from './context'
import { Spinner } from './AdminApp'

export default function SettingsPage() {
  const { isOwner } = useAdmin()
  return (
    <div className="max-w-3xl space-y-10">
      <h1 className="font-display text-3xl font-[800] tracking-[-0.02em] md:text-4xl">Settings</h1>
      <MyAccount />
      {isOwner && <Team />}
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-paper p-5 md:p-6" aria-label={title}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function MyAccount() {
  const { db, session, profile, refreshProfile, toast } = useAdmin()
  const [name, setName] = useState(profile.full_name)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'name' | 'password' | null>(null)

  async function saveName(e: FormEvent) {
    e.preventDefault()
    setBusy('name')
    const { error } = await db.from('profiles').update({ full_name: name.trim() }).eq('id', profile.id)
    setBusy(null)
    if (error) return toast(friendlyError(error), 'error')
    await refreshProfile()
    toast('Name saved')
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    setBusy('password')
    const { error } = await db.auth.updateUser({ password })
    setBusy(null)
    if (error) return toast(friendlyError(error), 'error')
    setPassword('')
    toast('Password changed')
  }

  return (
    <Card title="Your account">
      <p className="text-muted">
        Signed in as <span className="font-semibold text-ink">{session.user.email}</span> · {ROLE_LABEL[profile.role!]}
      </p>
      <form onSubmit={saveName} className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="font-semibold">Your name</span>
          <input className={`${inputClass} mt-1.5 min-h-11`} maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" disabled={busy !== null || name.trim() === profile.full_name} className={buttonClass('dark', 'md')}>
          Save name
        </button>
      </form>
      <form onSubmit={savePassword} className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="font-semibold">New password</span>
          <input type="password" className={`${inputClass} mt-1.5 min-h-11`} minLength={MIN_PASSWORD} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="mt-1 block text-sm text-muted">At least {MIN_PASSWORD} characters.</span>
        </label>
        <button type="submit" disabled={busy !== null || password.length < MIN_PASSWORD} className={buttonClass('dark', 'md', 'sm:mb-6')}>
          Change password
        </button>
      </form>
    </Card>
  )
}

const INVITE_ERRORS: Record<string, string> = {
  'already-registered': 'That address already has an account. Find it in the list below to change its access.',
  forbidden: 'Only the owner can invite people.',
  'signed-out': 'Your sign-in has expired. Sign in again and retry.',
  invalid: 'Please check the email address.',
  'not-configured': 'Invitations need SUPABASE_URL and SUPABASE_SECRET_KEY in Netlify. See docs/admin-setup.md.',
}

function Team() {
  const { db, session, profile: me, toast } = useAdmin()
  const [members, setMembers] = useState<Profile[] | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('content_manager')
  const [stories, setStories] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await db.from('profiles').select('*').order('created_at')
    if (error) toast(friendlyError(error), 'error')
    else setMembers(data as Profile[])
  }, [db, toast])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loads from Supabase; state is set when the request returns
    void load()
  }, [load])

  async function invite(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ email: email.trim(), role, canViewStories: stories }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(INVITE_ERRORS[body.error ?? ''] ?? 'The invitation couldn’t be sent. Please try again.')
      toast(`Invitation sent to ${email.trim()}`)
      setEmail('')
      void load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'The invitation couldn’t be sent.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function setAccess(member: Profile, nextRole: StaffRole | null, nextStories: boolean) {
    const { error } = await db.rpc('set_member_access', { member_id: member.id, new_role: nextRole, stories: nextStories })
    if (error) return toast(friendlyError(error), 'error')
    toast(nextRole ? `Updated ${member.email}` : `Removed access for ${member.email}`)
    void load()
  }

  return (
    <Card title="Team">
      <p className="text-muted">Everyone has their own account. New people get an email to choose their password. Content Managers see the Story Inbox only if you tick the box.</p>
      <form onSubmit={invite} className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label>
          <span className="font-semibold">Email address</span>
          <input type="email" required className={`${inputClass} mt-1.5 min-h-11`} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          <span className="font-semibold">Role</span>
          <select className={`${inputClass} mt-1.5 min-h-11`} value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            <option value="content_manager">Content Manager</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        {role === 'content_manager' && (
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" className="size-5 accent-blue" checked={stories} onChange={(e) => setStories(e.target.checked)} />
            Can read story submissions (names, contact details and stories)
          </label>
        )}
        <button type="submit" disabled={busy} className={buttonClass('primary', 'md', 'sm:col-span-2 sm:justify-self-start')}>
          {busy ? 'Sending…' : 'Send invitation'}
        </button>
      </form>

      <h3 className="kicker mt-8 text-muted">People with an account</h3>
      {!members ? (
        <Spinner label="Loading team…" />
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{m.full_name || m.email}</span>
                {m.full_name && <span className="block truncate text-sm text-muted">{m.email}</span>}
              </span>
              {m.id === me.id ? (
                <span className="text-sm text-muted">Owner (you)</span>
              ) : (
                <>
                  <select
                    aria-label={`Role for ${m.email}`}
                    className={`${inputClass} min-h-10 w-auto py-1`}
                    value={m.role ?? ''}
                    onChange={(e) => void setAccess(m, (e.target.value || null) as StaffRole | null, m.can_view_stories)}
                  >
                    <option value="">No access</option>
                    <option value="content_manager">Content Manager</option>
                    <option value="owner">Owner</option>
                  </select>
                  {m.role === 'content_manager' && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4 accent-blue" checked={m.can_view_stories} onChange={(e) => void setAccess(m, m.role, e.target.checked)} />
                      Stories
                    </label>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
