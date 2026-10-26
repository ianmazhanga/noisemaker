import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowDown, ArrowUp, Check, Mail, Plus, Send, Sparkles, Trash2, X } from 'lucide-react'
import { buttonClass } from '../components/ui/buttonClass'
import { inputClass } from '../components/inbox/shared'
import { CAMPAIGN_STATUS, type CampaignStatus } from '../lib/newsroom'
import { BLOCK_LABEL, readBlocks, renderEmail, type Block, type BlockType } from '../lib/newsletter'
import { TIME_ZONES, zonedToUtc } from '../lib/social'
import { defaultZone } from './social/shared'
import { useAdmin, friendlyError } from './context'
import { Spinner } from './AdminApp'
import { Badge, Card, ConfirmButton, Drawer, Empty, NeedsMigration, Notice, PageHeader, Tabs } from './ui'
import { api, labelClass, STATUS_TONE, useLoad, when, downloadCsv } from './lib'
import { toCsv } from '../lib/newsroom'

interface Campaign {
  id: string
  subject: string
  preheader: string
  intro: string
  blocks: Block[]
  status: CampaignStatus
  scheduled_at: string | null
  timezone: string
  sent_at: string | null
  stats: { recipients?: number; opens?: number; open_rate?: number; clicks?: number; click_rate?: number; unsubscribes?: number }
  last_test_at: string | null
  ai_generated: boolean
  error_message: string
  approved_at: string | null
  rejection_reason: string
  updated_at: string
  created_at: string
}

interface Stat {
  status: string
  total: number
  last_30_days: number
}

export default function NewsletterPage() {
  const { db, isOwner, isWriter, session, toast } = useAdmin()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<'campaigns' | 'subscribers'>('campaigns')
  const [busy, setBusy] = useState(false)
  const [state, reload] = useLoad(async () => {
    const [c, s, g] = await Promise.all([
      db.from('newsletter_campaigns').select('*').order('updated_at', { ascending: false }).limit(200),
      db.rpc('newsletter_stats'),
      db.from('analytics_snapshots').select('captured_on, value').eq('source', 'newsletter').eq('metric', 'subscribers').order('captured_on').limit(400),
    ])
    return { data: { campaigns: (c.data ?? []) as Campaign[], stats: (s.data ?? []) as Stat[], growth: (g.data ?? []) as { captured_on: string; value: number }[] }, error: c.error ?? s.error }
  }, [db])
  if (state.status === 'missing') return <NeedsMigration title="Newsletter Manager" />
  const openId = params.get('open')
  const open = (id: string | null) => setParams((p) => (id ? p.set('open', id) : p.delete('open'), p))

  async function create(ai: boolean) {
    setBusy(true)
    try {
      let draft: { subject: string; preheader: string; intro: string; blocks: Block[] } = { subject: '', preheader: '', intro: '', blocks: [] }
      if (ai) draft = await api(session.access_token, '/api/ai/newsletter', {})
      const { data, error } = await db.from('newsletter_campaigns').insert({ ...draft, ai_generated: ai }).select('id').single()
      if (error) throw new Error(friendlyError(error))
      await reload()
      open((data as { id: string }).id)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const count = (s: string) => (state.status === 'ready' ? Number(state.data.stats.find((x) => x.status === s)?.total ?? 0) : 0)
  const recent = (s: string) => (state.status === 'ready' ? Number(state.data.stats.find((x) => x.status === s)?.last_30_days ?? 0) : 0)

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Newsletter Manager"
        intro="Newsletters are drafted from approved content, reviewed, approved by an owner, then sent with Mailchimp. Nothing is sent without approval."
        actions={
          isWriter && (
            <>
              <button type="button" disabled={busy} className={buttonClass('outline', 'sm')} onClick={() => void create(false)}>
                <Plus className="size-4" aria-hidden /> Blank newsletter
              </button>
              <button type="button" disabled={busy} className={buttonClass('primary', 'sm')} onClick={() => void create(true)}>
                <Sparkles className="size-4" aria-hidden /> {busy ? 'Writing…' : 'Draft from this week’s content'}
              </button>
            </>
          )
        }
      />
      {state.status === 'loading' && <Spinner label="Loading…" />}
      {state.status === 'error' && <div className="mt-6"><Notice kind="error">{state.message}</Notice></div>}
      {state.status === 'ready' && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Subscribers (confirmed)" value={count('subscribed')} note={`${recent('subscribed')} new in 30 days`} />
            <Stat label="Waiting to confirm" value={count('pending')} note="Sent a confirmation email once Mailchimp is connected" />
            <Stat label="Unsubscribed" value={count('unsubscribed')} note={`${recent('unsubscribed')} in 30 days`} />
            <Stat label="Newsletters sent" value={state.data.campaigns.filter((c) => c.status === 'sent').length} />
          </div>
          <div className="mt-6">
            <Tabs label="Newsletter" value={tab} onChange={setTab} tabs={{ campaigns: 'Newsletters', subscribers: 'Subscribers' }} />
          </div>
          <div className="mt-5">
            {tab === 'campaigns' ? (
              state.data.campaigns.length === 0 ? (
                <Empty title="No newsletters yet.">A draft is also prepared automatically every Monday from the week’s approved content.</Empty>
              ) : (
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
                  {state.data.campaigns.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => open(c.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-bone">
                        <Badge className={STATUS_TONE[c.status]}>{CAMPAIGN_STATUS[c.status]}</Badge>
                        {c.ai_generated && <Badge className="bg-blue/10 text-blue-ink">AI draft</Badge>}
                        <span className="min-w-0 flex-1 font-semibold">{c.subject || 'No subject yet'}</span>
                        <span className="text-sm text-muted">
                          {c.sent_at ? `Sent ${when(c.sent_at)}` : c.scheduled_at ? `Scheduled ${when(c.scheduled_at)}` : `Updated ${when(c.updated_at)}`}
                          {c.stats.open_rate !== undefined && ` · ${Math.round(c.stats.open_rate * 100)}% opened · ${Math.round((c.stats.click_rate ?? 0) * 100)}% clicked`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : isOwner ? (
              <Subscribers />
            ) : (
              <p className="text-muted">Only owners see subscribers’ email addresses. The totals above are for everyone.</p>
            )}
          </div>
          {openId && state.data.campaigns.find((c) => c.id === openId) && <Editor key={openId} campaign={state.data.campaigns.find((c) => c.id === openId)!} onClose={() => open(null)} onChanged={() => void reload()} />}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-[800] tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  )
}

function Subscribers() {
  const { db } = useAdmin()
  const [state] = useLoad(async () => db.from('newsletter_subscribers').select('id, email, status, consent_text, consented_at, source, confirmed_at, unsubscribed_at, created_at').order('created_at', { ascending: false }).limit(5000), [db])
  if (state.status !== 'ready') return state.status === 'error' ? <Notice kind="error">{state.message}</Notice> : <Spinner label="Loading…" />
  const rows = state.data as { id: string; email: string; status: string; consent_text: string; consented_at: string | null; source: string; confirmed_at: string | null; unsubscribed_at: string | null; created_at: string }[]
  if (!rows.length) return <Empty title="No subscribers yet.">People sign up on the website’s Newsletter page and in the footer.</Empty>
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Private: owners only. Never share this list. People are removed by unsubscribing; delete records on request under POPIA from Supabase.</p>
        <button type="button" className={buttonClass('outline', 'sm')} onClick={() => downloadCsv('subscribers.csv', toCsv([['Email', 'Status', 'Signed up', 'Confirmed', 'Consent'], ...rows.map((r) => [r.email, r.status, r.created_at, r.confirmed_at, r.consent_text])]))}>
          Export CSV
        </button>
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-paper">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="bg-bone text-xs text-muted uppercase">
            <tr>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Signed up</th>
              <th className="px-4 py-2">Confirmed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">{r.email}</td>
                <td className="px-4 py-2">{r.status}</td>
                <td className="px-4 py-2">{when(r.created_at)}</td>
                <td className="px-4 py-2">{when(r.confirmed_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Editor({ campaign, onClose, onChanged }: { campaign: Campaign; onClose: () => void; onChanged: () => void }) {
  const { db, session, isOwner, isWriter, toast } = useAdmin()
  const [c, setC] = useState(() => ({ ...campaign, blocks: readBlocks(campaign.blocks) }))
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  const [testTo, setTestTo] = useState(session.user.email ?? '')
  const [scheduleAt, setScheduleAt] = useState('')
  const [zone, setZone] = useState(() => defaultZone(TIME_ZONES))
  const [reason, setReason] = useState('')
  const sent = ['sending', 'sent'].includes(campaign.status)
  const locked = sent || !isWriter
  const setBlock = (i: number, patch: Partial<Block>) => setC((x) => ({ ...x, blocks: x.blocks.map((b, k) => (k === i ? { ...b, ...patch } : b)) }))
  const move = (i: number, d: number) => setC((x) => {
    const blocks = [...x.blocks]
    const [b] = blocks.splice(i, 1)
    blocks.splice(Math.max(0, Math.min(blocks.length, i + d)), 0, b)
    return { ...x, blocks }
  })

  async function save(quiet = false) {
    if (c.blocks.some((b) => b.url && !b.url.startsWith('https://'))) {
      toast('Links must start with https://', 'error')
      return false
    }
    setBusy(true)
    const { error } = await db.from('newsletter_campaigns').update({ subject: c.subject, preheader: c.preheader, intro: c.intro, blocks: c.blocks }).eq('id', campaign.id)
    setBusy(false)
    if (error) {
      toast(friendlyError(error), 'error')
      return false
    }
    if (!quiet) toast(['approved', 'scheduled'].includes(campaign.status) ? 'Saved. It needs approving again.' : 'Saved')
    onChanged()
    return true
  }

  async function rpc(name: string, args: Record<string, unknown>, done: string, saveFirst = false) {
    if (saveFirst && !(await save(true))) return
    setBusy(true)
    const { error } = await db.rpc(name, { campaign_id: campaign.id, ...args })
    setBusy(false)
    if (error) return toast(friendlyError(error), 'error')
    toast(done)
    onChanged()
  }

  async function server(path: string, body: Record<string, unknown>, done: string) {
    if (!sent && !(await save(true))) return
    setBusy(true)
    try {
      await api(session.access_token, path, { campaignId: campaign.id, ...body })
      toast(done)
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const html = renderEmail(c, { siteUrl: window.location.origin, unsubscribe: '#' })

  return (
    <Drawer title={campaign.subject || 'Newsletter'} onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge className={STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS[campaign.status]}</Badge>
        {campaign.approved_at && <span className="text-sm text-muted">Approved {when(campaign.approved_at)}</span>}
        {campaign.last_test_at && <span className="text-sm text-muted">Test sent {when(campaign.last_test_at)}</span>}
      </div>
      {campaign.error_message && <Notice kind="error">Sending failed: {campaign.error_message}</Notice>}
      {campaign.rejection_reason && campaign.status === 'rejected' && <Notice kind="error">Rejected: {campaign.rejection_reason}</Notice>}
      {c.blocks.some((b) => b.text?.includes('[check:')) && (
        <div className="mt-3">
          <Notice kind="warn">Some items are marked [check: …]. Confirm them (and remove the note) before approving.</Notice>
        </div>
      )}

      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="text-sm font-semibold text-blue-ink underline" onClick={() => setPreview(!preview)}>
              {preview ? 'Edit' : 'Preview the email'}
            </button>
          </div>
          {preview ? (
            <iframe title="Email preview" sandbox="" srcDoc={html} className="h-[70vh] w-full rounded-lg border border-line bg-white" />
          ) : (
            <fieldset disabled={locked} className="space-y-4">
              <label className="block">
                <span className={labelClass}>Subject line</span>
                <input maxLength={150} className={`${inputClass} mt-1 min-h-11`} value={c.subject} onChange={(e) => setC({ ...c, subject: e.target.value })} />
              </label>
              <label className="block">
                <span className={labelClass}>Preview text (shown after the subject in inboxes)</span>
                <input maxLength={200} className={`${inputClass} mt-1 min-h-11`} value={c.preheader} onChange={(e) => setC({ ...c, preheader: e.target.value })} />
              </label>
              <label className="block">
                <span className={labelClass}>Introduction</span>
                <textarea rows={4} maxLength={5000} className={`${inputClass} mt-1 py-2.5`} value={c.intro} onChange={(e) => setC({ ...c, intro: e.target.value })} />
              </label>
              <div>
                <p className={labelClass}>Sections</p>
                <ol className="mt-2 space-y-3">
                  {c.blocks.map((b, i) => (
                    <li key={i} className="rounded-lg border border-line bg-paper p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <select aria-label="Section type" className={`${inputClass} min-h-9 w-auto py-1 text-sm`} value={b.type} onChange={(e) => setBlock(i, { type: e.target.value as BlockType })}>
                          {Object.keys(BLOCK_LABEL).map((t) => <option key={t} value={t}>{BLOCK_LABEL[t as BlockType] || 'Text'}</option>)}
                        </select>
                        <span className="ml-auto flex gap-1">
                          <button type="button" className={buttonClass('outline', 'sm', '!px-2.5')} aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp className="size-4" aria-hidden /></button>
                          <button type="button" className={buttonClass('outline', 'sm', '!px-2.5')} aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown className="size-4" aria-hidden /></button>
                          <button type="button" className={buttonClass('outline', 'sm', '!px-2.5')} aria-label="Remove section" onClick={() => setC({ ...c, blocks: c.blocks.filter((_, k) => k !== i) })}><Trash2 className="size-4" aria-hidden /></button>
                        </span>
                      </div>
                      <input aria-label="Section title" placeholder="Title" className={`${inputClass} mt-2 min-h-10`} value={b.title} onChange={(e) => setBlock(i, { title: e.target.value })} />
                      <textarea aria-label="Section text" placeholder="Text" rows={3} className={`${inputClass} mt-2 py-2 text-sm`} value={b.text ?? ''} onChange={(e) => setBlock(i, { text: e.target.value })} />
                      <input aria-label="Section link" placeholder="Link (https://)" className={`${inputClass} mt-2 min-h-10 text-sm`} value={b.url ?? ''} onChange={(e) => setBlock(i, { url: e.target.value })} />
                    </li>
                  ))}
                </ol>
                <button type="button" className={buttonClass('outline', 'sm', 'mt-3')} onClick={() => setC({ ...c, blocks: [...c.blocks, { type: 'text', title: '', text: '', url: '' }] })}>
                  <Plus className="size-4" aria-hidden /> Add a section
                </button>
              </div>
            </fieldset>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Review and send">
            <div className="flex flex-col gap-2">
              {!locked && (
                <button type="button" disabled={busy} className={buttonClass('dark', 'md')} onClick={() => void save()}>
                  Save
                </button>
              )}
              {isWriter && ['draft', 'rejected', 'failed'].includes(campaign.status) && (
                <button type="button" disabled={busy} className={buttonClass('outline', 'md')} onClick={() => void rpc('submit_newsletter', {}, 'Sent for approval', true)}>
                  <Send className="size-4" aria-hidden /> Send for approval
                </button>
              )}
              {isOwner && ['draft', 'pending_approval', 'rejected', 'failed'].includes(campaign.status) && (
                <button type="button" disabled={busy} className={buttonClass('primary', 'md', '!border-[#1f7a4d] !bg-[#1f7a4d]')} onClick={() => void rpc('approve_newsletter', {}, 'Approved', true)}>
                  <Check className="size-4" aria-hidden /> Approve
                </button>
              )}
              {!sent && isWriter && (
                <div className="rounded-lg border border-line p-2">
                  <label className="block">
                    <span className={labelClass}>Send a test to</span>
                    <input type="email" disabled={!isOwner} className={`${inputClass} mt-1 min-h-10`} value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                  </label>
                  {!isOwner && <p className="mt-1 text-xs text-muted">Tests go to your own address.</p>}
                  <button type="button" disabled={busy} className={buttonClass('outline', 'sm', 'mt-2')} onClick={() => void server('/api/admin/newsletter-test', { emails: [testTo] }, `Test sent to ${testTo}`)}>
                    <Mail className="size-4" aria-hidden /> Send test email
                  </button>
                </div>
              )}
              {isOwner && ['approved', 'scheduled'].includes(campaign.status) && (
                <>
                  <ConfirmButton label="Send to all subscribers now" confirm="Send it now? This can’t be undone." onConfirm={() => void server('/api/admin/newsletter-send', {}, 'Sent')} />
                  <div className="rounded-lg border border-line p-2">
                    <span className={labelClass}>Or schedule</span>
                    <input type="datetime-local" aria-label="Send at" className={`${inputClass} mt-1 min-h-10`} value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
                    <select aria-label="Time zone" className={`${inputClass} mt-1 min-h-10`} value={zone} onChange={(e) => setZone(e.target.value)}>
                      {TIME_ZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
                    </select>
                    <button
                      type="button"
                      disabled={!scheduleAt || busy}
                      className={buttonClass('outline', 'sm', 'mt-2')}
                      onClick={() => {
                        try {
                          void rpc('schedule_newsletter', { at: zonedToUtc(scheduleAt, zone).toISOString(), tz: zone }, 'Scheduled')
                        } catch {
                          toast('Choose a date and time.', 'error')
                        }
                      }}
                    >
                      Schedule
                    </button>
                    {campaign.status === 'scheduled' && (
                      <p className="mt-2 text-sm text-muted">
                        Goes out {when(campaign.scheduled_at)}.{' '}
                        <button type="button" className="font-semibold text-blue-ink underline" onClick={() => void rpc('schedule_newsletter', { at: null, tz: null }, 'Unscheduled')}>
                          Unschedule
                        </button>
                      </p>
                    )}
                  </div>
                </>
              )}
              {isOwner && ['pending_approval', 'approved', 'scheduled'].includes(campaign.status) && (
                <div className="flex gap-2">
                  <input aria-label="Reason for rejecting" placeholder="Reason (optional)" className={`${inputClass} min-h-10 text-sm`} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button type="button" className={buttonClass('outline', 'sm')} onClick={() => void rpc('reject_newsletter', { reason }, 'Rejected')}>
                    <X className="size-4" aria-hidden /> Reject
                  </button>
                </div>
              )}
              {isOwner && !sent && <ConfirmButton label="Delete" danger confirm="Delete this newsletter?" onConfirm={() => void db.from('newsletter_campaigns').delete().eq('id', campaign.id).then(() => (onClose(), onChanged()))} />}
            </div>
          </Card>
          {campaign.status === 'sent' && (
            <Card title="Results">
              {campaign.stats.recipients !== undefined ? (
                <dl className="space-y-1 text-sm">
                  <div>Sent to {campaign.stats.recipients}</div>
                  <div>Opened by {campaign.stats.opens} ({Math.round((campaign.stats.open_rate ?? 0) * 100)}%)</div>
                  <div>Clicked by {campaign.stats.clicks} ({Math.round((campaign.stats.click_rate ?? 0) * 100)}%)</div>
                  <div>Unsubscribed: {campaign.stats.unsubscribes}</div>
                  <p className="text-xs text-muted">From Mailchimp’s report, updated daily.</p>
                </dl>
              ) : (
                <p className="text-sm text-muted">Mailchimp’s report appears here after the next daily update.</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </Drawer>
  )
}
