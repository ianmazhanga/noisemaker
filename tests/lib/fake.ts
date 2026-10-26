/**
 * Mocked outside services for API tests: replaces fetch with a router of fake responses
 * and records every call. Nothing here talks to a real service.
 */
export interface Call {
  url: string
  method: string
  body: unknown
  headers: Headers
}

export type Route = (url: URL, call: Call) => Response | Promise<Response> | undefined

const realFetch = globalThis.fetch

export function fakeFetch(routes: Route[]): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    let body: unknown = init.body
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    } else if (init.body instanceof URLSearchParams) body = Object.fromEntries(init.body)
    const call = { url: url.toString(), method: (init.method ?? 'GET').toUpperCase(), body, headers: new Headers(init.headers) }
    calls.push(call)
    for (const route of routes) {
      const res = await route(url, call)
      if (res) return res
    }
    throw new Error(`Unexpected request: ${call.method} ${url}`)
  }) as typeof fetch
  return calls
}

export function restoreFetch() {
  globalThis.fetch = realFetch
}

/** Supabase with the secret key, plus sign-in tokens: 'owner-token', 'editor-token', 'viewer-token'. */
export function supabaseEnv() {
  process.env.SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test'
}

export const USERS: Record<string, { id: string; email: string; role: string }> = {
  'owner-token': { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.com', role: 'owner' },
  'editor-token': { id: '00000000-0000-4000-8000-000000000002', email: 'editor@example.com', role: 'editor' },
  'viewer-token': { id: '00000000-0000-4000-8000-000000000003', email: 'viewer@example.com', role: 'viewer' },
}

/** Answers Supabase's sign-in check and profile lookup for the USERS above. */
export const authRoutes: Route = (url, call) => {
  if (url.pathname === '/auth/v1/user') {
    const token = call.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const user = USERS[token]
    return user ? Response.json({ id: user.id, email: user.email }) : new Response(null, { status: 401 })
  }
  if (url.pathname === '/rest/v1/profiles') {
    const id = url.searchParams.get('id')?.replace('eq.', '')
    const user = Object.values(USERS).find((u) => u.id === id)
    return Response.json(user ? [{ role: user.role, can_view_stories: user.role === 'owner' }] : [])
  }
}

export const SETTINGS = {
  id: true,
  auto_ai_enabled: false,
  monthly_ai_budget_usd: '20.00',
  monthly_video_budget_usd: '20.00',
  max_ai_requests_per_day: 200,
  max_video_minutes: 120,
  max_upload_mb: 2048,
  max_clips_per_video: 8,
  source_retention_days: 0,
  render_retention_days: 0,
  default_timezone: 'Africa/Johannesburg',
  newsletter_from_name: 'Noisemakers News',
  newsletter_reply_to: '',
  news_topics: [] as string[],
  news_countries: ['ZA', 'US'],
}

export const settingsRoute =
  (overrides: Partial<typeof SETTINGS> = {}): Route =>
  (url) =>
    url.pathname === '/rest/v1/app_settings' ? Response.json([{ ...SETTINGS, ...overrides }]) : undefined

export const request = (path: string, body: unknown = {}, token?: string, method = 'POST') =>
  new Request(`https://example.com${path}`, { method, body: method === 'GET' ? undefined : JSON.stringify(body), headers: token ? { Authorization: `Bearer ${token}` } : {} })
