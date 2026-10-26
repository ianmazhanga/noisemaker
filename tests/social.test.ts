import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanHashtags, fullText, unsupportedQuotes, utcToZoned, zonedToUtc } from '../src/lib/social.ts'
import { POST as handler, sanitise } from '../api/ai/social-drafts.ts'

test('scheduling times are converted from the chosen time zone, including daylight saving', () => {
  // South Africa has no daylight saving: UTC+2 all year.
  assert.equal(zonedToUtc('2026-11-02T18:30', 'Africa/Johannesburg').toISOString(), '2026-11-02T16:30:00.000Z')
  // New York: daylight saving ends on 1 November 2026, so 2 November is UTC−5 and July is UTC−4.
  assert.equal(zonedToUtc('2026-11-02T18:30', 'America/New_York').toISOString(), '2026-11-02T23:30:00.000Z')
  assert.equal(zonedToUtc('2026-07-02T18:30', 'America/New_York').toISOString(), '2026-07-02T22:30:00.000Z')
  assert.equal(utcToZoned(new Date('2026-11-02T16:30:00Z'), 'Africa/Johannesburg'), '2026-11-02T18:30')
  assert.equal(utcToZoned(zonedToUtc('2026-03-15T09:05', 'America/Los_Angeles'), 'America/Los_Angeles'), '2026-03-15T09:05')
  assert.throws(() => zonedToUtc('tomorrow', 'UTC'))
})

test('hashtags are cleaned, de-duplicated and capped', () => {
  assert.deepEqual(cleanHashtags(['#Faith Stories', 'faithstories', 'Family!', '', 3, '##Diaspora'], 10), ['FaithStories', 'Family', 'Diaspora'])
  assert.deepEqual(cleanHashtags(['a', 'b', 'c'], 2), ['a', 'b'])
  assert.deepEqual(cleanHashtags('not a list'), [])
  assert.equal(fullText('Watch now', ['Noisemakers', 'Family']), 'Watch now\n\n#Noisemakers #Family')
})

test('quotes that are not in the source are caught', () => {
  const source = 'Dr Thomas Achia: Why I am proud to be my father’s son. A tribute to Engineer Joshua Achia.'
  assert.deepEqual(unsupportedQuotes('He says “why I am proud to be my father\'s son” in this episode.', source), [])
  assert.deepEqual(unsupportedQuotes('He says “my father was a saint and a hero” in this episode.', source), ['my father was a saint and a hero'])
  assert.deepEqual(unsupportedQuotes('No quotes here at all.', source), [])
})

test('AI output is limited to the requested platforms and each platform’s limits', () => {
  const source = 'Title: Raising a family in the diaspora'
  const result = sanitise(
    {
      summary: 'A conversation about raising children abroad.',
      posts: [
        { platform: 'x', caption: 'y'.repeat(400), hashtags: ['#a', 'b', 'c'] },
        { platform: 'instagram', caption: 'She said “we never gave up on each other” and it shows.', hashtags: ['Family'] },
        { platform: 'tiktok', caption: 'Not requested' },
        { platform: 'facebook', caption: '' },
        'nonsense',
      ],
    },
    ['x', 'instagram', 'facebook'],
    source,
  )
  assert.equal(result.summary, 'A conversation about raising children abroad.')
  assert.deepEqual(result.drafts.map((d) => d.platform), ['x', 'instagram'])
  assert.equal(result.drafts[0].caption.length, 256)
  assert.deepEqual(result.drafts[0].hashtags, ['a', 'b'])
  assert.match(result.drafts[0].warnings[0], /Shortened/)
  assert.match(result.drafts[1].warnings[0], /quote that isn't in the video description/)
})

// The function, against fake Supabase and OpenAI services.
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'OPENAI_API_KEY']) delete process.env[k]
})

const request = (body: unknown, token?: string) =>
  new Request('https://example.com/api/ai/social-drafts', { method: 'POST', body: JSON.stringify(body), headers: token ? { Authorization: `Bearer ${token}` } : {} })
const video = { title: 'Families in the Diaspora, Part 1', description: 'Dr Zebron and Dr Peggy Ncube discuss how they met.', platforms: ['instagram', 'x'], variations: 2 }

function fakeServices(calls: string[], aiReply: unknown = { summary: 'S', posts: [{ platform: 'instagram', caption: 'Watch the Ncubes share how they met.', hashtags: ['Family'] }] }) {
  process.env.SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test'
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    const auth = new Headers(init?.headers).get('Authorization')
    if (url.endsWith('/auth/v1/user')) return auth === 'Bearer team-token' || auth === 'Bearer stranger-token' ? Response.json({ id: auth === 'Bearer team-token' ? 'u1' : 'u2' }) : new Response(null, { status: 401 })
    if (url.includes('/rest/v1/profiles')) return Response.json([{ role: url.includes('u1') ? 'content_manager' : null }])
    if (url.startsWith('https://api.openai.com/')) {
      const sent = JSON.parse(String(init?.body))
      assert.match(sent.messages[0].content, /Never invent quotations/)
      assert.match(sent.messages[1].content, /Dr Zebron and Dr Peggy Ncube/)
      return Response.json({ choices: [{ message: { content: JSON.stringify(aiReply) } }] })
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch
}

test('only signed-in team members can use the AI, so nobody else spends the OpenAI credit', async () => {
  const calls: string[] = []
  fakeServices(calls)
  process.env.OPENAI_API_KEY = 'sk-test'
  assert.equal((await handler(request(video))).status, 401)
  assert.equal((await handler(request(video, 'forged'))).status, 403)
  assert.equal((await handler(request(video, 'stranger-token'))).status, 403)
  assert.ok(!calls.some((u) => u.includes('openai')))
})

test('without an OpenAI key the feature reports that it isn’t connected', async () => {
  fakeServices([])
  const res = await handler(request(video, 'team-token'))
  assert.equal(res.status, 503)
  assert.deepEqual(await res.json(), { error: 'ai-not-configured' })
})

test('returns checked drafts and never contacts a social network', async () => {
  const calls: string[] = []
  fakeServices(calls)
  process.env.OPENAI_API_KEY = 'sk-test'
  const res = await handler(request(video, 'team-token'))
  assert.equal(res.status, 200)
  const body = (await res.json()) as { drafts: { platform: string; caption: string }[] }
  assert.deepEqual(body.drafts.map((d) => d.platform), ['instagram'])
  assert.ok(calls.every((u) => u.includes('supabase.co') || u.includes('api.openai.com')))
})

test('bad requests are refused before any service is called', async () => {
  const calls: string[] = []
  fakeServices(calls)
  assert.equal((await handler(request({ ...video, title: '' }, 'team-token'))).status, 400)
  assert.equal((await handler(request({ ...video, platforms: ['myspace'] }, 'team-token'))).status, 400)
  assert.equal(calls.length, 0)
})
