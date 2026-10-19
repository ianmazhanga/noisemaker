/**
 * Runs for every verified Netlify Forms submission (Netlify calls this function by its name; spam is filtered out first).
 * Saves a copy of each "Tell your story" submission for the /inbox page, keeping only the form's own fields.
 */
import { FORM_NAME } from '../../src/lib/storyForm.ts'
import { toEntry } from '../../src/lib/inbox.ts'
import { databaseStore, type InboxStore } from '../inboxStore.ts'

export function createSubmissionHandler(store: InboxStore) {
  return async (req: Request) => {
    const body: unknown = await req.json().catch(() => null)
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>).payload : undefined
    if (!payload || typeof payload !== 'object') return new Response('Bad request', { status: 400 })

    const { form_name: formName, id, created_at: createdAt } = payload as Record<string, unknown>
    if (formName !== FORM_NAME) return new Response('Ignored')

    const entry = toEntry({ ...payload, id: typeof id === 'string' ? id : crypto.randomUUID(), created_at: typeof createdAt === 'string' ? createdAt : new Date().toISOString() })
    if (!entry) return new Response('Bad request', { status: 400 })
    await store.add(entry)
    return new Response('Saved')
  }
}

export default createSubmissionHandler(databaseStore)
