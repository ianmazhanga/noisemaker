import { SITE } from '../../config/site'
import { getConversationClips } from '../../lib/content'
import { ClipCard } from '../clips/ClipCard'
import { YouTubeIcon } from '../ui/BrandIcons'
import { Rail } from '../ui/Rail'
import { SectionHeading } from '../ui/SectionHeading'

/** Shorts from recent conversations: a way to sample the show before a full episode. */
export function Moments() {
  const clips = getConversationClips(8)
  if (!clips.length) return null

  return (
    <section aria-labelledby="moments-title" className="on-dark bg-ink py-16 text-paper md:py-24">
      <div className="wrap">
        <SectionHeading
          id="moments-title"
          index="03"
          kicker="Clips"
          dark
          title={
            <>
              Short on time? <span className="mark">Start with a moment.</span>
            </>
          }
          intro="Clips of a minute or so from recent conversations. If one stays with you, the full episode is a tap away."
          action={{ label: 'All clips', to: '/clips' }}
        >
          <a
            href={SITE.youtube.shortsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden min-h-11 items-center gap-2 rounded-full border-[1.5px] border-paper/30 px-4 text-sm font-semibold transition-colors hover:border-paper sm:inline-flex"
          >
            <YouTubeIcon className="size-4" /> Shorts<span className="sr-only"> on YouTube (opens in a new tab)</span>
          </a>
        </SectionHeading>
        <Rail label="Clips" dark>
          {clips.map((clip) => (
            <li key={clip.youtubeId} className="w-[44vw] max-w-56 sm:w-52 lg:w-[calc((100%-6rem)/5)] lg:max-w-none">
              <ClipCard clip={clip} dark />
            </li>
          ))}
        </Rail>
      </div>
    </section>
  )
}
