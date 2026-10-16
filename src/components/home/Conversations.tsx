import { getCuratedEpisodes } from '../../lib/content'
import { EpisodeFeatureCard, EpisodePortraitCard } from '../episodes/EpisodeCards'
import { Rail } from '../ui/Rail'
import { SectionHeading } from '../ui/SectionHeading'

/** Curated set: one feature card, then a rail of portrait crops. Curate in HOMEPAGE.conversations. */
export function Conversations() {
  const [feature, ...rest] = getCuratedEpisodes()
  if (!feature) return null

  return (
    <section aria-labelledby="conversations-title" className="border-t border-line py-16 md:py-24">
      <div className="wrap">
        <SectionHeading
          id="conversations-title"
          index="01"
          kicker="Start here"
          title={
            <>
              The <span className="accent">conversations</span>
            </>
          }
          intro="Fatherhood, raising a family abroad, the words couples struggle to say. These are the episodes to start with."
          action={{ label: 'All episodes', to: '/episodes' }}
        />
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-6">
            <EpisodeFeatureCard episode={feature} />
          </div>
          <div className="min-w-0 lg:col-span-6">
            <Rail label="More conversations to start with">
              {rest.map((episode) => (
                <li key={episode.slug} className="w-[64vw] max-w-72 sm:w-[17rem] lg:w-[calc((100%-1.5rem)/2.25)]">
                  <EpisodePortraitCard episode={episode} />
                </li>
              ))}
            </Rail>
          </div>
        </div>
      </div>
    </section>
  )
}
