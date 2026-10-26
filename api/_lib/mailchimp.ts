/**
 * Mailchimp (Marketing API v3) for the newsletter: adding subscribers with Mailchimp's own
 * double opt-in confirmation email, unsubscribes, campaigns, test emails, sending, and reports.
 *
 * Environment variables:
 *   MAILCHIMP_API_KEY       e.g. abc123…-us21 (the part after the dash is the data centre)
 *   MAILCHIMP_AUDIENCE_ID   Audience → Settings → Audience name and defaults → Audience ID
 *   MAILCHIMP_FROM_EMAIL    a verified sender address on your domain
 */
import { createHash } from 'node:crypto'
import { renderEmail, renderText, type Campaign } from '../../src/lib/newsletter.ts'
import { HttpError } from './server.ts'

type F = typeof fetch

export const mailchimpConfigured = () => Boolean(process.env.MAILCHIMP_API_KEY && process.env.MAILCHIMP_AUDIENCE_ID)

function config() {
  const key = process.env.MAILCHIMP_API_KEY ?? ''
  const audience = process.env.MAILCHIMP_AUDIENCE_ID ?? ''
  const dc = key.split('-')[1]
  if (!key || !audience || !dc || !/^[a-z]+\d+$/.test(dc)) throw new HttpError(503, 'mailchimp-not-configured')
  return { key, audience, base: `https://${dc}.api.mailchimp.com/3.0` }
}

export async function mc<T = Record<string, unknown>>(path: string, init: RequestInit = {}, f: F = fetch, allow: number[] = []): Promise<T> {
  const { key, base } = config()
  const res = await f(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${Buffer.from(`noisemakers:${key}`).toString('base64')}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 204) return {} as T
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok && !allow.includes(res.status)) throw new Error(`Mailchimp ${res.status}${body.detail ? `: ${String(body.detail).slice(0, 200)}` : ''}`)
  return body as T
}

const memberHash = (email: string) => createHash('md5').update(email.trim().toLowerCase()).digest('hex')

/**
 * Adds someone as "pending": Mailchimp emails them a confirmation link, and they're only
 * subscribed once they click it. Existing subscribers keep their status. The consent record
 * (what they agreed to, and when) is kept in newsletter_subscribers.
 */
export async function addPending(email: string, f: F = fetch) {
  const { audience } = config()
  return mc<{ status?: string }>(
    `/lists/${audience}/members/${memberHash(email)}`,
    { method: 'PUT', body: JSON.stringify({ email_address: email, status_if_new: 'pending', tags: ['website'] }) },
    f,
  )
}

export async function unsubscribe(email: string, f: F = fetch) {
  const { audience } = config()
  await mc(`/lists/${audience}/members/${memberHash(email)}`, { method: 'PATCH', body: JSON.stringify({ status: 'unsubscribed' }) }, f, [404])
}

/** Current status in Mailchimp: subscribed, pending, unsubscribed, cleaned, or null if unknown. */
export async function memberStatus(email: string, f: F = fetch): Promise<string | null> {
  const { audience } = config()
  const m = await mc<{ status?: string }>(`/lists/${audience}/members/${memberHash(email)}?fields=status`, {}, f, [404])
  return m.status ?? null
}

/** Creates or updates the Mailchimp campaign for a newsletter and sets its content. Returns its ID. */
export async function upsertCampaign(c: Campaign & { providerId: string; fromName: string; replyTo: string }, siteUrl: string, f: F = fetch): Promise<string> {
  const { audience } = config()
  const replyTo = c.replyTo || process.env.MAILCHIMP_FROM_EMAIL || ''
  if (!replyTo) throw new HttpError(503, 'mailchimp-sender-missing')
  const settings = { subject_line: c.subject, preview_text: c.preheader, title: `Noisemakers: ${c.subject}`.slice(0, 100), from_name: c.fromName, reply_to: replyTo }
  let id = c.providerId
  if (id) await mc(`/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify({ settings }) }, f)
  else id = String((await mc<{ id: string }>('/campaigns', { method: 'POST', body: JSON.stringify({ type: 'regular', recipients: { list_id: audience }, settings }) }, f)).id)
  await mc(`/campaigns/${id}/content`, { method: 'PUT', body: JSON.stringify({ html: renderEmail(c, { siteUrl, unsubscribe: '*|UNSUB|*', address: '*|LIST:ADDRESSLINE|*' }), plain_text: renderText(c, { siteUrl, unsubscribe: '*|UNSUB|*' }) }) }, f)
  return id
}

export const sendTest = (id: string, emails: string[], f: F = fetch) => mc(`/campaigns/${id}/actions/test`, { method: 'POST', body: JSON.stringify({ test_emails: emails, send_type: 'html' }) }, f)
export const sendNow = (id: string, f: F = fetch) => mc(`/campaigns/${id}/actions/send`, { method: 'POST' }, f)

export async function report(id: string, f: F = fetch) {
  const r = await mc<{ emails_sent?: number; opens?: { unique_opens?: number; open_rate?: number }; clicks?: { unique_subscriber_clicks?: number; click_rate?: number }; unsubscribed?: number }>(`/reports/${id}`, {}, f, [404])
  if (r.emails_sent === undefined) return null
  return { recipients: r.emails_sent, opens: r.opens?.unique_opens ?? 0, open_rate: r.opens?.open_rate ?? 0, clicks: r.clicks?.unique_subscriber_clicks ?? 0, click_rate: r.clicks?.click_rate ?? 0, unsubscribes: r.unsubscribed ?? 0 }
}

export async function audienceStats(f: F = fetch) {
  const { audience } = config()
  const l = await mc<{ stats?: { member_count?: number; unsubscribe_count?: number; open_rate?: number; click_rate?: number } }>(`/lists/${audience}?fields=stats`, {}, f)
  return l.stats ?? {}
}

export const ping = (f: F = fetch) => mc('/ping', {}, f)
