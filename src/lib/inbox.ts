/**
 * Story Inbox helpers (/admin/stories): searching, filtering and contact links.
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

export const isCallRequest = (entry: InboxEntry) => entry.fields.request_type.startsWith('Request an introductory call')

/** Case-insensitive match against the fields the team is likely to search by. */
export function matchesSearch(entry: InboxEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const { reference, full_name, email, phone, story_title, story_summary, topics } = entry.fields
  return [reference, full_name, email, phone, story_title, story_summary, topics].some((v) => v.toLowerCase().includes(q))
}

/** "+263771234567" → "https://wa.me/263771234567", with an optional prefilled message. Null unless the number is in international format. */
export function whatsappLink(phone: string, text = ''): string | null {
  if (!/^\+\d{8,15}$/.test(phone)) return null
  return `https://wa.me/${phone.slice(1)}${text.trim() ? `?text=${encodeURIComponent(text.trim())}` : ''}`
}

/** "+263 77 123" → "tel:+26377123". Null if there are no digits to dial. */
export function telLink(phone: string): string | null {
  const dial = phone.replace(/[^\d+]/g, '')
  return /\d{6,}/.test(dial) ? `tel:${dial}` : null
}

/** mailto: link with a subject and message. Null unless it looks like an email address. */
export function mailtoLink(email: string, subject: string, body = ''): string | null {
  if (!/^[^\s@?&]+@[^\s@?&]+\.[^\s@?&]+$/.test(email.trim())) return null
  const params = [`subject=${encodeURIComponent(subject)}`, body.trim() && `body=${encodeURIComponent(body.trim())}`].filter(Boolean).join('&')
  return `mailto:${email.trim()}?${params}`
}

export type ContactMethod = 'email' | 'phone' | 'whatsapp'

/** The contact method the person chose on the form, from its label ("Email", "Phone call", "WhatsApp"). */
export function preferredContact(entry: InboxEntry): ContactMethod | null {
  const label = entry.fields.preferred_contact.toLowerCase()
  if (label.includes('whatsapp')) return 'whatsapp'
  if (label.includes('phone')) return 'phone'
  if (label.includes('email')) return 'email'
  return null
}

export const emailSubject = (entry: InboxEntry) => `Your Noisemakers ${isCallRequest(entry) ? 'call request' : 'story'} (${entry.fields.reference})`

/** Starting point for a reply. The team edits it before anything is sent. */
export function defaultMessage(entry: InboxEntry): string {
  const first = entry.fields.full_name.trim().split(/\s+/)[0]
  const hello = first ? `Hello ${first}` : 'Hello'
  return isCallRequest(entry)
    ? `${hello}, thank you for asking for a call with Noisemakers. We would like to arrange a time to speak with you.`
    : `${hello}, thank you for submitting your story to Noisemakers. We would like to discuss your story with you.`
}

/** True if the submission arrived within the last `days` days. */
export const receivedWithin = (entry: InboxEntry, days: number, now = Date.now()) => now - Date.parse(entry.receivedAt) <= days * 86_400_000

/** Only web links are clickable, so a submitted "javascript:" link can't run. */
export function safeWebLink(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}
