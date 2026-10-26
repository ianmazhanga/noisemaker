import { Link, useParams } from 'react-router'
import { ArrowRight, Info } from 'lucide-react'
import { Seo } from '../components/seo/Seo'
import { YouTubeLink } from '../components/player/YouTubeLink'
import { EpisodeGridCard, TopicLabel } from '../components/episodes/EpisodeCards'
import { ClipCard } from '../components/clips/ClipCard'
import { YouTubeIcon } from '../components/ui/BrandIcons'
import { Thumb } from '../components/ui/Thumb'
import { ShareButton } from '../components/ui/ShareButton'
import { buttonClass } from '../components/ui/buttonClass'
import { getClipsForEpisode, getEpisode, getGuestsFor, getRelatedEpisodes, getSeriesParts, getTopic } from '../lib/content'
import { formatLongDate, formatRuntime } from '../lib/format'
import { breadcrumbLd, episodeVideoLd } from '../lib/structuredData'
import { shareImage, youtubeWatchUrl } from '../lib/youtube'
import NotFoundPage from './NotFoundPage'

export default function EpisodePage() {
  const { slug } = useParams()
  const episode = getEpisode(slug)
  if (!episode) return <NotFoundPage />

  const guests = getGuestsFor(episode.guestIds)
  const clips = getClipsForEpisode(episode.slug)
  const parts = getSeriesParts(episode)
  const related = getRelatedEpisodes(episode, 3)
  const topic = getTopic(episode.topic)

  return (
    <>
      <Seo
        title={episode.title}
        description={episode.summary}
        image={shareImage(episode.youtubeId, episode.hd)}
        imageAlt={`Thumbnail for “${episode.title}”`}
        type="video.episode"
        jsonLd={[
          episodeVideoLd(episode),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Episodes', path: '/episodes' },
            { name: episode.title, path: `/episodes/${episode.slug}` },
          ]),
        ]}
      />

      <article>
        <header className="wrap pt-8 md:pt-12">
          <nav aria-label="Breadcrumb" className="mb-8 text-sm text-muted">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link to="/" className="link-grow hover:text-ink">
                  Home
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li>
                <Link to="/episodes" className="link-grow hover:text-ink">
                  Episodes
                </Link>
              </li>
              {topic && (
                <>
                  <li aria-hidden>/</li>
                  <li>
                    <Link to={`/episodes?topic=${topic.slug}`} className="link-grow hover:text-ink">
                      {topic.name}
                    </Link>
                  </li>
                </>
              )}
            </ol>
          </nav>
          <div className="max-w-5xl">
            <TopicLabel episode={episode} />
            <h1 className="display-lg mt-4">{episode.title}</h1>
            <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-muted">
              {guests.length > 0 && <span className="font-semibold text-ink">With {guests.map((g) => g.name).join(' and ')}</span>}
              <time dateTime={episode.publishedAt}>{formatLongDate(episode.publishedAt)}</time>
              <span>{formatRuntime(episode.durationSeconds)}</span>
            </p>
          </div>
        </header>

        <div className="wrap mt-8 md:mt-10">
          <div className="max-w-[1100px]">
            <YouTubeLink key={episode.slug} youtubeId={episode.youtubeId} title={episode.title} hd={episode.hd} priority className="rounded-lg" />
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <a href={youtubeWatchUrl(episode.youtubeId)} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'md')}>
                <YouTubeIcon className="size-4" /> Watch on YouTube<span className="sr-only"> (opens in a new tab)</span>
              </a>
              <ShareButton title={episode.title} />
            </div>
          </div>
        </div>

        <div className="wrap grid gap-14 py-14 md:py-20 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-7">
            <p className="measure text-xl leading-relaxed md:text-2xl md:leading-snug">{episode.summary}</p>
            <div className="measure mt-6 space-y-5 text-lg text-muted">
              {episode.description.map((p, i) => (
                <p key={i} className="whitespace-pre-line [overflow-wrap:anywhere]">
                  {p}
                </p>
              ))}
            </div>
            {episode.points && (
              <section aria-labelledby="points-title" className="mt-12">
                <h2 id="points-title" className="kicker text-ink">
                  In this conversation
                </h2>
                <ol className="mt-5 divide-y divide-line border-y border-line">
                  {episode.points.map((point, i) => (
                    <li key={point} className="flex gap-5 py-4 text-lg">
                      <span className="w-6 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-blue-ink">{String(i + 1).padStart(2, '0')}</span>
                      {point}
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {episode.notice && (
              <aside aria-labelledby="notice-title" className="mt-12 flex gap-4 rounded-lg bg-bone p-6">
                <Info className="mt-0.5 size-5 shrink-0 text-blue-ink" aria-hidden />
                <div>
                  <h2 id="notice-title" className="font-semibold">
                    {episode.notice.title}
                  </h2>
                  {episode.notice.body.map((p) => (
                    <p key={p} className="mt-2 text-muted">
                      {p}
                    </p>
                  ))}
                </div>
              </aside>
            )}
          </div>

          <aside className="space-y-12 lg:col-span-4 lg:col-start-9">
            {guests.length > 0 && (
              <section aria-labelledby="guests-title">
                <h2 id="guests-title" className="kicker border-b border-ink pb-3">
                  {guests.length > 1 ? 'The noisemakers' : 'The noisemaker'}
                </h2>
                <ul className="mt-5 space-y-6">
                  {guests.map((g) => (
                    <li key={g.id} className="grid grid-cols-[4.5rem_1fr] gap-4">
                      <Thumb youtubeId={g.portrait.youtubeId} hd={g.portrait.hd} focus={g.portrait.focus} alt="" sizes="72px" zoom={false} className="aspect-[3/4] rounded-md" />
                      <div>
                        <p className="title text-lg">{g.name}</p>
                        <p className="mt-1 text-sm text-muted">{g.role}</p>
                        <Link to={`/episodes?guest=${g.id}`} className="group mt-2 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-blue-ink">
                          <span className="link-grow">All episodes with {g.name}</span>
                          <ArrowRight className="size-3.5" aria-hidden />
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
                {guests.flatMap((g) => g.links ?? []).map((l) => (
                  <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-9 items-center text-sm font-semibold underline underline-offset-4">
                    {l.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ))}
              </section>
            )}

            {parts.length > 1 && episode.series && (
              <section aria-labelledby="series-title">
                <h2 id="series-title" className="kicker border-b border-ink pb-3">
                  {episode.series.name}: all parts
                </h2>
                <ol className="divide-y divide-line">
                  {parts.map((p) => (
                    <li key={p.slug}>
                      {p.slug === episode.slug ? (
                        <p className="flex min-h-14 items-center gap-3 py-3 font-semibold" aria-current="page">
                          <span className="text-sm text-blue-ink">Part {p.series?.part}</span> Now viewing
                        </p>
                      ) : (
                        <Link to={`/episodes/${p.slug}`} className="group flex min-h-14 items-center gap-3 py-3 font-semibold">
                          <span className="text-sm text-blue-ink">Part {p.series?.part}</span>
                          <span className="link-grow">{formatRuntime(p.durationSeconds)}</span>
                          <ArrowRight className="ml-auto size-4" aria-hidden />
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {clips.length > 0 && (
              <section aria-labelledby="clips-title">
                <h2 id="clips-title" className="kicker border-b border-ink pb-3">
                  Clips from this conversation
                </h2>
                <ul className="mt-5 grid grid-cols-2 gap-4">
                  {clips.map((c) => (
                    <li key={c.youtubeId}>
                      <ClipCard clip={{ ...c, episodeSlug: undefined }} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      </article>

      {related.length > 0 && (
        <section aria-labelledby="related-title" className="border-t border-line bg-bone py-16 md:py-20">
          <div className="wrap">
            <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
              <h2 id="related-title" className="display-md">
                Keep watching
              </h2>
              <Link to="/episodes" className="group inline-flex min-h-11 items-center gap-2 font-semibold">
                <span className="link-grow">All episodes</span>
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <ul className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((e) => (
                <li key={e.slug}>
                  <EpisodeGridCard episode={e} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  )
}
