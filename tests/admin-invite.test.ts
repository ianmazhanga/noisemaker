import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import handler from '../netlify/functions/admin-invite.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SECRET_KEY
})

const post = (body: unknown, token?: string) =>
  new Request('https://noisemakersnews.com/api/admin/invite', { method: 'POST', body: JSON.stringify(body), headers: token ? { Authorization: `Bearer ${token}` } : {} })

/** Fake Supabase: `owner-token` belongs to an owner, `manager-token` to a content manager. */
function fakeSupabase(calls: { url: string; init?: RequestInit }[]) {
  process.env.SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test'
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const auth = new Headers(init?.headers).get('Authorization')
    if (url.endsWith('/auth/v1/user')) {
      if (auth === 'Bearer owner-token') return Response.json({ id: 'owner-id' })
      if (auth === 'Bearer manager-token') return Response.json({ id: 'manager-id' })
      return new Response(null, { status: 401 })
    }
    if (url.includes('/rest/v1/profiles?select=role')) return Response.json([{ role: url.includes('owner-id') ? 'owner' : 'content_manager' }])
    if (url.includes('/auth/v1/invite')) return Response.json({ id: 'new-member-id' })
    return new Response(null, { status: 204 })
  }) as typeof fetch
}

const invite = { email: 'Sam@Example.com', role: 'content_manager', canViewStories: true }

test('needs a signed-in owner', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  fakeSupabase(calls)
  assert.equal((await handler(post(invite))).status, 401)
  assert.equal((await handler(post(invite, 'forged-token'))).status, 401)
  assert.equal((await handler(post(invite, 'manager-token'))).status, 403)
  assert.ok(!calls.some((c) => c.url.includes('/invite')), 'no invitation is sent for non-owners')
})

test('rejects bad input before contacting Supabase', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  fakeSupabase(calls)
  assert.equal((await handler(post({ ...invite, email: 'not an email' }, 'owner-token'))).status, 400)
  assert.equal((await handler(post({ ...invite, role: 'superuser' }, 'owner-token'))).status, 400)
  assert.equal(calls.length, 0)
})

test('an owner invites someone and their role is set by the server', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  fakeSupabase(calls)
  const res = await handler(post(invite, 'owner-token'))
  assert.equal(res.status, 200)
  const sent = calls.find((c) => c.url.includes('/auth/v1/invite'))!
  assert.equal(JSON.parse(String(sent.init!.body)).email, 'sam@example.com')
  assert.ok(sent.url.includes(encodeURIComponent('https://noisemakersnews.com/admin/reset')))
  const grant = calls.find((c) => c.init?.method === 'PATCH')!
  assert.ok(grant.url.endsWith('profiles?id=eq.new-member-id'))
  assert.deepEqual(JSON.parse(String(grant.init!.body)), { role: 'content_manager', can_view_stories: true })
})

test('does nothing until Supabase is configured', async () => {
  assert.equal((await handler(post(invite, 'owner-token'))).status, 503)
})
