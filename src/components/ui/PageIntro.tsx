import type { ReactNode } from 'react'
import { Link } from 'react-router'

interface PageIntroProps {
  kicker: string
  title: ReactNode
  intro?: ReactNode
  crumbs?: { label: string; to?: string }[]
  children?: ReactNode
}

/** Top of an inner page: breadcrumb, kicker, display title, intro. */
export function PageIntro({ kicker, title, intro, crumbs, children }: PageIntroProps) {
  return (
    <header className="wrap pt-8 pb-10 md:pt-14 md:pb-14">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="mb-8 text-sm text-muted">
          <ol className="flex flex-wrap items-center gap-2">
            {crumbs.map((c, i) => (
              <li key={c.label} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden>/</span>}
                {c.to ? (
                  <Link to={c.to} className="link-grow hover:text-ink">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-ink">
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <p className="kicker flex items-center gap-2.5 text-muted">
        <span className="size-2 rounded-full bg-blue" aria-hidden />
        {kicker}
      </p>
      <h1 className="display-xl mt-5 max-w-5xl">{title}</h1>
      {intro && <div className="measure mt-6 text-lg text-muted md:text-xl md:leading-relaxed">{intro}</div>}
      {children}
    </header>
  )
}
