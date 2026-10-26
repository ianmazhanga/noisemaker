/**
 * Social Media Manager: platforms, limits, time zones and AI-output safeguards.
 * Shared by the dashboard and api/ai/social-drafts.ts.
 *
 * No imports, so tests and the server can run this file directly in Node.
 */

export type Platform = 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'x'
export type PostStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'published' | 'failed' | 'rejected'

export interface PlatformInfo {
  label: string
  /** The platform's own caption limit. */
  maxCaption: number
  /** How many hashtags to suggest at most. */
  maxHashtags: number
  /** Where an owner posts by hand until the account is connected. */
  postUrl: string
  /** What the AI is asked to write for this platform. */
  brief: string
}

export const PLATFORMS: Record<Platform, PlatformInfo> = {
  instagram: {
    label: 'Instagram',
    maxCaption: 2200,
    maxHashtags: 10,
    postUrl: 'https://www.instagram.com/',
    brief: 'An Instagram caption: a strong first line, 2–4 short paragraphs, a call to watch (link in bio). No URL in the caption.',
  },
  facebook: {
    label: 'Facebook',
    maxCaption: 5000,
    maxHashtags: 3,
    postUrl: 'https://www.facebook.com/',
    brief: 'A Facebook post: a short summary of the conversation and why it matters, ending with an invitation to watch. The link is added separately.',
  },
  tiktok: {
    label: 'TikTok',
    maxCaption: 2200,
    maxHashtags: 6,
    postUrl: 'https://www.tiktok.com/upload',
    brief: 'A TikTok caption: one or two punchy sentences that work with a short vertical clip.',
  },
  youtube: {
    label: 'YouTube community',
    maxCaption: 1500,
    maxHashtags: 3,
    postUrl: 'https://studio.youtube.com/',
    brief: 'A YouTube community post announcing the video to subscribers, ending with a question that invites comments.',
  },
  x: {
    label: 'X (Twitter)',
    // 280, minus room for a link, which X counts as 23 characters
    maxCaption: 256,
    maxHashtags: 2,
    postUrl: 'https://x.com/compose/post',
    brief: 'A post for X: one or two sentences, under 250 characters including hashtags.',
  },
}

export const PLATFORM_KEYS = Object.keys(PLATFORMS) as Platform[]

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
  rejected: 'Rejected',
}

export const POST_STATUSES = Object.keys(STATUS_LABEL) as PostStatus[]

/** Time zones the team schedules in. The owner is in the US; the Content Manager in South Africa. */
export const TIME_ZONES: { id: string; label: string }[] = [
  { id: 'Africa/Johannesburg', label: 'South Africa (SAST)' },
  { id: 'America/New_York', label: 'US Eastern' },
  { id: 'America/Chicago', label: 'US Central' },
  { id: 'America/Denver', label: 'US Mountain' },
  { id: 'America/Los_Angeles', label: 'US Pacific' },
  { id: 'Europe/London', label: 'UK' },
  { id: 'UTC', label: 'UTC' },
]

/**
 * Widely cited times of day when posts on each platform tend to get seen, in the
 * audience's local time. General guidance only: it isn't based on this account's
 * analytics, which aren't connected yet.
 */
export const POSTING_GUIDANCE: Record<Platform, string> = {
  instagram: 'Weekdays around 11:00–13:00 or 19:00–21:00',
  facebook: 'Weekdays around 09:00–13:00',
  tiktok: 'Evenings around 18:00–22:00',
  youtube: 'Within a day of the video going live',
  x: 'Weekdays around 08:00–10:00 or 12:00–13:00',
}

/** Offset of `timeZone` from UTC at `date`, in minutes (positive east of UTC). */
function offsetMinutes(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return Math.round((asUtc - date.getTime()) / 60_000)
}

/** "2026-11-02T18:30" as wall-clock time in `timeZone` → the exact moment, as a Date. */
export function zonedToUtc(local: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) throw new Error('Expected YYYY-MM-DDTHH:MM')
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  // Two passes settle the offset correctly around daylight-saving changes.
  let guess = naive - offsetMinutes(new Date(naive), timeZone) * 60_000
  guess = naive - offsetMinutes(new Date(guess), timeZone) * 60_000
  return new Date(guess)
}

/** The exact moment → "2026-11-02T18:30" wall-clock time in `timeZone`, for a datetime-local input. */
export function utcToZoned(date: Date, timeZone: string): string {
  return new Date(date.getTime() + offsetMinutes(date, timeZone) * 60_000).toISOString().slice(0, 16)
}

export const formatInZone = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

/** "#Faith Stories", "family" → ["FaithStories", "family"]. Letters, numbers and underscores only, no repeats. */
export function cleanHashtags(tags: unknown, max = 30): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    if (typeof t !== 'string') continue
    const tag = t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 60)
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase())
      out.push(tag)
    }
    if (out.length >= max) break
  }
  return out
}

/** Caption plus hashtags, ready to paste into the platform. */
export const fullText = (caption: string, hashtags: string[]) => [caption.trim(), hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n')

const normalise = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim()

/**
 * Quoted phrases in `text` that don't appear in `source`. The AI is told never to
 * invent quotes; this catches it if it does, so the post is flagged for checking.
 */
export function unsupportedQuotes(text: string, source: string): string[] {
  const src = normalise(source)
  const quotes = [...text.matchAll(/[“"]([^”"]{8,})[”"]/g)].map((m) => m[1])
  return quotes.filter((q) => !src.includes(normalise(q)))
}
