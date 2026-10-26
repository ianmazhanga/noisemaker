/**
 * YouTube channel sync: fetches every public upload with the YouTube Data API
 * v3 and turns it into the snapshot stored in src/data/youtube.json.
 *
 * Everything here is a plain function so it can be tested without network
 * access (see tests/youtube-sync.test.ts). scripts/sync-youtube.ts wires it up.
 */
import type { SyncedVideo, YouTubeSnapshot } from '../../src/types/content.ts'

const API = 'https://www.googleapis.com/youtube/v3'

/** Shorts last at most 3 minutes. Anything longer is a full episode. */
export const SHORT_MAX_SECONDS = 180

/** The subset of a videos.list item the sync reads. */
export interface ApiVideo {
  id: string
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    liveBroadcastContent?: string
    thumbnails?: Record<string, unknown>
  }
  contentDetails?: { duration?: string; contentRating?: { ytRating?: string } }
  status?: { privacyStatus?: string; uploadStatus?: string; embeddable?: boolean }
  /** Only present when 'statistics' is requested (the dashboard's sync does; the site's doesn't). */
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** "PT1H4M32S" → 3872. Returns 0 for anything it can't read. */
export function parseIsoDuration(iso: string | undefined): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? '')
  if (!m) return 0
  const [, d = '0', h = '0', min = '0', s = '0'] = m
  return Number(d) * 86400 + Number(h) * 3600 + Number(min) * 60 + Number(s)
}

/** Removes hashtags and tidies whitespace: "Why couples struggle #marriage #shorts" → "Why couples struggle". */
export function cleanTitle(title: string): string {
  return title
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*[|·:–—-]\s*$/, '')
    .trim()
}

/** Splits a description into paragraphs, dropping lines that are only hashtags. */
export function cleanDescription(description: string, maxParagraphs = 8): string[] {
  return description
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split('\n')
        .filter((line) => !/^\s*(#[\p{L}\p{N}_]+\s*)+$/u.test(line))
        .join('\n')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, maxParagraphs)
}

/** "Alcohol Addiction, Recovery & Hope: The Innocent Mathe Story" → "alcohol-addiction-recovery-hope-the-innocent-mathe-story" */
export function slugify(title: string, maxLength = 70): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= maxLength) return slug || 'episode'
  const cut = slug.slice(0, maxLength)
  return cut.slice(0, cut.lastIndexOf('-') > 20 ? cut.lastIndexOf('-') : maxLength).replace(/-+$/, '')
}

/**
 * Converts one API item into a SyncedVideo, or null if it shouldn't be on
 * the site: not public, not fully processed, live or an upcoming premiere.
 */
export function toSyncedVideo(item: ApiVideo, previous?: SyncedVideo): SyncedVideo | null {
  const { snippet, contentDetails, status } = item
  if (!snippet || !status) return null
  if (status.privacyStatus !== 'public') return null
  if (status.uploadStatus && status.uploadStatus !== 'processed') return null
  if (snippet.liveBroadcastContent && snippet.liveBroadcastContent !== 'none') return null
  const durationSeconds = parseIsoDuration(contentDetails?.duration)
  const publishedAt = normaliseDate(snippet.publishedAt)
  if (!durationSeconds || !publishedAt) return null

  return {
    youtubeId: item.id,
    // A video keeps the kind it was first given, so a manual correction in the snapshot sticks.
    kind: previous?.kind ?? (durationSeconds <= SHORT_MAX_SECONDS ? 'short' : 'episode'),
    slug: previous?.slug,
    title: cleanTitle(snippet.title ?? '') || 'Untitled video',
    description: cleanDescription(snippet.description ?? ''),
    publishedAt,
    durationSeconds,
    hd: Boolean(snippet.thumbnails && 'maxres' in snippet.thumbnails),
    restricted: status.embeddable === false || contentDetails?.contentRating?.ytRating === 'ytAgeRestricted',
  }
}

/** "2026-09-27T15:00:06.123Z" → "2026-09-27T15:00:06Z" */
function normaliseDate(value: string | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export interface SyncResult {
  snapshot: YouTubeSnapshot
  added: SyncedVideo[]
  removed: SyncedVideo[]
}

/**
 * Builds the new snapshot from the API items. Duplicates are dropped by video
 * ID, slugs are kept from the previous snapshot (or created once for new
 * episodes) and videos are ordered newest first.
 */
export function buildSnapshot(items: ApiVideo[], previous: YouTubeSnapshot, opts: { allowLargeRemoval?: boolean } = {}): SyncResult {
  const previousById = new Map(previous.videos.map((v) => [v.youtubeId, v]))
  const byId = new Map<string, SyncedVideo>()
  for (const item of items) {
    if (byId.has(item.id)) continue
    const video = toSyncedVideo(item, previousById.get(item.id))
    if (video) byId.set(video.youtubeId, video)
  }

  const videos = [...byId.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.youtubeId.localeCompare(b.youtubeId))

  // Slugs: keep every slug already in use (including those of removed videos, so a URL is never reused), then name new episodes.
  const taken = new Set(previous.videos.map((v) => v.slug).filter(Boolean))
  for (const v of [...videos].reverse()) {
    if (v.kind !== 'episode' || v.slug) continue
    const base = slugify(v.title)
    let slug = base
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`
    taken.add(slug)
    v.slug = slug
  }
  for (const v of videos) if (v.kind === 'short') delete v.slug

  const added = videos.filter((v) => !previousById.has(v.youtubeId))
  const removed = previous.videos.filter((v) => !byId.has(v.youtubeId))

  // Guard against a bad API response wiping the site: losing more than half the catalogue at once needs --force.
  if (!videos.length && previous.videos.length) throw new Error('YouTube returned no public videos. Keeping the existing snapshot.')
  if (!opts.allowLargeRemoval && previous.videos.length >= 4 && removed.length > previous.videos.length / 2) {
    throw new Error(`${removed.length} of ${previous.videos.length} videos would be removed at once. Keeping the existing snapshot (re-run with --force if this is intended).`)
  }

  return { snapshot: { channelId: previous.channelId, videos }, added, removed }
}

/** GET a JSON URL, retrying network errors, 429s and 5xx with exponential backoff. */
export async function getJson(url: string, fetchImpl: FetchLike, { retries = 3, baseDelayMs = 1000 } = {}): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)))
    try {
      const res = await fetchImpl(url)
      if (res.ok) return await res.json()
      const err = new Error(`YouTube API responded ${res.status}`)
      // 4xx other than 429 (bad key, quota exceeded, bad request) won't fix itself on retry.
      if (res.status !== 429 && res.status < 500) throw Object.assign(err, { fatal: true })
      lastError = err
    } catch (err) {
      if ((err as { fatal?: boolean }).fatal) throw err
      lastError = err
    }
  }
  throw lastError
}

/** The channel's uploads playlist: "UC…" → "UU…". */
export const uploadsPlaylistId = (channelId: string) => `UU${channelId.slice(2)}`

/**
 * Fetches every upload on the channel. Costs 1 quota unit per 50 videos for
 * the playlist plus 1 per 50 for the details: a few units per run against a
 * default allowance of 10,000 a day.
 */
export async function fetchChannelVideos(
  channelId: string,
  apiKey: string,
  fetchImpl: FetchLike,
  retryOpts?: { retries?: number; baseDelayMs?: number },
  parts = 'snippet,contentDetails,status',
): Promise<ApiVideo[]> {
  const ids: string[] = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ part: 'contentDetails', playlistId: uploadsPlaylistId(channelId), maxResults: '50', key: apiKey })
    if (pageToken) params.set('pageToken', pageToken)
    const page = (await getJson(`${API}/playlistItems?${params}`, fetchImpl, retryOpts)) as {
      items?: { contentDetails?: { videoId?: string } }[]
      nextPageToken?: string
    }
    for (const item of page.items ?? []) if (item.contentDetails?.videoId) ids.push(item.contentDetails.videoId)
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)

  const unique = [...new Set(ids)]
  const videos: ApiVideo[] = []
  for (let i = 0; i < unique.length; i += 50) {
    const params = new URLSearchParams({ part: parts, id: unique.slice(i, i + 50).join(','), maxResults: '50', key: apiKey })
    const page = (await getJson(`${API}/videos?${params}`, fetchImpl, retryOpts)) as { items?: ApiVideo[] }
    // Deleted or private videos are simply missing from this response.
    videos.push(...(page.items ?? []))
  }
  return videos
}
