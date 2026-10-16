import { Seo } from '../components/seo/Seo'
import { PageIntro } from '../components/ui/PageIntro'
import { ClipCard } from '../components/clips/ClipCard'
import { ExternalButton } from '../components/ui/Button'
import { YouTubeIcon } from '../components/ui/BrandIcons'
import { SITE } from '../config/site'
import { getClips } from '../lib/content'
import { breadcrumbLd, clipVideoLd } from '../lib/structuredData'

export default function ClipsPage() {
  const clips = getClips()
  const fromConversations = clips.filter((c) => c.guestIds.length)
  const lighter = clips.filter((c) => !c.guestIds.length)

  const grid = 'grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 md:gap-x-6 lg:grid-cols-4 xl:grid-cols-5'

  return (
    <>
      <Seo
        title="Clips"
        description="Short clips from Noisemakers conversations about marriage, parenting and recovery, each linked to the full episode where there is one."
        jsonLd={[
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Clips', path: '/clips' },
          ]),
          { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: clips.map((c, i) => ({ '@type': 'ListItem', position: i + 1, item: clipVideoLd(c) })) },
        ]}
      />
      <PageIntro
        kicker="Clips"
        title={
          <>
            A minute is <span className="accent">enough</span> to start
          </>
        }
        intro="Short moments from the conversations. Each one links to the full episode it came from, where there is one."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Clips' }]}
      >
        <ExternalButton href={SITE.youtube.shortsUrl} variant="dark" className="mt-8">
          <YouTubeIcon className="size-4" /> All Shorts on YouTube
        </ExternalButton>
      </PageIntro>

      <div className="wrap pb-20 md:pb-28">
        <section aria-labelledby="from-conversations">
          <h2 id="from-conversations" className="kicker border-b border-ink pb-3">
            From the conversations
          </h2>
          <ul className={`mt-8 ${grid}`}>
            {fromConversations.map((clip) => (
              <li key={clip.youtubeId}>
                <ClipCard clip={clip} />
              </li>
            ))}
          </ul>
        </section>

        {lighter.length > 0 && (
          <section aria-labelledby="lighter" className="mt-20">
            <h2 id="lighter" className="kicker border-b border-ink pb-3">
              Something lighter
            </h2>
            <ul className={`mt-8 ${grid}`}>
              {lighter.map((clip) => (
                <li key={clip.youtubeId}>
                  <ClipCard clip={clip} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}
