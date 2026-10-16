import { Link, useRouteError } from 'react-router'
import { Logo } from '../brand/Logo'
import { buttonClass } from '../ui/buttonClass'

/**
 * Shown if a page throws or a lazy-loaded page fails to download (for example
 * after a deploy or on a dropped connection). Stands alone so it works even
 * when the main layout is what failed.
 */
export function RouteError() {
  const error = useRouteError()
  if (import.meta.env.DEV) console.error(error)

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <div className="wrap flex h-[var(--header-h)] items-center">
        <Link to="/" aria-label="Noisemakers, home">
          <Logo />
        </Link>
      </div>
      <main className="wrap flex flex-1 flex-col justify-center py-20">
        <p className="kicker text-blue-ink">Something went wrong</p>
        <h1 className="display-lg mt-4 max-w-2xl">This page didn’t load properly.</h1>
        <p className="measure mt-5 text-lg text-muted">It may be a connection problem. Try reloading the page. If that doesn’t work, start again from the homepage.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={() => window.location.reload()} className={buttonClass('primary', 'lg')}>
            Reload page
          </button>
          <a href="/" className={buttonClass('outline', 'lg')}>
            Go to the homepage
          </a>
        </div>
      </main>
    </div>
  )
}
