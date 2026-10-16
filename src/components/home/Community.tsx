import { Link } from 'react-router'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { SITE } from '../../config/site'
import { getLeadEpisode } from '../../lib/content'
import { youtubeWatchUrl } from '../../lib/youtube'
import { LogoMark } from '../brand/Logo'
import { YouTubeIcon } from '../ui/BrandIcons'
import { buttonClass } from '../ui/buttonClass'

/** Full-width invitation to subscribe and join the conversation in the comments. */
export function Community() {
  const lead = getLeadEpisode()
  return (
    <section aria-labelledby="community-title" className="on-blue relative overflow-hidden bg-blue text-white">
      <LogoMark tile={false} className="pointer-events-none absolute top-1/2 -right-24 size-[34rem] -translate-y-1/2 opacity-[0.12] md:-right-16 md:size-[44rem]" />
      <div className="wrap relative py-20 md:py-28">
        <p className="kicker text-white/75">Join the conversation</p>
        <h2 id="community-title" className="display-xl mt-5 max-w-4xl">
          Don’t just watch. <span className="accent">Come have your say.</span>
        </h2>
        <p className="measure mt-6 text-lg text-white/85 md:text-xl md:leading-relaxed">
          Many episodes end with a question for you. Answer it in the comments, share a conversation with someone who needs to hear it, and subscribe so the next one finds you.
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <a href={SITE.youtube.subscribeUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('light', 'lg', 'w-full sm:w-auto')}>
            <YouTubeIcon className="size-5 text-[#ff0033]" /> Subscribe on YouTube<span className="sr-only"> (opens in a new tab)</span>
          </a>
          {lead && (
            <a href={youtubeWatchUrl(lead.youtubeId)} target="_blank" rel="noopener noreferrer" className={buttonClass('outline-light', 'lg', 'w-full sm:w-auto')}>
              Comment on the latest episode <ArrowUpRight className="size-4" aria-hidden />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
        <p className="mt-8 text-white/85">
          Have a story worth making noise about?{' '}
          <Link to="/tell-your-story" className="group inline-flex items-center gap-1 font-semibold text-white">
            <span className="link-grow">Tell us your story</span>
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </p>
        {SITE.social.length > 0 && (
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2" aria-label="Noisemakers elsewhere">
            {SITE.social.map((s) => (
              <li key={s.href}>
                <a href={s.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold">
                  {s.label} <ArrowUpRight className="size-4" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
