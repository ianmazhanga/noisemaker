import { Link } from 'react-router'
import type { Episode } from '../../types/content'
import { getGuestsFor, getTopic } from '../../lib/content'
import { youtubeWatchUrl } from '../../lib/youtube'
import { formatDate, formatDuration, formatRuntime, spokenDuration } from '../../lib/format'
import { PlayIcon } from '../player/PlayIcon'
import { Thumb } from '../ui/Thumb'

const guestLine = (e: Episode) => getGuestsFor(e.guestIds).map((g) => g.name).join(' · ')

function Duration({ seconds, className = '' }: { seconds: number; className?: string }) {
  return (
    <span className={`rounded-full bg-ink/80 px-2 py-1 text-xs leading-none font-semibold tabular-nums text-paper ${className}`}>
      <span aria-hidden>{formatDuration(seconds)}</span>
      <span className="sr-only">Duration {spokenDuration(seconds)}</span>
    </span>
  )
}

export function TopicLabel({ episode, dark }: { episode: Episode; dark?: boolean }) {
  const topic = getTopic(episode.topic)
  if (!topic && !episode.series) return null
  return (
    <p className={`kicker ${dark ? 'text-yellow' : 'text-blue-ink'}`}>
      {topic?.name}
      {episode.series && <span className={dark ? 'text-muted-dark' : 'text-muted'}> · Part {episode.series.part}</span>}
    </p>
  )
}

interface CardProps {
  episode: Episode
  /** Heading level inside the current section */
  as?: 'h2' | 'h3' | 'h4'
  priority?: boolean
}

/** Large card: wide 16:9 image, display title and summary. */
export function EpisodeFeatureCard({ episode, as: H = 'h3', priority }: CardProps) {
  const guests = guestLine(episode)
  return (
    <article className="group">
      <a href={youtubeWatchUrl(episode.youtubeId)} target="_blank" rel="noopener noreferrer" className="relative block w-full overflow-hidden rounded-lg" aria-label={`Watch on YouTube: ${episode.title} (opens in a new tab)`}>
        <Thumb youtubeId={episode.youtubeId} hd={episode.hd} alt="" priority={priority} sizes="(min-width: 1024px) 760px, 100vw" className="aspect-video" />
        <span className="absolute bottom-4 left-4 md:bottom-6 md:left-6">
          <PlayIcon size="lg" />
        </span>
      </a>
      <div className="mt-5 md:mt-6">
        <TopicLabel episode={episode} />
        <H className="display-md mt-3">
          <Link to={`/episodes/${episode.slug}`} className="link-grow">
            {episode.title}
          </Link>
        </H>
        <p className="mt-3">
          {guests && <span className="font-semibold">{guests} · </span>}
          <span className="text-muted">{formatRuntime(episode.durationSeconds)}</span>
        </p>
        <p className="measure mt-2 text-muted">{episode.summary}</p>
      </div>
    </article>
  )
}

/** Tall 4:5 crop centred on the guest. */
export function EpisodePortraitCard({ episode, as: H = 'h3' }: CardProps) {
  const guests = guestLine(episode)
  return (
    <article className="group">
      <a href={youtubeWatchUrl(episode.youtubeId)} target="_blank" rel="noopener noreferrer" className="relative block w-full overflow-hidden rounded-lg" aria-label={`Watch on YouTube: ${episode.title} (opens in a new tab)`}>
        <Thumb youtubeId={episode.youtubeId} hd={episode.hd} focus={episode.focus} alt="" sizes="(min-width: 1024px) 300px, 62vw" className="aspect-[3/4]" />
        <span className="absolute bottom-3 left-3">
          <PlayIcon size="md" />
        </span>
        <Duration seconds={episode.durationSeconds} className="absolute top-3 right-3" />
      </a>
      <div className="mt-4">
        <TopicLabel episode={episode} />
        <H className="title mt-2 text-lg md:text-xl">
          <Link to={`/episodes/${episode.slug}`} className="link-grow">
            {episode.title}
          </Link>
        </H>
        {guests && <p className="mt-1.5 text-sm text-muted">{guests}</p>}
      </div>
    </article>
  )
}

/** Compact list row: small thumbnail beside the title. */
export function EpisodeRow({ episode, as: H = 'h3' }: CardProps) {
  const guests = guestLine(episode)
  return (
    <article className="group grid grid-cols-[8.5rem_1fr] items-start gap-4 sm:grid-cols-[11rem_1fr] sm:gap-5">
      <a href={youtubeWatchUrl(episode.youtubeId)} target="_blank" rel="noopener noreferrer" className="relative block w-full overflow-hidden rounded-md" aria-label={`Watch on YouTube: ${episode.title} (opens in a new tab)`}>
        <Thumb youtubeId={episode.youtubeId} hd={episode.hd} alt="" sizes="176px" className="aspect-video" />
        <span className="absolute bottom-2 left-2">
          <PlayIcon size="sm" />
        </span>
      </a>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted">
          <time dateTime={episode.publishedAt}>{formatDate(episode.publishedAt)}</time>
          <span aria-hidden> · </span>
          <span aria-hidden>{formatDuration(episode.durationSeconds)}</span>
          <span className="sr-only">, {spokenDuration(episode.durationSeconds)}</span>
        </p>
        <H className="title clamp-3 mt-1.5 text-[1.0625rem] sm:text-lg">
          <Link to={`/episodes/${episode.slug}`} className="link-grow">
            {episode.title}
          </Link>
        </H>
        {guests && <p className="mt-1 truncate text-sm text-muted">{guests}</p>}
      </div>
    </article>
  )
}

/** Standard card for listings. */
export function EpisodeGridCard({ episode, as: H = 'h3', priority }: CardProps) {
  const guests = guestLine(episode)
  return (
    <article className="group flex flex-col">
      <a href={youtubeWatchUrl(episode.youtubeId)} target="_blank" rel="noopener noreferrer" className="relative block w-full overflow-hidden rounded-lg" aria-label={`Watch on YouTube: ${episode.title} (opens in a new tab)`}>
        <Thumb youtubeId={episode.youtubeId} hd={episode.hd} alt="" priority={priority} sizes="(min-width: 1024px) 440px, (min-width: 640px) 50vw, 100vw" className="aspect-video" />
        <span className="absolute bottom-3 left-3">
          <PlayIcon size="sm" />
        </span>
      </a>
      <div className="mt-4">
        <TopicLabel episode={episode} />
        <H className="title mt-2 text-xl">
          <Link to={`/episodes/${episode.slug}`} className="link-grow">
            {episode.title}
          </Link>
        </H>
        {guests && <p className="mt-1.5 text-sm font-semibold">{guests}</p>}
        <p className="clamp-2 mt-1.5 text-[0.9375rem] text-muted">{episode.summary}</p>
        <p className="mt-2 text-xs text-muted">
          <time dateTime={episode.publishedAt}>{formatDate(episode.publishedAt)}</time>
          <span aria-hidden> · {formatDuration(episode.durationSeconds)}</span>
          <span className="sr-only">, {spokenDuration(episode.durationSeconds)}</span>
        </p>
      </div>
    </article>
  )
}
