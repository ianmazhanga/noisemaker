/**
 * Small, dependency-free charts for the Analytics section. One series per chart (small
 * multiples instead of second axes), thin marks, recessive grid, a crosshair tooltip that
 * also works from the keyboard, and a table view so no value depends on hovering.
 */
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { compact } from './lib'

const SERIES = '#1a62f2'
const GRID = '#e2ded5'
const SURFACE = '#fbfaf7'


function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const step = 10 ** Math.floor(Math.log10(max / 4))
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => max / s <= 5) ?? step * 10
  return Array.from({ length: Math.floor(max / nice) + 2 }, (_, i) => i * nice).filter((_, i, all) => i === 0 || all[i - 1] < max)
}

export interface Point {
  label: string
  value: number
}

/** Value over time: a 2px line with a light wash, crosshair readout and an end label. */
export function LineChart({ points, title, unit = '' }: { points: Point[]; title: string; unit?: string }) {
  const [active, setActive] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const ref = useRef<SVGSVGElement>(null)
  const id = useId()
  const W = 600
  const H = 200
  const pad = { l: 44, r: 56, t: 12, b: 26 }
  if (!points.length) return <p className="text-sm text-muted">No data in this period.</p>

  const max = Math.max(...points.map((p) => p.value))
  const min = Math.min(0, ...points.map((p) => p.value))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (W - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - (v - min) / (top - min)) * (H - pad.t - pad.b)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('')
  const area = `${path}L${x(points.length - 1)},${y(min)}L${x(0)},${y(min)}Z`
  const last = points.length - 1

  const fromPointer = (e: PointerEvent<SVGSVGElement>) => {
    const box = ref.current!.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    let best = 0
    points.forEach((_, i) => (Math.abs(x(i) - px) < Math.abs(x(best) - px) ? (best = i) : null))
    setActive(best)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(last, (a ?? -1) + 1))
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? last + 1) - 1))
    else return
    e.preventDefault()
  }
  const a = active === null ? null : points[active]

  return (
    <figure>
      <div className="flex items-center justify-between gap-2">
        <figcaption className="text-sm font-semibold">{title}</figcaption>
        <button type="button" className="text-xs font-semibold text-blue-ink underline" onClick={() => setTable(!table)} aria-expanded={table} aria-controls={`${id}-table`}>
          {table ? 'Chart' : 'Table'}
        </button>
      </div>
      {table ? (
        <div id={`${id}-table`} className="mt-2 max-h-56 overflow-y-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {points.map((p) => (
                <tr key={p.label}>
                  <td className="py-1 text-muted">{p.label}</td>
                  <td className="py-1 text-right font-semibold tabular-nums">{p.value.toLocaleString()}{unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-2">
          <svg
            ref={ref}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-blue"
            role="img"
            aria-label={`${title}: ${points[0].label} ${points[0].value.toLocaleString()}${unit} to ${points[last].label} ${points[last].value.toLocaleString()}${unit}. Use the arrow keys to read each value.`}
            tabIndex={0}
            onPointerMove={fromPointer}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
                <text x={pad.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted text-[11px]">
                  {compact(t)}
                </text>
              </g>
            ))}
            <text x={pad.l} y={H - 6} className="fill-muted text-[11px]">{points[0].label}</text>
            {last > 0 && <text x={W - pad.r} y={H - 6} textAnchor="end" className="fill-muted text-[11px]">{points[last].label}</text>}
            <path d={area} fill={SERIES} opacity={0.1} />
            <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {active !== null && <line x1={x(active)} x2={x(active)} y1={pad.t} y2={H - pad.b} stroke="#5b5954" strokeWidth={1} />}
            <circle cx={x(active ?? last)} cy={y(points[active ?? last].value)} r={4} fill={SERIES} stroke={SURFACE} strokeWidth={2} />
            {active === null && (
              <text x={x(last) + 8} y={y(points[last].value)} dominantBaseline="middle" className="fill-ink text-[12px] font-semibold">
                {compact(points[last].value)}{unit}
              </text>
            )}
          </svg>
          {a && (
            <div className="pointer-events-none absolute top-0 rounded-lg bg-ink px-2.5 py-1.5 text-xs text-paper shadow-lg" style={{ left: `${Math.min(80, (x(active!) / W) * 100)}%` }} role="status">
              <span className="block text-sm font-semibold tabular-nums">{a.value.toLocaleString()}{unit}</span>
              <span className="text-paper/70">{a.label}</span>
            </div>
          )}
        </div>
      )}
    </figure>
  )
}

/** Comparing categories: horizontal bars (≤24px) with the value at the tip. */
export function BarList({ items, title }: { items: Point[]; title: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <figure>
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      <ul className="mt-3 space-y-2">
        {items.map((i) => (
          <li key={i.label} className="grid grid-cols-[7rem_1fr] items-center gap-2 text-sm" title={`${i.label}: ${i.value.toLocaleString()}`}>
            <span className="truncate text-muted">{i.label}</span>
            <span className="flex items-center gap-2">
              <span className="h-5 rounded-r-[4px]" style={{ width: `${Math.max(i.value ? 2 : 0, (i.value / max) * 85)}%`, background: SERIES }} aria-hidden />
              <span className="font-semibold tabular-nums">{i.value.toLocaleString()}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  )
}
