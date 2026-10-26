/**
 * Runs the real migration on PGlite (Postgres compiled to WebAssembly) with a small
 * stand-in for Supabase's auth schema and roles, then checks the security rules
 * by acting as the public, a new account, a content manager and the owner.
 */
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()

const OWNER = '00000000-0000-4000-8000-000000000001'
const MANAGER = '00000000-0000-4000-8000-000000000002'
const NEWCOMER = '00000000-0000-4000-8000-000000000003'

// What Supabase provides before any migration runs.
const SUPABASE_STANDIN = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`

/** Runs SQL as a Supabase caller: the public key (no user) or a signed-in user. */
async function as<T = Record<string, unknown>>(who: 'anon' | string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${who === 'anon' ? '' : who}', false);`)
  await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}`)
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

const admin = (sql: string, params: unknown[] = []) => db.query(sql, params)

async function addStory(reference: string, title = 'A story') {
  const { rows } = await admin(
    `insert into public.story_submissions (reference, fingerprint, request_type, full_name, email, phone, preferred_contact, story_title, story_summary)
     values ($1, 'fp', 'Submit my story', 'Test Person', 'p@example.com', '+27821234567', 'WhatsApp', $2, 'Summary') returning id`,
    [reference, title],
  )
  return (rows[0] as { id: string }).id
}

before(async () => {
  await db.exec(SUPABASE_STANDIN)
  const dir = new URL('../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(file, dir), 'utf8'))
  await admin(`insert into auth.users (id, email) values ($1, 'owner@example.com'), ($2, 'manager@example.com'), ($3, 'new@example.com')`, [OWNER, MANAGER, NEWCOMER])
  await admin(`update public.profiles set role = 'owner' where id = $1`, [OWNER])
  await admin(`update public.profiles set role = 'content_manager' where id = $1`, [MANAGER])
})

test('new accounts get a profile with no access', async () => {
  const rows = await admin(`select role, can_view_stories from public.profiles where id = $1`, [NEWCOMER])
  assert.deepEqual(rows.rows[0], { role: null, can_view_stories: false })
})

test('the public key can neither read nor write submissions', async () => {
  await addStory('NM-261026-AAAA')
  await assert.rejects(as('anon', 'select * from public.story_submissions'), /permission denied/)
  await assert.rejects(as('anon', `insert into public.story_submissions (reference, fingerprint) values ('NM-261026-ZZZZ', 'x')`), /permission denied/)
  await assert.rejects(as('anon', 'select * from public.profiles'), /permission denied/)
})

test('an account without a role sees nothing', async () => {
  assert.equal((await as(NEWCOMER, 'select * from public.story_submissions')).length, 0)
  assert.equal((await as(NEWCOMER, 'select * from public.notifications')).length, 0)
  assert.equal((await as(NEWCOMER, `update public.story_submissions set status = 'approved' returning id`)).length, 0)
})

test('content managers see stories only once the owner allows it', async () => {
  assert.equal((await as(MANAGER, 'select * from public.story_submissions')).length, 0)
  await as(OWNER, 'select public.set_member_access($1, $2, true)', [MANAGER, 'content_manager'])
  assert.ok((await as(MANAGER, 'select * from public.story_submissions')).length > 0)
  await as(OWNER, 'select public.set_member_access($1, $2, false)', [MANAGER, 'content_manager'])
  assert.equal((await as(MANAGER, 'select * from public.story_submissions')).length, 0)
})

test('status changes are recorded with who made them; other fields are locked', async () => {
  const id = await addStory('NM-261026-BBBB')
  const [row] = await as<{ status: string; status_changed_by: string }>(OWNER, `update public.story_submissions set status = 'contacted' where id = $1 returning status, status_changed_by`, [id])
  assert.deepEqual(row, { status: 'contacted', status_changed_by: OWNER })
  const log = await admin(`select actor_id, action, details from public.audit_logs where target = 'NM-261026-BBBB'`)
  assert.deepEqual(log.rows[0], { actor_id: OWNER, action: 'story.status', details: { from: 'new', to: 'contacted' } })
  await assert.rejects(as(OWNER, `update public.story_submissions set email = 'x@example.com' where id = $1`, [id]), /permission denied/)
})

test('only the owner can delete a submission', async () => {
  const id = await addStory('NM-261026-CCCC')
  await as(OWNER, 'select public.set_member_access($1, $2, true)', [MANAGER, 'content_manager'])
  assert.equal((await as(MANAGER, 'delete from public.story_submissions where id = $1 returning id', [id])).length, 0)
  assert.equal((await as(OWNER, 'delete from public.story_submissions where id = $1 returning id', [id])).length, 1)
})

test('nobody can raise their own access', async () => {
  await assert.rejects(as(MANAGER, `update public.profiles set role = 'owner' where id = $1`, [MANAGER]), /permission denied/)
  await assert.rejects(as(MANAGER, 'select public.set_member_access($1, $2, true)', [MANAGER, 'owner']), /Only the owner/)
  await assert.rejects(as(NEWCOMER, 'select public.set_member_access($1, $2, true)', [NEWCOMER, 'owner']), /Only the owner/)
  await assert.rejects(as(OWNER, 'select public.set_member_access($1, $2, false)', [OWNER, 'content_manager']), /your own owner access/)
  // People can still change their own name.
  assert.equal((await as(MANAGER, `update public.profiles set full_name = 'Sam' where id = $1 returning id`, [MANAGER])).length, 1)
  // And only the owner sees everyone's profile.
  assert.equal((await as(MANAGER, 'select id from public.profiles')).length, 1)
  assert.equal((await as(OWNER, 'select id from public.profiles')).length, 3)
})

test('a new story notifies everyone who can read stories, and only them', async () => {
  await as(OWNER, 'select public.set_member_access($1, $2, false)', [MANAGER, 'content_manager'])
  const id = await addStory('NM-261026-DDDD', 'Leaving home at sixteen')
  const [note] = await as<{ id: string; title: string; link: string }>(OWNER, `select id, title, link from public.notifications where link like '%' || $1`, [id])
  assert.equal(note.title, 'New story: Leaving home at sixteen')
  assert.equal(note.link, `/admin/stories?open=${id}`)
  assert.equal((await as(MANAGER, 'select * from public.notifications where id = $1', [note.id])).length, 0)
  await assert.rejects(as(MANAGER, 'insert into public.notification_reads (notification_id) values ($1)', [note.id]), /row-level security/)
  await as(OWNER, 'insert into public.notification_reads (notification_id) values ($1)', [note.id])
  assert.equal((await as(OWNER, 'select * from public.notification_reads')).length, 1)
})

test('notes belong to their author and to story readers', async () => {
  const id = await addStory('NM-261026-EEEE')
  await as(OWNER, 'insert into public.story_notes (submission_id, body) values ($1, $2)', [id, 'Called, will follow up Friday'])
  await assert.rejects(as(OWNER, 'insert into public.story_notes (submission_id, author_id, body) values ($1, $2, $3)', [id, MANAGER, 'spoofed']), /permission denied/)
  await assert.rejects(as(NEWCOMER, 'insert into public.story_notes (submission_id, body) values ($1, $2)', [id, 'x']), /row-level security/)
  assert.equal((await as(NEWCOMER, 'select * from public.story_notes')).length, 0)
  await assert.rejects(as(OWNER, 'insert into public.story_notes (submission_id, body) values ($1, $2)', [id, '   ']), /check constraint/)
})

test('only the owner reads the audit log', async () => {
  assert.ok((await as(OWNER, 'select * from public.audit_logs')).length > 0)
  assert.equal((await as(MANAGER, 'select * from public.audit_logs')).length, 0)
})

// ---------------------------------------------------------------------------
// Social Media Manager
// ---------------------------------------------------------------------------

async function draft(who: string, caption = 'Watch the new conversation') {
  const [row] = await as<{ id: string }>(who, `insert into public.social_posts (platform, caption, hashtags) values ('instagram', $1, '{noisemakers}') returning id`, [caption])
  return row.id
}
const statusOf = async (id: string) => ((await admin('select status, approved_by from public.social_posts where id = $1', [id])).rows[0] as { status: string; approved_by: string | null })

test('the public and accounts without a role get nothing from the social tables', async () => {
  await assert.rejects(as('anon', 'select * from public.social_posts'), /permission denied/)
  await assert.rejects(as('anon', 'select * from public.social_accounts'), /permission denied/)
  assert.equal((await as(NEWCOMER, 'select * from public.social_accounts')).length, 0)
  await assert.rejects(draft(NEWCOMER), /row-level security/)
})

test('content managers draft and submit posts, but only owners approve', async () => {
  const id = await draft(MANAGER)
  await as(MANAGER, 'select public.submit_post($1)', [id])
  assert.equal((await statusOf(id)).status, 'pending_approval')
  await assert.rejects(as(MANAGER, 'select public.approve_post($1)', [id]), /Only an owner/)
  await assert.rejects(as(MANAGER, `update public.social_posts set status = 'approved' where id = $1`, [id]), /permission denied/)
  await as(OWNER, 'select public.approve_post($1)', [id])
  assert.deepEqual(await statusOf(id), { status: 'approved', approved_by: OWNER })
  const [note] = (await admin(`select title, audience from public.notifications where kind = 'post.pending' and link like '%' || $1`, [id])).rows as { title: string; audience: string }[]
  assert.deepEqual(note, { title: 'Post awaiting approval: Instagram', audience: 'owner' })
})

test('new posts always start as drafts, whatever the request says', async () => {
  await assert.rejects(as(OWNER, `insert into public.social_posts (platform, caption, status) values ('x', 'Hi', 'published')`), /permission denied/)
})

test('nothing is scheduled or published without an owner’s approval', async () => {
  const id = await draft(OWNER)
  await assert.rejects(as(OWNER, `select public.schedule_post($1, now() + interval '1 day', 'Africa/Johannesburg')`, [id]), /Approve the post/)
  await assert.rejects(as(OWNER, `select public.mark_post_published($1, '')`, [id]), /Only approved posts/)
  // Even the secret key (which skips Row Level Security) can't publish an unapproved post.
  await assert.rejects(admin(`update public.social_posts set status = 'published' where id = $1`, [id]), /must be approved/)
  await as(OWNER, 'select public.approve_post($1)', [id])
  await as(OWNER, `select public.schedule_post($1, now() + interval '1 day', 'America/New_York')`, [id])
  const row = (await admin('select status, timezone from public.social_posts where id = $1', [id])).rows[0]
  assert.deepEqual(row, { status: 'scheduled', timezone: 'America/New_York' })
  await assert.rejects(as(OWNER, `select public.schedule_post($1, now() + interval '1 day', 'Mars/Olympus')`, [id]), /Unknown time zone/)
  await assert.rejects(as(OWNER, `select public.schedule_post($1, now() - interval '1 day', 'UTC')`, [id]), /in the future/)
  await assert.rejects(as(MANAGER, `select public.schedule_post($1, now() + interval '2 days', 'UTC')`, [id]), /Only an owner/)
})

test('editing an approved post sends it back for approval', async () => {
  const id = await draft(OWNER)
  await as(OWNER, 'select public.approve_post($1)', [id])
  await as(OWNER, `select public.schedule_post($1, now() + interval '1 day', 'UTC')`, [id])
  await as(MANAGER, `update public.social_posts set caption = 'Changed wording' where id = $1`, [id])
  const row = (await admin('select status, approved_by, scheduled_at from public.social_posts where id = $1', [id])).rows[0]
  assert.deepEqual(row, { status: 'pending_approval', approved_by: null, scheduled_at: null })
})

test('rejections record who and why; published posts are locked', async () => {
  const id = await draft(MANAGER)
  await as(MANAGER, 'select public.submit_post($1)', [id])
  await as(OWNER, `select public.reject_post($1, 'Wrong guest name')`, [id])
  const row = (await admin('select status, rejected_by, rejection_reason from public.social_posts where id = $1', [id])).rows[0]
  assert.deepEqual(row, { status: 'rejected', rejected_by: OWNER, rejection_reason: 'Wrong guest name' })

  const done = await draft(OWNER)
  await as(OWNER, 'select public.approve_post($1)', [done])
  await as(OWNER, `select public.mark_post_published($1, 'https://www.instagram.com/p/abc')`, [done])
  assert.equal((await statusOf(done)).status, 'published')
  assert.equal((await as(OWNER, `update public.social_posts set caption = 'x' where id = $1 returning id`, [done])).length, 0)
  assert.equal((await as(OWNER, 'delete from public.social_posts where id = $1 returning id', [done])).length, 0)
  const actions = (await admin(`select action from public.audit_logs where target = $1 order by at`, [done])).rows.map((r) => (r as { action: string }).action)
  assert.deepEqual(actions, ['post.approved', 'post.published'])
})

test('authors delete their own drafts; only owners delete others', async () => {
  const mine = await draft(MANAGER)
  const theirs = await draft(OWNER)
  assert.equal((await as(MANAGER, 'delete from public.social_posts where id = $1 returning id', [theirs])).length, 0)
  assert.equal((await as(MANAGER, 'delete from public.social_posts where id = $1 returning id', [mine])).length, 1)
  assert.equal((await as(OWNER, 'delete from public.social_posts where id = $1 returning id', [theirs])).length, 1)
})

test('account connections: owners edit profile links, nobody sets the connection by hand', async () => {
  assert.equal((await as(MANAGER, 'select * from public.social_accounts')).length, 5)
  assert.equal((await as(MANAGER, `update public.social_accounts set display_name = 'x' returning platform`)).length, 0)
  assert.equal((await as(OWNER, `update public.social_accounts set profile_url = 'https://www.instagram.com/noisemakers' where platform = 'instagram' returning platform`)).length, 1)
  await assert.rejects(as(OWNER, `update public.social_accounts set provider = 'buffer' where platform = 'instagram'`), /permission denied/)
})
