import { Link } from 'react-router'
import { ArrowUpRight } from 'lucide-react'
import { PRIMARY_NAV, SITE } from '../../config/site'
import { getTopics } from '../../lib/content'
import { Logo } from '../brand/Logo'
import { SocialLinks } from '../ui/SocialLinks'
import { NewsletterSignup } from '../news/NewsletterSignup'

const YEAR = new Date().getFullYear()
const heading = 'kicker text-muted-dark'
const link = 'inline-flex min-h-9 items-center text-paper/85 transition-colors hover:text-paper'

function External({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${link} gap-1.5`}>
      {children}
      <ArrowUpRight className="size-3.5 opacity-60" aria-hidden />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

export function Footer() {
  return (
    <footer className="on-dark bg-ink text-paper">
      <div className="wrap grid gap-12 py-16 md:grid-cols-12 md:gap-8 md:py-20">
        <div className="md:col-span-5">
          <Link to="/" className="inline-block rounded-md" aria-label={`${SITE.name}, home`}>
            <Logo inverted lockup />
          </Link>
          <p className="mt-6 max-w-sm text-paper/70">
            Inspirational interviews and stories about marriage, parenting, family and recovery.{' '}
            <span className="accent text-paper">Not all noise is bad noise.</span>
          </p>
          <p className={`${heading} mt-8`}>Follow us</p>
          <SocialLinks className="mt-4" />
          <p className={`${heading} mt-8`}>Newsletter</p>
          <div className="mt-4 max-w-md">
            <NewsletterSignup dark />
          </div>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:col-span-7">
          <div>
            <h2 className={heading}>Explore</h2>
            <ul className="mt-4">
              {PRIMARY_NAV.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className={link}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className={heading}>Topics</h2>
            <ul className="mt-4">
              {getTopics().map((t) => (
                <li key={t.slug}>
                  <Link to={`/episodes?topic=${t.slug}`} className={link}>
                    {t.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className={heading}>Watch</h2>
            <ul className="mt-4">
              <li>
                <External href={SITE.youtube.channelUrl}>YouTube channel</External>
              </li>
              <li>
                <External href={SITE.youtube.subscribeUrl}>Subscribe</External>
              </li>
              <li>
                <External href={SITE.youtube.shortsUrl}>Shorts</External>
              </li>
              {SITE.contactEmail && (
                <li>
                  <a href={`mailto:${SITE.contactEmail}`} className={link}>
                    {SITE.contactEmail}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </nav>
      </div>
      <div className="border-t border-line-dark">
        <div className="wrap flex flex-col gap-2 py-6 text-sm text-muted-dark sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {SITE.since === YEAR ? YEAR : `${SITE.since}–${YEAR}`} {SITE.channelName}
          </p>
          <Link to="/privacy" className="inline-flex min-h-9 items-center hover:text-paper">
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  )
}
