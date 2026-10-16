import type { Guest } from '../types/content'

/**
 * The people featured on the channel. The channel calls each week's guest
 * "the noisemaker".
 *
 * Every name, role and bio here restates what the channel's own video titles
 * and descriptions say. Nothing has been added from elsewhere. The show's host
 * is not named anywhere on the channel, so no host profile is included.
 */
export const GUESTS: Guest[] = [
  {
    id: 'ncubes',
    name: 'Dr Zebron & Dr Peggy Ncube',
    role: 'Married couple, both doctors, who raised their children in another country',
    bio: 'Dr Zebron Ncube and his wife Dr Peggy Ncube talk about how they met, how they raised their children abroad and how couples can work together. Dr Zebron Ncube has written several books, including Going the Distance: Exploring Families in the Diaspora, which Dr Peggy Ncube co-authored.',
    portrait: { youtubeId: 'EwmAiXDFSGU', hd: true, focus: { x: 0 } },
    links: [
      {
        label: 'Going the Distance (book)',
        href: 'https://www.amazon.com/Going-Distance-Exploring-Families-Diaspora/dp/1964462959',
      },
    ],
  },
  {
    id: 'dr-j-papu',
    name: 'Dr J Papu',
    role: 'Explains communication in marriage',
    bio: 'Dr J Papu unpacks what communication is and is not, how unresolved pain affects it, what body language says, why “sorry” is hard to say, and how men and women deal with vulnerability.',
    portrait: { youtubeId: 'rwwefOms0JY', focus: { x: 0, y: 0.45, zoom: 1.2 } },
  },
  {
    id: 'innocent-mathe',
    name: 'Mr Innocent Mathe',
    role: 'Recovered from alcohol addiction',
    bio: 'Mr Innocent Mathe shares what led to his alcohol addiction, how it affected his family, the turning point that changed everything, and what recovery looks like today.',
    quote: { text: 'I couldn’t stop drinking alcohol.', episodeSlug: 'innocent-mathe-alcohol-addiction-recovery' },
    portrait: { youtubeId: 'SK0H9xld6OA', focus: { x: 1, y: 0.6, zoom: 1.3 } },
  },
  {
    id: 'dr-thomas-achia',
    name: 'Dr Thomas Achia',
    role: 'On fatherhood, legacy and family board meetings',
    bio: 'Dr Thomas Achia pays tribute to his father, Engineer Joshua Achia, and the lessons he learnt from him about parenting, work ethic, leadership and spirituality. He also explains why every family should hold board meetings.',
    quote: { text: 'Why I am proud to be my father’s son.', episodeSlug: 'dr-thomas-achia-fatherhood-legacy' },
    portrait: { youtubeId: 'SZEGppMOPMM', hd: true, focus: { x: 0, y: 0.3, zoom: 1.6 } },
  },
  {
    id: 'ronah-sibanda',
    name: 'Ronah Sibanda',
    role: 'Women’s Ministries leader',
    bio: 'Ronah Sibanda shares a childhood story of being bullied at home and away, and what it taught her about self-esteem. Her love story with her husband, Lovemore Sibanda, inspired the Kokakora Love Story animations.',
    quote: { text: 'I was bullied at school and called names.', episodeSlug: 'ronah-sibanda-bullied-at-school' },
    portrait: { youtubeId: 'xdyw3zIIDyU', focus: { x: 0 } },
  },
  {
    id: 'ambuya-chihwai',
    name: 'Ambuya Hilda Chihwai',
    role: 'Farmer, wife, mother and grandmother',
    bio: 'Ambuya Chihwai enjoys farm life and shares her story, along with tips on parenting and healthy living.',
    quote: { text: 'It took every fiber in me to say sorry to my child.', episodeSlug: 'ambuya-chihwai-part-1' },
    portrait: { youtubeId: 'zft3Ow8ue0I', focus: { x: 0 } },
  },
  {
    id: 'stella-mkiliwane',
    name: 'Stella N Mkiliwane',
    role: 'Author of Behind the Smile Is Life and Life',
    bio: 'Stella N Mkiliwane talks about her book of true stories about overcoming adversity and turning bad situations around.',
    portrait: { youtubeId: 'XT-id6VUi4s', focus: { x: 0 } },
  },
]
