/**
 * The simple "post a video" workflow: which platforms can post a video automatically right
 * now, what to show for each post, and grouping one video's posts together.
 *
 * One video posted to several platforms is saved as one social post per platform, all with
 * the same group ID in source_ref, so each platform keeps its own approval, schedule and result.
 *
 * No imports, so tests can run this file directly in Node.
 */

export type Platform = 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'x'

export interface AccountState {
  platform: Platform
  provider?: string
  status?: 'not_connected' | 'connected' | 'expired' | 'error'
  last_error?: string
}

/** Platforms offered on the posting screen, in display order. */
export const VIDEO_PLATFORMS: Platform[] = ['tiktok', 'instagram', 'facebook', 'youtube', 'x']

export const VIDEO_PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube Shorts',
  x: 'X',
}

/** Where to post by hand, when the dashboard can't. */
export const MANUAL_URL: Record<Platform, string> = {
  tiktok: 'https://www.tiktok.com/upload',
  instagram: 'https://www.instagram.com/',
  facebook: 'https://www.facebook.com/',
  youtube: 'https://studio.youtube.com/',
  x: 'https://x.com/compose/post',
}

export type Connection = 'connected' | 'not_connected' | 'expired' | 'error'

export function connectionOf(account: AccountState | undefined): Connection {
  if (!account) return 'not_connected'
  if (account.status) return account.status
  return account.provider ? 'connected' : 'not_connected'
}

export const CONNECTION_LABEL: Record<Connection, string> = {
  connected: 'Connected',
  not_connected: 'Not connected',
  expired: 'Connection expired',
  error: 'Needs attention',
}

/**
 * Can the dashboard post a video to this platform by itself right now? If not, the reason
 * is shown and the post is published by hand. This mirrors what api/_lib/publish.ts supports.
 */
export function videoPosting(platform: Platform, account: AccountState | undefined): { auto: boolean; reason: string } {
  const c = connectionOf(account)
  if (c === 'not_connected') return { auto: false, reason: 'Not connected yet, so you post it yourself.' }
  if (c === 'expired') return { auto: false, reason: 'The connection has expired. Reconnect it in Accounts, or post it yourself.' }
  if (c === 'error') return { auto: false, reason: account?.last_error ? `Connection problem: ${account.last_error}` : 'The connection has a problem. Check Accounts, or post it yourself.' }
  if (platform === 'x') return { auto: false, reason: 'Videos go on X by hand for now.' }
  if (platform === 'tiktok') return { auto: true, reason: 'Posts automatically. Until TikTok approves the app, the video is visible only to your account.' }
  return { auto: true, reason: 'Posts automatically.' }
}

/** What a single platform post means to the person using the dashboard. */
export type Outcome = 'published' | 'failed' | 'scheduled' | 'draft' | 'waiting_approval' | 'manual' | 'publishing'

export const OUTCOME_LABEL: Record<Outcome, string> = {
  published: 'Published',
  failed: 'Failed',
  scheduled: 'Scheduled',
  draft: 'Draft',
  waiting_approval: 'Waiting for approval',
  manual: 'Manual action required',
  publishing: 'Publishing…',
}

export interface PostState {
  status: 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'published' | 'failed' | 'rejected'
  scheduled_at: string | null
  publish_started_at?: string | null
}

/**
 * Published only when the platform confirmed it (or an owner marked it after posting by hand).
 * Approved posts that can't post themselves, and scheduled ones whose time has passed without
 * an automatic post, need someone to post them by hand.
 */
export function outcomeOf(post: PostState, auto: boolean, now = Date.now()): Outcome {
  if (post.publish_started_at) return 'publishing'
  if (post.status === 'published') return 'published'
  if (post.status === 'failed') return 'failed'
  if (post.status === 'draft' || post.status === 'rejected') return 'draft'
  if (post.status === 'pending_approval') return 'waiting_approval'
  if (post.status === 'scheduled') return !auto && post.scheduled_at && Date.parse(post.scheduled_at) <= now ? 'manual' : 'scheduled'
  return auto ? 'scheduled' : 'manual'
}

/** Caption with hashtags, as it's posted: "#" added where missing, duplicates dropped. */
export function hashtagsFrom(text: string, max = 30): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[\s,]+/)) {
    const tag = raw.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase())
      out.push(tag)
    }
    if (out.length >= max) break
  }
  return out
}

/** Finished videos people upload: MP4 or MOV. */
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime']
export const isVideoFile = (file: { type: string; name: string }) => VIDEO_TYPES.includes(file.type) || /\.(mp4|mov)$/i.test(file.name)

/** Browsers sometimes leave the type of .mov files empty; the server needs a real type. */
export const videoType = (file: { type: string; name: string }) => (VIDEO_TYPES.includes(file.type) ? file.type : /\.mov$/i.test(file.name) ? 'video/quicktime' : 'video/mp4')

export function groupPosts<T extends { source_ref: string; source_type: string; media_asset_id?: string | null; created_at: string }>(posts: T[]): { id: string; posts: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const p of posts) {
    if (p.source_type !== 'manual' || !p.media_asset_id || !p.source_ref.startsWith('video-post:')) continue
    groups.set(p.source_ref, [...(groups.get(p.source_ref) ?? []), p])
  }
  return [...groups].map(([id, list]) => ({ id, posts: list })).sort((a, b) => b.posts[0].created_at.localeCompare(a.posts[0].created_at))
}
