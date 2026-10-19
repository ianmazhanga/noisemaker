import { Link } from 'react-router'
import { Seo } from '../components/seo/Seo'
import { PageIntro } from '../components/ui/PageIntro'
import { SITE } from '../config/site'

/**
 * Describes what this site actually does. Update it if analytics, new forms or
 * other third-party services are added, or if the retention period changes.
 */
const RETENTION = '12 months'

export default function PrivacyPage() {
  const h2 = 'title mt-12 text-2xl text-ink'
  const link = 'font-semibold text-blue-ink underline underline-offset-4'
  return (
    <>
      <Seo title="Privacy" description="How the Noisemakers website handles your data, including stories sent through the “Tell your story” form." />
      <PageIntro kicker="Privacy" title="Privacy" crumbs={[{ label: 'Home', to: '/' }, { label: 'Privacy' }]} />
      <div className="wrap pb-20 md:pb-28">
        <div className="measure space-y-4 text-lg text-muted">
          <p className="text-ink">
            This website is a guide to the Noisemakers videos on YouTube, and a way to tell the team your story. It is designed to collect as little as possible.
          </p>

          <h2 className={h2}>What this site doesn’t do</h2>
          <p>It sets no cookies of its own, runs no analytics or advertising trackers, and has no accounts.</p>

          <h2 className={h2}>The “Tell your story” form</h2>
          <p>
            If you use the{' '}
            <Link to="/tell-your-story" className={link}>
              Tell your story
            </Link>{' '}
            form, we collect what you type into it: your name, email address, phone number if you give one, how you’d like to be contacted, an optional profile link, your
            story and the other answers on the form, and your consent choices.
          </p>
          <p>
            <strong className="text-ink">Why:</strong> only to consider your story for an upcoming conversation and to contact you about it. Nothing you send is published
            without your agreement, and it is never sold or used for marketing.
          </p>
          <p>
            <strong className="text-ink">Where it’s stored:</strong> with our website host, Netlify, using its Netlify Forms service. Netlify may check submissions with an
            automated spam filter. Only the Noisemakers team can see submissions, in Netlify or on a password-protected page of this site.
          </p>
          <p>
            <strong className="text-ink">How long:</strong> we delete submissions we aren’t taking forward within {RETENTION}. If your story becomes part of a conversation,
            we keep your contact details for as long as we’re working together.
          </p>
          <p>
            <strong className="text-ink">Your choices:</strong> you can ask to see, correct or delete your submission at any time.{' '}
            {SITE.contactEmail ? (
              <>
                Email{' '}
                <a href={`mailto:${SITE.contactEmail}`} className={link}>
                  {SITE.contactEmail}
                </a>{' '}
                with your reference number.
              </>
            ) : (
              <>Tell the team when they contact you, or send the form again with your reference number and your request in “Anything else we should know?”.</>
            )}
          </p>
          <p>
            So the same story isn’t sent twice by accident, your browser remembers a short code for each story you send, only until you close the tab. It doesn’t contain
            your details.
          </p>

          <h2 className={h2}>Thumbnails</h2>
          <p>
            Episode and clip images load from YouTube’s image servers (i.ytimg.com). As with any image on the web, your browser sends YouTube a standard request, which includes your IP address.
          </p>

          <h2 className={h2}>Video players</h2>
          <p>
            No YouTube player loads until you press play. Players use YouTube’s privacy-enhanced mode (youtube-nocookie.com). Once a video plays, YouTube’s own privacy policy applies to that
            player.
          </p>

          <h2 className={h2}>Links to YouTube</h2>
          <p>Buttons such as “Watch on YouTube” and “Subscribe” take you to YouTube, where Google’s privacy policy applies.</p>
          <p>
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className={link}>
              Google privacy policy<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </div>
      </div>
    </>
  )
}
