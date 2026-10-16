import { Seo } from '../components/seo/Seo'
import { PageIntro } from '../components/ui/PageIntro'

/**
 * Describes what this site actually does. Update it if analytics, forms or
 * other third-party services are added.
 */
export default function PrivacyPage() {
  const h2 = 'title mt-12 text-2xl text-ink'
  return (
    <>
      <Seo title="Privacy" description="How the Noisemakers website handles your data: no cookies or analytics of its own, and YouTube loads only when you press play." />
      <PageIntro kicker="Privacy" title="Privacy" crumbs={[{ label: 'Home', to: '/' }, { label: 'Privacy' }]} />
      <div className="wrap pb-20 md:pb-28">
        <div className="measure space-y-4 text-lg text-muted">
          <p className="text-ink">This website is a guide to the Noisemakers videos on YouTube. It is designed to collect as little as possible.</p>

          <h2 className={h2}>What this site doesn’t do</h2>
          <p>It sets no cookies of its own, runs no analytics or advertising trackers, and has no forms or accounts. It doesn’t ask for or store any personal information.</p>

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
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-ink underline underline-offset-4">
              Google privacy policy<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </div>
      </div>
    </>
  )
}
