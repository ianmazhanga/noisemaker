import { Link } from 'react-router'
import { ArrowRight, Play } from 'lucide-react'
import { getEpisodes, getGuestsFor, getLatestEpisodes, getLeadEpisode } from '../../lib/content'
import { formatLongDate, formatRuntime } from '../../lib/format'
import { usePlayer } from '../player/PlayerContext'
import { PlayIcon } from '../player/PlayIcon'
import { EpisodeRow, TopicLabel } from '../episodes/EpisodeCards'
import { Thumb } from '../ui/Thumb'
import { SectionHeading } from '../ui/SectionHeading'
import { buttonClass } from '../ui/buttonClass'

/** Editorial feed: the lead episode large, the next few as a list beside it. */
export function LatestConversations() {
  const { playEpisode } = usePlayer()
  const lead = getLeadEpisode()
  const more = getLatestEpisodes(4, [lead.slug])
  const guests = getGuestsFor(lead.guestIds)
  const total = getEpisodes().length

  return (
    <section aria-labelledby="latest-title" className="bg-bone py-16 md:py-24">
      <div className="wrap">
        <SectionHeading id="latest-title" index="02" kicker="Fresh from the studio" title="Latest conversations" />
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
          <article className="group lg:col-span-7">
            <button type="button" onClick={() => playEpisode(lead)} className="relative block w-full overflow-hidden rounded-lg" aria-label={`Play episode: ${lead.title}`}>
              <Thumb youtubeId={lead.youtubeId} hd={lead.hd} alt="" sizes="(min-width: 1024px) 800px, 100vw" className="aspect-video" />
              <span className="absolute bottom-4 left-4 md:bottom-6 md:left-6">
                <PlayIcon size="lg" />
              </span>
            </button>
            <div className="mt-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <TopicLabel episode={lead} />
                <span className="text-sm text-muted">
                  <time dateTime={lead.publishedAt}>{formatLongDate(lead.publishedAt)}</time> · {formatRuntime(lead.durationSeconds)}
                </span>
              </div>
              <h3 className="display-md mt-3">
                <Link to={`/episodes/${lead.slug}`} className="link-grow">
                  {lead.title}
                </Link>
              </h3>
              {guests.length > 0 && <p className="mt-3 font-semibold">With {guests.map((g) => g.name).join(' and ')}</p>}
              <p className="measure mt-2 text-lg text-muted">{lead.summary}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" onClick={() => playEpisode(lead)} className={buttonClass('dark', 'md')}>
                  <Play className="size-4 fill-current" aria-hidden /> Play episode
                </button>
                <Link to={`/episodes/${lead.slug}`} className={buttonClass('outline', 'md')}>
                  Episode details
                </Link>
              </div>
            </div>
          </article>

          <div className="lg:col-span-5">
            <h3 className="kicker border-b border-ink pb-3 text-ink">More recent episodes</h3>
            <ul className="divide-y divide-line">
              {more.map((episode) => (
                <li key={episode.slug} className="py-5">
                  <EpisodeRow episode={episode} as="h4" />
                </li>
              ))}
            </ul>
            <Link to="/episodes" className="group mt-2 inline-flex min-h-11 items-center gap-2 font-semibold">
              <span className="link-grow">Browse all {total} episodes</span>
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
