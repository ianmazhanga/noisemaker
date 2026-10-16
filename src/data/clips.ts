import type { Clip } from '../types/content'

/**
 * YouTube Shorts from the channel, newest first.
 *
 * `episodeSlug` is set only where the clip's description links the full
 * episode, or the clip shows the same guest in the same recording and that
 * guest has exactly one full interview.
 */
export const CLIPS: Clip[] = [
  {
    youtubeId: '4o9k1VadtQA',
    title: 'African parents sacrificed for their children’s education, out of love',
    caption: 'How much are parents willing to sacrifice to give their children a better future?',
    publishedAt: '2026-10-09T17:00:07Z',
    durationSeconds: 44,
    guestIds: ['ncubes'],
  },
  {
    youtubeId: 'y6zTGiiKfHk',
    title: 'Why these doctors let their kids say no',
    caption: 'Could a safe space to say no at home prepare children to say no to their peers?',
    publishedAt: '2026-10-08T18:00:32Z',
    durationSeconds: 31,
    guestIds: ['ncubes'],
  },
  {
    youtubeId: 'WQIjAC7ezvg',
    title: 'Your unhealed pain may be hurting your marriage',
    caption: 'Sometimes the argument isn’t about what happened today, but pain that was never addressed yesterday.',
    publishedAt: '2026-10-07T20:00:30Z',
    durationSeconds: 41,
    guestIds: ['dr-j-papu'],
    episodeSlug: 'why-couples-struggle-to-communicate',
  },
  {
    youtubeId: 'cV2C9mGtK24',
    title: 'Why is your spouse the hardest person to talk to?',
    caption: 'Why can we open up to friends and strangers, but not to the person we married?',
    publishedAt: '2026-10-07T17:00:18Z',
    durationSeconds: 25,
    guestIds: ['dr-j-papu'],
    episodeSlug: 'why-couples-struggle-to-communicate',
  },
  {
    youtubeId: 'QKO3GwG1jkA',
    title: 'I drank every day at work',
    caption: 'What happens when alcohol addiction follows you into the workplace?',
    publishedAt: '2026-10-05T20:00:33Z',
    durationSeconds: 29,
    guestIds: ['innocent-mathe'],
    episodeSlug: 'innocent-mathe-alcohol-addiction-recovery',
  },
  {
    youtubeId: 'QXozjgZaGLg',
    title: 'He drank after church while serving as a youth leader',
    caption: 'He went to church. He served as a youth leader. Then he went home and drank.',
    publishedAt: '2026-10-05T17:00:24Z',
    durationSeconds: 85,
    guestIds: ['innocent-mathe'],
    episodeSlug: 'innocent-mathe-alcohol-addiction-recovery',
  },
  {
    youtubeId: '09clmEa2aL0',
    title: 'Why I started drinking',
    caption: 'Where the addiction started, and the pain underneath it.',
    publishedAt: '2026-10-04T19:43:37Z',
    durationSeconds: 79,
    guestIds: ['innocent-mathe'],
    episodeSlug: 'innocent-mathe-alcohol-addiction-recovery',
  },
  {
    youtubeId: 'REodinofEgs',
    title: 'Why couples avoid the conversations they need most',
    caption: 'Sometimes it isn’t that couples don’t know what to say. They’re afraid of the pain that comes with saying it.',
    publishedAt: '2026-10-04T11:13:59Z',
    durationSeconds: 41,
    guestIds: ['dr-j-papu'],
    episodeSlug: 'why-couples-struggle-to-communicate',
  },
  {
    youtubeId: 'iB1r5z51gTY',
    title: 'Proposals from the past',
    publishedAt: '2026-05-13T23:25:11Z',
    durationSeconds: 16,
    guestIds: [],
  },
  {
    youtubeId: 'q4YqTC6Tiws',
    title: 'Proud aunty at the mall',
    publishedAt: '2026-05-12T20:16:45Z',
    durationSeconds: 13,
    guestIds: [],
  },
  {
    youtubeId: 't8kgj-jXY3M',
    title: 'The best sadza-making pot',
    caption: 'There’s a specific pot for cooking sadza. Do you know its name?',
    publishedAt: '2026-05-11T18:00:48Z',
    durationSeconds: 16,
    guestIds: [],
  },
]
