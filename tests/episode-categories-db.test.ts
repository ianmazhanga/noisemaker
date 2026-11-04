/** Episode category overrides: public to read, only writers change them, every change logged. */
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { migratedDb, type TestDb } from './lib/pg.ts'

const OWNER = '00000000-0000-4000-8000-0000000000c1'
const EDITOR = '00000000-0000-4000-8000-0000000000c2'
const VIEWER = '00000000-0000-4000-8000-0000000000c3'
let t: TestDb

before(async () => {
  t = await migratedDb()
  await t.addUser(OWNER, 'o@example.com', 'owner', true)
  await t.addUser(EDITOR, 'e@example.com', 'editor')
  await t.addUser(VIEWER, 'v@example.com', 'viewer')
})

test('anyone can read categories, so the website can show them', async () => {
  await t.as(EDITOR, `insert into public.episode_categories (youtube_id, topic) values ('GR7LqguR4IA', 'life-stories')`)
  assert.deepEqual(await t.as('anon', 'select youtube_id, topic from public.episode_categories'), [{ youtube_id: 'GR7LqguR4IA', topic: 'life-stories' }])
  await assert.rejects(t.as('anon', 'select updated_by from public.episode_categories'), /permission denied/)
})

test('only owners, editors and content managers change them', async () => {
  await assert.rejects(t.as('anon', `insert into public.episode_categories (youtube_id, topic) values ('5qmm7aPmvCk', 'family')`), /permission denied/)
  await assert.rejects(t.as(VIEWER, `insert into public.episode_categories (youtube_id, topic) values ('5qmm7aPmvCk', 'family')`), /row-level security/)
  assert.equal((await t.as(VIEWER, `update public.episode_categories set topic = 'family' returning youtube_id`)).length, 0)
  await t.as(OWNER, `update public.episode_categories set topic = 'family' where youtube_id = 'GR7LqguR4IA'`)
  const [row] = await t.admin<{ topic: string; updated_by: string }>(`select topic, updated_by from public.episode_categories`)
  assert.deepEqual(row, { topic: 'family', updated_by: OWNER })
  const log = await t.admin<{ details: { topic: string; from: string } }>(`select details from public.audit_logs where action = 'episode.category' order by id`)
  assert.deepEqual(log.map((l) => [l.details.from, l.details.topic]), [[null, 'life-stories'], ['life-stories', 'family']])
  assert.equal((await t.as(EDITOR, `delete from public.episode_categories returning youtube_id`)).length, 1)
})

test('bad IDs and slugs are refused', async () => {
  await assert.rejects(t.as(EDITOR, `insert into public.episode_categories (youtube_id, topic) values ('nope', 'family')`), /check constraint/)
  await assert.rejects(t.as(EDITOR, `insert into public.episode_categories (youtube_id, topic) values ('GR7LqguR4IA', 'Not A Slug!')`), /check constraint/)
})

test('the migration is safe to run again', async () => {
  await t.db.exec(readFileSync(new URL('../supabase/migrations/20261105000000_episode_categories.sql', import.meta.url), 'utf8'))
})
