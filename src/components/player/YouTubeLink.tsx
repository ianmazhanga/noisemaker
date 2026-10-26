import type { Focus } from '../../types/content'
import { youtubeShortUrl, youtubeWatchUrl } from '../../lib/youtube'
import { Thumb } from '../ui/Thumb'
import { PlayIcon } from './PlayIcon'

interface YouTubeLinkProps {
  youtubeId: string
  title: string
  hd?: boolean
  focus?: Focus
  vertical?: boolean
  priority?: boolean
  className?: string
}

/** Large thumbnail with a play button. Videos play on YouTube, so it opens the video there in a new tab. */
export function YouTubeLink({ youtubeId, title, hd, focus, vertical, priority, className = '' }: YouTubeLinkProps) {
  return (
    <a
      href={vertical ? youtubeShortUrl(youtubeId) : youtubeWatchUrl(youtubeId)}
      target="_blank"
      rel="noopener noreferrer"
      className={`group relative block w-full overflow-hidden bg-ink ${vertical ? 'aspect-[9/16]' : 'aspect-video'} ${className}`}
      aria-label={`Watch on YouTube: ${title} (opens in a new tab)`}
    >
      <Thumb youtubeId={youtubeId} hd={hd} vertical={vertical} focus={focus} alt="" priority={priority} sizes="(min-width: 1100px) 1100px, 100vw" className="absolute inset-0" />
      <span aria-hidden className="absolute inset-0 bg-ink/15 transition-colors duration-300 group-hover:bg-ink/0" />
      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <PlayIcon size="lg" />
      </span>
    </a>
  )
}
