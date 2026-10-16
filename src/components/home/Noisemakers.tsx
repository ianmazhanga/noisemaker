import { HOMEPAGE } from '../../config/site'
import { getGuest, getGuests } from '../../lib/content'
import { GuestCard, GuestFeature } from '../guests/GuestCards'
import { SectionHeading } from '../ui/SectionHeading'

export function Noisemakers() {
  const featured = getGuest(HOMEPAGE.featuredGuest)
  const others = getGuests().filter((g) => g.id !== featured?.id)

  return (
    <section aria-labelledby="noisemakers-title" className="py-16 md:py-24">
      <div className="wrap">
        <SectionHeading
          id="noisemakers-title"
          index="04"
          kicker="The people"
          title={
            <>
              Meet the <span className="accent">noisemakers</span>
            </>
          }
          intro="On this show, the guest is the noisemaker: someone willing to speak openly about what they have lived through, in the hope it heals someone somewhere."
          action={{ label: 'About the podcast', to: '/about' }}
        />
        {featured && <GuestFeature guest={featured} />}
        <ul className="mt-16 grid gap-x-12 gap-y-8 border-t border-line pt-10 sm:gap-y-12 md:mt-20 md:pt-14 lg:grid-cols-2">
          {others.map((guest) => (
            <li key={guest.id}>
              <GuestCard guest={guest} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
