/**
 * The channel's mark, redrawn as a crisp SVG: a white network globe on the
 * channel's blue tile.
 */
const RIM: [number, number][] = [
  [16, 6.5],
  [23.4, 9.8],
  [25.4, 17.2],
  [21.6, 24.4],
  [13.4, 25.3],
  [7.3, 20.4],
  [7, 12.4],
]
const INNER: [number, number][] = [
  [14.4, 12.6],
  [20.2, 14.8],
  [15.6, 19.8],
  [10.8, 16.6],
]
const EDGES: [number, number][] = [
  [0, 7], [6, 7], [7, 8], [1, 8], [2, 8], [8, 9], [3, 9], [4, 9], [9, 10], [10, 7], [5, 10], [6, 10], [9, 2],
]

export function LogoMark({ className = '', tile = true }: { className?: string; tile?: boolean }) {
  const points = [...RIM, ...INNER]
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      {tile && <rect width="32" height="32" rx="7" fill="#1a62f2" />}
      <g stroke="#fff" strokeWidth="1.05" fill="none" strokeLinecap="round">
        <circle cx="16" cy="16" r="9.6" />
        {EDGES.map(([a, b]) => (
          <line key={`${a}-${b}`} x1={points[a][0]} y1={points[a][1]} x2={points[b][0]} y2={points[b][1]} />
        ))}
      </g>
      <g fill="#fff">
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === 8 || i === 0 ? 1.75 : 1.3} />
        ))}
      </g>
    </svg>
  )
}

interface LogoProps {
  inverted?: boolean
  className?: string
  /** Full lockup with the channel's "News Network" line, as on YouTube. */
  lockup?: boolean
}

export function Logo({ inverted, className = '', lockup }: LogoProps) {
  return (
    // Slightly smaller on phones so the full lockup fits beside the header buttons.
    <span className={`inline-flex items-center gap-2 sm:gap-2.5 ${className}`}>
      <LogoMark className="size-8 shrink-0 sm:size-9" />
      <span
        className={`font-display text-[1.15rem] leading-none font-[800] tracking-[-0.03em] sm:text-[1.3rem] ${inverted ? 'text-paper' : 'text-ink'}`}
        style={{ fontVariationSettings: "'wdth' 104" }}
      >
        Noisemakers
      </span>
      {lockup && (
        // Hidden on the narrowest phones, where it would push the header buttons off screen.
        <span
          className={`border-l pl-2 text-[0.625rem] leading-tight font-semibold tracking-[0.06em] uppercase max-[379px]:hidden sm:pl-2.5 sm:text-[0.6875rem] ${inverted ? 'border-paper/30 text-paper/70' : 'border-ink/20 text-muted'}`}
        >
          News
          <br />
          Network
        </span>
      )}
    </span>
  )
}
