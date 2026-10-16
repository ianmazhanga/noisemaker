import { Link } from 'react-router'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { Seo } from '../components/seo/Seo'
import { PageIntro } from '../components/ui/PageIntro'
import { Thumb } from '../components/ui/Thumb'
import { ExternalButton } from '../components/ui/Button'
import { YouTubeIcon } from '../components/ui/BrandIcons'
import { SITE } from '../config/site'
import { countByTopic, getEpisodesByGuest, getGuests, getTopics, guestCredits } from '../lib/content'
import { breadcrumbLd, seriesLd } from '../lib/structuredData'

export default function AboutPage() {
  const topics = getTopics()
  const guests = getGuests()

  return (
    <>
      <Seo
        title="About"
        description="Noisemakers is a video podcast of inspirational interviews and stories, made in the hope that each conversation heals someone somewhere."
        jsonLd={[
          seriesLd(),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'About', path: '/about' },
          ]),
        ]}
      />
      <PageIntro
        kicker="About the podcast"
        title={
          <>
            The noise you didn’t know you <span className="mark">needed.</span>
          </>
        }
        crumbs={[{ label: 'Home', to: '/' }, { label: 'About' }]}
      />

      <section aria-label="What Noisemakers is" className="wrap grid gap-10 pb-16 md:pb-24 lg:grid-cols-12">
        <div className="space-y-6 text-lg text-muted lg:col-span-7 lg:text-xl lg:leading-relaxed">
          <p className="text-ink">
            Noisemakers is a podcast of inspirational interviews and stories, making noise about different aspects of life one story at a time.
          </p>
          <p>
            The aim is that each interview heals someone somewhere: that it helps improve family relationships and mend broken ones. Difficult topics, from addiction to the conversations
            couples avoid, are approached with a focus on positive outcomes.
          </p>
          <p>
            It began from a desire to encourage conversations that let different voices in families and communities be heard. It is a Christian motivational channel, and many episode descriptions
            open with a verse of scripture.
          </p>
        </div>
        <aside className="lg:col-span-4 lg:col-start-9">
          <div className="rounded-lg bg-ink p-7 text-paper on-dark">
            <p className="kicker text-muted-dark">Where to watch</p>
            <p className="title mt-3 text-2xl">YouTube, {SITE.youtube.handle}</p>
            <p className="mt-2 text-paper/70">
              On YouTube the channel is called {SITE.channelName}. Full episodes and short clips have been published there since {SITE.since}.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <ExternalButton href={SITE.youtube.subscribeUrl} variant="yellow">
                <YouTubeIcon className="size-4" /> Subscribe on YouTube
              </ExternalButton>
              <ExternalButton href={SITE.youtube.channelUrl} variant="outline-light">
                Visit the channel
              </ExternalButton>
            </div>
          </div>
        </aside>
      </section>

      <section aria-labelledby="topics-title" className="bg-bone py-16 md:py-24">
        <div className="wrap">
          <h2 id="topics-title" className="display-lg">
            What we <span className="accent">talk about</span>
          </h2>
          <ul className="mt-10 grid gap-px overflow-hidden rounded-lg bg-line sm:grid-cols-2 lg:grid-cols-4">
            {topics.map((t) => (
              <li key={t.slug} className="bg-bone">
                <Link to={`/episodes?topic=${t.slug}`} className="group flex h-full flex-col gap-3 p-6 transition-colors hover:bg-paper md:p-8">
                  <span className="text-sm font-semibold tabular-nums text-blue-ink">
                    {countByTopic(t.slug)} episode{countByTopic(t.slug) === 1 ? '' : 's'}
                  </span>
                  <span className="title text-2xl">{t.name}</span>
                  <span className="text-muted">{t.description}</span>
                  <ArrowRight className="mt-auto size-5 pt-2 transition-transform group-hover:translate-x-1" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="people-title" className="py-16 md:py-24">
        <div className="wrap">
          <h2 id="people-title" className="display-lg">
            The <span className="accent">noisemakers</span>
          </h2>
          <p className="measure mt-4 text-lg text-muted">Each episode centres on a guest, the noisemaker. Here is everyone who has sat down so far.</p>
          <ul className="mt-12 divide-y divide-line border-y border-line">
            {guests.map((g) => (
              <li key={g.id} id={g.id} className="grid scroll-mt-28 gap-6 py-10 md:grid-cols-12 md:gap-10">
                <Thumb
                  youtubeId={g.portrait.youtubeId}
                  hd={g.portrait.hd}
                  focus={g.portrait.focus}
                  alt={`${g.name}, from their episode on Noisemakers`}
                  sizes="(min-width: 768px) 300px, 100vw"
                  zoom={false}
                  className="aspect-video rounded-lg md:col-span-3 md:aspect-[3/4]"
                />
                <div className="md:col-span-6">
                  <h3 className="title text-2xl md:text-3xl">{g.name}</h3>
                  <p className="mt-1 font-semibold">{g.role}</p>
                  <p className="mt-3 text-muted">{g.bio}</p>
                  {g.links?.map((l) => (
                    <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-blue-ink">
                      {l.label} <ArrowUpRight className="size-3.5" aria-hidden />
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ))}
                </div>
                <div className="md:col-span-3">
                  <p className="kicker text-muted">{guestCredits(g.id)}</p>
                  <ul className="mt-3 space-y-2">
                    {getEpisodesByGuest(g.id).map((e) => (
                      <li key={e.slug}>
                        <Link to={`/episodes/${e.slug}`} className="link-grow text-[0.9375rem] font-semibold">
                          {e.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  )
}
