/**
 * Shared by the server functions in api/: JSON responses, the Supabase REST API with the
 * secret key, checking who's calling, notifications, audit entries and integration status.
 * (Vercel doesn't turn files in folders starting with "_" into functions.)
 *
 * Environment variables: SUPABASE_URL and SUPABASE_SECRET_KEY (see api/stories.ts).
 */

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })

/** An error with an HTTP status and a short code the dashboard turns into a message. */
export class HttpError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, details?: unknown) {
    super(code)
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Turns errors into JSON answers. Unexpected errors are logged by message only (never request bodies). */
export function failure(error: unknown, label: string): Response {
  if (error instanceof HttpError) return json({ error: error.code, ...(error.details ? { details: error.details } : {}) }, error.status)
  console.error(`${label}: ${error instanceof Error ? error.message : 'failed'}`)
  return json({ error: 'unavailable' }, 502)
}

/** Reads a JSON object body of at most `max` bytes. */
export async function readBody(req: Request, max = 64_000): Promise<Record<string, unknown>> {
  const text = await req.text().catch(() => '')
  if (text.length > max) throw new HttpError(413, 'too-large')
  if (!text) return {}
  try {
    const body: unknown = JSON.parse(text)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'invalid')
  }
}

/** The last part of the path: /api/admin/upload-url → "upload-url". */
export const routeName = (req: Request) => new URL(req.url).pathname.replace(/\/+$/, '').split('/').pop() ?? ''

export function supabaseConfig() {
  const url = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
  const key = process.env.SUPABASE_SECRET_KEY ?? ''
  if (!url.startsWith('https://') || !key) throw new HttpError(503, 'not-configured')
  return { url, key }
}

export const secretHeaders = (key: string): Record<string, string> => {
  const headers: Record<string, string> = { apikey: key }
  // Legacy service_role keys are JWTs and also go in Authorization.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`
  return headers
}

/** Calls Supabase with the secret key, which skips Row Level Security. Throws on HTTP errors. */
export async function sb<T = unknown>(path: string, init: RequestInit & { allow?: number[] } = {}): Promise<T> {
  const { url, key } = supabaseConfig()
  const { allow, ...rest } = init
  const res = await fetch(`${url}${path}`, {
    ...rest,
    headers: { ...secretHeaders(key), ...(rest.body && typeof rest.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers as Record<string, string>) },
    signal: rest.signal ?? AbortSignal.timeout(10_000),
  })
  if (!res.ok && !allow?.includes(res.status)) {
    const detail = await res.text().catch(() => '')
    // Database messages raised by our own checks (e.g. "must be approved") are safe and useful to pass on.
    const message = /"message":"([^"]{1,200})"/.exec(detail)?.[1] ?? ''
    throw Object.assign(new Error(`Supabase ${res.status} on ${path.split('?')[0]}${message ? `: ${message}` : ''}`), { status: res.status, dbMessage: message })
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return null as T
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

/** Table rows through PostgREST. */
export const rest = <T = unknown>(path: string, init: RequestInit & { allow?: number[] } = {}) => sb<T>(`/rest/v1/${path}`, init)

/** A database function. */
export const rpc = <T = unknown>(name: string, args: Record<string, unknown> = {}) => sb<T>(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) })

export interface Caller {
  id: string
  email: string
  role: 'owner' | 'editor' | 'content_manager' | 'viewer'
  canViewStories: boolean
  token: string
}

/**
 * Who is calling: the signed-in person's token is checked with Supabase and their role
 * read from the database, never from the request. `need` limits who may call.
 */
export async function caller(req: Request, need: 'staff' | 'writer' | 'owner' = 'staff'): Promise<Caller> {
  const token = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1]
  if (!token) throw new HttpError(401, 'signed-out')
  const { url, key } = supabaseConfig()
  const me = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) })
  if (!me.ok) throw new HttpError(401, 'signed-out')
  const { id, email } = (await me.json()) as { id?: string; email?: string }
  if (!id) throw new HttpError(401, 'signed-out')
  const [profile] = await rest<{ role: Caller['role'] | null; can_view_stories: boolean }[]>(`profiles?select=role,can_view_stories&id=eq.${encodeURIComponent(id)}`)
  const role = profile?.role
  if (!role) throw new HttpError(403, 'forbidden')
  if (need === 'owner' && role !== 'owner') throw new HttpError(403, 'forbidden')
  if (need === 'writer' && role === 'viewer') throw new HttpError(403, 'forbidden')
  return { id, email: email ?? '', role, canViewStories: role === 'owner' || Boolean(profile.can_view_stories), token }
}

/** Adds a notification once per dedupe key. Never throws: a failed notification mustn't break the work it reports. */
export async function notify(kind: string, title: string, link: string, audience: 'owner' | 'stories' | 'staff', dedupeKey?: string) {
  try {
    await rpc('notify', { kind, title, link, audience, dedupe_key: dedupeKey ?? null })
  } catch (error) {
    console.error(`notify: ${error instanceof Error ? error.message : 'failed'}`)
  }
}

export async function audit(actorId: string | null, action: string, target: string, details: Record<string, unknown> = {}) {
  try {
    await rest('audit_logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ actor_id: actorId, action, target, details }) })
  } catch (error) {
    console.error(`audit: ${error instanceof Error ? error.message : 'failed'}`)
  }
}

/** Records that an integration worked (or why it didn't), for Settings → Integrations. Never throws. */
export async function integration(key: string, outcome: { ok: true; sync?: boolean; details?: Record<string, unknown> } | { ok: false; error: string }) {
  const now = new Date().toISOString()
  const row: Record<string, unknown> = { key, updated_at: now }
  if (outcome.ok) {
    row.last_success_at = now
    row.last_error = ''
    if (outcome.sync) row.last_sync_at = now
    if (outcome.details) row.details = outcome.details
  } else {
    row.last_error = outcome.error.slice(0, 500)
    row.last_error_at = now
  }
  try {
    await rest('integration_status?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) })
  } catch (error) {
    console.error(`integration status: ${error instanceof Error ? error.message : 'failed'}`)
  }
}

export interface Settings {
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
  news_topics: string[]
  news_countries: string[]
}

export async function settings(): Promise<Settings> {
  const [row] = await rest<Record<string, unknown>[]>('app_settings?select=*&limit=1')
  if (!row) throw new HttpError(503, 'database-update-needed')
  const n = (k: string) => Number(row[k])
  return {
    ...(row as unknown as Settings),
    monthly_ai_budget_usd: n('monthly_ai_budget_usd'),
    monthly_video_budget_usd: n('monthly_video_budget_usd'),
  }
}

/** The site's public address, for links in emails and OAuth redirects. */
export const siteUrl = (req?: Request) => (process.env.SITE_URL ?? '').replace(/\/+$/, '') || (req ? new URL(req.url).origin : 'https://noisemakersnews.com')

/** Is this a "table doesn't exist yet" error, i.e. the newsroom migration hasn't been run? */
export const isMissingTable = (error: unknown) => /Supabase 404|PGRST205|42P01|does not exist/i.test(error instanceof Error ? error.message : '')
