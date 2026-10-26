/**
 * POST /api/stories  { "form": StoryForm, "reference": "NM-…", "honeypot": "" }
 *
 * Saves a "Tell your story" submission to the database (Supabase), where the Story Inbox
 * at /admin/stories reads it. This is the only place submissions are stored.
 *
 * Vercel environment variables (Project → Settings → Environment Variables):
 *   SUPABASE_URL         https://<project>.supabase.co
 *   SUPABASE_SECRET_KEY  the project's secret (or legacy service_role) key. Never put it in a VITE_ variable.
 * Without them the function answers 503 and the form tells the person to try again later.
 */
import { fingerprint, parseStoryForm, REFERENCE_PATTERN, toSubmission, validate } from '../src/lib/storyForm.ts'

const MAX_BODY = 32_000
/** The same story from the same email within this window is treated as a repeat, not a new submission. */
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000
/**
 * Flood guard: more submissions than this in ten minutes, from anyone, is almost certainly
 * a bot, so further ones are turned away until things calm down.
 */
const MAX_PER_TEN_MINUTES = 20

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** Supabase's REST API, called with the secret key. Legacy keys are JWTs and also go in Authorization. */
function rest(url: string, key: string) {
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' }
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`
  return (path: string, init: RequestInit = {}) =>
    fetch(`${url.replace(/\/+$/, '')}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(8000) })
}

export async function POST(req: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SECRET_KEY ?? ''
  if (!url.startsWith('https://') || !key) return json({ error: 'not-configured' }, 503)

  const text = await req.text().catch(() => '')
  if (!text || text.length > MAX_BODY) return json({ error: 'invalid' }, 400)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'invalid' }, 400)
  }

  // Bots fill in the hidden field. Answer as if it worked, and save nothing.
  if (typeof body.honeypot === 'string' && body.honeypot.trim()) return json({ ok: true })

  const form = parseStoryForm(body.form)
  const reference = typeof body.reference === 'string' ? body.reference : ''
  if (!form || !REFERENCE_PATTERN.test(reference) || Object.keys(validate(form)).length) return json({ error: 'invalid' }, 400)

  const api = rest(url, key)
  const print = fingerprint(form)
  try {
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString()
    const recent = await api(`story_submissions?select=reference&fingerprint=eq.${encodeURIComponent(print)}&received_at=gte.${encodeURIComponent(since)}&limit=1`)
    if (!recent.ok) throw new Error(`Supabase ${recent.status} checking for repeats`)
    const [existing] = (await recent.json()) as { reference: string }[]
    if (existing) return json({ ok: true, duplicate: true, reference: existing.reference })

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const busy = await api(`story_submissions?select=id&received_at=gte.${encodeURIComponent(tenMinutesAgo)}`, { method: 'HEAD', headers: { Prefer: 'count=exact' } })
    const count = Number(busy.headers.get('content-range')?.split('/')[1] ?? 0)
    if (count >= MAX_PER_TEN_MINUTES) return json({ error: 'busy' }, 429)

    const res = await api('story_submissions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ...toSubmission(form, reference), fingerprint: print }),
    })
    // 409: this reference is already saved, e.g. the browser retried.
    if (!res.ok && res.status !== 409) throw new Error(`Supabase ${res.status} saving a submission`)
    return json({ ok: true, reference })
  } catch (error) {
    // Never log the submission itself: it holds personal details.
    console.error(error instanceof Error ? error.message : 'Saving the submission failed')
    return json({ error: 'unavailable' }, 502)
  }
}
