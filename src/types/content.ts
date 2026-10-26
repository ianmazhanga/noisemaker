/**
 * Content model for the Noisemakers website.
 *
 * Everything the UI shows comes through these shapes (via src/lib/content.ts),
 * so the static data files can later be swapped for a CMS or the YouTube Data
 * API without touching components.
 */

export type TopicSlug = 'marriage' | 'family' | 'life-stories' | 'love-stories'

export interface Topic {
  slug: TopicSlug
  name: string
  /** One sentence, describing what the channel's episodes in this topic actually cover. */
  description: string
}

/** Where to aim a crop of a YouTube thumbnail, as fractions (0 = left/top, 1 = right/bottom). */
export interface Focus {
  x: number
  y?: number
  /** Magnify around the focus point, for thumbnails where text sits close to a face. Default 1. */
  zoom?: number
}

export interface Episode {
  /** URL slug: /episodes/:slug */
  slug: string
  /** 11-character YouTube video ID */
  youtubeId: string
  /** Display title: the YouTube title with hashtags removed and casing tidied. */
  title: string
  /** One or two factual sentences restating the channel's own description. */
  summary: string
  /** Longer factual description, restating the channel's own description. Paragraphs. */
  description: string[]
  /** Discussion points, only where the channel's description lists them. */
  points?: string[]
  /** Hand-assigned topic. Episodes imported automatically from YouTube have none until one is set. */
  topic?: TopicSlug
  /** Guest IDs from src/data/guests.ts, only where YouTube names them. */
  guestIds: string[]
  /** ISO 8601 publish time as reported by YouTube */
  publishedAt: string
  /** Duration in seconds as reported by YouTube */
  durationSeconds: number
  /** YouTube serves a 1280×720 maxresdefault thumbnail for this video. */
  hd?: boolean
  /** YouTube doesn't allow this video to play on other sites (embedding off or age-restricted). Set by the sync. */
  restricted?: boolean
  /** Where faces sit in the thumbnail, used when cropping to portrait shapes. */
  focus?: Focus
  /** Multi-part conversations */
  series?: { name: string; part: number }
  /** Content note and support information, only where the channel's description provides it. */
  notice?: { title: string; body: string[] }
}

/** A YouTube Short. */
export interface Clip {
  youtubeId: string
  /** Display title: the YouTube title with hashtags removed and casing tidied. */
  title: string
  /** One factual line, restating the channel's description. Optional. */
  caption?: string
  publishedAt: string
  durationSeconds: number
  guestIds: string[]
  /** Full episode the clip was cut from, only where that is verifiable. */
  episodeSlug?: string
  /** YouTube doesn't allow this video to play on other sites. Set by the sync. */
  restricted?: boolean
}

export interface Guest {
  id: string
  name: string
  /** One line: who they are, as described by the channel. */
  role: string
  /** Short factual introduction, restating the channel's descriptions. */
  bio: string
  /** A first-person line the channel attributes to the guest in a video title or thumbnail. */
  quote?: { text: string; episodeSlug: string }
  /** Thumbnail used as the guest's portrait. */
  portrait: { youtubeId: string; hd?: boolean; focus: Focus }
  /** Extra links the channel itself shares, e.g. a book. */
  links?: { label: string; href: string }[]
}

/**
 * One public video as last seen on the channel by the YouTube sync
 * (scripts/sync-youtube.ts). Stored in src/data/youtube.json.
 */
export interface SyncedVideo {
  youtubeId: string
  kind: 'episode' | 'short'
  /** Episodes only. Assigned once when the video is first seen and never changed, so links stay stable. */
  slug?: string
  /** The YouTube title with hashtags removed. */
  title: string
  /** The YouTube description, as paragraphs, with hashtag-only lines removed. */
  description: string[]
  publishedAt: string
  durationSeconds: number
  hd: boolean
  restricted: boolean
}

export interface YouTubeSnapshot {
  channelId: string
  videos: SyncedVideo[]
}

/** A book by a guest, only where the channel itself names it. */
export interface Book {
  slug: string
  title: string
  subtitle?: string
  /** As the channel credits them. */
  authors: string
  /** Guest ID from src/data/guests.ts */
  guestId: string
  /** One or two factual sentences restating the channel's own description. */
  description: string
  /** Where the channel links to buy it. Omitted when the channel gives no link. */
  buyUrl?: string
  /** The episodes where the book is discussed or mentioned. */
  episodeSlugs: string[]
}
