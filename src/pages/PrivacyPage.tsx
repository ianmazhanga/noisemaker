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
          <p>It sets no cookies of its own, runs no analytics or advertising trackers, and has no public accounts.</p>

          <h2 className={h2}>The newsletter</h2>
          <p>
            If you sign up for the{' '}
            <Link to="/newsletter" className={link}>
              newsletter
            </Link>
            , we keep your email address, the date you signed up, and the exact wording you agreed to, as a record of your consent.
          </p>
          <p>
            <strong className="text-ink">Why:</strong> only to send you the Noisemakers newsletter. We never sell or share your address, and we only start sending once you’ve confirmed it with the link we email you.
          </p>
          <p>
            <strong className="text-ink">Where it’s stored:</strong> in our private team database (Supabase), which only the owners can read, and with our email provider, Mailchimp, which sends the newsletter and tells us
            how many people opened it.{' '}
            <a href="https://www.intuit.com/privacy/statement/" target="_blank" rel="noopener noreferrer" className={link}>
              Mailchimp’s privacy statement<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
          <p>
            <strong className="text-ink">Your choices:</strong> every newsletter has an Unsubscribe link, and unsubscribing takes effect straight away. You can also ask us to delete your record entirely. These are your rights
            under South Africa’s Protection of Personal Information Act (POPIA) and similar laws elsewhere.
          </p>

          <h2 className={h2}>News articles</h2>
          <p>Articles on the News pages are loaded from our database. Reading them doesn’t send us anything about you beyond the standard request your browser makes.</p>

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
            <strong className="text-ink">Where it’s stored:</strong> in our private team database, run by Supabase. Only Noisemakers team members who have their own
            sign-in, and whom the owner has allowed to read stories, can see submissions.
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

          <h2 className={h2}>Videos</h2>
          <p>This site doesn’t load any YouTube player. Pressing play on a video opens it on YouTube in a new tab.</p>

          <h2 className={h2}>Links to YouTube</h2>
          <p>Videos and buttons such as “Watch on YouTube” and “Subscribe” take you to YouTube, where Google’s privacy policy applies.</p>
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
