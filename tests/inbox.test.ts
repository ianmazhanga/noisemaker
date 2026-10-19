import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { isCallRequest, matchesSearch, passwordMatches, safeWebLink, toEntry, whatsappLink } from '../src/lib/inbox.ts'
import { createInboxHandler } from '../netlify/functions/inbox.ts'
import { createSubmissionHandler } from '../netlify/functions/submission-created.ts'
import type { InboxStore } from '../netlify/inboxStore.ts'
import type { InboxEntry } from '../src/lib/inbox.ts'

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

// The functions, against an in-memory fake of the database store.
afterEach(() => {
  delete process.env.INBOX_PASSWORD
})

const PASSWORD = 'a long inbox password'
const post = (body: unknown) => new Request('https://example.com/api/inbox', { method: 'POST', body: JSON.stringify(body) })

function fakeStore(): InboxStore & { rows: InboxEntry[] } {
  const rows: InboxEntry[] = []
  return {
    rows,
    async add(e) { if (!rows.some((r) => r.id === e.id)) rows.push(e) },
    async list() { return [...rows].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)) },
    async remove(id) { rows.splice(0, rows.length, ...rows.filter((r) => r.id !== id)) },
  }
}

test('the inbox refuses to run without a strong password', async () => {
  process.env.INBOX_PASSWORD = 'short'
  const res = await createInboxHandler(fakeStore())(post({ password: 'short' }))
  assert.equal(res.status, 503)
})

test('a wrong password gets nothing', async () => {
  process.env.INBOX_PASSWORD = PASSWORD
  const handler = createInboxHandler(fakeStore())
  assert.equal((await handler(post({ password: 'guess' }))).status, 401)
  assert.equal((await handler(new Request('https://example.com/api/inbox'))).status, 405)
})

test('submissions are saved without IP or browser, listed newest first, and can be deleted', async () => {
  process.env.INBOX_PASSWORD = PASSWORD
  const store = fakeStore()
  const save = createSubmissionHandler(store)
  const event = (id: string, createdAt: string, form = 'tell-your-story') =>
    new Request('https://example.com', { method: 'POST', body: JSON.stringify({ payload: { form_name: form, ...raw(id, createdAt, { full_name: id }) } }) })
  await save(event('old', '2026-10-01T09:00:00Z'))
  await save(event('new', '2026-10-19T09:00:00Z'))
  await save(event('other', '2026-10-19T10:00:00Z', 'newsletter'))
  assert.ok(!JSON.stringify(store.rows).includes('203.0.113.9'))

  const handler = createInboxHandler(store)
  const body = (await (await handler(post({ password: PASSWORD }))).json()) as { entries: InboxEntry[] }
  assert.deepEqual(body.entries.map((e: { id: string }) => e.id), ['new', 'old'])
  const after = (await (await handler(post({ password: PASSWORD, deleteId: "old" }))).json()) as { entries: InboxEntry[] }
  assert.deepEqual(after.entries.map((e: { id: string }) => e.id), ['new'])
})
