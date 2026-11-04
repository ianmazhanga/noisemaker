import { Link } from 'react-router'
import { Seo } from '../components/seo/Seo'
import { PageIntro } from '../components/ui/PageIntro'
import { SITE } from '../config/site'

/**
 * Terms of Service. Plain-English rules for the website, story submissions and the team's
 * Social Media Manager. Describes only what the site actually does.
 *
 * OWNER REVIEW NEEDED before relying on this legally: it names no legal entity, address or
 * governing law, because those weren't provided. Have it checked by someone qualified, and
 * update LAST_UPDATED whenever the wording changes.
 */
const LAST_UPDATED = '5 November 2026'

export default function TermsPage() {
  const h2 = 'title mt-12 text-2xl text-ink'
  const link = 'font-semibold text-blue-ink underline underline-offset-4'
  const external = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className={link}>
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
  return (
    <>
      <Seo title="Terms of Service" description="The rules for using the Noisemakers News website, sending a story, and how the Noisemakers team publishes to social media." />
      <PageIntro kicker="Terms" title="Terms of Service" crumbs={[{ label: 'Home', to: '/' }, { label: 'Terms of Service' }]} />
      <div className="wrap pb-20 md:pb-28">
        <div className="measure space-y-4 text-lg text-muted">
          <p className="text-sm">Last updated: {LAST_UPDATED}</p>
          <p className="text-ink">
            These terms apply to the {SITE.name} website at {SITE.url.replace(/^https:\/\//, '')} (“the site”), run by the {SITE.name} team (“we”, “us”). By using the site you agree to them. If you don’t agree, please
            don’t use the site.
          </p>

          <h2 className={h2}>1. What the site is</h2>
          <p>
            {SITE.name} publishes interviews and stories about life, family, marriage, faith and recovery. The site lists our interviews, short clips and news articles, lets people tell us their story, and lets
            visitors sign up for our newsletter. Our videos are hosted on YouTube, the {SITE.channelName} channel.
          </p>

          <h2 className={h2}>2. Interviews and published content</h2>
          <p>
            Interviews share the personal experiences and opinions of our guests. They’re not medical, legal, financial, psychological or other professional advice. If you need help with something discussed in
            an interview, please speak to a qualified professional.
          </p>
          <p>
            We work to keep what we publish accurate. Our articles credit their sources, and our news summaries are written in our own words with links to the original reporting. If you think something we
            published is wrong, please tell us (see Contact, below) and we’ll look at it.
          </p>

          <h2 className={h2}>3. Telling us your story</h2>
          <p>
            You can send us your story, or ask for an introductory call, with the{' '}
            <Link to="/tell-your-story" className={link}>
              Tell your story
            </Link>{' '}
            form. To use it you must be 18 or over, and the story must be your own to tell. Please don’t include details about other people that they wouldn’t want shared.
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>Sending a story doesn’t mean we’ll feature it, and it doesn’t create any agreement between us. We read every submission, but we can’t reply to everyone.</li>
            <li>
              Nothing you send is published without your agreement. If we’d like to interview you, we’ll talk with you first about what will be recorded and published, and you can say no at any point
              before publication.
            </li>
            <li>A call request is not a booking. A call is only arranged once a team member confirms it with you.</li>
            <li>
              How we handle what you send, and how to ask us to delete it, is explained in our{' '}
              <Link to="/privacy" className={link}>
                Privacy Policy
              </Link>
              .
            </li>
          </ul>

          <h2 className={h2}>4. Copyright and ownership</h2>
          <p>
            The {SITE.name} name, logo, videos, articles, thumbnails, design and other content on the site belong to {SITE.name} or to the people who made them with us, unless we say otherwise. You may share links
            to our pages and videos. You may not copy, re-upload, sell or reuse our videos, clips or articles, in whole or in large part, without our written permission.
          </p>
          <p>Guests keep the rights to their own life story. Anything you send us through the site stays yours; you let us read and use it only to consider it for, and prepare, a conversation with you.</p>
          <p>If you believe something on the site infringes your copyright, please contact us with details and we’ll review it promptly.</p>

          <h2 className={h2}>5. Using the site properly</h2>
          <p>Please don’t:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>send false, abusive, threatening, hateful or unlawful content, or content that isn’t yours to share;</li>
            <li>pretend to be someone else, or sign other people up for the newsletter;</li>
            <li>send spam or automated submissions, or try to overload, probe or break into the site, its forms or the team dashboard;</li>
            <li>collect information about our guests, visitors or team from the site.</li>
          </ul>
          <p>We may remove content, refuse submissions or block access to protect the site, our guests and our team.</p>

          <h2 className={h2}>6. Newsletter</h2>
          <p>
            Signing up for the{' '}
            <Link to="/newsletter" className={link}>
              newsletter
            </Link>{' '}
            is free and optional. We only send it after you confirm your address, and every issue has an unsubscribe link.
          </p>

          <h2 className={h2}>7. YouTube, TikTok and other platforms</h2>
          <p>
            Our videos play on YouTube, and we share our content on social media platforms including TikTok, Instagram, Facebook and X. When you watch, follow or interact with us there, that platform’s own terms
            and privacy policy apply, not these. We don’t control those platforms, and we’re not responsible for their content, availability or how they handle your information.
          </p>
          <p>
            {SITE.name} isn’t endorsed by, sponsored by or affiliated with YouTube, Google, TikTok, Meta or X. Their names are used only to say where our content can be found. Their terms:{' '}
            {external('https://www.youtube.com/t/terms', 'YouTube')}, {external('https://www.tiktok.com/legal/page/global/terms-of-service/en', 'TikTok')},{' '}
            {external('https://www.facebook.com/terms.php', 'Facebook')}, {external('https://help.instagram.com/581066165581870', 'Instagram')} and {external('https://x.com/en/tos', 'X')}.
          </p>

          <h2 className={h2}>8. Our Social Media Manager</h2>
          <p>
            Our team uses a private dashboard, the Social Media Manager, to prepare and publish {SITE.name}’s own posts and videos to our own accounts on TikTok, Instagram, Facebook, YouTube and X. It isn’t a public
            service: visitors can’t sign up for it or connect their accounts to it.
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>Only team members we’ve given their own sign-in can use it, and only owners can connect accounts or publish.</li>
            <li>
              Accounts are connected only by their owner signing in on the platform’s own official page and approving access. We never ask for or store social media passwords. Access can be removed at any
              time by disconnecting in the dashboard or in the platform’s own settings.
            </li>
            <li>The access a platform grants is stored encrypted and used only to publish content our owners have approved to our own accounts, and to read those accounts’ basic profile and statistics.</li>
            <li>Nothing is posted automatically without an owner’s approval. We only post content we have the rights to, and we follow each platform’s terms, community guidelines and developer policies.</li>
            <li>Using the dashboard for anything else, or by anyone who hasn’t been authorised by our owners, is not allowed.</li>
          </ul>

          <h2 className={h2}>9. No guarantees</h2>
          <p>
            We provide the site “as is”. We try to keep it running and accurate, but we can’t promise it will always be available, error-free or up to date. To the extent the law allows, we’re not liable for any
            loss that comes from using the site or relying on its content. Nothing in these terms limits any rights you have under the law where you live that can’t be limited.
          </p>

          <h2 className={h2}>10. Changes to these terms</h2>
          <p>We may update these terms as the site changes. The date at the top shows when they last changed. If you keep using the site after a change, the updated terms apply.</p>

          <h2 className={h2}>11. Contact</h2>
          <p>
            {SITE.contactEmail ? (
              <>
                Questions about these terms? Email{' '}
                <a href={`mailto:${SITE.contactEmail}`} className={link}>
                  {SITE.contactEmail}
                </a>
                .
              </>
            ) : (
              <>
                Questions about these terms? Contact us through the{' '}
                <Link to="/tell-your-story" className={link}>
                  Tell your story
                </Link>{' '}
                form: choose “Request an introductory call” and write your question under “What would you like to talk about?”.
              </>
            )}
          </p>
          <p>
            See also our{' '}
            <Link to="/privacy" className={link}>
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </>
  )
}
