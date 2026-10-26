import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Copy, Plus, Save, Sparkles } from 'lucide-react'
import { buttonClass } from '../components/ui/buttonClass'
import { inputClass } from '../components/inbox/shared'
import { INTERVIEW_TOOL_KEYS, INTERVIEW_TOOLS, OWNER_PROJECT_STATUSES, PROJECT_STATUS, PROJECT_STATUSES, type InterviewTool, type ProjectStatus } from '../lib/newsroom'
import { TIME_ZONES, utcToZoned, zonedToUtc } from '../lib/social'
import { useAdmin, friendlyError } from './context'
import { Spinner } from './AdminApp'
import { Badge, Card, ConfirmButton, Drawer, Empty, NeedsMigration, Notice, PageHeader, Warnings } from './ui'
import { api, day, labelClass, STATUS_TONE, useLoad, when, memberName, type Member } from './lib'

export interface Project {
  id: string
  title: string
  summary: string
  status: ProjectStatus
  story_id: string | null
  guest_name: string
  guest_verified_info: string
  guest_links: string[]
  recording_at: string | null
  recording_timezone: string
  recording_location: string
  assigned_to: string | null
  youtube_id: string
  prep: Record<string, string>
  notes: string
  created_at: string
  updated_at: string
  approved_by: string | null
  approved_at: string | null
  published_at: string | null
}

export default function VideoPage() {
  const { db, isWriter } = useAdmin()
  const [params, setParams] = useSearchParams()
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [state, reload] = useLoad(async () => {
    const [p, m] = await Promise.all([db.from('video_projects').select('*').order('updated_at', { ascending: false }).limit(500), db.rpc('team_members')])
    return { data: { projects: (p.data ?? []) as Project[], members: (m.data ?? []) as Member[] }, error: p.error ?? m.error }
  }, [db])

  if (state.status === 'missing') return <NeedsMigration title="Video Production" />
  const openId = params.get('open')
  const close = () => setParams((p) => (p.delete('open'), p))

  return (
    <div className="max-w-[90rem]">
      <PageHeader
        title="Video Production"
        intro="Every video from the first idea to YouTube: interviews, preparation, scripts, recording, editing and approval. Only an owner marks a video ready to publish."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-blue" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
            </label>
            {isWriter && (
              <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden /> New project
              </button>
            )}
          </>
        }
      />
      {state.status === 'loading' && <Spinner label="Loading projects…" />}
      {state.status === 'error' && <div className="mt-6"><Notice kind="error">{state.message}</Notice></div>}
      {state.status === 'ready' && (
        <>
          {state.data.projects.length === 0 && (
            <div className="mt-6">
              <Empty title="No video projects yet.">Add an idea with New project. Approving a story in the Story Inbox also creates an interview project here.</Empty>
            </div>
          )}
          <Board projects={state.data.projects} members={state.data.members} showArchived={showArchived} onOpen={(id) => setParams((p) => (p.set('open', id), p))} />
          {openId && state.data.projects.find((p) => p.id === openId) && (
            <ProjectDrawer project={state.data.projects.find((p) => p.id === openId)!} members={state.data.members} onClose={close} onChanged={() => void reload()} />
          )}
        </>
      )}
      {creating && (
        <NewProject
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            void reload()
            setParams((p) => (p.set('open', id), p))
          }}
        />
      )}
    </div>
  )
}

function Board({ projects, members, showArchived, onOpen }: { projects: Project[]; members: Member[]; showArchived: boolean; onOpen: (id: string) => void }) {
  const columns = PROJECT_STATUSES.filter((s) => showArchived || s !== 'archived')
  return (
    <div className="mt-6 overflow-x-auto pb-4">
      <ol className="flex min-w-max gap-3" aria-label="Pipeline">
        {columns.map((status) => {
          const items = projects.filter((p) => p.status === status)
          return (
            <li key={status} className="w-64 shrink-0 rounded-xl bg-paper/60 p-2 ring-1 ring-line">
              <h2 className="flex items-center justify-between px-1.5 py-1 text-sm font-semibold">
                {PROJECT_STATUS[status]} <span className="tabular-nums text-muted">{items.length}</span>
              </h2>
              <ul className="mt-1 space-y-2">
                {items.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => onOpen(p.id)} className="block w-full rounded-lg border border-line bg-paper p-3 text-left hover:border-ink/40">
                      <span className="block font-semibold leading-snug">{p.title}</span>
                      {p.guest_name && <span className="mt-0.5 block text-sm text-muted">Guest: {p.guest_name}</span>}
                      {p.recording_at && <span className="mt-1 block text-xs font-semibold text-blue-ink">Recording {when(p.recording_at)}</span>}
                      <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
                        {p.assigned_to && <span>{memberName(members, p.assigned_to)}</span>}
                        <span>Updated {day(p.updated_at)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function NewProject({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { db, toast } = useAdmin()
  const [title, setTitle] = useState('')
  const [guest, setGuest] = useState('')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { data, error } = await db.from('video_projects').insert({ title: title.trim(), guest_name: guest.trim(), summary: summary.trim() }).select('id').single()
    setBusy(false)
    if (error) return toast(friendlyError(error), 'error')
    toast('Project added')
    onCreated((data as { id: string }).id)
  }
  return (
    <Drawer title="New video project" onClose={onClose}>
      <form onSubmit={create} className="space-y-4">
        <label className="block">
          <span className={labelClass}>Working title</span>
          <input required maxLength={200} className={`${inputClass} mt-1 min-h-11`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block">
          <span className={labelClass}>Guest (optional)</span>
          <input maxLength={200} className={`${inputClass} mt-1 min-h-11`} value={guest} onChange={(e) => setGuest(e.target.value)} />
        </label>
        <label className="block">
          <span className={labelClass}>What it’s about (optional)</span>
          <textarea rows={4} maxLength={5000} className={`${inputClass} mt-1 py-2.5`} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <button type="submit" disabled={busy || !title.trim()} className={buttonClass('primary', 'md')}>
          {busy ? 'Adding…' : 'Add project'}
        </button>
      </form>
    </Drawer>
  )
}

function ProjectDrawer({ project, members, onClose, onChanged }: { project: Project; members: Member[]; onClose: () => void; onChanged: () => void }) {
  const { db, isOwner, isWriter, canReadStories, toast } = useAdmin()
  const [draft, setDraft] = useState(() => ({
    ...project,
    links: project.guest_links.join('\n'),
    recordingLocal: project.recording_at ? utcToZoned(new Date(project.recording_at), project.recording_timezone) : '',
  }))
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const [files] = useLoad(async () => {
    const [assets, video] = await Promise.all([
      db.from('media_assets').select('id, filename, kind, status, duration_seconds, created_at').eq('project_id', project.id).neq('status', 'deleted').order('created_at', { ascending: false }),
      project.youtube_id ? db.from('youtube_videos').select('title, view_count, like_count, comment_count, published_at').eq('youtube_id', project.youtube_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ])
    return { data: { assets: (assets.data ?? []) as { id: string; filename: string; kind: string; status: string; duration_seconds: number | null; created_at: string }[], video: video.data as { title: string; view_count: number | null; like_count: number | null; comment_count: number | null } | null }, error: assets.error }
  }, [db, project.id, project.youtube_id])

  async function save(next: Partial<Project> = {}) {
    let recordingAt: string | null = null
    try {
      recordingAt = draft.recordingLocal ? zonedToUtc(draft.recordingLocal, draft.recording_timezone).toISOString() : null
    } catch {
      return toast('Check the recording date and time.', 'error')
    }
    if (draft.youtube_id && !/^[A-Za-z0-9_-]{11}$/.test(draft.youtube_id)) return toast('A YouTube video ID has 11 characters, e.g. dQw4w9WgXcQ.', 'error')
    setBusy(true)
    const { error } = await db
      .from('video_projects')
      .update({
        title: draft.title.trim(),
        summary: draft.summary,
        status: draft.status,
        guest_name: draft.guest_name,
        guest_verified_info: draft.guest_verified_info,
        guest_links: draft.links.split(/\s+/).filter((l) => /^https:\/\//.test(l)).slice(0, 10),
        recording_at: recordingAt,
        recording_timezone: draft.recording_timezone,
        recording_location: draft.recording_location,
        assigned_to: draft.assigned_to || null,
        youtube_id: draft.youtube_id.trim(),
        notes: draft.notes,
        prep: draft.prep,
        ...next,
      })
      .eq('id', project.id)
    setBusy(false)
    if (error) return toast(friendlyError(error), 'error')
    toast('Saved')
    onChanged()
  }

  async function remove() {
    const { error } = await db.from('video_projects').delete().eq('id', project.id)
    if (error) return toast(friendlyError(error), 'error')
    toast('Project deleted')
    onClose()
    onChanged()
  }

  const statusOptions = PROJECT_STATUSES.filter((s) => isOwner || !OWNER_PROJECT_STATUSES.includes(s) || s === project.status)

  return (
    <Drawer title={project.title} onClose={onClose} wide>
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Card title="Project">
            <fieldset disabled={!isWriter} className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className={labelClass}>Title</span>
                <input maxLength={200} className={`${inputClass} mt-1 min-h-11`} value={draft.title} onChange={(e) => set('title', e.target.value)} />
              </label>
              <label>
                <span className={labelClass}>Stage</span>
                <select className={`${inputClass} mt-1 min-h-11`} value={draft.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {PROJECT_STATUS[s]}
                      {OWNER_PROJECT_STATUSES.includes(s) ? ' (owner)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={labelClass}>Assigned to</span>
                <select className={`${inputClass} mt-1 min-h-11`} value={draft.assigned_to ?? ''} onChange={(e) => set('assigned_to', e.target.value || null)}>
                  <option value="">Nobody yet</option>
                  {members.filter((m) => m.role !== 'viewer').map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name || m.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className={labelClass}>Summary</span>
                <textarea rows={3} maxLength={5000} className={`${inputClass} mt-1 py-2.5`} value={draft.summary} onChange={(e) => set('summary', e.target.value)} />
              </label>
            </fieldset>
            <p className="mt-3 text-xs text-muted">
              Created {when(project.created_at)} · Last updated {when(project.updated_at)}
              {project.approved_at && ` · Approved ${when(project.approved_at)} by ${memberName(members, project.approved_by) || 'an owner'}`}
            </p>
            {project.story_id && canReadStories && (
              <Link to={`/admin/stories?open=${project.story_id}`} className="mt-2 inline-block text-sm font-semibold text-blue-ink underline underline-offset-4">
                Open the original story (contact details and consent)
              </Link>
            )}
          </Card>

          <Card title="Guest">
            <fieldset disabled={!isWriter} className="space-y-4">
              <label className="block">
                <span className={labelClass}>Name</span>
                <input maxLength={200} className={`${inputClass} mt-1 min-h-11`} value={draft.guest_name} onChange={(e) => set('guest_name', e.target.value)} />
              </label>
              <label className="block">
                <span className={labelClass}>Verified information</span>
                <span className="block text-sm text-muted">Only facts you’ve checked (with the guest or a reliable source). The AI assistant uses nothing else about the guest.</span>
                <textarea rows={5} maxLength={10000} className={`${inputClass} mt-1 py-2.5`} value={draft.guest_verified_info} onChange={(e) => set('guest_verified_info', e.target.value)} />
              </label>
              <label className="block">
                <span className={labelClass}>Public links (one per line, https://)</span>
                <textarea rows={2} className={`${inputClass} mt-1 py-2.5`} value={draft.links} onChange={(e) => set('links', e.target.value)} />
              </label>
            </fieldset>
          </Card>

          <Card title="Recording">
            <fieldset disabled={!isWriter} className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className={labelClass}>Date and time</span>
                <input type="datetime-local" className={`${inputClass} mt-1 min-h-11`} value={draft.recordingLocal} onChange={(e) => set('recordingLocal', e.target.value)} />
              </label>
              <label>
                <span className={labelClass}>Time zone</span>
                <select className={`${inputClass} mt-1 min-h-11`} value={draft.recording_timezone} onChange={(e) => set('recording_timezone', e.target.value)}>
                  {TIME_ZONES.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className={labelClass}>Where (studio, address or video-call link)</span>
                <input maxLength={300} className={`${inputClass} mt-1 min-h-11`} value={draft.recording_location} onChange={(e) => set('recording_location', e.target.value)} />
              </label>
              <label>
                <span className={labelClass}>YouTube video ID (once published)</span>
                <input maxLength={11} className={`${inputClass} mt-1 min-h-11 font-mono`} value={draft.youtube_id} onChange={(e) => set('youtube_id', e.target.value)} />
              </label>
            </fieldset>
            {project.recording_at && <p className="mt-2 text-sm text-muted">Shown on the Content Calendar.</p>}
          </Card>

          <Card title="Notes">
            <textarea rows={6} disabled={!isWriter} maxLength={20000} className={`${inputClass} py-2.5`} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
          </Card>

          {isWriter && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy || !draft.title.trim()} className={buttonClass('primary', 'md')} onClick={() => void save()}>
                <Save className="size-4" aria-hidden /> {busy ? 'Saving…' : 'Save'}
              </button>
              {project.status !== 'awaiting_approval' && !['ready', 'published'].includes(project.status) && (
                <button type="button" disabled={busy} className={buttonClass('outline', 'md')} onClick={() => void save({ status: 'awaiting_approval' })}>
                  Send for approval
                </button>
              )}
              {isOwner && project.status === 'awaiting_approval' && (
                <button type="button" disabled={busy} className={buttonClass('primary', 'md', '!border-[#1f7a4d] !bg-[#1f7a4d]')} onClick={() => void save({ status: 'ready' })}>
                  Approve: ready to publish
                </button>
              )}
              {isOwner && <ConfirmButton label="Delete" confirm="Delete this project?" danger onConfirm={() => void remove()} className="ml-auto" />}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <Assistant project={project} prep={draft.prep} onSave={(tool, text) => set('prep', { ...draft.prep, [tool]: text })} />
          <Card title="Recordings and clips">
            {files.status !== 'ready' ? (
              <Spinner label="Loading…" />
            ) : files.data.assets.length === 0 ? (
              <p className="text-sm text-muted">No recordings uploaded for this project yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {files.data.assets.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span className="truncate">{a.filename}</span>
                    <Badge className={STATUS_TONE[a.status === 'ready' ? 'approved' : 'draft']}>{a.kind.replace('_', ' ')}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <Link to={`/admin/shorts?project=${project.id}`} className={buttonClass('outline', 'sm', 'mt-3')}>
              Upload a recording or make Shorts
            </Link>
          </Card>
          {files.status === 'ready' && files.data.video && (
            <Card title="Video performance">
              <p className="text-sm text-muted">From YouTube, at the last sync.</p>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                {(['view_count', 'like_count', 'comment_count'] as const).map((k) => (
                  <div key={k} className="rounded-lg bg-bone p-2">
                    <dt className="text-xs text-muted">{k.replace('_count', 's')}</dt>
                    <dd className="font-display text-xl font-[800]">{files.data.video![k]?.toLocaleString() ?? 'n/a'}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>
      </div>
    </Drawer>
  )
}

interface AssistantResult {
  tool: InterviewTool
  label: string
  items: string[]
  text: string
  uncertain: string[]
  warnings: string[]
}

/** AI Interview Assistant: writes from the project's own notes and verified guest information only. */
function Assistant({ project, prep, onSave }: { project: Project; prep: Record<string, string>; onSave: (tool: InterviewTool, text: string) => void }) {
  const { session, isWriter, toast } = useAdmin()
  const [busy, setBusy] = useState<InterviewTool | null>(null)
  const [result, setResult] = useState<AssistantResult | null>(null)
  const saved = useMemo(() => INTERVIEW_TOOL_KEYS.filter((k) => prep[k]), [prep])

  async function ask(tool: InterviewTool) {
    setBusy(tool)
    try {
      setResult(await api<AssistantResult>(session.access_token, '/api/ai/interview', { projectId: project.id, tool }))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }
  const output = result ? (result.items.length ? result.items.map((i) => (result.tool === 'hashtags' ? `#${i}` : `• ${i}`)).join('\n') : result.text) : ''

  return (
    <Card title={<span className="inline-flex items-center gap-2"><Sparkles className="size-4" aria-hidden /> AI Interview Assistant</span>}>
      <p className="text-sm text-muted">Works only from this project’s summary, notes and verified guest information (and the guest’s own story, if you can see it). Save the project first if you’ve changed those.</p>
      {isWriter ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {INTERVIEW_TOOL_KEYS.map((k) => (
            <button key={k} type="button" disabled={busy !== null} className={buttonClass(prep[k] ? 'dark' : 'outline', 'sm', '!min-h-9 !px-3 !text-xs')} onClick={() => void ask(k)}>
              {busy === k ? 'Writing…' : INTERVIEW_TOOLS[k]}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">Viewers can read saved preparation but not use the AI.</p>
      )}
      {result && (
        <div className="mt-4 rounded-lg bg-bone p-3">
          <p className="text-sm font-semibold">{result.label}</p>
          <pre className="mt-2 font-sans text-sm whitespace-pre-wrap">{output}</pre>
          {result.uncertain.length > 0 && (
            <div className="mt-2 text-sm">
              <p className="font-semibold">To confirm before using:</p>
              <ul className="list-disc pl-5">{result.uncertain.map((u) => <li key={u}>{u}</li>)}</ul>
            </div>
          )}
          <Warnings items={result.warnings} />
          <div className="mt-3 flex gap-2">
            <button type="button" className={buttonClass('dark', 'sm')} onClick={() => (onSave(result.tool, output), toast('Added to the project. Press Save to keep it.'))}>
              Keep in project
            </button>
            <button type="button" className={buttonClass('outline', 'sm')} onClick={() => void navigator.clipboard.writeText(output).then(() => toast('Copied'))}>
              <Copy className="size-4" aria-hidden /> Copy
            </button>
          </div>
        </div>
      )}
      {saved.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold">Saved preparation ({saved.length})</summary>
          {saved.map((k) => (
            <div key={k} className="mt-3">
              <p className="text-xs font-semibold text-muted uppercase">{INTERVIEW_TOOLS[k]}</p>
              <pre className="mt-1 font-sans text-sm whitespace-pre-wrap">{prep[k]}</pre>
            </div>
          ))}
        </details>
      )}
    </Card>
  )
}

