/**
 * POST /api/inbox  { "password": "..." }  →  the "Tell your story" submissions, newest first.
 *
 * Set two environment variables in Netlify (Site configuration → Environment variables):
 *   INBOX_PASSWORD     the password for /inbox, at least 12 characters
 *   NETLIFY_API_TOKEN  a Netlify personal access token (User settings → Applications)
 * The token stays here on the server; the browser only ever sees the submissions.
 */
import { FORM_NAME } from '../../src/lib/storyForm.ts'
import { MIN_PASSWORD_LENGTH, passwordMatches, toEntry, type InboxEntry, type InboxResponse } from '../../src/lib/inbox.ts'

const API = 'https://api.netlify.com/api/v1'
const PER_PAGE = 100
/** 1,000 submissions. The privacy policy deletes old ones, so this is far more than the inbox should hold. */
const MAX_PAGES = 10

interface Context {
  site?: { id?: string }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

async function netlify(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'noisemakers-inbox' }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Netlify API ${res.status} for ${path.split('?')[0]}`)
  return res.json()
}

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const password = process.env.INBOX_PASSWORD ?? ''
  const token = process.env.NETLIFY_API_TOKEN ?? ''
  const siteId = context.site?.id ?? process.env.SITE_ID ?? ''
  if (password.length < MIN_PASSWORD_LENGTH || !token || !siteId) {
    console.error('Inbox is not set up: INBOX_PASSWORD (12+ characters) and NETLIFY_API_TOKEN are required.')
    return json({ error: 'not-configured' }, 503)
  }

  const body: unknown = await req.json().catch(() => null)
  const given = body && typeof body === 'object' ? (body as Record<string, unknown>).password : undefined
  if (!(await passwordMatches(given, password))) {
    // Slows down guessing on top of the rate limit below.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return json({ error: 'wrong-password' }, 401)
  }

  try {
    const forms = await netlify(`/sites/${encodeURIComponent(siteId)}/forms`, token)
    const form = Array.isArray(forms) ? forms.find((f) => f && typeof f === 'object' && f.name === FORM_NAME) : undefined
    if (!form || typeof form.id !== 'string') return json({ entries: [], formFound: false } satisfies InboxResponse)

    const entries: InboxEntry[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await netlify(`/forms/${encodeURIComponent(form.id)}/submissions?per_page=${PER_PAGE}&page=${page}`, token)
      if (!Array.isArray(batch)) break
      for (const raw of batch) {
        const entry = toEntry(raw)
        if (entry) entries.push(entry)
      }
      if (batch.length < PER_PAGE) break
    }
    entries.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    return json({ entries, formFound: true } satisfies InboxResponse)
  } catch (error) {
    console.error(error)
    return json({ error: 'netlify-unavailable' }, 502)
  }
}

export const config = {
  path: '/api/inbox',
  // Per visitor IP: at most 10 attempts a minute.
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
