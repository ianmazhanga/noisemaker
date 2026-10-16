import { useState } from 'react'
import { youtubeEmbedUrl, youtubeShortUrl, youtubeWatchUrl } from '../../lib/youtube'
import { YouTubeIcon } from '../ui/BrandIcons'
import { buttonClass } from '../ui/buttonClass'
import type { Focus } from '../../types/content'
import { Thumb } from '../ui/Thumb'
import { PlayIcon } from './PlayIcon'

interface LiteYouTubeProps {
  youtubeId: string
  title: string
  hd?: boolean
  focus?: Focus
  vertical?: boolean
  /** YouTube doesn't allow this video to play here: show a link to YouTube instead of a player. */
  restricted?: boolean
  /** Load the player straight away (e.g. inside a modal opened by a click). */
  autoload?: boolean
  priority?: boolean
  className?: string
}

/**
 * Click-to-load YouTube player. Shows only the thumbnail until someone asks
 * to play, so no YouTube scripts or cookies load on page view. Uses the
 * privacy-enhanced youtube-nocookie.com domain.
 */
export function LiteYouTube({ youtubeId, title, hd, focus, vertical, restricted, autoload, priority, className = '' }: LiteYouTubeProps) {
  const [active, setActive] = useState(Boolean(autoload))
  const [ready, setReady] = useState(false)

  if (restricted) {
    return (
      <div className={`relative w-full overflow-hidden bg-ink ${vertical ? 'aspect-[9/16]' : 'aspect-video'} ${className}`}>
        <Thumb youtubeId={youtubeId} hd={hd} vertical={vertical} focus={focus} alt="" priority={priority} sizes="(min-width: 1100px) 1100px, 100vw" className="absolute inset-0 opacity-40" />
        <div className="on-dark absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-paper">
          <p className="max-w-sm font-semibold">YouTube only lets this video play on YouTube.</p>
          <a href={vertical ? youtubeShortUrl(youtubeId) : youtubeWatchUrl(youtubeId)} target="_blank" rel="noopener noreferrer" className={buttonClass('light', 'md')}>
            <YouTubeIcon className="size-4 text-[#ff0033]" /> Watch on YouTube<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative w-full overflow-hidden bg-ink ${vertical ? 'aspect-[9/16]' : 'aspect-video'} ${className}`}>
      {!active ? (
        <button type="button" onClick={() => setActive(true)} className="group absolute inset-0 block w-full" aria-label={`Play: ${title}`}>
          <Thumb youtubeId={youtubeId} hd={hd} vertical={vertical} focus={focus} alt="" priority={priority} sizes="(min-width: 1100px) 1100px, 100vw" className="absolute inset-0" />
          <span aria-hidden className="absolute inset-0 bg-ink/15 transition-colors duration-300 group-hover:bg-ink/0" />
          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <PlayIcon size="lg" />
          </span>
        </button>
      ) : (
        <>
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center" role="status">
              <span className="size-10 animate-spin-slow rounded-full border-2 border-paper/20 border-t-paper" aria-hidden />
              <span className="sr-only">Loading video player</span>
            </div>
          )}
          <iframe
            src={youtubeEmbedUrl(youtubeId)}
            title={title}
            onLoad={() => setReady(true)}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </>
      )}
    </div>
  )
}
