/**
 * The newsroom server functions against mocked Supabase, OpenAI, Mailchimp and social
 * platforms (tests/lib/fake.ts). These are not live integration tests: they check our
 * side of each conversation, permissions and safety rules.
 */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { authRoutes, fakeFetch, request, restoreFetch, settingsRoute, supabaseEnv, USERS } from './lib/fake.ts'
import { POST as admin } from '../api/admin/[action].ts'
import { POST as ai } from '../api/ai/[task].ts'
import { GET as cron, slotFor } from '../api/cron/[job].ts'
import { POST as newsletter } from '../api/newsletter/[action].ts'
import { decrypt, encrypt } from '../api/_lib/crypto.ts'
import { authorizeUrl, exchangeCode } from '../api/_lib/oauth.ts'
import { facebook, instagram, publishPost, x } from '../api/_lib/publish.ts'
import { chatJson } from '../api/_lib/ai.ts'
import { fetchNews } from '../api/_lib/automation.ts'

const ENV = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'OPENAI_API_KEY', 'CRON_SECRET', 'MAILCHIMP_API_KEY', 'MAILCHIMP_AUDIENCE_ID', 'TOKEN_ENCRYPTION_KEY', 'X_CLIENT_ID', 'X_CLIENT_SECRET', 'META_APP_ID', 'META_APP_SECRET']
afterEach(() => {
  restoreFetch()
  for (const k of ENV) delete process.env[k]
})

const KEY = Buffer.alloc(32, 7).toString('base64')

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

test('scheduled jobs need the cron secret', async () => {
  assert.equal((await cron(request('/api/cron/tick', {}, 'x', 'GET'))).status, 503)
  process.env.CRON_SECRET = 'a-long-random-cron-secret-value'
  const calls = fakeFetch([])
  assert.equal((await cron(request('/api/cron/tick', {}, undefined, 'GET'))).status, 403)
  assert.equal((await cron(request('/api/cron/tick', {}, 'a-long-random-cron-secret-valuX', 'GET'))).status, 403)
  assert.equal((await cron(request('/api/cron/nope', {}, 'a-long-random-cron-secret-value', 'GET'))).status, 404)
  assert.equal(calls.length, 0)
})

test('each run has a time slot, so overlapping calls do the work once', () => {
  const at = new Date('2026-10-26T10:47:12Z')
  assert.equal(slotFor('tick', at), '2026-10-26T10:45')
  assert.equal(slotFor('hourly', at), '2026-10-26T10')
  assert.equal(slotFor('daily', at), '2026-10-26')
})

test('a second scheduler call in the same slot is skipped', async () => {
  process.env.CRON_SECRET = 'a-long-random-cron-secret-value'
  supabaseEnv()
  // The jobs table already has this slot's row, so the insert returns nothing.
  fakeFetch([(url) => (url.pathname === '/rest/v1/jobs' ? Response.json([]) : undefined)])
  const res = await cron(request('/api/cron/tick', {}, 'a-long-random-cron-secret-value', 'GET'))
  assert.deepEqual(await res.json(), { job: 'tick', result: { skipped: 'already ran for this slot' } })
})

// ---------------------------------------------------------------------------
// Newsletter sign-up
// ---------------------------------------------------------------------------

const subscriberRoutes = (existing: unknown[] = []) => (url: URL, call: { method: string }) => {
  if (url.pathname !== '/rest/v1/newsletter_subscribers') return undefined
  if (call.method === 'GET') return Response.json(url.searchParams.has('email_key') ? existing : [])
  return new Response(null, { status: 201 })
}

test('sign-ups need a valid email and consent; bots get a normal answer and nothing is saved', async () => {
  supabaseEnv()
  const calls = fakeFetch([subscriberRoutes()])
  assert.equal((await newsletter(request('/api/newsletter/subscribe', { email: 'nope', consent: true }))).status, 400)
  assert.equal((await newsletter(request('/api/newsletter/subscribe', { email: 'reader@example.com' }))).status, 400)
  const bot = await newsletter(request('/api/newsletter/subscribe', { email: 'bot@example.com', consent: true, honeypot: 'x' }))
  assert.equal(bot.status, 200)
  assert.equal(calls.length, 0)
})

test('a sign-up is saved as pending with the exact consent wording, and Mailchimp sends the confirmation', async () => {
  supabaseEnv()
  process.env.MAILCHIMP_API_KEY = 'abc-us21'
  process.env.MAILCHIMP_AUDIENCE_ID = 'list1'
  const calls = fakeFetch([subscriberRoutes(), (url) => (url.hostname === 'us21.api.mailchimp.com' ? Response.json({ status: 'pending' }) : undefined)])
  const res = await newsletter(request('/api/newsletter/subscribe', { email: 'Reader@Example.com', consent: true }))
  assert.deepEqual(await res.json(), { ok: true, confirmation: 'email' })
  const insert = calls.find((c) => c.method === 'POST' && c.url.includes('newsletter_subscribers'))!.body as Record<string, string>
  assert.equal(insert.status, 'pending')
  assert.equal(insert.email_key, 'reader@example.com')
  assert.match(insert.consent_text, /unsubscribe at any time/)
  const mc = calls.find((c) => c.url.includes('mailchimp.com'))!
  assert.equal(mc.method, 'PUT')
  assert.equal((mc.body as { status_if_new: string }).status_if_new, 'pending')
})

test('without Mailchimp the sign-up is kept and confirmed later', async () => {
  supabaseEnv()
  fakeFetch([subscriberRoutes()])
  const res = await newsletter(request('/api/newsletter/subscribe', { email: 'reader@example.com', consent: true }))
  assert.deepEqual(await res.json(), { ok: true, confirmation: 'later' })
})

test('unsubscribe links work once the token matches', async () => {
  supabaseEnv()
  const token = 'a'.repeat(64)
  const calls = fakeFetch([(url, call) => (url.pathname === '/rest/v1/newsletter_subscribers' ? (call.method === 'GET' ? Response.json([{ id: 's1', email: 'r@example.com' }]) : new Response(null, { status: 204 })) : undefined)])
  const res = await newsletter(request(`/api/newsletter/unsubscribe?token=${token}`, {}, undefined, 'GET'))
  assert.equal(res.status, 303)
  assert.match(res.headers.get('Location')!, /unsubscribed=1/)
  assert.equal((calls.find((c) => c.method === 'PATCH')!.body as { status: string }).status, 'unsubscribed')
  const bad = await newsletter(request('/api/newsletter/unsubscribe?token=short', {}, undefined, 'GET'))
  assert.match(bad.headers.get('Location')!, /unsubscribed=0/)
})

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

test('owner-only actions refuse editors and viewers; viewers can’t act at all', async () => {
  supabaseEnv()
  fakeFetch([authRoutes, settingsRoute()])
  for (const action of ['publish-post', 'newsletter-send', 'oauth-start', 'delete-asset', 'check-integrations']) {
    assert.equal((await admin(request(`/api/admin/${action}`, {}, 'editor-token'))).status, 403, action)
  }
  assert.equal((await admin(request('/api/admin/upload-url', {}, 'viewer-token'))).status, 403)
  assert.equal((await admin(request('/api/admin/upload-url', {}))).status, 401)
  assert.equal((await ai(request('/api/ai/interview', {}, 'viewer-token'))).status, 403)
})

test('integration status lists missing settings by name, never values', async () => {
  supabaseEnv()
  process.env.OPENAI_API_KEY = 'sk-secret-value'
  fakeFetch([authRoutes, (url) => (url.pathname.startsWith('/rest/v1/') ? Response.json([]) : undefined)])
  const res = await admin(request('/api/admin/integrations', {}, 'viewer-token'))
  const body = (await res.json()) as Record<string, { configured: boolean; missing: string[] }>
  assert.equal(body.openai.configured, true)
  assert.deepEqual(body.mailchimp.missing, ['MAILCHIMP_API_KEY', 'MAILCHIMP_AUDIENCE_ID', 'MAILCHIMP_FROM_EMAIL'])
  assert.equal(body.buffer.configured, false)
  assert.doesNotMatch(JSON.stringify(body), /sk-secret-value|sb_secret_test/)
})

test('uploads are checked for type and size before a link is given', async () => {
  supabaseEnv()
  const calls = fakeFetch([
    authRoutes,
    settingsRoute({ max_upload_mb: 100, max_video_minutes: 60 }),
    (url, call) => (url.pathname === '/rest/v1/media_assets' && call.method === 'POST' ? Response.json([{ id: (call.body as { id: string }).id }]) : undefined),
    (url) => (url.pathname.startsWith('/storage/v1/object/upload/sign/') ? Response.json({ url: `/object/upload/sign/media/x?token=tok123` }) : undefined),
  ])
  const ask = (body: object) => admin(request('/api/admin/upload-url', body, 'editor-token'))
  assert.equal((await ask({ kind: 'source_video', filename: 'a.exe', mimeType: 'application/x-msdownload', size: 10 })).status, 400)
  assert.equal((await ask({ kind: 'source_video', filename: 'big.mp4', mimeType: 'video/mp4', size: 200 * 1024 * 1024 })).status, 413)
  assert.equal((await ask({ kind: 'source_video', filename: 'long.mp4', mimeType: 'video/mp4', size: 1000, durationSeconds: 4000 })).status, 413)
  const ok = await ask({ kind: 'source_video', filename: 'Interview (Final).MOV', mimeType: 'video/quicktime', size: 50 * 1024 * 1024, durationSeconds: 1800 })
  assert.equal(ok.status, 200)
  const body = (await ok.json()) as { path: string; token: string; bucket: string }
  assert.match(body.path, /^source_video\/\d{4}-\d{2}\/[0-9a-f-]{36}\/interview-final\.mov$/)
  assert.equal(body.token, 'tok123')
  assert.equal(body.bucket, 'media')
  const saved = calls.find((c) => c.method === 'POST' && c.url.includes('media_assets'))!.body as { status: string; created_by: string }
  assert.equal(saved.status, 'pending_upload')
  assert.equal(saved.created_by, USERS['editor-token'].id)
})

const jobRoutes = (spentUsd = 0) => [
  authRoutes,
  settingsRoute({ monthly_ai_budget_usd: '1.00' }),
  (url: URL) => (url.pathname === '/rest/v1/media_assets' ? Response.json([{ status: 'ready', kind: 'source_video', duration_seconds: 3600 }]) : undefined),
  (url: URL) => (url.pathname === '/rest/v1/ai_usage' ? Response.json(spentUsd ? [{ category: 'ai', cost_usd: String(spentUsd) }] : []) : undefined),
]

test('video jobs show their cost first and only start when confirmed and within budget', async () => {
  supabaseEnv()
  process.env.OPENAI_API_KEY = 'sk-test'
  const assetId = '11111111-1111-4111-8111-111111111111'
  const calls = fakeFetch([...jobRoutes(), (url, call) => (url.pathname === '/rest/v1/jobs' && call.method === 'POST' ? Response.json([{ id: 'job-1' }]) : undefined), (url) => (url.pathname === '/rest/v1/audit_logs' ? new Response(null, { status: 201 }) : undefined)])
  const estimate = await admin(request('/api/admin/estimate', { kind: 'analyze', assetId, count: 6, lengths: [30, 60] }, 'editor-token'))
  const { estimate: e } = (await estimate.json()) as { estimate: { usd: number; lines: string[] } }
  assert.ok(e.usd > 0.3 && e.lines.length === 3)
  const unconfirmed = await admin(request('/api/admin/start-job', { kind: 'analyze', assetId }, 'editor-token'))
  assert.equal(unconfirmed.status, 400)
  assert.equal(((await unconfirmed.json()) as { error: string }).error, 'confirm-needed')
  assert.ok(!calls.some((c) => c.url.includes('/rest/v1/jobs')))
  const started = await admin(request('/api/admin/start-job', { kind: 'analyze', assetId, confirm: true }, 'editor-token'))
  assert.deepEqual(await started.json(), { jobId: 'job-1', duplicate: false })
  const job = calls.find((c) => c.url.includes('/rest/v1/jobs'))!.body as { idempotency_key: string; requested_by: string; estimated_cost_usd: number }
  assert.match(job.idempotency_key, /^analyze:11111111-1111-4111-8111-111111111111:30-60:6$/)
  assert.equal(job.estimated_cost_usd, e.usd)
})

test('a job that would go over the monthly budget is refused', async () => {
  supabaseEnv()
  process.env.OPENAI_API_KEY = 'sk-test'
  const calls = fakeFetch(jobRoutes(0.9))
  const res = await admin(request('/api/admin/start-job', { kind: 'analyze', assetId: '11111111-1111-4111-8111-111111111111', confirm: true }, 'owner-token'))
  assert.equal(res.status, 402)
  assert.ok(!calls.some((c) => c.url.includes('/rest/v1/jobs')))
})

// ---------------------------------------------------------------------------
// AI cost controls
// ---------------------------------------------------------------------------

test('AI calls stop at the daily limit and are recorded with their cost', async () => {
  supabaseEnv()
  process.env.OPENAI_API_KEY = 'sk-test'
  let usageRows = 0
  const calls = fakeFetch([
    settingsRoute({ max_ai_requests_per_day: 2 }),
    (url, call) => {
      if (url.pathname !== '/rest/v1/ai_usage') return undefined
      if (call.method === 'POST') return new Response(null, { status: 201 })
      return Response.json(url.searchParams.has('user_id') ? Array.from({ length: usageRows }, (_, i) => ({ id: i })) : [])
    },
    (url) => (url.hostname === 'api.openai.com' ? Response.json({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }) : undefined),
  ])
  const ask = () => chatJson({ feature: 'test', userId: 'u1', system: 's', user: 'u' })
  assert.deepEqual(await ask(), { ok: true })
  const usage = calls.find((c) => c.method === 'POST' && c.url.includes('ai_usage'))!.body as { cost_usd: number; input_tokens: number; feature: string }
  assert.equal(usage.input_tokens, 1000)
  assert.equal(usage.cost_usd, (1000 * 0.15 + 500 * 0.6) / 1_000_000)
  usageRows = 2
  await assert.rejects(ask(), /ai-daily-limit/)
})

test('the interview assistant only sends the project’s own verified notes to the AI', async () => {
  supabaseEnv()
  process.env.OPENAI_API_KEY = 'sk-test'
  const calls = fakeFetch([
    authRoutes,
    settingsRoute(),
    (url) => (url.pathname === '/rest/v1/ai_usage' ? (url.search ? Response.json([]) : new Response(null, { status: 201 })) : undefined),
    (url) =>
      url.pathname === '/rest/v1/video_projects'
        ? Response.json([{ title: 'Starting over', summary: 'Moving abroad', guest_name: 'Thandi', guest_verified_info: 'Moved to Texas in 2019.', guest_links: [], notes: '', story_id: null }])
        : undefined,
    (url) => (url.hostname === 'api.openai.com' ? Response.json({ choices: [{ message: { content: JSON.stringify({ items: ['How did it feel to arrive?', 'You said “we had nothing at all”, tell us more.'], uncertain: ['Year of the move'] }) } }] }) : undefined),
  ])
  const res = await ai(request('/api/ai/interview', { projectId: '22222222-2222-4222-8222-222222222222', tool: 'questions' }, 'editor-token'))
  const body = (await res.json()) as { items: string[]; warnings: string[]; uncertain: string[] }
  assert.equal(body.items.length, 2)
  assert.equal(body.uncertain[0], 'Year of the move')
  assert.match(body.warnings[0], /quote that isn't in the project notes/)
  const sent = calls.find((c) => c.url.includes('openai'))!.body as { messages: { content: string }[] }
  assert.match(sent.messages[0].content, /never state facts about the guest from general knowledge/)
  assert.match(sent.messages[1].content, /Moved to Texas in 2019/)
})

// ---------------------------------------------------------------------------
// Social publishing
// ---------------------------------------------------------------------------

const post = { id: 'p1', platform: 'facebook' as const, caption: 'Watch the new conversation', hashtags: ['Family'], link_url: 'https://www.youtube.com/watch?v=abcdefghijk', source_title: 'Ep 1', media_asset_id: null }
const conn = { platform: 'facebook' as const, provider: 'meta' as const, accountId: 'PAGE1', accessToken: 'tok', meta: {} }

test('Facebook: text posts go to the Page feed with the link', async () => {
  const calls = fakeFetch([(url) => (url.pathname.endsWith('/PAGE1/feed') ? Response.json({ id: 'PAGE1_99' }) : undefined)])
  const r = await facebook(conn, post, null)
  assert.deepEqual(r, { platformId: 'PAGE1_99', url: 'https://www.facebook.com/PAGE1_99' })
  assert.deepEqual(calls[0].body, { access_token: 'tok', message: 'Watch the new conversation\n\n#Family', link: post.link_url })
})

test('Instagram: needs media, waits for the video to process, then publishes', async () => {
  await assert.rejects(instagram({ ...conn, platform: 'instagram' }, post, null), /need an image or video/)
  let checks = 0
  const calls = fakeFetch([
    (url, call) => (url.pathname.endsWith('/IG1/media') && call.method === 'POST' ? Response.json({ id: 'C1' }) : undefined),
    (url) => (url.pathname.endsWith('/C1') ? Response.json({ status_code: ++checks < 2 ? 'IN_PROGRESS' : 'FINISHED' }) : undefined),
    (url) => (url.pathname.endsWith('/IG1/media_publish') ? Response.json({ id: 'M1' }) : undefined),
    (url) => (url.pathname.endsWith('/M1') ? Response.json({ permalink: 'https://www.instagram.com/reel/abc/' }) : undefined),
  ])
  const r = await instagram({ ...conn, platform: 'instagram', accountId: 'IG1' }, post, { url: 'https://signed/clip.mp4', mimeType: 'video/mp4', size: 100, kind: 'video' }, fetch, 1)
  assert.deepEqual(r, { platformId: 'M1', url: 'https://www.instagram.com/reel/abc/' })
  assert.equal((calls[0].body as { media_type: string }).media_type, 'REELS')
  assert.equal(checks, 2)
})

test('X: text posts only; media goes by hand', async () => {
  const calls = fakeFetch([(url) => (url.hostname === 'api.x.com' ? Response.json({ data: { id: '777' } }) : undefined)])
  assert.deepEqual(await x({ ...conn, platform: 'x' }, post, null), { platformId: '777', url: 'https://x.com/i/web/status/777' })
  assert.match((calls[0].body as { text: string }).text, /#Family\n\nhttps:\/\/www\.youtube\.com/)
  await assert.rejects(x({ ...conn, platform: 'x' }, post, { url: 'u', mimeType: 'video/mp4', size: 1, kind: 'video' }), /by hand/)
})

test('publishing claims the post first, and records failures instead of retrying', async () => {
  supabaseEnv()
  process.env.TOKEN_ENCRYPTION_KEY = KEY
  const rpcs: string[] = []
  fakeFetch([
    (url) => (url.pathname === '/rest/v1/social_posts' ? Response.json([{ platform: 'facebook' }]) : undefined),
    (url) => (url.pathname === '/rest/v1/social_connections' ? Response.json(url.searchParams.get('select') === '*' ? [{ platform: 'facebook', provider: 'meta', external_account_id: 'PAGE1', access_token_enc: encrypt('tok'), refresh_token_enc: '', token_expires_at: null, meta: {} }] : [{ platform: 'facebook' }]) : undefined),
    (url, call) => {
      if (!url.pathname.startsWith('/rest/v1/rpc/')) return undefined
      rpcs.push(`${url.pathname.split('/').pop()}:${JSON.stringify(call.body)}`)
      return url.pathname.endsWith('begin_publish') ? Response.json([post]) : new Response(null, { status: 204 })
    },
    (url) => (url.pathname.endsWith('/PAGE1/feed') ? Response.json({ error: { message: 'Session expired' } }, { status: 400 }) : undefined),
  ])
  assert.equal(await publishPost('p1'), 'failed')
  assert.equal(rpcs.length, 2)
  assert.match(rpcs[0], /^begin_publish/)
  assert.match(rpcs[1], /^finish_publish:.*"ok":false.*Session expired/)
})

test('posts for accounts that aren’t connected are left alone', async () => {
  supabaseEnv()
  const calls = fakeFetch([
    (url) => (url.pathname === '/rest/v1/social_posts' ? Response.json([{ platform: 'tiktok' }]) : undefined),
    (url) => (url.pathname === '/rest/v1/social_connections' ? Response.json([]) : undefined),
  ])
  assert.equal(await publishPost('p1'), 'not-connected')
  assert.ok(!calls.some((c) => c.url.includes('/rpc/')))
})

// ---------------------------------------------------------------------------
// Connecting accounts
// ---------------------------------------------------------------------------

test('tokens are encrypted, and tampering is detected', () => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY
  const sealed = encrypt('secret-token')
  assert.doesNotMatch(sealed, /secret-token/)
  assert.equal(decrypt(sealed), 'secret-token')
  const parts = sealed.split(':')
  parts[3] = Buffer.from('tampered').toString('base64url')
  assert.throws(() => decrypt(parts.join(':')))
  delete process.env.TOKEN_ENCRYPTION_KEY
  assert.throws(() => encrypt('x'), /encryption-not-configured/)
})

test('OAuth sign-in uses state and PKCE, and the code is exchanged for the right account', async () => {
  process.env.X_CLIENT_ID = 'cid'
  process.env.X_CLIENT_SECRET = 'csecret'
  const url = new URL(authorizeUrl('x', 'state123', 'verifier-value-long-enough', 'https://site/api/oauth/callback'))
  assert.equal(url.searchParams.get('state'), 'state123')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.notEqual(url.searchParams.get('code_challenge'), 'verifier-value-long-enough')
  const calls = fakeFetch([
    (u) => (u.pathname === '/2/oauth2/token' ? Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 7200, scope: 'tweet.write users.read' }) : undefined),
    (u) => (u.pathname === '/2/users/me' ? Response.json({ data: { id: '42', username: 'noisemakers', name: 'Noisemakers' } }) : undefined),
  ])
  const [c] = await exchangeCode('x', 'code1', 'verifier-value-long-enough', 'https://site/api/oauth/callback')
  assert.equal(c.account_name, '@noisemakers')
  assert.equal(c.refresh_token, 'rt')
  assert.equal((calls[0].body as { code_verifier: string }).code_verifier, 'verifier-value-long-enough')
  assert.match(calls[0].headers.get('Authorization')!, /^Basic /)
})

test('Meta sign-in connects the Page and its linked Instagram account', async () => {
  process.env.META_APP_ID = 'app'
  process.env.META_APP_SECRET = 'secret'
  fakeFetch([
    (u) => (u.pathname.endsWith('/oauth/access_token') ? Response.json({ access_token: u.searchParams.has('fb_exchange_token') ? 'long' : 'short' }) : undefined),
    (u) => (u.pathname.endsWith('/me/accounts') ? Response.json({ data: [{ id: 'PAGE1', name: 'Noisemakers', access_token: 'page-token', instagram_business_account: { id: 'IG1', username: 'noisemakersnews' } }] }) : undefined),
  ])
  const list = await exchangeCode('meta', 'code', '', 'https://site/api/oauth/callback')
  assert.deepEqual(list.map((c) => [c.platform, c.external_account_id, c.access_token]), [['facebook', 'PAGE1', 'page-token'], ['instagram', 'IG1', 'page-token']])
  assert.equal(list[1].profile_url, 'https://www.instagram.com/noisemakersnews')
})

// ---------------------------------------------------------------------------
// News discovery
// ---------------------------------------------------------------------------

test('news discovery saves feed items with tidy links and marks repeats', async () => {
  supabaseEnv()
  const feed = `<rss><channel>
    <item><title>Cape Town opens new public library in Khayelitsha</title><link>https://news.example/library?utm_source=x</link><description>It opened today.</description></item>
    <item><title>Parenting support grows in Durban</title><link>https://news.example/parenting</link></item>
  </channel></rss>`
  const calls = fakeFetch([
    settingsRoute({ news_topics: ['parenting'] }),
    (url) => (url.pathname === '/rest/v1/news_sources' ? (url.search.includes('enabled') ? Response.json([{ id: 's1', name: 'Example', feed_url: 'https://news.example/rss', topics: [] }]) : new Response(null, { status: 204 })) : undefined),
    (url, call) => {
      if (url.pathname !== '/rest/v1/news_items') return undefined
      if (call.method === 'GET') return Response.json([{ id: 'old1', title: 'New public library opens in Khayelitsha, Cape Town', cluster_key: 'zzz' }])
      return Response.json((call.body as { title: string }[]).map((r, i) => ({ id: `n${i}`, title: r.title, cluster_key: '' })))
    },
    (url) => (url.hostname === 'news.example' ? new Response(feed) : undefined),
    (url) => (url.pathname === '/rest/v1/integration_status' ? new Response(null, { status: 201 }) : undefined),
  ])
  const result = await fetchNews()
  assert.deepEqual(result, { sources: 1, added: 2, failed: 0 })
  const rows = calls.find((c) => c.method === 'POST' && c.url.includes('news_items'))!.body as { url_key: string; duplicate_of: string | null; matched_topics: string[] }[]
  assert.equal(rows[0].url_key, 'news.example/library')
  assert.equal(rows[0].duplicate_of, 'old1')
  assert.deepEqual(rows[1].matched_topics, ['parenting'])
})
