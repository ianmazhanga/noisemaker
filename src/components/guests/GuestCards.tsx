import { Link } from 'react-router'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import type { Guest } from '../../types/content'
import { getEpisodesByGuest, guestCredits } from '../../lib/content'
import { Thumb } from '../ui/Thumb'

function Quote({ guest, className = '' }: { guest: Guest; className?: string }) {
  if (!guest.quote) return null
  return (
    <blockquote className={`accent text-ink ${className}`}>
      <p>“{guest.quote.text}”</p>
    </blockquote>
  )
}

/** Large editorial spread for one guest. */
export function GuestFeature({ guest }: { guest: Guest }) {
  const episodes = getEpisodesByGuest(guest.id)
  return (
    <article className="grid gap-8 md:grid-cols-12 md:items-center md:gap-10">
      <div className="md:col-span-5">
        <Thumb
          youtubeId={guest.portrait.youtubeId}
          hd={guest.portrait.hd}
          focus={guest.portrait.focus}
          alt={`${guest.name}, from their episode on Noisemakers`}
          sizes="(min-width: 768px) 520px, 100vw"
          zoom={false}
          className="aspect-[4/5] rounded-lg"
        />
      </div>
      <div className="md:col-span-7">
        <p className="kicker text-blue-ink">Featured noisemakers</p>
        <h3 className="display-lg mt-4">{guest.name}</h3>
        <p className="mt-3 text-lg font-semibold">{guest.role}</p>
        <p className="measure mt-4 text-lg text-muted">{guest.bio}</p>
        <Quote guest={guest} className="mt-6 text-2xl" />
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {episodes.map((e) => (
            <li key={e.slug}>
              <Link to={`/episodes/${e.slug}`} className="group flex min-h-14 items-center justify-between gap-4 py-3 font-semibold">
                <span className="link-grow">{e.title}</span>
                <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        {guest.links?.map((l) => (
          <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="group mt-5 inline-flex min-h-11 items-center gap-1.5 font-semibold text-blue-ink">
            <span className="link-grow">{l.label}</span>
            <ArrowUpRight className="size-4" aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ))}
      </div>
    </article>
  )
}

/** Compact guest card: tall portrait crop beside name, role, quote and a link to their episodes. */
export function GuestCard({ guest }: { guest: Guest }) {
  return (
    <article className="group grid grid-cols-[5.5rem_1fr] items-start gap-5 sm:grid-cols-[8.5rem_1fr] sm:gap-6 lg:grid-cols-[10rem_1fr]">
      <Thumb
        youtubeId={guest.portrait.youtubeId}
        hd={guest.portrait.hd}
        focus={guest.portrait.focus}
        alt={`${guest.name}, from their episode on Noisemakers`}
        sizes="(min-width: 1024px) 160px, (min-width: 640px) 136px, 88px"
        className="aspect-[3/4] rounded-lg"
      />
      <div className="sm:pt-1">
        <h3 className="title text-xl md:text-2xl">{guest.name}</h3>
        <p className="mt-1 text-[0.9375rem] text-muted">{guest.role}</p>
        <Quote guest={guest} className="mt-3 hidden text-lg sm:block" />
        <Link to={`/episodes?guest=${guest.id}`} className="mt-3 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-blue-ink">
          <span className="link-grow">{guestCredits(guest.id)}</span>
          <ArrowRight className="size-3.5" aria-hidden />
          <span className="sr-only"> with {guest.name}</span>
        </Link>
      </div>
    </article>
  )
}
