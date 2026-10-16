import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { getCuratedEpisodes } from '../../lib/content'
import { EpisodeFeatureCard, EpisodePortraitCard } from '../episodes/EpisodeCards'
import { Rail } from '../ui/Rail'
import { SectionHeading } from '../ui/SectionHeading'

const control =
  'inline-flex size-11 items-center justify-center rounded-full border-[1.5px] border-ink/20 text-ink transition-colors hover:border-ink hover:bg-ink hover:text-paper'

/**
 * Curated set: one feature card, then a rail of portrait crops showing what's
 * next. The arrows move the next conversation into the feature slot, looping
 * at either end. Scrolling the rail by hand (drag, swipe, trackpad) moves the
 * cards scrolled past into the feature slot too. Curate in HOMEPAGE.conversations.
 */
export function Conversations() {
  const episodes = getCuratedEpisodes()
  const [active, setActive] = useState(0)
  if (!episodes.length) return null

  const count = episodes.length
  const feature = episodes[active]
  // Up next, in order, wrapping round to the start.
  const upNext = [...episodes.slice(active + 1), ...episodes.slice(0, active)]
  const go = (step: number) => setActive((i) => (((i + step) % count) + count) % count)

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
            <EpisodeFeatureCard key={feature.slug} episode={feature} />
          </div>
          <div className="min-w-0 lg:col-span-6">
            {upNext.length > 0 && (
              // Remounting on change starts the rail at the next conversation again.
              <Rail key={feature.slug} label="Up next" controls={false} onSettle={(passed) => passed > 0 && go(passed)}>
                {upNext.map((episode) => (
                  <li key={episode.slug} className="w-[64vw] max-w-72 sm:w-[17rem] lg:w-[calc((100%-1.5rem)/2.25)]">
                    <EpisodePortraitCard episode={episode} />
                  </li>
                ))}
              </Rail>
            )}
            {count > 1 && (
              <div className="mt-5 flex items-center justify-end gap-3">
                <p className="mr-auto text-sm text-muted tabular-nums lg:mr-1" aria-live="polite">
                  <span className="sr-only">Showing conversation </span>
                  {active + 1} of {count}
                  <span className="sr-only">: {feature.title}</span>
                </p>
                <button type="button" className={control} onClick={() => go(-1)} aria-label="Previous conversation">
                  <ArrowLeft className="size-4" aria-hidden />
                </button>
                <button type="button" className={control} onClick={() => go(1)} aria-label="Next conversation">
                  <ArrowRight className="size-4" aria-hidden />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
