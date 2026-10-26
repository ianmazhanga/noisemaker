import markSrc from '../../assets/brand/logo-mark.png'

/** The channel's mark: the white network globe, on the logo's blue tile unless `tile` is false. */
export function LogoMark({ className = '', tile = true }: { className?: string; tile?: boolean }) {
  const img = <img src={markSrc} alt="" aria-hidden="true" draggable={false} className={tile ? 'size-[74%]' : className} />
  if (!tile) return img
  return <span className={`inline-flex items-center justify-center rounded-[22%] bg-[#0d72ff] ${className}`}>{img}</span>
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
