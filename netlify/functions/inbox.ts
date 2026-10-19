/**
 * POST /api/inbox  { "password": "..." }                     →  the "Tell your story" submissions, newest first.
 * POST /api/inbox  { "password": "...", "deleteId": "..." }  →  deletes one submission from the inbox.
 *
 * Submissions are copied into the site's Netlify Database as they arrive (see submission-created.ts),
 * so the only setting needed is one environment variable in Netlify (Site configuration → Environment variables):
 *   INBOX_PASSWORD  the password for /inbox, at least 12 characters
 */
import { MIN_PASSWORD_LENGTH, passwordMatches, type InboxResponse } from '../../src/lib/inbox.ts'
import { databaseStore, type InboxStore } from '../inboxStore.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export function createInboxHandler(store: InboxStore) {
  return async (req: Request) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    const password = process.env.INBOX_PASSWORD ?? ''
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.error('Inbox is not set up: INBOX_PASSWORD (12+ characters) is required.')
      return json({ error: 'not-configured' }, 503)
    }

    const body: unknown = await req.json().catch(() => null)
    const { password: given, deleteId } = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    if (!(await passwordMatches(given, password))) {
      // Slows down guessing on top of the rate limit below.
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return json({ error: 'wrong-password' }, 401)
    }

    try {
      if (typeof deleteId === 'string' && deleteId) await store.remove(deleteId)
      return json({ entries: await store.list() } satisfies InboxResponse)
    } catch (error) {
      console.error(error)
      return json({ error: 'storage-unavailable' }, 502)
    }
  }
}

export default createInboxHandler(databaseStore)

export const config = {
  path: '/api/inbox',
  // Per visitor IP: at most 10 attempts a minute.
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
