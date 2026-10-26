import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react'
import { ROLE_LABEL } from '../lib/supabase'
import { INTEGRATIONS } from '../lib/integrations'
import { TIME_ZONES } from '../lib/social'
import { inputClass } from '../components/inbox/shared'
import { buttonClass } from '../components/ui/buttonClass'
import { useAdmin, friendlyError, MIN_PASSWORD } from './context'
import { Spinner } from './AdminApp'
import { Badge, Card, NeedsMigration, Notice, PageHeader, Tabs } from './ui'
import { api, labelClass, money, useLoad, when } from './lib'

const TABS = { account: 'Your account', integrations: 'Integrations', costs: 'AI and costs', automation: 'Automation and storage' } as const
type Tab = keyof typeof TABS

export default function SettingsPage() {
  const { isOwner } = useAdmin()
  const [params, setParams] = useSearchParams()
  const tab = ((params.get('tab') ?? 'account') in TABS ? params.get('tab') : 'account') as Tab
  return (
    <div className="max-w-5xl">
      <PageHeader title="Settings" intro={isOwner ? <>Team members and roles are in <Link to="/admin/team" className="font-semibold text-blue-ink underline">Team Management</Link>.</> : undefined} />
      <div className="mt-6">
        <Tabs label="Settings" value={tab} onChange={(t) => setParams((p) => (p.set('tab', t), p))} tabs={TABS} />
      </div>
      <div className="mt-6">{tab === 'account' ? <MyAccount /> : tab === 'integrations' ? <Integrations /> : tab === 'costs' ? <Costs /> : <Automation />}</div>
    </div>
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
    <Card title="Your account" className="max-w-3xl">
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

interface IntegrationState {
  configured: boolean
  missing: string[]
  status: { last_success_at: string | null; last_sync_at: string | null; last_error: string; last_error_at: string | null } | null
  account: { status: string; account_name: string; connected_at: string | null; last_error: string } | null
}

function Integrations() {
  const { session, isOwner, toast } = useAdmin()
  const [data, setData] = useState<Record<string, IntegrationState> | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  const load = () =>
    api<Record<string, IntegrationState>>(session.access_token, '/api/admin/integrations')
      .then(setData)
      .catch((e: Error) => setError(e.message))

  useEffect(() => {
    void load()
    // oxlint-disable-next-line react/exhaustive-deps -- load once
  }, [])

  async function check() {
    setChecking(true)
    try {
      const results = await api<Record<string, string>>(session.access_token, '/api/admin/check-integrations', {}, 60_000)
      const failed = Object.entries(results).filter(([, v]) => v !== 'ok')
      toast(failed.length ? `${failed.length} connection problem(s): ${failed.map(([k]) => INTEGRATIONS[k]?.label ?? k).join(', ')}` : 'Every configured service answered correctly.', failed.length ? 'error' : 'success')
      await load()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setChecking(false)
    }
  }

  if (error) return <Notice kind="error">{error}</Notice>
  if (!data) return <Spinner label="Checking integrations…" />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-muted">What each service is used for, whether its settings are in place, and when it last worked. Secret keys are never shown here; they’re added in Vercel → Project → Settings → Environment Variables, then the project is redeployed.</p>
        {isOwner && (
          <button type="button" disabled={checking} className={buttonClass('outline', 'sm')} onClick={() => void check()}>
            {checking ? 'Testing…' : 'Test connections now'}
          </button>
        )}
      </div>
      <ul className="grid gap-4 md:grid-cols-2">
        {Object.entries(INTEGRATIONS).map(([key, info]) => {
          const s = data[key]
          const account = s?.account
          const failing = s?.status?.last_error && (!s.status.last_success_at || (s.status.last_error_at ?? '') > s.status.last_success_at)
          const state = info.unavailable ? 'unavailable' : !s?.configured && info.env.length ? 'missing' : failing ? 'error' : account && account.status !== 'connected' ? 'connect' : 'ok'
          return (
            <li key={key} className="rounded-xl border border-line bg-paper p-5">
              <div className="flex items-start gap-2">
                {state === 'ok' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[#1f7a4d]" aria-hidden /> : state === 'error' ? <XCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />}
                <h3 className="flex-1 font-semibold">{info.label}</h3>
                <Badge className={state === 'ok' ? 'bg-[#1f7a4d] text-white' : state === 'error' ? 'bg-danger text-white' : 'bg-line text-ink'}>
                  {{ ok: info.env.length ? 'Configured' : 'Ready', error: 'Connection error', missing: 'Not configured', connect: 'Account not connected', unavailable: 'Not available' }[state]}
                </Badge>
              </div>
              {info.unavailable ? (
                <p className="mt-2 text-sm text-muted">{info.unavailable}</p>
              ) : (
                <>
                  {info.features.length > 0 && <p className="mt-2 text-sm text-muted">Used for: {info.features.join(' · ')}</p>}
                  <dl className="mt-2 space-y-0.5 text-sm">
                    {s?.status?.last_success_at && <div>Last worked: {when(s.status.last_success_at)}</div>}
                    {s?.status?.last_sync_at && <div>Last sync: {when(s.status.last_sync_at)}</div>}
                    {failing && <div className="text-danger">Error {when(s.status!.last_error_at)}: {s.status!.last_error}</div>}
                    {account && <div>Account: {account.status === 'connected' ? `${account.account_name || 'connected'} (since ${when(account.connected_at)})` : 'not connected'}</div>}
                    {s?.missing.length ? <div className="text-danger">Missing in Vercel: {s.missing.map((m) => <code key={m} className="mr-1 font-mono text-xs">{m}</code>)}</div> : null}
                  </dl>
                  {(state !== 'ok' || !s?.status) && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-semibold">How to set it up</summary>
                      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">{info.setup.map((step) => <li key={step}>{step}</li>)}</ol>
                    </details>
                  )}
                  {account && account.status !== 'connected' && s?.configured && (
                    <Link to="/admin/social?tab=accounts" className={buttonClass('outline', 'sm', 'mt-3')}>
                      Connect the account
                    </Link>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

interface Settings {
  auto_ai_enabled: boolean
  monthly_ai_budget_usd: number
  monthly_video_budget_usd: number
  max_ai_requests_per_day: number
  max_video_minutes: number
  max_upload_mb: number
  max_clips_per_video: number
  source_retention_days: number
  render_retention_days: number
  default_timezone: string
  newsletter_from_name: string
  newsletter_reply_to: string
  updated_at: string
}

function useSettings() {
  const { db } = useAdmin()
  return useLoad(async () => db.from('app_settings').select('*').maybeSingle(), [db])
}

function SettingsForm({ fields, title }: { title: string; fields: (s: Settings, set: (k: keyof Settings, v: unknown) => void, disabled: boolean) => React.ReactNode }) {
  const { db, isOwner, toast } = useAdmin()
  const [state, reload] = useSettings()
  const [draft, setDraft] = useState<Settings | null>(null)
  if (state.status === 'missing') return <NeedsMigration title={title} />
  if (state.status !== 'ready') return state.status === 'error' ? <Notice kind="error">{state.message}</Notice> : <Spinner label="Loading…" />
  if (!state.data) return <NeedsMigration title={title} />
  const current = draft ?? (state.data as unknown as Settings)
  const set = (k: keyof Settings, v: unknown) => setDraft({ ...current, [k]: v })

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!draft) return
    // Only the columns owners may change; the rest (who and when) is set by the database.
    const editable = ['auto_ai_enabled', 'monthly_ai_budget_usd', 'monthly_video_budget_usd', 'max_ai_requests_per_day', 'max_video_minutes', 'max_upload_mb', 'max_clips_per_video', 'source_retention_days', 'render_retention_days', 'default_timezone', 'newsletter_from_name', 'newsletter_reply_to'] as const
    const { error } = await db.from('app_settings').update(Object.fromEntries(editable.map((k) => [k, draft[k]]))).eq('id', true)
    if (error) return toast(friendlyError(error), 'error')
    toast('Settings saved')
    setDraft(null)
    void reload()
  }

  return (
    <form onSubmit={save} className="space-y-5">
      {!isOwner && <Notice kind="info">Only owners change these settings.</Notice>}
      {fields(current, set, !isOwner)}
      {isOwner && (
        <button type="submit" disabled={!draft} className={buttonClass('primary', 'md')}>
          Save settings
        </button>
      )}
      <p className="text-xs text-muted">Last changed {when(current.updated_at)}. Changes are recorded in the activity log.</p>
    </form>
  )
}

function NumberField({ label, hint, value, onChange, disabled, min, max, step = 1 }: { label: string; hint?: string; value: number; onChange: (v: number) => void; disabled: boolean; min: number; max: number; step?: number }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {hint && <span className="block text-xs text-muted">{hint}</span>}
      <input type="number" disabled={disabled} min={min} max={max} step={step} className={`${inputClass} mt-1 min-h-11 max-w-48`} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

function Costs() {
  const { db, isOwner } = useAdmin()
  const [usage] = useLoad(async () => db.rpc('usage_this_month'), [db])
  const [recent] = useLoad(async () => (isOwner ? db.from('ai_usage').select('at, feature, model, input_tokens, output_tokens, audio_seconds, video_seconds, cost_usd').order('at', { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null })), [db, isOwner])
  const rows = usage.status === 'ready' ? (usage.data as { category: string; cost_usd: number; requests: number; budget_usd: number }[]) : []
  return (
    <div className="space-y-6">
      {usage.status === 'missing' ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => {
            const pct = Number(r.budget_usd) > 0 ? Math.min(100, (Number(r.cost_usd) / Number(r.budget_usd)) * 100) : 100
            return (
              <Card key={r.category} title={r.category === 'ai' ? 'AI this month' : 'Video processing this month'}>
                <p className="text-3xl font-semibold tabular-nums">
                  {money(Number(r.cost_usd))} <span className="text-base font-normal text-muted">of {money(Number(r.budget_usd))}</span>
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue/15" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the budget used">
                  <div className={`h-full ${pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-yellow' : 'bg-blue'}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted">{r.requests} requests. Estimated from list prices; your OpenAI and GitHub bills are the final word.</p>
              </Card>
            )
          })}
        </div>
      )}
      <Card title="Limits">
        <SettingsForm
          title="AI and costs"
          fields={(s, set, disabled) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField label="Monthly AI budget (US$)" hint="AI writing and transcription stop when it’s used up. 0 turns paid AI off." value={Number(s.monthly_ai_budget_usd)} onChange={(v) => set('monthly_ai_budget_usd', v)} disabled={disabled} min={0} max={10000} step={0.5} />
              <NumberField label="Monthly video processing budget (US$)" hint="Rendering stops when it’s used up." value={Number(s.monthly_video_budget_usd)} onChange={(v) => set('monthly_video_budget_usd', v)} disabled={disabled} min={0} max={10000} step={0.5} />
              <NumberField label="AI requests per person per day" value={s.max_ai_requests_per_day} onChange={(v) => set('max_ai_requests_per_day', v)} disabled={disabled} min={0} max={10000} />
              <NumberField label="Longest video to process (minutes)" value={s.max_video_minutes} onChange={(v) => set('max_video_minutes', v)} disabled={disabled} min={1} max={600} />
              <NumberField label="Largest upload (MB)" hint="Your Supabase plan also limits file sizes (50 MB on the Free plan)." value={s.max_upload_mb} onChange={(v) => set('max_upload_mb', v)} disabled={disabled} min={1} max={51200} />
              <NumberField label="Most clips per video" value={s.max_clips_per_video} onChange={(v) => set('max_clips_per_video', v)} disabled={disabled} min={1} max={30} />
            </div>
          )}
        />
      </Card>
      {isOwner && recent.status === 'ready' && (
        <Card title="Recent AI and video usage">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-xs text-muted uppercase">
                <tr>
                  <th className="py-1">When</th>
                  <th className="py-1">Feature</th>
                  <th className="py-1">Model</th>
                  <th className="py-1 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(recent.data as { at: string; feature: string; model: string; cost_usd: number }[]).map((r, i) => (
                  <tr key={i}>
                    <td className="py-1">{when(r.at)}</td>
                    <td className="py-1">{r.feature}</td>
                    <td className="py-1 text-muted">{r.model}</td>
                    <td className="py-1 text-right tabular-nums">${Number(r.cost_usd).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

function Automation() {
  return (
    <Card title="Automation and storage">
      <SettingsForm
        title="Automation and storage"
        fields={(s, set, disabled) => (
          <div className="space-y-5">
            <label className="flex items-start gap-3">
              <input type="checkbox" disabled={disabled} className="mt-1 size-5 accent-blue" checked={s.auto_ai_enabled} onChange={(e) => set('auto_ai_enabled', e.target.checked)} />
              <span>
                <span className="font-semibold">Let automations use AI</span>
                <span className="block text-sm text-muted">
                  When on, a new YouTube video gets AI caption drafts automatically and the Monday newsletter draft gets an AI introduction. Everything still waits for approval. When off, automations only notify you and assemble drafts
                  without AI. Video analysis always needs someone to confirm its cost.
                </span>
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField label="Delete original recordings after (days)" hint="0 keeps them. Clips attached to unpublished posts are kept." value={s.source_retention_days} onChange={(v) => set('source_retention_days', v)} disabled={disabled} min={0} max={3650} />
              <NumberField label="Delete rendered clips after (days)" hint="0 keeps them." value={s.render_retention_days} onChange={(v) => set('render_retention_days', v)} disabled={disabled} min={0} max={3650} />
              <label className="block">
                <span className={labelClass}>Default time zone</span>
                <select disabled={disabled} className={`${inputClass} mt-1 min-h-11`} value={s.default_timezone} onChange={(e) => set('default_timezone', e.target.value)}>
                  {TIME_ZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>Newsletter sender name</span>
                <input disabled={disabled} maxLength={100} className={`${inputClass} mt-1 min-h-11`} value={s.newsletter_from_name} onChange={(e) => set('newsletter_from_name', e.target.value)} />
              </label>
              <label className="block">
                <span className={labelClass}>Newsletter reply-to address</span>
                <input type="email" disabled={disabled} className={`${inputClass} mt-1 min-h-11`} value={s.newsletter_reply_to} onChange={(e) => set('newsletter_reply_to', e.target.value)} />
              </label>
            </div>
            <div className="rounded-lg bg-bone p-4 text-sm">
              <p className="font-semibold">What runs on its own</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                <li>Every 15 minutes: approved posts, articles and newsletters go out at their scheduled time (connected accounts only; others remind you to post by hand).</li>
                <li>Every hour: YouTube sync (new videos notify the team), news sources are checked, newsletter sign-ups are sent to Mailchimp for confirmation.</li>
                <li>Every day: analytics are saved, expiring connections are flagged, old files are cleaned up, and on Mondays a newsletter draft is prepared.</li>
                <li>When a story is approved: an interview project is created in Video Production. When an article is approved: a promotion task goes on the calendar.</li>
              </ul>
              <p className="mt-2 text-muted">The schedule needs CRON_SECRET set (Settings → Integrations → Scheduler).</p>
            </div>
          </div>
        )}
      />
    </Card>
  )
}
