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
