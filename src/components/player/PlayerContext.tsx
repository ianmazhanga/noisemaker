import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, X } from 'lucide-react'
import type { Clip, Episode } from '../../types/content'
import { youtubeShortUrl, youtubeWatchUrl } from '../../lib/youtube'
import { formatDate, formatDuration } from '../../lib/format'
import { getEpisode, getGuestsFor } from '../../lib/content'
import { useDialog } from '../../hooks/useDialog'
import { LiteYouTube } from './LiteYouTube'
import { YouTubeIcon } from '../ui/BrandIcons'
import { buttonClass } from '../ui/buttonClass'

type Playing = { kind: 'episode'; item: Episode } | { kind: 'clip'; item: Clip }

interface PlayerApi {
  playEpisode: (episode: Episode) => void
  playClip: (clip: Clip) => void
}

const PlayerContext = createContext<PlayerApi | null>(null)

// oxlint-disable-next-line react/only-export-components
export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider')
  return ctx
}

/** App-wide modal player, so any play button on the site can open an embedded player. */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const [playing, setPlaying] = useState<Playing | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setPlaying(null), [])
  useDialog(dialogRef, Boolean(playing), close, closeRef)

  const api = useMemo<PlayerApi>(
    () => ({
      playEpisode: (item) => setPlaying({ kind: 'episode', item }),
      playClip: (item) => setPlaying({ kind: 'clip', item }),
    }),
    [],
  )

  return (
    <PlayerContext.Provider value={api}>
      {children}
      <AnimatePresence>
        {playing && (
          <motion.div
            key="player"
            ref={dialogRef}
            className="on-dark fixed inset-0 z-[80] overflow-y-auto bg-ink/95"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-title"
          >
            <div className="flex min-h-full items-center justify-center p-4 md:p-10">
              <motion.div
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 8, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                onClick={(e) => e.stopPropagation()}
                className={playing.kind === 'clip' ? 'flex w-full max-w-4xl flex-col gap-6 md:flex-row md:items-center md:gap-10' : 'w-full max-w-5xl'}
              >
                <button
                  ref={closeRef}
                  type="button"
                  onClick={close}
                  className="fixed top-3 right-3 z-10 inline-flex size-11 items-center justify-center rounded-full bg-ink-3 text-paper transition-colors hover:bg-paper hover:text-ink md:top-5 md:right-5"
                  aria-label="Close player"
                >
                  <X className="size-5" aria-hidden />
                </button>
                {playing.kind === 'episode' ? <EpisodePlayer episode={playing.item} onNavigate={close} /> : <ClipPlayer clip={playing.item} onNavigate={close} />}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </PlayerContext.Provider>
  )
}

function EpisodePlayer({ episode, onNavigate }: { episode: Episode; onNavigate: () => void }) {
  const guests = getGuestsFor(episode.guestIds)
  return (
    <>
      <LiteYouTube youtubeId={episode.youtubeId} title={episode.title} hd={episode.hd} autoload className="rounded-lg" />
      <div className="mt-5 flex flex-col gap-5 text-paper md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="kicker text-muted-dark">
            {guests.length ? guests.map((g) => g.name).join(', ') + ' · ' : ''}
            <time dateTime={episode.publishedAt}>{formatDate(episode.publishedAt)}</time> · {formatDuration(episode.durationSeconds)}
          </p>
          <h2 id="player-title" className="title mt-2 text-xl md:text-2xl">
            {episode.title}
          </h2>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link to={`/episodes/${episode.slug}`} onClick={onNavigate} className={buttonClass('outline-light', 'md')}>
            Episode page
          </Link>
          <a href={youtubeWatchUrl(episode.youtubeId)} target="_blank" rel="noopener noreferrer" className={buttonClass('light', 'md')}>
            <YouTubeIcon className="size-4" /> Watch on YouTube<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </>
  )
}

function ClipPlayer({ clip, onNavigate }: { clip: Clip; onNavigate: () => void }) {
  const episode = getEpisode(clip.episodeSlug)
  const guests = getGuestsFor(clip.guestIds)
  return (
    <>
      <LiteYouTube
        youtubeId={clip.youtubeId}
        title={clip.title}
        vertical
        autoload
        className="mx-auto w-[min(100%,calc(72vh*9/16))] shrink-0 rounded-lg md:mx-0 md:w-[min(420px,calc(84vh*9/16))]"
      />
      <div className="text-paper md:max-w-sm">
        <p className="kicker text-muted-dark">
          Clip · {formatDuration(clip.durationSeconds)}
          {guests.length ? ` · ${guests.map((g) => g.name).join(', ')}` : ''}
        </p>
        <h2 id="player-title" className="title mt-2 text-2xl md:text-3xl">
          {clip.title}
        </h2>
        {clip.caption && <p className="mt-3 text-paper/75">{clip.caption}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          {episode && (
            <Link to={`/episodes/${episode.slug}`} onClick={onNavigate} className={buttonClass('yellow', 'md')}>
              Watch the full episode <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
          <a href={youtubeShortUrl(clip.youtubeId)} target="_blank" rel="noopener noreferrer" className={buttonClass('outline-light', 'md')}>
            <YouTubeIcon className="size-4" /> Open in YouTube<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </>
  )
}
