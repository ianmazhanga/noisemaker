/**
 * Security and workflow rules of the newsroom migration, checked by acting as the public,
 * a viewer, an editor, a content manager, an owner and the server's secret key.
 */
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { migratedDb, type TestDb } from './lib/pg.ts'

const OWNER = '00000000-0000-4000-8000-0000000000a1'
const EDITOR = '00000000-0000-4000-8000-0000000000a2'
const MANAGER = '00000000-0000-4000-8000-0000000000a3'
const VIEWER = '00000000-0000-4000-8000-0000000000a4'
const NOBODY = '00000000-0000-4000-8000-0000000000a5'

let t: TestDb

before(async () => {
  t = await migratedDb()
  await t.addUser(OWNER, 'owner@example.com', 'owner', true)
  await t.addUser(EDITOR, 'editor@example.com', 'editor')
  await t.addUser(MANAGER, 'manager@example.com', 'content_manager')
  await t.addUser(VIEWER, 'viewer@example.com', 'viewer')
  await t.addUser(NOBODY, 'nobody@example.com')
})

const one = async <T,>(p: Promise<T[]>) => (await p)[0]

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

test('viewers read but cannot write anything', async () => {
  assert.equal((await t.as(VIEWER, 'select * from public.app_settings')).length, 1)
  await assert.rejects(t.as(VIEWER, `insert into public.social_posts (platform, caption) values ('x', 'Hi')`), /row-level security/)
  await assert.rejects(t.as(VIEWER, `insert into public.video_projects (title) values ('Idea')`), /row-level security/)
  await assert.rejects(t.as(VIEWER, `insert into public.news_articles (slug, title) values ('a', 'A')`), /row-level security/)
  await assert.rejects(t.as(VIEWER, `insert into public.calendar_events (title, starts_at) values ('x', now())`), /row-level security/)
  assert.equal((await t.as(VIEWER, `update public.app_settings set auto_ai_enabled = true returning id`)).length, 0)
})

test('editors and content managers read stories only when the owner allows it; viewers never do', async () => {
  await t.admin(`insert into public.story_submissions (reference, fingerprint, full_name, story_title) values ('NM-261028-AAAA', 'f', 'Thandi', 'Starting over')`)
  assert.equal((await t.as(EDITOR, 'select * from public.story_submissions')).length, 0)
  await t.as(OWNER, 'select public.set_member_access($1, $2, true)', [EDITOR, 'editor'])
  assert.ok((await t.as(EDITOR, 'select * from public.story_submissions')).length > 0)
  await t.as(OWNER, 'select public.set_member_access($1, $2, true)', [VIEWER, 'viewer'])
  assert.equal((await t.as(VIEWER, 'select * from public.story_submissions')).length, 0)
  await t.as(OWNER, 'select public.set_member_access($1, $2, false)', [VIEWER, 'viewer'])
})

test('the owner can remove someone’s access completely', async () => {
  await t.addUser('00000000-0000-4000-8000-0000000000a6', 'temp@example.com', 'editor')
  await t.as(OWNER, 'select public.set_member_access($1, null, false)', ['00000000-0000-4000-8000-0000000000a6'])
  const [row] = await t.admin<{ role: string | null }>(`select role from public.profiles where email = 'temp@example.com'`)
  assert.equal(row.role, null)
})

test('everyone on the team sees the team list, outsiders see nothing', async () => {
  assert.ok((await t.as(VIEWER, 'select * from public.team_members()')).length >= 4)
  assert.equal((await t.as(NOBODY, 'select * from public.team_members()')).length, 0)
})

test('only owners change settings, and the change is logged', async () => {
  assert.equal((await t.as(EDITOR, 'update public.app_settings set monthly_ai_budget_usd = 999 returning id')).length, 0)
  await t.as(OWNER, 'update public.app_settings set monthly_ai_budget_usd = 15, auto_ai_enabled = false')
  const [s] = await t.admin<{ monthly_ai_budget_usd: string; updated_by: string }>('select monthly_ai_budget_usd, updated_by from public.app_settings')
  assert.deepEqual(s, { monthly_ai_budget_usd: '15.00', updated_by: OWNER })
  assert.ok((await t.admin(`select 1 from public.audit_logs where action = 'settings.changed'`)).length > 0)
})

// ---------------------------------------------------------------------------
// The public key
// ---------------------------------------------------------------------------

test('the public key reads only published articles, and only their public columns', async () => {
  await t.admin(`insert into public.news_articles (slug, title, body, status, approved_by, published_at, editorial_notes)
                 values ('live-story', 'Live', 'Body', 'published', $1, now() - interval '1 hour', 'secret note'),
                        ('draft-story', 'Draft', 'Body', 'draft', null, null, '')`, [OWNER])
  const rows = await t.as<{ slug: string }>('anon', 'select slug, title, body from public.news_articles')
  assert.deepEqual(rows.map((r) => r.slug), ['live-story'])
  await assert.rejects(t.as('anon', 'select editorial_notes from public.news_articles'), /permission denied/)
  await assert.rejects(t.as('anon', 'select * from public.news_articles'), /permission denied/)
})

test('the public key gets nothing else', async () => {
  for (const table of ['newsletter_subscribers', 'newsletter_campaigns', 'video_projects', 'video_clips', 'media_assets', 'jobs', 'social_connections', 'oauth_states', 'ai_usage', 'app_settings', 'content_calendar', 'youtube_videos', 'analytics_snapshots']) {
    await assert.rejects(t.as('anon', `select * from public.${table}`), /permission denied/, table)
  }
})

test('connected-account tokens are invisible to every dashboard account', async () => {
  await t.admin(`insert into public.social_connections (platform, provider, access_token_enc) values ('x', 'x', 'v1:abc')`)
  await assert.rejects(t.as(OWNER, 'select * from public.social_connections'), /permission denied/)
  await assert.rejects(t.as(OWNER, 'select * from public.oauth_states'), /permission denied/)
  assert.equal((await t.as('service', 'select * from public.social_connections')).length, 1)
})

test('subscriber addresses are visible to owners only', async () => {
  await t.admin(`insert into public.newsletter_subscribers (email, email_key, status) values ('reader@example.com', 'reader@example.com', 'subscribed')`)
  assert.equal((await t.as(OWNER, 'select email from public.newsletter_subscribers')).length, 1)
  assert.equal((await t.as(EDITOR, 'select email from public.newsletter_subscribers')).length, 0)
  await assert.rejects(t.as(OWNER, 'select unsubscribe_token from public.newsletter_subscribers'), /permission denied/)
  const stats = await t.as<{ status: string; total: string }>(EDITOR, 'select status, total from public.newsletter_stats()')
  assert.equal(Number(stats.find((s) => s.status === 'subscribed')?.total), 1)
})

// ---------------------------------------------------------------------------
// News Manager
// ---------------------------------------------------------------------------

async function article(who: string, slug: string) {
  return (await one(t.as<{ id: string }>(who, `insert into public.news_articles (slug, title, body) values ($1, 'A headline', 'Text') returning id`, [slug]))).id
}

test('articles need an owner’s approval before they can go live', async () => {
  const id = await article(EDITOR, 'needs-approval')
  await t.as(EDITOR, 'select public.submit_article($1)', [id])
  await assert.rejects(t.as(EDITOR, 'select public.approve_article($1)', [id]), /Only an owner/)
  await assert.rejects(t.as(OWNER, 'select public.set_article_live($1, true)', [id]), /Only approved/)
  await assert.rejects(t.admin(`update public.news_articles set status = 'published' where id = $1`, [id]), /must be approved/)
  await assert.rejects(t.as(EDITOR, `update public.news_articles set status = 'published' where id = $1`, [id]), /permission denied/)
  assert.ok((await t.admin(`select 1 from public.notifications where kind = 'article.pending' and link like '%' || $1`, [id])).length === 1)

  await t.as(OWNER, 'select public.approve_article($1)', [id])
  await t.as(OWNER, 'select public.set_article_live($1, true)', [id])
  assert.equal((await t.as('anon', 'select slug from public.news_articles where slug = $1', ['needs-approval'])).length, 1)
  // Automation B: a promotion task lands on the calendar
  assert.equal((await t.admin(`select 1 from public.calendar_events where related_id = $1 and kind = 'task'`, [id])).length, 1)

  await t.as(OWNER, 'select public.set_article_live($1, false)', [id])
  assert.equal((await t.as('anon', 'select slug from public.news_articles where slug = $1', ['needs-approval'])).length, 0)
})

test('editing an approved article sends it back for approval', async () => {
  const id = await article(EDITOR, 'edit-after-approval')
  await t.as(OWNER, 'select public.approve_article($1)', [id])
  await t.as(OWNER, `select public.schedule_article($1, now() + interval '1 day')`, [id])
  await t.as(EDITOR, `update public.news_articles set body = 'Changed' where id = $1`, [id])
  const [row] = await t.admin('select status, approved_by, scheduled_at from public.news_articles where id = $1', [id])
  assert.deepEqual(row, { status: 'pending_approval', approved_by: null, scheduled_at: null })
})

test('scheduled articles go live when their time comes, and not before', async () => {
  const id = await article(EDITOR, 'scheduled-one')
  await t.as(OWNER, 'select public.approve_article($1)', [id])
  await t.as(OWNER, `select public.schedule_article($1, now() + interval '1 minute')`, [id])
  assert.equal((await one(t.as<{ n: number }>('service', 'select public.publish_due_articles() as n'))).n, 0)
  await t.admin(`update public.news_articles set scheduled_at = now() - interval '1 minute' where id = $1`, [id])
  assert.equal((await one(t.as<{ n: number }>('service', 'select public.publish_due_articles() as n'))).n, 1)
  await assert.rejects(t.as(OWNER, 'select public.publish_due_articles()'), /permission denied/)
})

// ---------------------------------------------------------------------------
// Newsletters
// ---------------------------------------------------------------------------

test('newsletters can’t be scheduled or sent without approval; edits need a new approval', async () => {
  const { id } = await one(t.as<{ id: string }>(MANAGER, `insert into public.newsletter_campaigns (subject, intro) values ('This week', 'Hello') returning id`))
  await assert.rejects(t.as(OWNER, `select public.schedule_newsletter($1, now() + interval '1 day', 'UTC')`, [id]), /Approve the newsletter/)
  await assert.rejects(t.admin(`update public.newsletter_campaigns set status = 'sent' where id = $1`, [id]), /must be approved/)
  await t.as(MANAGER, 'select public.submit_newsletter($1)', [id])
  await assert.rejects(t.as(MANAGER, 'select public.approve_newsletter($1)', [id]), /Only an owner/)
  await t.as(OWNER, 'select public.approve_newsletter($1)', [id])
  await t.as(OWNER, `select public.schedule_newsletter($1, now() + interval '1 day', 'Europe/London')`, [id])
  await t.as(MANAGER, `update public.newsletter_campaigns set subject = 'New subject' where id = $1`, [id])
  const [row] = await t.admin('select status, approved_by from public.newsletter_campaigns where id = $1', [id])
  assert.deepEqual(row, { status: 'pending_approval', approved_by: null })
})

// ---------------------------------------------------------------------------
// Social publishing
// ---------------------------------------------------------------------------

async function approvedPost(caption = 'Watch the conversation') {
  const { id } = await one(t.as<{ id: string }>(OWNER, `insert into public.social_posts (platform, caption) values ('facebook', $1) returning id`, [caption]))
  await t.as(OWNER, 'select public.approve_post($1)', [id])
  return id
}

test('each approved post is claimed for publishing once, so it can’t be posted twice', async () => {
  const id = await approvedPost()
  assert.equal((await t.as('service', 'select id from public.begin_publish($1)', [id])).length, 1)
  assert.equal((await t.as('service', 'select id from public.begin_publish($1)', [id])).length, 0)
  // Nobody can edit it mid-publish.
  assert.equal((await t.as(OWNER, `update public.social_posts set caption = 'x' where id = $1 returning id`, [id])).length, 0)
  await t.as('service', `select public.finish_publish($1, true, 'https://facebook.com/p/1', '123_456', '')`, [id])
  const [row] = await t.admin('select status, platform_post_id, publish_started_at from public.social_posts where id = $1', [id])
  assert.deepEqual(row, { status: 'published', platform_post_id: '123_456', publish_started_at: null })
  assert.equal((await t.as('service', 'select id from public.begin_publish($1)', [id])).length, 0)
})

test('unapproved posts can’t be claimed for publishing', async () => {
  const { id } = await one(t.as<{ id: string }>(EDITOR, `insert into public.social_posts (platform, caption) values ('x', 'Draft') returning id`))
  assert.equal((await t.as('service', 'select id from public.begin_publish($1)', [id])).length, 0)
  await assert.rejects(t.as(OWNER, 'select public.begin_publish($1)', [id]), /permission denied/)
})

test('a failed attempt notifies owners once and can be retried safely by an owner', async () => {
  const id = await approvedPost('Will fail')
  await t.as('service', 'select public.begin_publish($1)', [id])
  await t.as('service', `select public.finish_publish($1, false, '', '', 'Token expired')`, [id])
  await t.as('service', `select public.finish_publish($1, false, '', '', 'Token expired')`, [id])
  assert.equal((await t.admin(`select 1 from public.notifications where kind = 'post.failed' and link like '%' || $1`, [id])).length, 1)
  const [failed] = await t.admin<{ status: string; error_message: string }>('select status, error_message from public.social_posts where id = $1', [id])
  assert.deepEqual(failed, { status: 'failed', error_message: 'Token expired' })
  await assert.rejects(t.as(EDITOR, 'select public.retry_post($1)', [id]), /Only an owner/)
  await t.as(OWNER, 'select public.retry_post($1)', [id])
  assert.equal((await t.as('service', 'select id from public.begin_publish($1)', [id])).length, 1)
})

test('attempts that never report back are marked failed, not retried', async () => {
  const id = await approvedPost('Stuck')
  await t.as('service', 'select public.begin_publish($1)', [id])
  await t.admin(`update public.social_posts set publish_started_at = now() - interval '20 minutes' where id = $1`, [id])
  await t.as('service', 'select public.expire_stuck_publishing()')
  const [row] = await t.admin<{ status: string; error_message: string }>('select status, error_message from public.social_posts where id = $1', [id])
  assert.equal(row.status, 'failed')
  assert.match(row.error_message, /Check whether it was posted/)
})

test('changing the media of an approved post needs a fresh approval', async () => {
  const id = await approvedPost('With media')
  const { id: asset } = await one(t.admin<{ id: string }>(`insert into public.media_assets (path, kind, status) values ('x/clip.mp4', 'clip_final', 'ready') returning id`))
  await t.as(EDITOR, 'update public.social_posts set media_asset_id = $2 where id = $1', [id, asset])
  const [row] = await t.admin('select status, approved_by from public.social_posts where id = $1', [id])
  assert.deepEqual(row, { status: 'pending_approval', approved_by: null })
})

// ---------------------------------------------------------------------------
// Video production and AI Shorts
// ---------------------------------------------------------------------------

async function clip() {
  const { id: asset } = await one(t.admin<{ id: string }>(`insert into public.media_assets (path, kind, status) values (gen_random_uuid() || '/source.mp4', 'source_video', 'ready') returning id`))
  const { id } = await one(t.as<{ id: string }>(EDITOR, `insert into public.video_clips (asset_id, title, start_s, end_s, captions) values ($1, 'Strong answer', 10, 40, '{"tiktok": "A tiktok caption", "instagram": "An IG caption", "hashtags": ["Family", "#Hope!"]}') returning id`, [asset]))
  return { id, asset }
}

test('clips need a final render and an owner’s approval before they reach social media', async () => {
  const { id } = await clip()
  await assert.rejects(t.as(OWNER, 'select public.approve_clip($1)', [id]), /Render the final video/)
  await assert.rejects(t.as(EDITOR, `select public.send_clip_to_social($1, '{tiktok}')`, [id]), /Approve the clip/)
  await assert.rejects(t.admin(`update public.video_clips set status = 'approved' where id = $1`, [id]), /rendered and approved/)

  const { id: final } = await one(t.admin<{ id: string }>(`insert into public.media_assets (path, kind, status) values (gen_random_uuid() || '/final.mp4', 'clip_final', 'ready') returning id`))
  await t.as('service', `update public.video_clips set final_asset_id = $2, status = 'rendered' where id = $1`, [id, final])
  await assert.rejects(t.as(EDITOR, 'select public.approve_clip($1)', [id]), /Only an owner/)
  await t.as(OWNER, 'select public.approve_clip($1)', [id])

  const made = await one(t.as<{ n: number }>(EDITOR, `select public.send_clip_to_social($1, '{tiktok,instagram}') as n`, [id]))
  assert.equal(made.n, 2)
  const posts = await t.admin<{ platform: string; caption: string; status: string; media_asset_id: string; hashtags: string[] }>(
    'select platform, caption, status, media_asset_id, hashtags from public.social_posts where clip_id = $1 order by platform', [id])
  assert.deepEqual(posts.map((p) => [p.platform, p.caption, p.status]), [['instagram', 'An IG caption', 'pending_approval'], ['tiktok', 'A tiktok caption', 'pending_approval']])
  assert.equal(posts[0].media_asset_id, final)
  assert.deepEqual(posts[0].hashtags, ['Family', 'Hope'])
  // Sending again doesn't make duplicates.
  assert.equal((await one(t.as<{ n: number }>(OWNER, `select public.send_clip_to_social($1, '{tiktok,instagram}') as n`, [id]))).n, 0)
})

test('editing an approved clip’s video clears the approval and the stale renders', async () => {
  const { id } = await clip()
  const { id: final } = await one(t.admin<{ id: string }>(`insert into public.media_assets (path, kind, status) values (gen_random_uuid() || '/f.mp4', 'clip_final', 'ready') returning id`))
  await t.as('service', `update public.video_clips set final_asset_id = $2, status = 'rendered' where id = $1`, [id, final])
  await t.as(OWNER, 'select public.approve_clip($1)', [id])
  await t.as(EDITOR, 'update public.video_clips set end_s = 45 where id = $1', [id])
  const [row] = await t.admin('select status, approved_by, final_asset_id from public.video_clips where id = $1', [id])
  assert.deepEqual(row, { status: 'editing', approved_by: null, final_asset_id: null })
})

test('only owners mark a video ready to publish', async () => {
  const { id } = await one(t.as<{ id: string }>(EDITOR, `insert into public.video_projects (title) values ('Episode 12') returning id`))
  await t.as(EDITOR, `update public.video_projects set status = 'awaiting_approval' where id = $1`, [id])
  assert.equal((await t.admin(`select 1 from public.notifications where kind = 'video.pending' and link like '%' || $1`, [id])).length, 1)
  await assert.rejects(t.as(EDITOR, `update public.video_projects set status = 'ready' where id = $1`, [id]), /Only an owner/)
  await t.as(OWNER, `update public.video_projects set status = 'ready' where id = $1`, [id])
  const [row] = await t.admin('select status, approved_by from public.video_projects where id = $1', [id])
  assert.deepEqual(row, { status: 'ready', approved_by: OWNER })
})

test('approving a story creates one interview project, without copying contact details', async () => {
  const [{ id }] = await t.admin<{ id: string }>(`insert into public.story_submissions (reference, fingerprint, full_name, email, phone, story_title) values ('NM-261028-BBBB', 'f2', 'Sipho Dlamini', 'sipho@example.com', '+27821234567', 'Rebuilding after loss') returning id`)
  await t.as(OWNER, `update public.story_submissions set status = 'approved' where id = $1`, [id])
  await t.as(OWNER, `update public.story_submissions set status = 'contacted' where id = $1`, [id])
  await t.as(OWNER, `update public.story_submissions set status = 'approved' where id = $1`, [id])
  const projects = await t.admin<{ title: string; guest_name: string; summary: string; notes: string }>('select title, guest_name, summary, notes from public.video_projects where story_id = $1', [id])
  assert.equal(projects.length, 1)
  assert.equal(projects[0].title, 'Rebuilding after loss')
  assert.equal(projects[0].guest_name, 'Sipho Dlamini')
  assert.doesNotMatch(JSON.stringify(projects[0]), /sipho@example.com|\+2782/)
  const [story] = await t.admin<{ interview_project_id: string; contacted_at: string | null }>('select interview_project_id, contacted_at from public.story_submissions where id = $1', [id])
  assert.ok(story.interview_project_id && story.contacted_at)
})

// ---------------------------------------------------------------------------
// Jobs, costs and notifications
// ---------------------------------------------------------------------------

test('the same work can’t be queued twice, but can be redone after it fails', async () => {
  await t.admin(`insert into public.jobs (kind, idempotency_key) values ('transcribe', 'transcribe:asset-1')`)
  await assert.rejects(t.admin(`insert into public.jobs (kind, idempotency_key) values ('transcribe', 'transcribe:asset-1')`), /duplicate key/)
  await t.admin(`update public.jobs set status = 'failed' where idempotency_key = 'transcribe:asset-1'`)
  await t.admin(`insert into public.jobs (kind, idempotency_key) values ('transcribe', 'transcribe:asset-1')`)
})

test('workers claim each queued job once; dashboard accounts can’t claim jobs', async () => {
  await t.admin(`insert into public.jobs (kind, idempotency_key) values ('render', 'render:claim-test')`)
  const first = await t.as<{ id: string; status: string }>('service', `select id, status from public.claim_job('{render}', 'worker-a')`)
  assert.equal(first.length, 1)
  assert.equal(first[0].status, 'running')
  assert.equal((await t.as('service', `select id from public.claim_job('{render}', 'worker-b')`)).length, 0)
  await assert.rejects(t.as(OWNER, `select public.claim_job('{render}', 'sneaky')`), /permission denied/)
})

test('jobs whose worker went quiet are retried, then failed', async () => {
  const [{ id }] = await t.admin<{ id: string }>(`insert into public.jobs (kind, status, attempts, max_attempts, heartbeat_at) values ('analyze', 'running', 2, 2, now() - interval '1 hour') returning id`)
  await t.as('service', `select * from public.claim_job('{analyze}', 'w')`)
  const [row] = await t.admin<{ status: string }>('select status from public.jobs where id = $1', [id])
  assert.equal(row.status, 'failed')
})

test('only an owner or whoever started a job can cancel it', async () => {
  const [{ id }] = await t.admin<{ id: string }>(`insert into public.jobs (kind, requested_by) values ('render', $1) returning id`, [EDITOR])
  await assert.rejects(t.as(MANAGER, 'select public.cancel_job($1)', [id]), /Only an owner/)
  await t.as(EDITOR, 'select public.cancel_job($1)', [id])
  await assert.rejects(t.as(OWNER, 'select public.cancel_job($1)', [id]), /already finished/)
})

test('notifications with the same key are created once', async () => {
  await t.as('service', `select public.notify('job.failed', 'Render failed', '/admin/shorts', 'owner', 'job.failed:123')`)
  await t.as('service', `select public.notify('job.failed', 'Render failed', '/admin/shorts', 'owner', 'job.failed:123')`)
  assert.equal((await t.admin(`select 1 from public.notifications where dedupe_key = 'job.failed:123'`)).length, 1)
  await assert.rejects(t.as(OWNER, `select public.notify('x', 'spoof', '/admin', 'staff', null)`), /permission denied/)
})

test('people manage only their own notification preferences', async () => {
  await t.as(EDITOR, `insert into public.notification_preferences (muted_kinds) values ('{post.pending}')`)
  assert.equal((await t.as(OWNER, 'select * from public.notification_preferences')).length, 0)
  await assert.rejects(t.as(EDITOR, `insert into public.notification_preferences (user_id) values ($1)`, [OWNER]), /permission denied/)
})

test('spending this month is visible to the team against the budget', async () => {
  await t.admin(`insert into public.ai_usage (feature, category, cost_usd) values ('captions', 'ai', 0.25), ('render', 'video', 1.5)`)
  const rows = await t.as<{ category: string; cost_usd: string; budget_usd: string }>(VIEWER, 'select category, cost_usd, budget_usd from public.usage_this_month() order by category')
  assert.deepEqual(rows.map((r) => [r.category, Number(r.cost_usd)]), [['ai', 0.25], ['video', 1.5]])
  assert.equal((await t.as(VIEWER, 'select * from public.ai_usage')).length, 0)
})

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

test('the calendar combines every section and respects each section’s permissions', async () => {
  const id = await approvedPost('On the calendar')
  await t.as(OWNER, `select public.schedule_post($1, now() + interval '2 days', 'UTC')`, [id])
  await t.as(EDITOR, `insert into public.video_projects (title, recording_at) values ('Recording day', now() + interval '3 days')`)
  const items = await t.as<{ item_type: string }>(VIEWER, 'select item_type from public.content_calendar')
  const types = new Set(items.map((i) => i.item_type))
  for (const type of ['post', 'recording', 'article', 'event']) assert.ok(types.has(type), type)
  assert.equal((await t.as(NOBODY, 'select * from public.content_calendar')).length, 0)
})

test('moving a post on the calendar is an owner’s call; writers can move recordings', async () => {
  const id = await approvedPost('Move me')
  await t.as(OWNER, `select public.schedule_post($1, now() + interval '2 days', 'UTC')`, [id])
  await assert.rejects(t.as(EDITOR, `select public.reschedule_item('post', $1, now() + interval '3 days')`, [id]), /Only an owner/)
  await t.as(OWNER, `select public.reschedule_item('post', $1, now() + interval '3 days')`, [id])
  const { id: project } = await one(t.as<{ id: string }>(EDITOR, `insert into public.video_projects (title, recording_at) values ('Move recording', now() + interval '1 day') returning id`))
  await t.as(EDITOR, `select public.reschedule_item('recording', $1, now() + interval '5 days')`, [project])
  await assert.rejects(t.as(VIEWER, `select public.reschedule_item('recording', $1, now() + interval '6 days')`, [project]), /Not allowed/)
})
