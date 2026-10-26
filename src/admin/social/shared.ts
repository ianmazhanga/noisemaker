import { getClips, getEpisodes } from '../../lib/content'
import { youtubeShortUrl, youtubeWatchUrl } from '../../lib/youtube'
import type { Platform, PostStatus } from '../../lib/social'

export interface PostRow {
  id: string
  platform: Platform
  caption: string
  hashtags: string[]
  link_url: string
  media_note: string
  source_type: 'manual' | 'youtube' | 'news'
  source_ref: string
  source_title: string
  ai_generated: boolean
  status: PostStatus
  scheduled_at: string | null
  timezone: string
  created_by: string | null
  created_at: string
  updated_at: string
  approved_by: string | null
  approved_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string
  published_at: string | null
  published_url: string
  error_message: string
}

export interface AccountRow {
  platform: Platform
  display_name: string
  profile_url: string
  provider: string
  connected_at: string | null
}

export interface ChannelVideo {
  youtubeId: string
  title: string
  description: string
  url: string
  kind: 'Episode' | 'Short'
  publishedAt: string
}

/** The channel's videos, newest first, from the same synced catalog the public site uses. */
export function channelVideos(): ChannelVideo[] {
  const episodes = getEpisodes().map((e) => ({
    youtubeId: e.youtubeId,
    title: e.title,
    description: [e.summary, ...e.description, ...(e.points ?? []).map((p) => `• ${p}`)].join('\n\n'),
    url: youtubeWatchUrl(e.youtubeId),
    kind: 'Episode' as const,
    publishedAt: e.publishedAt,
  }))
  const clips = getClips().map((c) => ({
    youtubeId: c.youtubeId,
    title: c.title,
    description: c.caption ?? '',
    url: youtubeShortUrl(c.youtubeId),
    kind: 'Short' as const,
    publishedAt: c.publishedAt,
  }))
  return [...episodes, ...clips].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

/** True when the error means this section's tables haven't been added to the database yet. */
export const isMissingTable = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message ?? '')))

export const PLATFORM_STYLE: Record<Platform, string> = {
  instagram: 'bg-[#e1306c] text-white',
  facebook: 'bg-[#1877f2] text-white',
  tiktok: 'bg-ink text-white',
  youtube: 'bg-[#ff0000] text-white',
  x: 'bg-ink-3 text-white',
}

export const STATUS_STYLE: Record<PostStatus, string> = {
  draft: 'bg-line text-ink',
  pending_approval: 'bg-yellow text-ink',
  approved: 'bg-[#1f7a4d] text-white',
  scheduled: 'bg-blue text-white',
  published: 'bg-ink text-paper',
  failed: 'bg-danger text-white',
  rejected: 'bg-bone text-muted ring-1 ring-line',
}

/** The viewer's own time zone if it's one of ours, else South Africa. */
export function defaultZone(zones: { id: string }[]): string {
  try {
    const mine = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zones.some((z) => z.id === mine) ? mine : 'Africa/Johannesburg'
  } catch {
    return 'Africa/Johannesburg'
  }
}

export const AI_ERRORS: Record<string, string> = {
  'ai-not-configured': 'AI writing isn’t connected yet. Add OPENAI_API_KEY in Vercel to switch it on. You can still write posts yourself.',
  'ai-key-invalid': 'The OpenAI key in Vercel was refused. Check OPENAI_API_KEY.',
  'ai-busy': 'OpenAI is busy or the account is out of credit. Try again in a minute.',
  'ai-empty': 'The AI didn’t return any usable drafts. Try again.',
  'not-configured': 'The server isn’t connected to the database. Add SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel.',
  forbidden: 'Your account isn’t allowed to use this.',
  'signed-out': 'Your sign-in has expired. Sign in again.',
  invalid: 'Something about that request wasn’t right. Check the video and platforms.',
}

export interface Suggestion {
  platform: Platform
  caption: string
  hashtags: string[]
  warnings: string[]
}

/** Asks the AI for drafts. Throws an Error with a message fit to show the owner. */
export async function requestDrafts(accessToken: string, video: Pick<ChannelVideo, 'title' | 'description' | 'url'>, platforms: Platform[], variations: number) {
  const res = await fetch('/api/ai/social-drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ title: video.title, description: video.description, url: video.url, platforms, variations }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null)
  if (!res) throw new Error('Couldn’t reach the AI service. Check your connection and try again.')
  const body = (await res.json().catch(() => ({}))) as { error?: string; summary?: string; drafts?: Suggestion[] }
  if (!res.ok || !body.drafts) throw new Error(AI_ERRORS[body.error ?? ''] ?? 'The AI couldn’t write drafts just now. Please try again.')
  return { summary: body.summary ?? '', drafts: body.drafts }
}
