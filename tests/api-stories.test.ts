import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_FORM, parseStoryForm, type StoryForm } from '../src/lib/storyForm.ts'
import { POST as handler } from '../api/stories.ts'

const valid: StoryForm = {
  ...EMPTY_FORM,
  fullName: 'Tendai Moyo',
  email: 'tendai@example.com',
  contactMethod: 'whatsapp',
  phoneCountry: 'Zimbabwe|+263',
  phone: '077 123 4567',
  storyTitle: 'Raising our children far from home',
  storySummary: 'We moved abroad with two young children and had to learn how to parent without family nearby.',
  whyShare: 'So other families know they are not alone.',
  topics: ['Family & parenting', 'Life in the diaspora'],
  interviewFormat: 'remote',
  consentPrivacy: true,
  consentContact: true,
  consentAge: true,
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SECRET_KEY
})

const post = (body: unknown) => new Request('https://example.com/api/stories', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

/** A fake Supabase REST API that records requests. `existing` is returned by the repeat check. */
function fakeSupabase(calls: { url: string; init?: RequestInit }[], existing: unknown[] = [], insertStatus = 201, recentCount = 0) {
  process.env.SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test'
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    assert.equal(new Headers(init?.headers).get('apikey'), 'sb_secret_test')
    if (init?.method === 'POST') return new Response(null, { status: insertStatus })
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-range': `*/${recentCount}` } })
    return Response.json(existing)
  }) as typeof fetch
}

test('untrusted JSON is rebuilt field by field', () => {
  const form = parseStoryForm({ ...valid, contactMethod: 'carrier pigeon', topics: ['Faith', 'Faith', 'Not a topic', 3], consentAge: 'yes', extra: 'dropped' })!
  assert.equal(form.contactMethod, '')
  assert.deepEqual(form.topics, ['Faith'])
  assert.equal(form.consentAge, false)
  assert.ok(!('extra' in form))
  assert.equal(parseStoryForm('nope'), null)
  assert.equal(parseStoryForm([1]), null)
})

test('does nothing until Supabase is configured', async () => {
  const res = await handler(post({ form: valid, reference: 'NM-261026-K3QX' }))
  assert.equal(res.status, 503)
})

test('saves a valid submission with the form fields and a fingerprint', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  fakeSupabase(calls)
  const res = await handler(post({ form: valid, reference: 'NM-261026-K3QX', honeypot: '' }))
  assert.equal(res.status, 200)
  const insert = calls.find((c) => c.init?.method === 'POST')!
  assert.equal(insert.url, 'https://project.supabase.co/rest/v1/story_submissions')
  const saved = JSON.parse(String(insert.init!.body))
  assert.equal(saved.reference, 'NM-261026-K3QX')
  assert.equal(saved.full_name, 'Tendai Moyo')
  assert.equal(saved.phone, '+263771234567')
  assert.equal(saved.preferred_contact, 'WhatsApp')
  assert.ok(saved.fingerprint)
  assert.ok(!('status' in saved), 'new submissions get the database default status')
})

test('rejects invalid submissions and saves nothing', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  fakeSupabase(calls)
  assert.equal((await handler(post({ form: { ...valid, consentAge: false }, reference: 'NM-261026-K3QX' }))).status, 400)
  assert.equal((await handler(post({ form: valid, reference: 'not-a-reference' }))).status, 400)
  assert.equal((await handler(post('{not json'))).status, 400)
  assert.equal((await handler(post({ form: { ...valid, storySummary: 'x'.repeat(40_000) }, reference: 'NM-261026-K3QX' }))).status, 400)
  assert.equal(calls.length, 0)
})

test('bots that fill the hidden field get a normal answer, but nothing is saved', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  fakeSupabase(calls)
  const res = await handler(post({ form: valid, reference: 'NM-261026-K3QX', honeypot: 'http://spam.example' }))
  assert.equal(res.status, 200)
  assert.equal(calls.length, 0)
})

test('the same story sent again within a day is not saved twice', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  fakeSupabase(calls, [{ reference: 'NM-261025-ABCD' }])
  const res = await handler(post({ form: valid, reference: 'NM-261026-K3QX' }))
  assert.deepEqual(await res.json(), { ok: true, duplicate: true, reference: 'NM-261025-ABCD' })
  assert.ok(!calls.some((c) => c.init?.method === 'POST'))
})

test('a Supabase failure is reported without logging personal details', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  fakeSupabase(calls, [], 500)
  const logged: unknown[] = []
  const realError = console.error
  console.error = (...args: unknown[]) => logged.push(...args)
  try {
    assert.equal((await handler(post({ form: valid, reference: 'NM-261026-K3QX' }))).status, 502)
  } finally {
    console.error = realError
  }
  assert.ok(!JSON.stringify(logged).includes('Tendai'))
  assert.ok(!JSON.stringify(logged).includes('tendai@example.com'))
})

test('a flood of submissions is turned away before anything is saved', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  fakeSupabase(calls, [], 201, 20)
  const res = await handler(post({ form: valid, reference: 'NM-261026-K3QX' }))
  assert.equal(res.status, 429)
  assert.ok(!calls.some((c) => c.init?.method === 'POST'))
})
