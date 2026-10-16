import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'

interface RailProps {
  label: string
  children: ReactNode
  dark?: boolean
  className?: string
}

/**
 * Horizontal, touch-friendly row of cards that snaps to items. On larger
 * screens it adds previous/next buttons, which disable at either end.
 * Tabbing through the cards scrolls them into view natively.
 */
export function Rail({ label, children, dark, className = '' }: RailProps) {
  const ref = useRef<HTMLUListElement>(null)
  const id = useId()
  const [edges, setEdges] = useState({ start: true, end: false })

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 })
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [update])

  const scroll = (direction: 1 | -1) => {
    const el = ref.current
    if (!el) return
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: smooth ? 'smooth' : 'auto' })
  }

  const control = `inline-flex size-11 items-center justify-center rounded-full border-[1.5px] transition-colors disabled:cursor-default disabled:opacity-30 ${
    dark ? 'border-paper/30 text-paper enabled:hover:border-paper enabled:hover:bg-paper enabled:hover:text-ink' : 'border-ink/20 text-ink enabled:hover:border-ink enabled:hover:bg-ink enabled:hover:text-paper'
  }`

  return (
    <div className={className}>
      <ul ref={ref} id={id} className="rail pb-2" aria-label={label}>
        {children}
      </ul>
      {!(edges.start && edges.end) && (
        <div className="mt-5 hidden justify-end gap-2 md:flex">
          <button type="button" className={control} onClick={() => scroll(-1)} disabled={edges.start} aria-controls={id} aria-label={`Scroll ${label} back`}>
            <ArrowLeft className="size-4" aria-hidden />
          </button>
          <button type="button" className={control} onClick={() => scroll(1)} disabled={edges.end} aria-controls={id} aria-label={`Scroll ${label} forward`}>
            <ArrowRight className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}
