import { useCallback, useState, type CSSProperties } from 'react'
import { landscapeThumb, verticalThumb } from '../../lib/youtube'
import type { Focus } from '../../types/content'
import { LogoMark } from '../brand/Logo'

interface ThumbProps {
  youtubeId: string
  /** Empty string for decorative images whose meaning is given by nearby text. */
  alt: string
  hd?: boolean
  /** Use the vertical frame YouTube generates for Shorts. */
  vertical?: boolean
  focus?: Focus
  /** Rendered width, so the browser picks the right file from the srcset. */
  sizes?: string
  priority?: boolean
  /** Sizing and shape: the parent decides the aspect ratio. */
  className?: string
  zoom?: boolean
}

type Stage = 'primary' | 'fallback' | 'failed'

/**
 * YouTube thumbnail that fills its box. Fades in on load, crops letterboxed
 * thumbnails to the picture area, and falls back first to a smaller file and
 * then to a branded tile, so a broken image is never shown.
 */
export function Thumb({ youtubeId, alt, hd, vertical, focus, sizes = '100vw', priority, className = '', zoom = true }: ThumbProps) {
  const [loaded, setLoaded] = useState(false)
  const [stage, setStage] = useState<Stage>('primary')
  const source = vertical ? { ...verticalThumb(youtubeId), srcSet: undefined } : landscapeThumb(youtubeId, hd)
  const src = stage === 'fallback' ? source.fallback : source.src

  // Images served from cache can finish loading before React attaches onLoad.
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setLoaded(true)
  }, [])

  const style = { '--fx': focus?.x ?? 0.5, '--fy': focus?.y ?? 0.5, '--zoom': focus?.zoom ?? 1 } as CSSProperties

  return (
    <div className={`thumb ${zoom ? 'thumb-zoom' : ''} ${className}`} style={style}>
      {stage === 'failed' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-blue" role={alt ? 'img' : undefined} aria-label={alt || undefined}>
          <LogoMark tile={false} className="size-1/3 max-w-24 opacity-90" />
        </div>
      ) : (
        <div className={vertical ? 'absolute inset-0' : 'thumb-box'}>
          <img
            ref={imgRef}
            key={src}
            src={src}
            srcSet={stage === 'primary' ? source.srcSet : undefined}
            sizes={stage === 'primary' && source.srcSet ? sizes : undefined}
            alt={alt}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            onLoad={() => setLoaded(true)}
            onError={() => setStage((s) => (s === 'primary' ? 'fallback' : 'failed'))}
            className={loaded ? 'opacity-100' : 'opacity-0'}
          />
        </div>
      )}
    </div>
  )
}
