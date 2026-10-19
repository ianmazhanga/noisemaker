/**
 * Netlify Database storage for the /inbox page (table: story_submissions).
 * netlify/functions/submission-created.ts adds each verified submission; netlify/functions/inbox.ts reads and deletes them.
 * The schema lives in netlify/database/migrations, which Netlify applies on deploy.
 */
import { getDatabase } from '@netlify/database'
import { toEntry, type InboxEntry } from '../src/lib/inbox.ts'

export interface InboxStore {
  add(entry: InboxEntry): Promise<void>
  list(): Promise<InboxEntry[]>
  remove(id: string): Promise<void>
}

/** 1,000 submissions. The privacy policy deletes old ones, so this is far more than the inbox should hold. */
const MAX_ENTRIES = 1000

export const databaseStore: InboxStore = {
  async add(entry) {
    await getDatabase().sql`
      INSERT INTO story_submissions (id, received_at, fields)
      VALUES (${entry.id}, ${entry.receivedAt}, ${JSON.stringify(entry.fields)}::jsonb)
      ON CONFLICT (id) DO NOTHING`
  },
  async list() {
    const rows = (await getDatabase().sql`
      SELECT id, received_at, fields FROM story_submissions ORDER BY received_at DESC LIMIT ${MAX_ENTRIES}`) as { id: string; received_at: Date | string; fields: unknown }[]
    return rows.flatMap((row) => toEntry({ id: row.id, created_at: new Date(row.received_at).toISOString(), data: row.fields }) ?? [])
  },
  async remove(id) {
    await getDatabase().sql`DELETE FROM story_submissions WHERE id = ${id}`
  },
}
