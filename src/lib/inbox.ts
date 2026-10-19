/**
 * Private submissions inbox (/inbox): shared by the page and netlify/functions/inbox.ts.
 *
 * Netlify Forms keeps the submissions. The function fetches them with a Netlify
 * access token that never reaches the browser, and only after the inbox password
 * matches. Only the form's own fields are passed on: Netlify also records each
 * sender's IP address and browser, which the inbox doesn't need.
 *
 * Imports only storyForm.ts, so tests can run this file directly in Node.
 */
import { FIELD_NAMES } from './storyForm.ts'

export type FieldName = (typeof FIELD_NAMES)[number]

export interface InboxEntry {
  id: string
  receivedAt: string
  fields: Record<FieldName, string>
}

export interface InboxResponse {
  entries: InboxEntry[]
  /** False until Netlify has detected the form, i.e. before the first deploy with form detection on. */
  formFound: boolean
}

/** The page is on the open web, so the function won't run with a shorter INBOX_PASSWORD. */
export const MIN_PASSWORD_LENGTH = 12

/** Keeps the form's fields from a Netlify submission and drops everything else. Null if it isn't one. */
export function toEntry(raw: unknown): InboxEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const { id, created_at: receivedAt, data } = raw as Record<string, unknown>
  if (typeof id !== 'string' || typeof receivedAt !== 'string' || !data || typeof data !== 'object') return null
  const values = data as Record<string, unknown>
  const fields = Object.fromEntries(FIELD_NAMES.map((name) => [name, typeof values[name] === 'string' ? (values[name] as string) : ''])) as Record<FieldName, string>
  return { id, receivedAt, fields }
}

/** Compares in constant time, so response timing doesn't reveal how much of a guess was right. */
export async function passwordMatches(given: unknown, expected: string): Promise<boolean> {
  if (typeof given !== 'string' || !given || given.length > 1024) return false
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [a, b] = await Promise.all([hash(given), hash(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export const isCallRequest = (entry: InboxEntry) => entry.fields.request_type.startsWith('Request an introductory call')

/** Case-insensitive match against the fields the team is likely to search by. */
export function matchesSearch(entry: InboxEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const { reference, full_name, email, phone, story_title, story_summary, topics } = entry.fields
  return [reference, full_name, email, phone, story_title, story_summary, topics].some((v) => v.toLowerCase().includes(q))
}

/** "+263771234567" → "https://wa.me/263771234567". Null unless the number is in international format. */
export function whatsappLink(phone: string): string | null {
  return /^\+\d{8,15}$/.test(phone) ? `https://wa.me/${phone.slice(1)}` : null
}

/** Only web links are clickable, so a submitted "javascript:" link can't run. */
export function safeWebLink(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}
