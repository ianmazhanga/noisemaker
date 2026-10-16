import { Link } from 'react-router'
import { Mic, Play } from 'lucide-react'
import { HOMEPAGE, SITE } from '../../config/site'
import { getClips, getEpisode, getLeadEpisode } from '../../lib/content'
import { formatDuration, formatRuntime } from '../../lib/format'
import type { Clip, Episode } from '../../types/content'
import { usePlayer } from '../player/PlayerContext'
import { PlayIcon } from '../player/PlayIcon'
import { YouTubeIcon } from '../ui/BrandIcons'
import { Thumb } from '../ui/Thumb'
import { buttonClass } from '../ui/buttonClass'

function TileLabel({ children }: { children: string }) {
  return <span className="absolute top-3 left-3 rounded-full bg-paper px-2.5 py-1 text-xs leading-none font-semibold text-ink">{children}</span>
}

function EpisodeTile({ episode, className, portrait, priority }: { episode: Episode; className: string; portrait?: boolean; priority?: boolean }) {
  const { playEpisode } = usePlayer()
  return (
    <button type="button" onClick={() => playEpisode(episode)} className={`group absolute block overflow-hidden rounded-lg ${className}`} aria-label={`Play episode: ${episode.title}`}>
      <Thumb
        youtubeId={episode.youtubeId}
        hd={episode.hd}
        focus={portrait ? episode.focus : undefined}
        alt=""
        priority={priority}
        sizes="(min-width: 1024px) 420px, 80vw"
        className="absolute inset-0"
      />
      <TileLabel>{`Episode · ${formatRuntime(episode.durationSeconds)}`}</TileLabel>
      <span className={`absolute ${portrait ? 'right-3 bottom-[18%]' : 'bottom-3 left-3'}`}>
        <PlayIcon size="sm" />
      </span>
    </button>
  )
}

function ClipTile({ clip, className }: { clip: Clip; className: string }) {
  const { playClip } = usePlayer()
  return (
    <button type="button" onClick={() => playClip(clip)} className={`group absolute block overflow-hidden rounded-lg ${className}`} aria-label={`Play clip: ${clip.title}`}>
      <Thumb youtubeId={clip.youtubeId} vertical alt="" sizes="200px" className="absolute inset-0" priority />
      <TileLabel>{`Clip · ${formatDuration(clip.durationSeconds)}`}</TileLabel>
      <span className="absolute bottom-3 left-3">
        <PlayIcon size="sm" />
      </span>
    </button>
  )
}

export function Hero() {
  const { playEpisode } = usePlayer()
  const lead = getLeadEpisode()
  const portrait = getEpisode(HOMEPAGE.heroCollage.portraitEpisode)
  const landscape = getEpisode(HOMEPAGE.heroCollage.landscapeEpisode)
  const clip = getClips().find((c) => c.youtubeId === HOMEPAGE.heroCollage.clip)

  return (
    <section aria-labelledby="hero-title" className="overflow-hidden">
      <div className="wrap grid items-center gap-10 pt-8 pb-16 md:pt-14 md:pb-24 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-6 xl:col-span-6">
          <p className="kicker flex items-center gap-2.5 text-muted">
            <span className="size-2 rounded-full bg-blue" aria-hidden />
            A video podcast of inspirational interviews & stories
          </p>
          <h1 id="hero-title" className="display-xl mt-5 md:mt-6">
            Not all noise is <span className="mark">bad noise.</span>
          </h1>
          <p className="measure mt-6 text-lg text-muted md:mt-8 md:text-xl md:leading-relaxed">
            Honest conversations about marriage, parenting, family and recovery, with the people who have lived them.{' '}
            <span className="text-ink">This is the noise you didn’t know you needed.</span>
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap md:mt-10">
            {lead ? (
              <button type="button" onClick={() => playEpisode(lead)} className={buttonClass('primary', 'lg', 'w-full sm:w-auto')}>
                <Play className="size-4 fill-current" aria-hidden /> Watch the latest episode
              </button>
            ) : (
              <a href={SITE.youtube.channelUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'lg', 'w-full sm:w-auto')}>
                <YouTubeIcon className="size-5" /> Watch on YouTube<span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            <Link to="/tell-your-story" className={buttonClass('dark', 'lg', 'w-full sm:w-auto')}>
              <Mic className="size-4" aria-hidden /> Tell your story
            </Link>
          </div>

          <dl className="mt-8 grid max-w-xl gap-4 border-t border-line pt-6 text-sm sm:grid-cols-2 md:mt-10">
            {lead && (
              <div>
                <dt className="kicker text-muted">Latest episode</dt>
                <dd className="mt-1.5 font-semibold">
                  <Link to={`/episodes/${lead.slug}`} className="link-grow">
                    {lead.title}
                  </Link>
                </dd>
              </div>
            )}
            <div>
              <dt className="kicker text-muted">Never miss an episode</dt>
              <dd className="mt-1.5">
                <a href={SITE.youtube.subscribeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-semibold">
                  <YouTubeIcon className="size-4 text-blue" />
                  <span className="link-grow">Subscribe on YouTube, {SITE.youtube.handle}</span>
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </dd>
            </div>
          </dl>
        </div>

        {/* Collage: recomposed per breakpoint rather than scaled down */}
        <div className="lg:col-span-6 xl:col-span-6">
          <div className="relative aspect-[10/6.2] lg:aspect-[10/10.8]">
            {portrait && <EpisodeTile episode={portrait} portrait className="aspect-[3/4] max-lg:hidden lg:top-0 lg:right-0 lg:w-[54%]" />}
            {clip && (
              <ClipTile
                clip={clip}
                className="top-[7%] right-0 z-10 aspect-[9/16] w-[30%] ring-6 ring-paper lg:top-[8%] lg:z-0 lg:right-auto lg:left-[3%] lg:w-[31%] lg:ring-0"
              />
            )}
            {landscape && (
              <EpisodeTile
                episode={landscape}
                priority
                className="top-0 left-0 aspect-video w-[76%] lg:top-auto lg:bottom-0 lg:w-[72%] lg:ring-8 lg:ring-paper"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
