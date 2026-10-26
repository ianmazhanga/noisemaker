/** The newsroom migration can be run again on a database that already has it, without errors or lost rows. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { migratedDb } from './lib/pg.ts'

test('the newsroom migration is safe to run twice', async () => {
  const { db, admin } = await migratedDb()
  await admin(`insert into public.news_sources (name, feed_url) values ('Example', 'https://example.com/feed')`)
  const dir = new URL('../supabase/migrations/', import.meta.url)
  const newsroom = readdirSync(dir).filter((f) => f.endsWith('_newsroom.sql'))
  assert.equal(newsroom.length, 1)
  await db.exec(readFileSync(new URL(newsroom[0], dir), 'utf8'))
  assert.equal((await admin('select 1 from public.news_sources')).length, 1)
  assert.equal((await admin('select 1 from public.app_settings')).length, 1)
})
