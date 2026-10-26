import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, Minus } from 'lucide-react'
import { ROLE_LABEL, type Profile, type StaffRole } from '../lib/supabase'
import { ROLE_INFO, ROLES } from '../lib/newsroom'
import { inputClass } from '../components/inbox/shared'
import { buttonClass } from '../components/ui/buttonClass'
import { useAdmin, friendlyError } from './context'
import { Spinner } from './AdminApp'
import { Card, PageHeader } from './ui'
import { labelClass, when } from './lib'

const INVITE_ERRORS: Record<string, string> = {
  'already-registered': 'That address already has an account. Find it in the list below to change its access.',
  forbidden: 'Only an owner can invite people.',
  'signed-out': 'Your sign-in has expired. Sign in again and retry.',
  invalid: 'Please check the email address.',
  'not-configured': 'Invitations need SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel. See docs/admin-setup.md.',
}

/** What each role can do. The database enforces the same rules. */
const MATRIX: [string, Record<StaffRole, boolean | 'flag'>][] = [
  ['Read the dashboard', { owner: true, editor: true, content_manager: true, viewer: true }],
  ['Read story submissions (personal details)', { owner: true, editor: 'flag', content_manager: 'flag', viewer: false }],
  ['Write drafts: posts, articles, newsletters, videos, clips', { owner: true, editor: true, content_manager: true, viewer: false }],
  ['Use AI and start video jobs (within the budgets)', { owner: true, editor: true, content_manager: true, viewer: false }],
  ['Approve, schedule and publish anything', { owner: true, editor: false, content_manager: false, viewer: false }],
  ['Connect accounts, change settings and budgets', { owner: true, editor: false, content_manager: false, viewer: false }],
  ['Manage the team, see the activity log and subscribers', { owner: true, editor: false, content_manager: false, viewer: false }],
]

export default function TeamPage() {
  const { isOwner } = useAdmin()
  if (!isOwner) return <p className="text-muted">Only owners manage the team.</p>
  return (
    <div className="max-w-5xl space-y-8">
      <PageHeader title="Team Management" intro="Everyone has their own sign-in. Roles decide what each person can do, and the database enforces them, not just the buttons." />
      <Members />
      <Card title="Who can do what">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-xs text-muted uppercase">
              <tr>
                <th className="py-2" />
                {ROLES.map((r) => <th key={r} className="px-2 py-2 text-center">{ROLE_INFO[r].label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {MATRIX.map(([what, can]) => (
                <tr key={what}>
                  <td className="py-2 pr-3">{what}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-2 py-2 text-center">
                      {can[r] === 'flag' ? <span className="text-xs font-semibold">If allowed</span> : can[r] ? <Check className="mx-auto size-4 text-[#1f7a4d]" aria-label="Yes" /> : <Minus className="mx-auto size-4 text-muted" aria-label="No" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <AuditLog />
    </div>
  )
}

function Members() {
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

  const canHaveStories = (r: StaffRole | null) => r === 'editor' || r === 'content_manager'

  return (
    <Card title="People">
      <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label>
          <span className={labelClass}>Invite by email</span>
          <input type="email" required className={`${inputClass} mt-1.5 min-h-11`} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          <span className={labelClass}>Role</span>
          <select className={`${inputClass} mt-1.5 min-h-11`} value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
          </select>
        </label>
        <p className="text-sm text-muted sm:col-span-2">{ROLE_INFO[role].can}</p>
        {canHaveStories(role) && (
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" className="size-5 accent-blue" checked={stories} onChange={(e) => setStories(e.target.checked)} />
            Can read story submissions (names, contact details and stories)
          </label>
        )}
        <button type="submit" disabled={busy} className={buttonClass('primary', 'md', 'sm:col-span-2 sm:justify-self-start')}>
          {busy ? 'Sending…' : 'Send invitation'}
        </button>
      </form>

      {!members ? (
        <Spinner label="Loading team…" />
      ) : (
        <ul className="mt-6 divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{m.full_name || m.email}</span>
                <span className="block truncate text-sm text-muted">
                  {m.full_name && `${m.email} · `}joined {when(m.created_at)}
                </span>
              </span>
              {m.id === me.id ? (
                <span className="text-sm text-muted">{ROLE_LABEL[m.role!]} (you)</span>
              ) : (
                <>
                  <select aria-label={`Role for ${m.email}`} className={`${inputClass} min-h-10 w-auto py-1`} value={m.role ?? ''} onChange={(e) => void setAccess(m, (e.target.value || null) as StaffRole | null, m.can_view_stories)}>
                    <option value="">No access</option>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
                  </select>
                  {canHaveStories(m.role) && (
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
      <p className="mt-3 text-xs text-muted">Removing access keeps the account but it can’t see anything. To delete an account entirely, use Supabase → Authentication → Users.</p>
    </Card>
  )
}

function AuditLog() {
  const { db } = useAdmin()
  const [rows, setRows] = useState<{ id: number; at: string; action: string; target: string; actor: { full_name: string; email: string } | null }[] | null>(null)
  useEffect(() => {
    void db
      .from('audit_logs')
      .select('id, at, action, target, actor:profiles(full_name, email)')
      .order('at', { ascending: false })
      .limit(100)
      .then(({ data }) => setRows((data ?? []) as never))
  }, [db])
  return (
    <Card title="Activity log">
      <p className="text-sm text-muted">Approvals, publishing, settings changes, access changes and deletions, newest first.</p>
      {!rows ? (
        <Spinner label="Loading…" />
      ) : (
        <ul className="mt-3 max-h-96 divide-y divide-line overflow-y-auto text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap justify-between gap-x-4 py-2">
              <span>
                <span className="font-semibold">{r.actor?.full_name || r.actor?.email || 'System'}</span> · {r.action.replace('.', ': ').replace(/_/g, ' ')}
                {r.target && <span className="text-muted"> · {r.target.length > 24 ? `${r.target.slice(0, 8)}…` : r.target}</span>}
              </span>
              <time dateTime={r.at} className="text-muted">{when(r.at)}</time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
