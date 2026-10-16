import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'

interface SectionHeadingProps {
  id: string
  /** Two-digit section number, magazine style */
  index?: string
  kicker: string
  title: ReactNode
  intro?: ReactNode
  action?: { label: string; to: string }
  dark?: boolean
  children?: ReactNode
}

export function SectionHeading({ id, index, kicker, title, intro, action, dark, children }: SectionHeadingProps) {
  return (
    <div className="mb-8 flex flex-col gap-5 md:mb-12 md:flex-row md:items-end md:justify-between md:gap-10">
      <div className="max-w-3xl">
        <p className={`kicker flex items-center gap-3 ${dark ? 'text-muted-dark' : 'text-muted'}`}>
          {index && <span className={dark ? 'text-yellow' : 'text-blue-ink'}>{index}</span>}
          {index && <span aria-hidden className={`h-px w-8 ${dark ? 'bg-paper/30' : 'bg-ink/25'}`} />}
          {kicker}
        </p>
        <h2 id={id} className="display-lg mt-4">
          {title}
        </h2>
        {intro && <p className={`measure mt-4 text-[1.0625rem] ${dark ? 'text-paper/75' : 'text-muted'}`}>{intro}</p>}
      </div>
      {(action || children) && (
        <div className="flex shrink-0 items-center gap-3">
          {children}
          {action && (
            <Link
              to={action.to}
              className={`group inline-flex min-h-11 items-center gap-2 text-[0.9375rem] font-semibold ${dark ? 'text-paper' : 'text-ink'}`}
            >
              <span className="link-grow">{action.label}</span>
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
