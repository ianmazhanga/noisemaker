import { useId } from 'react'

/** Brand glyphs (Lucide v1 no longer ships brand logos). Decorative: pair with visible text or an aria-label. */

/** YouTube's own colours (red tile, white play arrow), whatever the surrounding text colour. */
export function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path fill="#ff0000" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8Z" />
      <path fill="#fff" d="M9.6 15.6V8.4l6.3 3.6-6.3 3.6Z" />
    </svg>
  )
}

/** Instagram's glyph in its gradient. */
export function InstagramIcon({ className }: { className?: string }) {
  const id = `ig-${useId()}`
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={id} cx="0.3" cy="1.07" r="1.2">
          <stop offset="0" stopColor="#fdf497" />
          <stop offset="0.1" stopColor="#fdf497" />
          <stop offset="0.5" stopColor="#fd5949" />
          <stop offset="0.68" stopColor="#d6249f" />
          <stop offset="1" stopColor="#285aeb" />
        </radialGradient>
      </defs>
      <g fill="none" stroke={`url(#${id})`} strokeWidth="2.2">
        <rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5.6" />
        <circle cx="12" cy="12" r="4.4" />
      </g>
      <circle cx="17.4" cy="6.6" r="1.35" fill={`url(#${id})`} />
    </svg>
  )
}

/** X (formerly Twitter). Uses the text colour, as X's logo is black or white. */
export function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.59-6.64 7.59H.47l8.6-9.83L0 1.15h7.6l5.24 6.93ZM17.6 20.65h2.04L6.48 3.24H4.3Z" />
    </svg>
  )
}

const TIKTOK =
  'M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03a10.7 10.7 0 0 1-5.82-1.9c-.01 2.92.01 5.84-.02 8.75a7.6 7.6 0 0 1-1.35 3.94 7.4 7.4 0 0 1-5.91 3.21 7.3 7.3 0 0 1-4.08-1.03 7.5 7.5 0 0 1-3.65-5.71c-.02-.5-.03-1-.01-1.49a7.6 7.6 0 0 1 8.73-6.68c.02 1.48-.04 2.96-.04 4.44a3.4 3.4 0 0 0-4.38 2.12c-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87a3.3 3.3 0 0 0 2.77-1.61c.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07Z'

/** TikTok's note with its cyan and pink edges. The main note uses the text colour. */
export function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="-1 -1 26 26" className={className} aria-hidden="true" focusable="false">
      <path d={TIKTOK} fill="#25f4ee" transform="translate(-0.7 -0.7)" />
      <path d={TIKTOK} fill="#fe2c55" transform="translate(0.7 0.7)" />
      <path d={TIKTOK} fill="currentColor" />
    </svg>
  )
}
