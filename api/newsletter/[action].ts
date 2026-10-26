/**
 * Public newsletter endpoints.
 *
 *   POST /api/newsletter/subscribe     { "email": "...", "consent": true, "honeypot": "" }
 *   GET|POST /api/newsletter/unsubscribe?token=...
 *
 * Sign-ups are double opt-in: people are "pending" until they click the confirmation link
 * that Mailchimp emails them. Without Mailchimp connected, sign-ups are kept as pending
 * (with their consent record) and confirmation emails go out once it is connected.
 * The answer is the same whether or not an address was already on the list, so the form
 * can't be used to find out who subscribes. Subscriber details are never sent to the browser.
 */
import { CONSENT_TEXT, EMAIL_PATTERN } from '../../src/lib/newsletter.ts'
import { addPending, mailchimpConfigured, unsubscribe as mailchimpUnsubscribe } from '../_lib/mailchimp.ts'
import { failure, HttpError, json, readBody, rest, routeName, siteUrl } from '../_lib/server.ts'

/** More sign-ups than this in ten minutes, from anyone, is almost certainly a bot. */
const MAX_PER_TEN_MINUTES = 30

interface Subscriber {
  id: string
  status: string
}

async function subscribe(req: Request): Promise<Response> {
  const body = await readBody(req, 4000)
  // Bots fill in the hidden field: answer as if it worked, and save nothing.
  if (typeof body.honeypot === 'string' && body.honeypot.trim()) return json({ ok: true, confirmation: 'email' })
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!EMAIL_PATTERN.test(email) || email.length > 254 || body.consent !== true) throw new HttpError(400, 'invalid')
  const key = email.toLowerCase()

  const since = new Date(Date.now() - 10 * 60_000).toISOString()
  const recent = await rest<unknown[]>(`newsletter_subscribers?select=id&created_at=gte.${encodeURIComponent(since)}&limit=${MAX_PER_TEN_MINUTES}`)
  if (recent.length >= MAX_PER_TEN_MINUTES) throw new HttpError(429, 'busy')

  const now = new Date().toISOString()
  const [existing] = await rest<Subscriber[]>(`newsletter_subscribers?select=id,status&email_key=eq.${encodeURIComponent(key)}`)
  if (!existing) {
    await rest('newsletter_subscribers?on_conflict=email_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ email, email_key: key, status: 'pending', consent_text: CONSENT_TEXT, consented_at: now, source: 'website' }),
    })
  } else if (existing.status === 'unsubscribed' || existing.status === 'cleaned') {
    // Subscribing again is a new consent.
    await rest(`newsletter_subscribers?id=eq.${existing.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'pending', consent_text: CONSENT_TEXT, consented_at: now, unsubscribed_at: null, provider_synced_at: null }) })
  }

  let confirmation: 'email' | 'later' = 'later'
  if (mailchimpConfigured() && existing?.status !== 'subscribed') {
    try {
      const m = await addPending(email)
      const patch: Record<string, unknown> = { provider_synced_at: new Date().toISOString() }
      if (m.status === 'subscribed') Object.assign(patch, { status: 'subscribed', confirmed_at: new Date().toISOString() })
      await rest(`newsletter_subscribers?email_key=eq.${encodeURIComponent(key)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) })
      confirmation = 'email'
    } catch (error) {
      // Saved locally; the hourly sync tries Mailchimp again.
      console.error(`newsletter subscribe: ${error instanceof Error ? error.message : 'Mailchimp failed'}`)
    }
  } else if (existing?.status === 'subscribed') confirmation = 'email'
  return json({ ok: true, confirmation })
}

async function unsubscribe(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const token = url.searchParams.get('token') ?? ''
  const done = (ok: boolean) =>
    req.method === 'GET' ? new Response(null, { status: 303, headers: { Location: `${siteUrl(req)}/newsletter?unsubscribed=${ok ? '1' : '0'}`, 'Cache-Control': 'no-store' } }) : json({ ok }, ok ? 200 : 400)
  if (!/^[0-9a-f]{64}$/.test(token)) return done(false)
  const [sub] = await rest<{ id: string; email: string }[]>(`newsletter_subscribers?select=id,email&unsubscribe_token=eq.${token}`)
  if (!sub) return done(false)
  await rest(`newsletter_subscribers?id=eq.${sub.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() }) })
  if (mailchimpConfigured()) await mailchimpUnsubscribe(sub.email).catch((error: Error) => console.error(`newsletter unsubscribe: ${error.message}`))
  return done(true)
}

async function handle(req: Request): Promise<Response> {
  try {
    const action = routeName(req)
    if (action === 'subscribe' && req.method === 'POST') return await subscribe(req)
    if (action === 'unsubscribe') return await unsubscribe(req)
    return json({ error: 'not-found' }, 404)
  } catch (error) {
    return failure(error, 'newsletter')
  }
}

export const GET = handle
export const POST = handle
