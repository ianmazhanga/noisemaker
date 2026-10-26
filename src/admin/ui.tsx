/**
 * Building blocks shared by the dashboard sections: calling the server, page headers,
 * notices, badges, tabs, confirmations and loading data from Supabase.
 */
import { useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Database, X } from 'lucide-react'
import { useDialog } from '../hooks/useDialog'
import { buttonClass } from '../components/ui/buttonClass'

/** What each server error code means, in plain English. */
/** POSTs to one of the site's server functions as the signed-in person. */
export function PageHeader({ title, intro, actions }: { title: string; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-[800] tracking-[-0.02em] md:text-4xl">{title}</h1>
        {intro && <p className="mt-1 max-w-3xl text-muted">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-paper p-4 md:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const style = { info: 'border-line bg-bone', warn: 'border-yellow bg-yellow/15', error: 'border-danger/40 bg-danger/10 text-danger', success: 'border-[#1f7a4d]/40 bg-[#1f7a4d]/10' }[kind]
  return (
    <div role={kind === 'error' ? 'alert' : undefined} className={`rounded-lg border px-4 py-3 ${style}`}>
      {children}
    </div>
  )
}

/** Shown instead of a section until the newsroom migration has been run. */
export function NeedsMigration({ title }: { title: string }) {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl font-[800] tracking-[-0.02em] md:text-4xl">{title}</h1>
      <div className="mt-6 rounded-xl border border-yellow bg-yellow/15 p-5">
        <p className="flex items-center gap-2 font-semibold">
          <Database className="size-5" aria-hidden /> One database update is needed before this section works.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted">
          <li>Open your Supabase project → SQL Editor → New query.</li>
          <li>
            Paste the whole of <code className="font-mono text-sm">supabase/migrations/20261028000000_newsroom.sql</code> from the GitHub repository and press Run. It only adds things, and is safe to run again.
          </li>
          <li>Reload this page.</li>
        </ol>
      </div>
    </div>
  )
}

export function Badge({ children, className = 'bg-line text-ink' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${className}`}>{children}</span>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink/20 p-6">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-muted">{children}</div>}
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Record<T, ReactNode>; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line">
      {(Object.keys(tabs) as T[]).map((t) => (
        <button
          key={t}
          type="button"
          aria-current={value === t ? 'page' : undefined}
          onClick={() => onChange(t)}
          className={`-mb-px min-h-11 border-b-2 px-4 font-semibold whitespace-nowrap ${value === t ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
        >
          {tabs[t]}
        </button>
      ))}
    </nav>
  )
}

/** A button that asks "Are you sure?" inline before doing something that can't be undone. */
export function ConfirmButton({ label, confirm, onConfirm, danger, disabled, className = '' }: { label: ReactNode; confirm: string; onConfirm: () => void; danger?: boolean; disabled?: boolean; className?: string }) {
  const [asking, setAsking] = useState(false)
  if (!asking)
    return (
      <button type="button" disabled={disabled} className={buttonClass('outline', 'sm', className)} onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label={confirm}>
      <span className={`text-sm font-semibold ${danger ? 'text-danger' : ''}`}>{confirm}</span>
      <button type="button" className={buttonClass('dark', 'sm', danger ? '!border-danger !bg-danger' : '')} onClick={() => (setAsking(false), onConfirm())}>
        Yes
      </button>
      <button type="button" className={buttonClass('outline', 'sm')} onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  )
}

export function Warnings({ items }: { items: string[] | undefined }) {
  if (!items?.length) return null
  return (
    <ul className="space-y-1 text-sm text-danger">
      {items.map((w) => (
        <li key={w} className="flex gap-1.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {w}
        </li>
      ))}
    </ul>
  )
}

/** Loads data with Supabase, noticing when the section's tables don't exist yet. */
/** Status pill colours shared by articles, newsletters, clips and projects. */
/** Uploads a file straight to Supabase Storage with a one-time link from the server. */
/** A video file's length, read in the browser before uploading (so limits can be checked first). */
/** Turns rows into a CSV download. */
/** A panel that slides over the page from the right (full screen on phones). Escape or the × closes it. */
export function Drawer({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref, true, onClose)
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 bg-ink/40" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div ref={ref} className={`absolute inset-y-0 right-0 flex w-full flex-col bg-bone shadow-2xl ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}>
        <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-3 md:px-6">
          <h2 className="min-w-0 flex-1 truncate text-xl font-semibold">{title}</h2>
          <button type="button" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-bone" aria-label="Close" onClick={onClose}>
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">{children}</div>
      </div>
    </div>
  )
}

