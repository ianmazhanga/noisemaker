/**
 * POST /api/admin/<action>   Header: Authorization: Bearer <a team member's access token>
 *
 * Dashboard actions that need the server: they use secret keys, call outside services or
 * move files. Who may do what is checked here from the database role, never the request.
 *
 *   integrations       staff    which services are configured and their last status
 *   check-integrations owner    tests each configured service now
 *   oauth-start        owner    { platform } → the platform's sign-in page
 *   upload-url         writer   { kind, filename, mimeType, size, durationSeconds?, projectId? } → a one-time upload link
 *   upload-done        writer   { assetId } → checks the upload and marks the file ready
 *   delete-asset       owner    { assetId }
 *   estimate           writer   { kind: 'analyze' | 'render', assetId | clipId, ... } → cost before starting
 *   start-job          writer   same as estimate, plus { confirm: true }
 *   publish-post       owner    { postId } → publishes an approved post now
 *   newsletter-test    writer   { campaignId, emails } (non-owners: only to their own address)
 *   newsletter-send    owner    { campaignId } → sends an approved newsletter now
 *   run                writer   { task: 'youtube' | 'news' } (owners also 'analytics', 'subscribers')
 */
import { estimateAnalysis, estimateRender, overBudget } from '../../src/lib/costs.ts'
import { clipLength } from '../../src/lib/clips.ts'
import { INTEGRATIONS } from '../../src/lib/integrations.ts'
import { EMAIL_PATTERN } from '../../src/lib/newsletter.ts'
import { PLATFORM_KEYS, type Platform } from '../../src/lib/social.ts'
import { rpcUsage } from '../_lib/ai.ts'
import { analyticsSnapshot, fetchNews, sendCampaign, syncSubscribers, syncYouTube } from '../_lib/automation.ts'
import { randomToken } from '../_lib/crypto.ts'
import { mailchimpConfigured, ping, sendTest, upsertCampaign } from '../_lib/mailchimp.ts'
import { authorizeUrl, PROVIDER_OF, providerConfigured } from '../_lib/oauth.ts'
import { publishPost } from '../_lib/publish.ts'
import { audit, caller, failure, HttpError, integration, json, readBody, rest, routeName, settings, siteUrl, type Caller } from '../_lib/server.ts'
import { objectInfo, removeObjects, signedUploadUrl } from '../_lib/storage.ts'

const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null)

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

async function integrations() {
  const rows = await rest<{ key: string; last_success_at: string | null; last_sync_at: string | null; last_error: string; last_error_at: string | null; details: Record<string, unknown> }[]>('integration_status?select=*').catch(() => [])
  const accounts = await rest<{ platform: string; status: string; account_name: string; connected_at: string | null; last_error: string }[]>('social_accounts?select=platform,status,account_name,connected_at,last_error').catch(() => [])
  return Object.fromEntries(
    Object.entries(INTEGRATIONS).map(([key, info]) => {
      const missing = info.env.filter((name) => !process.env[name])
      const status = rows.find((r) => r.key === key) ?? null
      const account = info.oauthPlatform ? accounts.find((a) => a.platform === info.oauthPlatform) : undefined
      return [key, { configured: !info.unavailable && missing.length === 0 && info.env.length > 0, missing, status, account: account ?? null }]
    }),
  )
}

/** Cheap, read-only calls that prove each configured service accepts our credentials. */
async function checkIntegrations() {
  const results: Record<string, string> = {}
  const check = async (key: string, run: () => Promise<void>) => {
    try {
      await run()
      results[key] = 'ok'
      await integration(key, { ok: true })
    } catch (error) {
      results[key] = error instanceof Error ? error.message : 'failed'
      await integration(key, { ok: false, error: results[key] })
    }
  }
  await check('supabase', async () => void (await rest('app_settings?select=id&limit=1')))
  if (process.env.OPENAI_API_KEY)
    await check('openai', async () => {
      const res = await fetch('https://api.openai.com/v1/models?limit=1', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(res.status === 401 ? 'The key was refused' : `OpenAI answered ${res.status}`)
    })
  if (process.env.YOUTUBE_API_KEY)
    await check('youtube_data', async () => {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=id&id=UCD49Bigk35BXat_YPimii0Q&key=${encodeURIComponent(process.env.YOUTUBE_API_KEY!)}`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`YouTube answered ${res.status}`)
    })
  if (mailchimpConfigured()) await check('mailchimp', async () => void (await ping()))
  return results
}

// ---------------------------------------------------------------------------
// Social accounts
// ---------------------------------------------------------------------------

async function oauthStart(who: Caller, body: Record<string, unknown>, req: Request) {
  const platform = body.platform as Platform
  if (!PLATFORM_KEYS.includes(platform)) throw new HttpError(400, 'invalid')
  if (!process.env.TOKEN_ENCRYPTION_KEY) throw new HttpError(503, 'encryption-not-configured')
  const provider = PROVIDER_OF[platform]
  if (!providerConfigured(provider)) throw new HttpError(503, 'provider-not-configured')
  const state = randomToken(24)
  const verifier = randomToken(48)
  await rest('oauth_states', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ state, platform, user_id: who.id, code_verifier: verifier }) })
  return { url: authorizeUrl(provider, state, verifier, `${siteUrl(req)}/api/oauth/callback`) }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const KINDS: Record<string, { mime: RegExp; maxMb?: number; bucket: 'media' | 'site-images' }> = {
  source_video: { mime: /^video\/(mp4|quicktime|webm|x-matroska)$/, bucket: 'media' },
  image: { mime: /^image\/(png|jpeg|webp|gif)$/, maxMb: 10, bucket: 'site-images' },
  logo: { mime: /^image\/(png|webp)$/, maxMb: 5, bucket: 'media' },
  music: { mime: /^audio\/(mpeg|mp4|wav|x-wav)$/, maxMb: 50, bucket: 'media' },
  intro: { mime: /^video\/(mp4|quicktime|webm)$/, maxMb: 200, bucket: 'media' },
  outro: { mime: /^video\/(mp4|quicktime|webm)$/, maxMb: 200, bucket: 'media' },
}

/** "My Interview (final).MOV" → "my-interview-final.mov" */
export const safeFilename = (name: string) => {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(name)?.[1] ?? 'bin').toLowerCase()
  const base = name.replace(/\.[^.]*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file'
  return `${base}.${ext}`
}

export async function uploadUrl(who: Caller, body: Record<string, unknown>) {
  const kind = String(body.kind ?? '')
  const rule = KINDS[kind]
  const mimeType = String(body.mimeType ?? '')
  const size = Number(body.size)
  const filename = String(body.filename ?? '').slice(0, 255)
  if (!rule || !rule.mime.test(mimeType) || !Number.isFinite(size) || size <= 0 || !filename) throw new HttpError(400, 'invalid')
  const s = await settings()
  const maxMb = Math.min(rule.maxMb ?? s.max_upload_mb, s.max_upload_mb)
  if (size > maxMb * 1024 * 1024) throw new HttpError(413, 'too-large', { maxMb })
  const duration = Number(body.durationSeconds)
  if (kind === 'source_video' && Number.isFinite(duration) && duration > s.max_video_minutes * 60) throw new HttpError(413, 'too-long', { maxMinutes: s.max_video_minutes })
  const projectId = uuid(body.projectId)
  const id = crypto.randomUUID()
  const path = `${kind}/${new Date().toISOString().slice(0, 7)}/${id}/${safeFilename(filename)}`
  const [asset] = await rest<{ id: string }[]>('media_assets', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ id, bucket: rule.bucket, path, kind, filename, mime_type: mimeType, size_bytes: size, duration_seconds: Number.isFinite(duration) && duration > 0 ? duration : null, status: 'pending_upload', project_id: projectId, created_by: who.id }),
  })
  const upload = await signedUploadUrl(rule.bucket, path)
  return { assetId: asset.id, bucket: rule.bucket, path, token: upload.token }
}

async function uploadDone(body: Record<string, unknown>) {
  const id = uuid(body.assetId)
  if (!id) throw new HttpError(400, 'invalid')
  const [asset] = await rest<{ bucket: string; path: string; kind: string; status: string; size_bytes: number }[]>(`media_assets?select=bucket,path,kind,status,size_bytes&id=eq.${id}`)
  if (!asset) throw new HttpError(404, 'not-found')
  const info = await objectInfo(asset.bucket, asset.path)
  if (!info) throw new HttpError(409, 'upload-missing')
  const s = await settings()
  if (info.size > s.max_upload_mb * 1024 * 1024) {
    await removeObjects(asset.bucket, [asset.path])
    await rest(`media_assets?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed' }) })
    throw new HttpError(413, 'too-large', { maxMb: s.max_upload_mb })
  }
  await rest(`media_assets?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'ready', size_bytes: info.size || asset.size_bytes }) })
  return { ok: true, publicUrl: asset.bucket === 'site-images' ? `${(process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')}/storage/v1/object/public/site-images/${asset.path}` : null }
}

async function deleteAsset(who: Caller, body: Record<string, unknown>) {
  const id = uuid(body.assetId)
  if (!id) throw new HttpError(400, 'invalid')
  const [asset] = await rest<{ bucket: string; path: string }[]>(`media_assets?select=bucket,path&id=eq.${id}`)
  if (!asset) throw new HttpError(404, 'not-found')
  const used = await rest<unknown[]>(`social_posts?select=id&media_asset_id=eq.${id}&status=in.(pending_approval,approved,scheduled)&limit=1`)
  if (used.length) throw new HttpError(409, 'in-use')
  await removeObjects(asset.bucket, [asset.path])
  await rest(`media_assets?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'deleted', deleted_at: new Date().toISOString() }) })
  await audit(who.id, 'file.deleted', id)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Video jobs: estimate first, then start only with confirmation
// ---------------------------------------------------------------------------

interface Planned {
  kind: 'analyze' | 'render'
  key: string
  payload: Record<string, unknown>
  estimate: { usd: number; lines: string[] }
  category: 'ai' | 'video'
}

export async function planJob(body: Record<string, unknown>): Promise<Planned> {
  const s = await settings()
  if (body.kind === 'analyze') {
    const id = uuid(body.assetId)
    if (!id) throw new HttpError(400, 'invalid')
    const [asset] = await rest<{ status: string; kind: string; duration_seconds: number | null }[]>(`media_assets?select=status,kind,duration_seconds&id=eq.${id}`)
    if (!asset || asset.kind !== 'source_video' || asset.status !== 'ready') throw new HttpError(409, 'asset-not-ready')
    const duration = Number(asset.duration_seconds ?? 0)
    if (!duration) throw new HttpError(409, 'duration-unknown')
    if (duration > s.max_video_minutes * 60) throw new HttpError(413, 'too-long', { maxMinutes: s.max_video_minutes })
    const count = Math.min(s.max_clips_per_video, Math.max(1, Math.round(Number(body.count) || 6)))
    const lengths = (Array.isArray(body.lengths) ? body.lengths : [30, 60]).map(Number).filter((n) => Number.isFinite(n) && n >= 10 && n <= 180).slice(0, 4)
    if (!lengths.length) throw new HttpError(400, 'invalid')
    const regenerate = body.regenerate === true
    return {
      kind: 'analyze',
      // The same recording and settings are analysed once, unless the owner asks to regenerate.
      key: `analyze:${id}:${[...lengths].sort().join('-')}:${count}${regenerate ? `:${Date.now()}` : ''}`,
      payload: { assetId: id, count, lengths, regenerate },
      estimate: estimateAnalysis(duration, undefined, count),
      category: 'ai',
    }
  }
  if (body.kind === 'render') {
    const id = uuid(body.clipId)
    if (!id) throw new HttpError(400, 'invalid')
    const [clip] = await rest<{ start_s: number; end_s: number; cuts: [number, number][]; status: string; updated_at: string }[]>(`video_clips?select=start_s,end_s,cuts,status,updated_at&id=eq.${id}`)
    if (!clip) throw new HttpError(404, 'not-found')
    if (['rendering', 'approved', 'sent_to_social'].includes(clip.status)) throw new HttpError(409, 'clip-locked')
    const final = body.final === true
    return {
      kind: 'render',
      key: `render:${id}:${final ? 'final' : 'preview'}:${clip.updated_at}`,
      payload: { clipId: id, final },
      estimate: estimateRender(clipLength(Number(clip.start_s), Number(clip.end_s), clip.cuts ?? []), final),
      category: 'video',
    }
  }
  throw new HttpError(400, 'invalid')
}

async function startJob(who: Caller, body: Record<string, unknown>) {
  const plan = await planJob(body)
  if (body.confirm !== true) throw new HttpError(400, 'confirm-needed', { estimate: plan.estimate })
  const s = await settings()
  const usage = await rpcUsage()
  const budget = plan.category === 'ai' ? s.monthly_ai_budget_usd : s.monthly_video_budget_usd
  if (overBudget(plan.category === 'ai' ? usage.ai : usage.video, budget, plan.estimate.usd)) throw new HttpError(402, 'budget', { budget, estimate: plan.estimate.usd })
  if (plan.kind === 'analyze' && !process.env.OPENAI_API_KEY) throw new HttpError(503, 'ai-not-configured')

  const inserted = await rest<{ id: string }[]>('jobs?on_conflict=idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify({ kind: plan.kind, idempotency_key: plan.key, payload: plan.payload, estimated_cost_usd: plan.estimate.usd, requested_by: who.id, message: 'Waiting for the video worker' }),
  }).catch((error: { status?: number }) => {
    if (error.status === 409) return []
    throw error
  })
  if (!inserted.length) {
    // Already queued, running or done: show that job instead of starting a second one.
    const [existing] = await rest<{ id: string; status: string }[]>(`jobs?select=id,status&idempotency_key=eq.${encodeURIComponent(plan.key)}&status=in.(queued,running,succeeded)`)
    return { jobId: existing?.id ?? null, duplicate: true, status: existing?.status }
  }
  if (plan.kind === 'render') await rest(`video_clips?id=eq.${plan.payload.clipId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'rendering' }) })
  await audit(who.id, 'job.started', inserted[0].id, { kind: plan.kind, estimate_usd: plan.estimate.usd })
  await wakeWorker()
  return { jobId: inserted[0].id, duplicate: false }
}

/** Starts the video worker straight away when a GitHub token is configured; otherwise it picks the job up at its next scheduled check. */
async function wakeWorker() {
  const token = process.env.GITHUB_DISPATCH_TOKEN
  const repo = process.env.GITHUB_REPOSITORY || 'ianmazhanga/noisemaker'
  if (!token) return
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/video-worker.yml/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(8000),
    })
    await integration('video_worker', res.ok ? { ok: true } : { ok: false, error: `GitHub answered ${res.status} when starting the worker` })
  } catch (error) {
    await integration('video_worker', { ok: false, error: error instanceof Error ? error.message : 'Could not start the worker' })
  }
}

// ---------------------------------------------------------------------------
// Publishing and newsletters
// ---------------------------------------------------------------------------

async function newsletterTest(who: Caller, body: Record<string, unknown>) {
  const id = uuid(body.campaignId)
  const emails = (Array.isArray(body.emails) ? body.emails : [who.email]).map((e) => String(e).trim()).filter((e) => EMAIL_PATTERN.test(e)).slice(0, 5)
  if (!id || !emails.length) throw new HttpError(400, 'invalid')
  if (who.role !== 'owner' && emails.some((e) => e.toLowerCase() !== who.email.toLowerCase())) throw new HttpError(403, 'forbidden')
  const [c] = await rest<{ subject: string; preheader: string; intro: string; blocks: unknown; provider_campaign_id: string; status: string }[]>(`newsletter_campaigns?select=subject,preheader,intro,blocks,provider_campaign_id,status&id=eq.${id}`)
  if (!c) throw new HttpError(404, 'not-found')
  if (['sending', 'sent'].includes(c.status)) throw new HttpError(409, 'already-sent')
  const s = await settings()
  const providerId = await upsertCampaign({ subject: c.subject || '(no subject)', preheader: c.preheader, intro: c.intro, blocks: c.blocks as never, providerId: c.provider_campaign_id, fromName: s.newsletter_from_name, replyTo: s.newsletter_reply_to }, siteUrl())
  await sendTest(providerId, emails)
  await rest(`newsletter_campaigns?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ provider_campaign_id: providerId, last_test_at: new Date().toISOString() }) })
  await integration('mailchimp', { ok: true })
  return { ok: true, sentTo: emails }
}

// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  try {
    const action = routeName(req)
    const ownerOnly = ['check-integrations', 'oauth-start', 'delete-asset', 'publish-post', 'newsletter-send'].includes(action)
    const readOnly = action === 'integrations'
    const who = await caller(req, ownerOnly ? 'owner' : readOnly ? 'staff' : 'writer')
    const body = await readBody(req)
    switch (action) {
      case 'integrations':
        return json(await integrations())
      case 'check-integrations':
        return json(await checkIntegrations())
      case 'oauth-start':
        return json(await oauthStart(who, body, req))
      case 'upload-url':
        return json(await uploadUrl(who, body))
      case 'upload-done':
        return json(await uploadDone(body))
      case 'delete-asset':
        return json(await deleteAsset(who, body))
      case 'estimate':
        return json({ estimate: (await planJob(body)).estimate })
      case 'start-job':
        return json(await startJob(who, body))
      case 'publish-post': {
        const id = uuid(body.postId)
        if (!id) throw new HttpError(400, 'invalid')
        return json({ result: await publishPost(id) })
      }
      case 'newsletter-test':
        return json(await newsletterTest(who, body))
      case 'newsletter-send': {
        const id = uuid(body.campaignId)
        if (!id) throw new HttpError(400, 'invalid')
        if (!mailchimpConfigured()) throw new HttpError(503, 'mailchimp-not-configured')
        const result = await sendCampaign(id)
        if (result === 'sent') await audit(who.id, 'newsletter.sent', id)
        return json({ result })
      }
      case 'run': {
        const task = body.task
        if (task === 'youtube') return json(await syncYouTube())
        if (task === 'news') return json(await fetchNews())
        if (who.role !== 'owner') throw new HttpError(403, 'forbidden')
        if (task === 'analytics') return json(await analyticsSnapshot())
        if (task === 'subscribers') return json(await syncSubscribers())
        throw new HttpError(400, 'invalid')
      }
      default:
        throw new HttpError(404, 'not-found')
    }
  } catch (error) {
    return failure(error, 'admin action')
  }
}
