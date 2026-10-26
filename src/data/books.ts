import type { Book } from '../types/content'

/**
 * Books by the people featured on the channel. Only books the channel itself
 * names are listed. Titles, credits and descriptions restate the channel's own
 * video descriptions. To add one, copy an entry and fill in the fields.
 */
export const BOOKS: Book[] = [
  {
    slug: 'going-the-distance',
    title: 'Going the Distance',
    subtitle: 'Exploring Families in the Diaspora',
    authors: 'Dr Zebron Ncube, co-authored by Dr Peggy Ncube',
    guestId: 'ncubes',
    description:
      'A book about families in the diaspora by Dr Zebron Ncube, one of several he has written, co-authored with his wife Dr Peggy Ncube. The couple talk about raising their children in another country in their two-part conversation.',
    buyUrl: 'https://www.amazon.com/Going-Distance-Exploring-Families-Diaspora/dp/1964462959',
    episodeSlugs: ['families-in-the-diaspora-part-1', 'families-in-the-diaspora-part-2'],
  },
  {
    slug: 'behind-the-smile-is-life-and-life',
    title: 'Behind the Smile Is Life and Life',
    authors: 'Stella N Mkiliwane',
    guestId: 'stella-mkiliwane',
    description:
      'True stories of overcoming adversity and turning bad situations into hopeful ones. Stella N Mkiliwane talks about the book in her conversation.',
    episodeSlugs: ['behind-the-smile-stella-mkiliwane'],
  },
]
