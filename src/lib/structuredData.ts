import { SITE } from '../config/site'
import type { Clip, Episode } from '../types/content'
import { getGuestsFor } from './content'
import { isoDuration } from './format'
import { shareImage, youtubeShortUrl, youtubeWatchUrl } from './youtube'

type Ld = Record<string, unknown>

/**
 * The show as a whole. Noisemakers is a video podcast published on YouTube,
 * with no audio RSS feed, so no webFeed is declared.
 */
export function seriesLd(): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'PodcastSeries',
    '@id': `${SITE.url}/#series`,
    name: SITE.name,
    alternateName: SITE.channelName,
    description: SITE.description,
    url: SITE.url,
    image: `${SITE.url}/og-image.png`,
    inLanguage: 'en',
    sameAs: [SITE.youtube.channelUrl, ...SITE.social.map((s) => s.href)],
  }
}

export function websiteLd(): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    url: SITE.url,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE.url}/episodes?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }
}

export function episodeVideoLd(episode: Episode): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: episode.title,
    description: episode.summary,
    thumbnailUrl: [shareImage(episode.youtubeId, episode.hd)],
    uploadDate: episode.publishedAt,
    duration: isoDuration(episode.durationSeconds),
    embedUrl: `https://www.youtube.com/embed/${episode.youtubeId}`,
    contentUrl: youtubeWatchUrl(episode.youtubeId),
    url: `${SITE.url}/episodes/${episode.slug}`,
    actor: getGuestsFor(episode.guestIds).map((g) => ({ '@type': 'Person', name: g.name })),
    isPartOf: { '@id': `${SITE.url}/#series` },
  }
}

export function clipVideoLd(clip: Clip): Ld {
  return {
    '@type': 'VideoObject',
    name: clip.title,
    description: clip.caption ?? clip.title,
    thumbnailUrl: [`https://i.ytimg.com/vi/${clip.youtubeId}/oar2.jpg`],
    uploadDate: clip.publishedAt,
    duration: isoDuration(clip.durationSeconds),
    embedUrl: `https://www.youtube.com/embed/${clip.youtubeId}`,
    contentUrl: youtubeShortUrl(clip.youtubeId),
  }
}

export function breadcrumbLd(items: { name: string; path: string }[]): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${SITE.url}${item.path}`,
    })),
  }
}
