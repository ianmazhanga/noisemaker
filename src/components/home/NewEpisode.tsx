import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { getLeadEpisode } from '../../lib/content'
import { youtubeWatchUrl } from '../../lib/youtube'
import { formatLongDate, formatRuntime } from '../../lib/format'
import { PlayIcon } from '../player/PlayIcon'
import { YouTubeIcon } from '../ui/BrandIcons'
import { Thumb } from '../ui/Thumb'
import { buttonClass } from '../ui/buttonClass'
import { TopicLabel } from '../episodes/EpisodeCards'

/** An episode counts as "new" for this long after it's published; after that it's the "latest". */
const NEW_FOR_DAYS = 30

/** Reveals the section once as it scrolls into view. Without IntersectionObserver it just shows. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, shown] as const
}

/**
 * The newest interview, featured right below the hero. It updates by itself: the hourly YouTube
 * sync adds new uploads, and the newest full episode (never a Short or a trailer) is shown.
 */
export function NewEpisode() {
  const episode = getLeadEpisode()
  const [ref, shown] = useReveal<HTMLElement>()
  // The moment the page opened, for the "new" label.
  const [now] = useState(() => Date.now())
  if (!episode) return null

  const isNew = now - Date.parse(episode.publishedAt) < NEW_FOR_DAYS * 86_400_000
  const watch = youtubeWatchUrl(episode.youtubeId)
  // Each part slides in after the one before; reduced-motion users get everything at once.
  const reveal = (delay: string) =>
    `transition-[opacity,translate] duration-700 ease-[var(--ease-out)] motion-reduce:transition-none ${delay} ${shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100'}`

  return (
    <section ref={ref} aria-labelledby="new-episode-title" className="on-dark relative isolate overflow-hidden bg-ink py-16 text-paper md:py-24">
      {/* Soft blue light behind the thumbnail */}
      <div aria-hidden className="pointer-events-none absolute -top-1/3 right-[-10%] -z-10 size-[42rem] max-w-[120vw] rounded-full bg-blue/30 blur-[120px] md:size-[56rem]" />
      <div aria-hidden className="pointer-events-none absolute bottom-[-30%] left-[-15%] -z-10 size-[30rem] rounded-full bg-blue-deep/25 blur-[120px]" />

      <div className="wrap grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
        <div className="lg:col-span-5">
          <p className={`kicker inline-flex items-center gap-2.5 text-yellow ${reveal('')}`}>
            <span className="relative flex size-2.5" aria-hidden>
              <span className="absolute inline-flex size-full rounded-full bg-yellow opacity-70 motion-safe:animate-ping" />
              <span className="relative inline-flex size-2.5 rounded-full bg-yellow" />
            </span>
            {isNew ? 'New episode' : 'Latest episode'}
          </p>
          <h2 id="new-episode-title" className={`display-lg mt-5 text-paper ${reveal('delay-100')}`}>
            {episode.title}
          </h2>
          <p className={`measure mt-6 line-clamp-5 text-lg text-paper/75 ${reveal('delay-200')}`}>{episode.summary}</p>
          <div className={`mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-dark ${reveal('delay-200')}`}>
            <TopicLabel episode={episode} dark />
            <span>
              <time dateTime={episode.publishedAt}>{formatLongDate(episode.publishedAt)}</time> · {formatRuntime(episode.durationSeconds)}
            </span>
          </div>
          <div className={`mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap ${reveal('delay-300')}`}>
            <a href={watch} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'lg', 'shadow-[0_12px_40px_-12px_rgb(26_98_242_/_0.9)]')}>
              <YouTubeIcon className="size-5" />
              Watch Latest Interview
              <span className="sr-only"> on YouTube (opens in a new tab)</span>
            </a>
            <Link to={`/episodes/${episode.slug}`} className={buttonClass('outline-light', 'lg')}>
              About this episode <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>

        <div className={`lg:col-span-7 ${reveal('delay-150')} ${shown ? 'scale-100' : 'motion-safe:scale-[0.97]'}`}>
          <a
            href={watch}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative block overflow-hidden rounded-2xl ring-1 ring-paper/10 shadow-[0_40px_120px_-40px_rgb(26_98_242_/_0.75)] transition-shadow duration-500 hover:shadow-[0_40px_140px_-30px_rgb(26_98_242_/_0.95)]"
            aria-label={`Watch on YouTube: ${episode.title} (opens in a new tab)`}
          >
            <Thumb youtubeId={episode.youtubeId} hd={episode.hd} alt={`Thumbnail for the interview “${episode.title}”`} sizes="(min-width: 1024px) 760px, 100vw" className="aspect-video" />
            <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink/60 via-transparent to-transparent" />
            <span className="absolute bottom-4 left-4 transition-transform duration-300 group-hover:scale-105 md:bottom-6 md:left-6">
              <PlayIcon size="lg" />
            </span>
            <span className="absolute right-4 bottom-4 rounded-full bg-ink/80 px-3 py-1.5 text-xs font-semibold text-paper md:right-6 md:bottom-6">{formatRuntime(episode.durationSeconds)}</span>
          </a>
        </div>
      </div>
    </section>
  )
}
