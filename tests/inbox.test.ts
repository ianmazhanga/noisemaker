import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { isCallRequest, matchesSearch, passwordMatches, safeWebLink, toEntry, whatsappLink } from '../src/lib/inbox.ts'
import handler from '../netlify/functions/inbox.ts'

const raw = (id: string, createdAt: string, data: Record<string, string>) => ({
  id,
  created_at: createdAt,
  data: { ip: '203.0.113.9', user_agent: 'Mozilla/5.0', referrer: 'https://example.com', ...data },
})

test('entries keep only the form fields, never IP address or browser', () => {
  const entry = toEntry(raw('a1', '2026-10-20T10:00:00Z', { full_name: 'Tendai Moyo', email: 't@example.com', reference: 'NM-261020-ABCD' }))
  assert.ok(entry)
  assert.equal(entry.fields.full_name, 'Tendai Moyo')
  assert.equal(entry.fields.story_summary, '')
  assert.ok(!JSON.stringify(entry).includes('203.0.113.9'))
  assert.ok(!JSON.stringify(entry).includes('Mozilla'))
  assert.equal(toEntry(null), null)
  assert.equal(toEntry({ id: 1 }), null)
})

test('password check', async () => {
  assert.equal(await passwordMatches('correct horse battery', 'correct horse battery'), true)
  assert.equal(await passwordMatches('correct horse batterz', 'correct horse battery'), false)
  assert.equal(await passwordMatches('', 'correct horse battery'), false)
  assert.equal(await passwordMatches(undefined, 'correct horse battery'), false)
})

test('search, call-request filter and safe links', () => {
  const entry = toEntry(raw('a1', '2026-10-20T10:00:00Z', { full_name: 'Tendai Moyo', request_type: 'Request an introductory call (pending: not booked until the team confirms)' }))!
  assert.equal(isCallRequest(entry), true)
  assert.equal(matchesSearch(entry, 'tendai'), true)
  assert.equal(matchesSearch(entry, 'nobody'), false)
  assert.equal(whatsappLink('+263771234567'), 'https://wa.me/263771234567')
  assert.equal(whatsappLink('077 123'), null)
  assert.equal(safeWebLink('javascript:alert(1)'), null)
  assert.equal(safeWebLink('https://instagram.com/x'), 'https://instagram.com/x')
})

// The function, against a fake Netlify API.
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.INBOX_PASSWORD
  delete process.env.NETLIFY_API_TOKEN
})

const PASSWORD = 'a long inbox password'
const context = { site: { id: 'site-123' } }
const post = (body: unknown) => new Request('https://example.com/api/inbox', { method: 'POST', body: JSON.stringify(body) })

function fakeNetlify(seen: string[]) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(String(url))
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer secret-token')
    if (String(url).endsWith('/sites/site-123/forms')) return Response.json([{ id: 'other', name: 'newsletter' }, { id: 'form-1', name: 'tell-your-story' }])
    if (String(url).includes('/forms/form-1/submissions')) {
      return Response.json([raw('old', '2026-10-01T09:00:00Z', { full_name: 'Older' }), raw('new', '2026-10-19T09:00:00Z', { full_name: 'Newer' })])
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

test('the function refuses to run without a strong password and a token', async () => {
  process.env.INBOX_PASSWORD = 'short'
  process.env.NETLIFY_API_TOKEN = 'secret-token'
  const res = await handler(post({ password: 'short' }), context)
  assert.equal(res.status, 503)
})

test('a wrong password gets nothing and never reaches Netlify', async () => {
  process.env.INBOX_PASSWORD = PASSWORD
  process.env.NETLIFY_API_TOKEN = 'secret-token'
  const seen: string[] = []
  fakeNetlify(seen)
  const res = await handler(post({ password: 'guess' }), context)
  assert.equal(res.status, 401)
  assert.deepEqual(seen, [])
  assert.equal((await handler(new Request('https://example.com/api/inbox'), context)).status, 405)
})

test('the right password returns the story submissions, newest first, without the token', async () => {
  process.env.INBOX_PASSWORD = PASSWORD
  process.env.NETLIFY_API_TOKEN = 'secret-token'
  const seen: string[] = []
  fakeNetlify(seen)
  const res = await handler(post({ password: PASSWORD }), context)
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.ok(!text.includes('secret-token'))
  const body = JSON.parse(text)
  assert.equal(body.formFound, true)
  assert.deepEqual(body.entries.map((e: { id: string }) => e.id), ['new', 'old'])
  assert.ok(seen.every((u) => u.startsWith('https://api.netlify.com/api/v1/')))
})
