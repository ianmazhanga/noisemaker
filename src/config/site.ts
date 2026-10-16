export const SITE = {
  name: 'Noisemakers',
  /** The channel's name on YouTube. */
  channelName: 'Noisemakers News Network',
  tagline: 'Not all noise is bad noise',
  description:
    'Noisemakers is a video podcast of inspirational interviews and stories about marriage, parenting, family and the journeys that shape us. Not all noise is bad noise.',
  /** Production origin, used for canonical URLs, Open Graph and structured data. */
  url: 'https://noisemakersnews.com',
  /** Year of the channel's first upload (YouTube shows "Joined May 6, 2024"). */
  since: 2024,
  youtube: {
    channelUrl: 'https://www.youtube.com/@noisemakersnews',
    subscribeUrl: 'https://www.youtube.com/@noisemakersnews?sub_confirmation=1',
    shortsUrl: 'https://www.youtube.com/@noisemakersnews/shorts',
    channelId: 'UCD49Bigk35BXat_YPimii0Q',
    handle: '@noisemakersnews',
  },
  /**
   * Social profiles. The YouTube channel doesn't link any, so these are empty.
   * Add a URL here and it appears in the footer and community section.
   */
  social: [] as { label: string; href: string }[],
  /** Contact address. Leave empty until there's a real inbox. The Collaborate page adapts. */
  contactEmail: '',
}

/**
 * Homepage programming. Change these slugs to re-curate the homepage without
 * touching any layout code.
 */
export const HOMEPAGE = {
  /** 'latest' uses the newest episode, or set a specific episode slug. */
  leadEpisode: 'latest' as 'latest' | string,
  /** "The Conversations": the first is shown largest. */
  conversations: [
    'dr-thomas-achia-fatherhood-legacy',
    'families-in-the-diaspora-part-1',
    'why-couples-struggle-to-communicate',
    'ronah-sibanda-bullied-at-school',
    'ambuya-chihwai-part-1',
    'the-blind-date',
  ],
  /** Hero collage: two episode thumbnails and one Short. */
  heroCollage: {
    portraitEpisode: 'behind-the-smile-stella-mkiliwane',
    landscapeEpisode: 'families-in-the-diaspora-part-2',
    clip: '09clmEa2aL0',
  },
  /** Guest shown as the large feature in "Meet the noisemakers". */
  featuredGuest: 'ncubes',
}

export interface NavItem {
  label: string
  to: string
}

export const PRIMARY_NAV: NavItem[] = [
  { label: 'Home', to: '/' },
  { label: 'Episodes', to: '/episodes' },
  { label: 'Clips', to: '/clips' },
  { label: 'About', to: '/about' },
  { label: 'Collaborate', to: '/collaborate' },
]
