import { useSearchParams } from 'react-router'
import { Seo } from '../components/seo/Seo'
import { PageIntro } from '../components/ui/PageIntro'
import { NewsletterSignup } from '../components/news/NewsletterSignup'

export default function NewsletterPage() {
  const [params] = useSearchParams()
  const unsubscribed = params.get('unsubscribed')
  return (
    <>
      <Seo title="Newsletter" description="Get new Noisemakers conversations, news and stories by email, once a week." />
      <PageIntro kicker="Newsletter" title="The Noisemakers newsletter" intro="New conversations, news and stories from the community, once a week. Free, and you can unsubscribe at any time." crumbs={[{ label: 'Home', to: '/' }, { label: 'Newsletter' }]} />
      <div className="wrap pb-20 md:pb-28">
        <div className="max-w-2xl">
          {unsubscribed === '1' && (
            <p role="status" className="mb-8 rounded-lg bg-bone px-4 py-3 font-semibold">
              You’ve been unsubscribed and won’t receive any more newsletters.
            </p>
          )}
          {unsubscribed === '0' && (
            <p role="alert" className="mb-8 rounded-lg bg-danger/10 px-4 py-3 text-danger">
              That unsubscribe link didn’t work. Use the Unsubscribe link at the bottom of any newsletter instead.
            </p>
          )}
          <NewsletterSignup />
          <p className="mt-8 text-muted">We send a confirmation email first, and only start sending newsletters once you’ve clicked the link in it. Your address is used only for the newsletter.</p>
        </div>
      </div>
    </>
  )
}
