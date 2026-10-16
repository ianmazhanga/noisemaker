import type { Topic } from '../types/content'

/** Topics are derived from what the channel's episodes actually cover. */
export const TOPICS: Topic[] = [
  {
    slug: 'marriage',
    name: 'Marriage',
    description: 'Communication, unhealed pain and the conversations couples avoid.',
  },
  {
    slug: 'family',
    name: 'Family & Parenting',
    description: 'Raising children, fatherhood, family meetings and family life in the diaspora.',
  },
  {
    slug: 'life-stories',
    name: 'Life Stories',
    description: 'First-person journeys through addiction, bullying, adversity and recovery.',
  },
  {
    slug: 'love-stories',
    name: 'Love Stories',
    description: 'Short animated retellings of real couples’ love stories.',
  },
]
