import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { Seo } from '../components/seo/Seo'
import { EpisodeRow } from '../components/episodes/EpisodeCards'
import { buttonClass } from '../components/ui/buttonClass'
import { getLatestEpisodes } from '../lib/content'

export default function NotFoundPage() {
  return (
    <>
      <Seo title="Page not found" description="This page doesn’t exist. Try the latest Noisemakers episodes instead." noindex />
      <div className="wrap grid gap-14 py-16 md:py-24 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <p className="kicker text-blue-ink">404</p>
          <h1 className="display-xl mt-5">This page made no noise.</h1>
          <p className="measure mt-6 text-lg text-muted">The link may be old, or the address mistyped. The conversations are still here.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/" className={buttonClass('primary', 'lg')}>
              Go home
            </Link>
            <Link to="/episodes" className={buttonClass('outline', 'lg')}>
              Browse episodes <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
        <div className="lg:col-span-5 lg:col-start-8">
          <h2 className="kicker border-b border-ink pb-3">Latest episodes</h2>
          <ul className="divide-y divide-line">
            {getLatestEpisodes(3).map((e) => (
              <li key={e.slug} className="py-5">
                <EpisodeRow episode={e} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  )
}
