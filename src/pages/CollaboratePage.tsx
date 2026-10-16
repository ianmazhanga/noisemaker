import { Mail, MessageSquareText, Play } from 'lucide-react'
import { Seo } from '../components/seo/Seo'
import { PageIntro } from '../components/ui/PageIntro'
import { ExternalButton } from '../components/ui/Button'
import { buttonClass } from '../components/ui/buttonClass'
import { YouTubeIcon } from '../components/ui/BrandIcons'
import { SITE } from '../config/site'
import { getLeadEpisode } from '../lib/content'
import { youtubeWatchUrl } from '../lib/youtube'
import { breadcrumbLd } from '../lib/structuredData'

export default function CollaboratePage() {
  const lead = getLeadEpisode()
  const step = 'grid gap-5 border-t border-line py-8 md:grid-cols-12 md:gap-10 md:py-10'

  return (
    <>
      <Seo
        title="Collaborate"
        description="Have a story worth making noise about? How to suggest a topic or a guest to Noisemakers."
        jsonLd={breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Collaborate', path: '/collaborate' },
        ])}
      />
      <PageIntro
        kicker="Collaborate"
        title={
          <>
            Have a story worth making <span className="accent">noise</span> about?
          </>
        }
        intro="Noisemakers features people willing to talk honestly about family, marriage, parenting, faith and recovery. If you’d like to celebrate someone, such as your father, or suggest a topic that would help families, the show asks you to say so in the comments."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Collaborate' }]}
      />

      <div className="wrap pb-20 md:pb-28">
        <ol>
          <li className={step}>
            <div className="flex items-start gap-4 md:col-span-5">
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-blue text-white">
                <MessageSquareText className="size-5" aria-hidden />
              </span>
              <h2 className="title pt-1.5 text-2xl">Leave a comment on the latest episode</h2>
            </div>
            <div className="md:col-span-7">
              <p className="measure text-lg text-muted">
                Tell the show who you’d like to hear from or what you’d like discussed. Comments are where the channel asks for suggestions.
              </p>
              <ExternalButton href={youtubeWatchUrl(lead.youtubeId)} variant="primary" className="mt-5">
                <Play className="size-4 fill-current" aria-hidden /> Comment on the latest episode
              </ExternalButton>
            </div>
          </li>
          <li className={step}>
            <div className="flex items-start gap-4 md:col-span-5">
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-paper">
                <YouTubeIcon className="size-5" />
              </span>
              <h2 className="title pt-1.5 text-2xl">Find the show on YouTube</h2>
            </div>
            <div className="md:col-span-7">
              <p className="measure text-lg text-muted">
                Subscribe to follow new conversations as they’re published, and check the channel page for its latest posts.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <ExternalButton href={SITE.youtube.channelUrl} variant="dark">
                  Visit {SITE.youtube.handle}
                </ExternalButton>
                <ExternalButton href={SITE.youtube.subscribeUrl} variant="outline">
                  Subscribe
                </ExternalButton>
              </div>
            </div>
          </li>
          {SITE.contactEmail && (
            <li className={step}>
              <div className="flex items-start gap-4 md:col-span-5">
                <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-yellow text-ink">
                  <Mail className="size-5" aria-hidden />
                </span>
                <h2 className="title pt-1.5 text-2xl">Email the team</h2>
              </div>
              <div className="md:col-span-7">
                <p className="measure text-lg text-muted">For guest suggestions, partnerships and anything else.</p>
                <a href={`mailto:${SITE.contactEmail}`} className={buttonClass('outline', 'md', 'mt-5')}>
                  {SITE.contactEmail}
                </a>
              </div>
            </li>
          )}
        </ol>
      </div>
    </>
  )
}
