import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'

interface RailProps {
  label: string
  children: ReactNode
  dark?: boolean
  /** Show the previous/next scroll buttons. Turn off when the parent provides its own. */
  controls?: boolean
  /**
   * Called when someone stops scrolling the rail by hand (mouse drag, swipe,
   * trackpad or wheel), with the index of the card nearest the start.
   * Keyboard focus scrolling doesn't trigger it.
   */
  onSettle?: (index: number) => void
  className?: string
}

/** Pixels the mouse must move before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 6

/**
 * Horizontal, touch-friendly row of cards that snaps to items. On larger
 * screens it adds previous/next buttons, which disable at either end, and
 * the row can be dragged with the mouse. Tabbing through the cards scrolls
 * them into view natively.
 */
export function Rail({ label, children, dark, controls = true, onSettle, className = '' }: RailProps) {
  const ref = useRef<HTMLUListElement>(null)
  const id = useId()
  const [edges, setEdges] = useState({ start: true, end: false })
  const [dragging, setDragging] = useState(false)
  // True while a scroll was started by a person's pointer, touch or wheel, so onSettle ignores focus scrolling.
  const handScroll = useRef(false)
  const onSettleRef = useRef(onSettle)
  useEffect(() => {
    onSettleRef.current = onSettle
  }, [onSettle])

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 })
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    let settleTimer = 0
    const onScroll = () => {
      update()
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        if (!handScroll.current || el.dataset.dragging) return
        handScroll.current = false
        const items = [...el.children] as HTMLElement[]
        if (!items.length) return
        const origin = items[0].offsetLeft
        let nearest = 0
        items.forEach((item, i) => {
          if (Math.abs(item.offsetLeft - origin - el.scrollLeft) < Math.abs(items[nearest].offsetLeft - origin - el.scrollLeft)) nearest = i
        })
        onSettleRef.current?.(nearest)
      }, 180)
    }
    const markHand = () => {
      handScroll.current = true
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('touchstart', markHand, { passive: true })
    el.addEventListener('wheel', markHand, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      window.clearTimeout(settleTimer)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('touchstart', markHand)
      el.removeEventListener('wheel', markHand)
      observer.disconnect()
    }
  }, [update])

  /** Click-and-drag scrolling with a mouse. Touch and trackpads scroll natively. */
  const onPointerDown = (e: ReactPointerEvent<HTMLUListElement>) => {
    const el = ref.current
    if (!el || e.pointerType !== 'mouse' || e.button !== 0 || el.scrollWidth <= el.clientWidth) return
    const startX = e.clientX
    const startScroll = el.scrollLeft
    let moved = false

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD) return
      if (!moved) {
        moved = true
        handScroll.current = true
        el.dataset.dragging = 'true'
        // Snapping fights a drag, so it's paused until the mouse is released.
        el.style.scrollSnapType = 'none'
        setDragging(true)
      }
      el.scrollLeft = startScroll - dx
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (!moved) return
      delete el.dataset.dragging
      el.style.scrollSnapType = ''
      setDragging(false)
      // A drag shouldn't also count as a click on the card under the cursor.
      const swallow = (ev: MouseEvent) => {
        ev.preventDefault()
        ev.stopPropagation()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
      // Settle even if the snap didn't move the rail any further.
      el.dispatchEvent(new Event('scroll'))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const scroll = (direction: 1 | -1) => {
    const el = ref.current
    if (!el) return
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: smooth ? 'smooth' : 'auto' })
  }

  const control = `inline-flex size-11 items-center justify-center rounded-full border-[1.5px] transition-colors disabled:cursor-default disabled:opacity-30 ${
    dark ? 'border-paper/30 text-paper enabled:hover:border-paper enabled:hover:bg-paper enabled:hover:text-ink' : 'border-ink/20 text-ink enabled:hover:border-ink enabled:hover:bg-ink enabled:hover:text-paper'
  }`
  const scrollable = !(edges.start && edges.end)

  return (
    <div className={className}>
      <ul
        ref={ref}
        id={id}
        className={`rail pb-2 ${scrollable ? 'md:cursor-grab' : ''} ${dragging ? 'cursor-grabbing! select-none [&_*]:cursor-grabbing!' : ''}`}
        aria-label={label}
        onPointerDown={onPointerDown}
        // Stops the browser dragging a thumbnail image instead of scrolling.
        onDragStart={(e) => e.preventDefault()}
      >
        {children}
      </ul>
      {controls && scrollable && (
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
