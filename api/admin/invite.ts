/**
 * POST /api/admin/invite  { "email": "...", "role": "content_manager" | "owner", "canViewStories": boolean }
 * Header: Authorization: Bearer <the signed-in owner's access token>
 *
 * Emails an invitation to a new team member and gives their account the chosen role.
 * Only an owner may call it: the token is checked with Supabase and the caller's role is
 * read from the database, never from the request. Uses SUPABASE_URL and SUPABASE_SECRET_KEY
 * (see api/stories.ts).
 */
const ROLES = ['owner', 'editor', 'content_manager', 'viewer'] as const
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export async function POST(req: Request): Promise<Response> {
  const base = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
  const key = process.env.SUPABASE_SECRET_KEY ?? ''
  if (!base.startsWith('https://') || !key) return json({ error: 'not-configured' }, 503)

  const secret: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' }
  if (key.startsWith('eyJ')) secret.Authorization = `Bearer ${key}`
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { ...secret, ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(8000) })

  const token = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1]
  if (!token) return json({ error: 'signed-out' }, 401)

  const body: unknown = await req.json().catch(() => null)
  const { email, role, canViewStories } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (typeof email !== 'string' || !EMAIL.test(email.trim()) || email.length > 254 || !ROLES.includes(role as (typeof ROLES)[number])) {
    return json({ error: 'invalid' }, 400)
  }

  try {
    // Who is asking? Supabase checks the token; the role comes from the database.
    const me = await call('/auth/v1/user', { headers: { Authorization: `Bearer ${token}` } })
    if (!me.ok) return json({ error: 'signed-out' }, 401)
    const { id: callerId } = (await me.json()) as { id?: string }
    const profile = await call(`/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(callerId ?? '')}`)
    const [caller] = profile.ok ? ((await profile.json()) as { role: string | null }[]) : []
    if (caller?.role !== 'owner') return json({ error: 'forbidden' }, 403)

    const origin = new URL(req.url).origin
    const invite = await call(`/auth/v1/invite?redirect_to=${encodeURIComponent(`${origin}/admin/reset`)}`, {
      method: 'POST',
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    })
    if (invite.status === 422) return json({ error: 'already-registered' }, 409)
    if (!invite.ok) throw new Error(`Supabase ${invite.status} sending an invitation`)
    const { id: memberId } = (await invite.json()) as { id?: string }
    if (!memberId) throw new Error('Supabase returned no user for the invitation')

    const grant = await call(`/rest/v1/profiles?id=eq.${encodeURIComponent(memberId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ role, can_view_stories: role === 'owner' || (role !== 'viewer' && canViewStories === true) }),
    })
    if (!grant.ok) throw new Error(`Supabase ${grant.status} setting the new member's role`)
    await call('/rest/v1/audit_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ actor_id: callerId, action: 'member.invited', target: memberId, details: { role, can_view_stories: role === 'owner' || canViewStories === true } }),
    })
    return json({ ok: true })
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invitation failed')
    return json({ error: 'unavailable' }, 502)
  }
}
