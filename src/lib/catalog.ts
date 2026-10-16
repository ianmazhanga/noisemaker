/**
 * Merges the YouTube sync snapshot (src/data/youtube.json) with the
 * hand-written entries in src/data/episodes.ts and clips.ts.
 *
 * - The snapshot decides which videos exist: anything deleted or made private
 *   on YouTube disappears from the site.
 * - A hand-written entry wins for its video (summary, topic, guests, slug…),
 *   with playback restrictions taken from the snapshot.
 * - A video with no hand-written entry is shown with YouTube's own title and
 *   description, so new uploads appear without anyone editing the site.
 * - If the snapshot is empty or unreadable, the hand-written lists are used
 *   as they are.
 *
 * Only type imports here, so tests can run this file directly in Node.
 */
import type { Clip, Episode, SyncedVideo, YouTubeSnapshot } from '../types/content'

const byNewest = <T extends { publishedAt: string }>(a: T, b: T) => b.publishedAt.localeCompare(a.publishedAt)

/** First paragraph, cut at a word boundary. */
function summarise(paragraphs: string[], maxLength = 220): string {
  const first = (paragraphs[0] ?? '').replace(/\s+/g, ' ').trim()
  if (first.length <= maxLength) return first
  const cut = first.slice(0, maxLength)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 80 ? cut.lastIndexOf(' ') : maxLength).replace(/[\s,;:.–—-]+$/, '')}…`
}

function autoEpisode(v: SyncedVideo): Episode {
  const summary = summarise(v.description)
  // The summary is the first paragraph; don't repeat it in the description unless it had to be shortened.
  const usedWhole = summary && summary === (v.description[0] ?? '').replace(/\s+/g, ' ').trim()
  return {
    slug: v.slug ?? v.youtubeId,
    youtubeId: v.youtubeId,
    title: v.title,
    summary: summary || 'A new episode from Noisemakers. Watch it here or on YouTube.',
    description: usedWhole ? v.description.slice(1) : v.description,
    guestIds: [],
    publishedAt: v.publishedAt,
    durationSeconds: v.durationSeconds,
    hd: v.hd,
    restricted: v.restricted || undefined,
  }
}

function autoClip(v: SyncedVideo): Clip {
  return {
    youtubeId: v.youtubeId,
    title: v.title,
    caption: summarise(v.description, 160) || undefined,
    publishedAt: v.publishedAt,
    durationSeconds: v.durationSeconds,
    guestIds: [],
    restricted: v.restricted || undefined,
  }
}

export interface Catalog {
  episodes: Episode[]
  clips: Clip[]
  /** Hand-written entries hidden because their video is no longer public on YouTube. */
  hidden: string[]
}

export function buildCatalog(snapshot: YouTubeSnapshot | null | undefined, curatedEpisodes: Episode[], curatedClips: Clip[]): Catalog {
  if (!snapshot?.videos?.length) {
    return { episodes: [...curatedEpisodes].sort(byNewest), clips: [...curatedClips].sort(byNewest), hidden: [] }
  }

  const episodeById = new Map(curatedEpisodes.map((e) => [e.youtubeId, e]))
  const clipById = new Map(curatedClips.map((c) => [c.youtubeId, c]))
  const seen = new Set<string>()
  const episodes: Episode[] = []
  const clips: Clip[] = []

  for (const v of snapshot.videos) {
    if (seen.has(v.youtubeId)) continue
    seen.add(v.youtubeId)
    const restricted = v.restricted || undefined
    const curatedEpisode = episodeById.get(v.youtubeId)
    const curatedClip = clipById.get(v.youtubeId)
    // A hand-written entry decides whether a video is an episode or a clip.
    if (curatedEpisode) episodes.push({ ...curatedEpisode, restricted })
    else if (curatedClip) clips.push({ ...curatedClip, restricted })
    else if (v.kind === 'episode') episodes.push(autoEpisode(v))
    else clips.push(autoClip(v))
  }

  // Keep slugs unique if an automatic slug ever matches a hand-written one. Hand-written slugs never change.
  const slugs = new Set(episodes.filter((e) => episodeById.has(e.youtubeId)).map((e) => e.slug))
  for (const e of episodes) {
    if (episodeById.has(e.youtubeId)) continue
    if (slugs.has(e.slug)) e.slug = `${e.slug}-${e.youtubeId.toLowerCase()}`
    slugs.add(e.slug)
  }

  const hidden = [...curatedEpisodes.map((e) => e.youtubeId), ...curatedClips.map((c) => c.youtubeId)].filter((id) => !seen.has(id))
  // Clips can only point at episodes that are still on the site.
  const live = new Set(episodes.map((e) => e.slug))
  const linkedClips = clips.map((c) => (c.episodeSlug && !live.has(c.episodeSlug) ? { ...c, episodeSlug: undefined } : c))

  return { episodes: episodes.sort(byNewest), clips: linkedClips.sort(byNewest), hidden }
}
