/**
 * Content access layer. UI components read content only through these
 * functions, never from src/data directly.
 *
 * Episodes and clips come from the YouTube sync snapshot (src/data/youtube.json,
 * refreshed hourly by a GitHub Action) merged with the hand-written details in
 * src/data/episodes.ts and clips.ts. See src/lib/catalog.ts.
 */
import { CLIPS } from '../data/clips'
import { EPISODES } from '../data/episodes'
import { GUESTS } from '../data/guests'
import { TOPICS } from '../data/topics'
import snapshot from '../data/youtube.json'
import { HOMEPAGE } from '../config/site'
import { buildCatalog } from './catalog'
import type { Clip, Episode, Guest, Topic, TopicSlug, YouTubeSnapshot } from '../types/content'

/** Newest first. */
const { episodes, clips } = buildCatalog(snapshot as YouTubeSnapshot, EPISODES, CLIPS)

export const getEpisodes = (): Episode[] => episodes
export const getEpisode = (slug: string | undefined) => episodes.find((e) => e.slug === slug)

/** The pinned episode, or the newest. Undefined only if the channel has no episodes at all. */
export function getLeadEpisode(): Episode | undefined {
  return (HOMEPAGE.leadEpisode !== 'latest' && getEpisode(HOMEPAGE.leadEpisode)) || episodes[0]
}

/** Newest episodes, excluding the given slugs. */
export function getLatestEpisodes(limit: number, exclude: string[] = []): Episode[] {
  return episodes.filter((e) => !exclude.includes(e.slug)).slice(0, limit)
}

export function getCuratedEpisodes(): Episode[] {
  return HOMEPAGE.conversations.map((slug) => getEpisode(slug)).filter((e): e is Episode => Boolean(e))
}

export const getEpisodesByGuest = (guestId: string) => episodes.filter((e) => e.guestIds.includes(guestId))

/** Same guest first, then same topic, then newest. */
export function getRelatedEpisodes(episode: Episode, limit = 3): Episode[] {
  const score = (e: Episode) =>
    (e.guestIds.some((g) => episode.guestIds.includes(g)) ? 2 : 0) + (e.topic && e.topic === episode.topic ? 1 : 0)
  return episodes
    .filter((e) => e.slug !== episode.slug)
    .map((e, i) => ({ e, s: score(e), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map(({ e }) => e)
}

/** The neighbouring part of a multi-part conversation, if any. */
export function getSeriesParts(episode: Episode): Episode[] {
  if (!episode.series) return []
  return episodes
    .filter((e) => e.series?.name === episode.series?.name)
    .sort((a, b) => (a.series?.part ?? 0) - (b.series?.part ?? 0))
}

export const getClips = (): Clip[] => clips
export const getClipsForEpisode = (slug: string) => clips.filter((c) => c.episodeSlug === slug)
export const getClipsByGuest = (guestId: string) => clips.filter((c) => c.guestIds.includes(guestId))
/** Clips from conversations (with a named guest), for the homepage. */
export const getConversationClips = (limit: number) => clips.filter((c) => c.guestIds.length).slice(0, limit)

export const getGuests = (): Guest[] => GUESTS
export const getGuest = (id: string | undefined) => GUESTS.find((g) => g.id === id)
export const getGuestsFor = (ids: string[]) => ids.map((id) => getGuest(id)).filter((g): g is Guest => Boolean(g))

/** "2 episodes · 3 clips" */
export function guestCredits(guestId: string): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const e = getEpisodesByGuest(guestId).length
  const c = getClipsByGuest(guestId).length
  return [e && plural(e, 'episode'), c && plural(c, 'clip')].filter(Boolean).join(' · ')
}

export const getTopics = (): Topic[] => TOPICS
export const getTopic = (slug: string | null | undefined) => TOPICS.find((t) => t.slug === slug)
export const isTopicSlug = (slug: string | null): slug is TopicSlug => TOPICS.some((t) => t.slug === slug)
export const countByTopic = (slug: TopicSlug) => episodes.filter((e) => e.topic === slug).length

/** Case- and accent-insensitive match on title, guest names, summary and topic. */
export function searchEpisodes(query: string, list: Episode[] = episodes): Episode[] {
  const normalise = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[’‘“”"]/g, '')
      .toLowerCase()
  const terms = normalise(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return list
  return list.filter((e) => {
    const haystack = normalise(
      [e.title, e.summary, getTopic(e.topic)?.name ?? '', ...getGuestsFor(e.guestIds).map((g) => g.name)].join(' '),
    )
    return terms.every((t) => haystack.includes(t))
  })
}
