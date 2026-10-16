import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import type { Clip } from '../../types/content'
import { getGuestsFor } from '../../lib/content'
import { formatDuration, spokenDuration } from '../../lib/format'
import { usePlayer } from '../player/PlayerContext'
import { PlayIcon } from '../player/PlayIcon'
import { Thumb } from '../ui/Thumb'

interface ClipCardProps {
  clip: Clip
  dark?: boolean
  as?: 'h2' | 'h3'
}

/** Vertical 9:16 card for a YouTube Short. */
export function ClipCard({ clip, dark, as: H = 'h3' }: ClipCardProps) {
  const { playClip } = usePlayer()
  const guests = getGuestsFor(clip.guestIds)
  return (
    <article className="group">
      <button type="button" onClick={() => playClip(clip)} className="relative block w-full overflow-hidden rounded-lg" aria-label={`Play clip: ${clip.title}`}>
        <Thumb youtubeId={clip.youtubeId} vertical alt="" sizes="240px" className="aspect-[9/16]" />
        <span className="absolute bottom-3 left-3">
          <PlayIcon size="md" />
        </span>
        <span className="absolute top-3 left-3 rounded-full bg-ink/80 px-2 py-1 text-xs leading-none font-semibold tabular-nums text-paper">
          <span aria-hidden>{formatDuration(clip.durationSeconds)}</span>
          <span className="sr-only">Duration {spokenDuration(clip.durationSeconds)}</span>
        </span>
      </button>
      <H className="title mt-3 text-base md:text-[1.0625rem]">{clip.title}</H>
      {guests.length > 0 && <p className={`mt-1 text-sm ${dark ? 'text-muted-dark' : 'text-muted'}`}>{guests.map((g) => g.name).join(', ')}</p>}
      {clip.episodeSlug && (
        <Link
          to={`/episodes/${clip.episodeSlug}`}
          className={`group/link mt-2 inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold ${dark ? 'text-yellow' : 'text-blue-ink'}`}
        >
          Full episode <ArrowRight className="size-3.5 transition-transform group-hover/link:translate-x-0.5" aria-hidden />
          <span className="sr-only">: from the conversation this clip comes from</span>
        </Link>
      )}
    </article>
  )
}
