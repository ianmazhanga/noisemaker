import { Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
import { Header } from './Header'
import { Footer } from './Footer'

function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, hash])
  return null
}

export function PageFallback() {
  return (
    <div className="wrap py-20" role="status" aria-live="polite">
      <div className="h-3 w-28 animate-pulse rounded bg-line" />
      <div className="mt-6 h-14 max-w-2xl animate-pulse rounded bg-bone" />
      <div className="mt-3 h-14 max-w-xl animate-pulse rounded bg-bone" />
      <div className="mt-12 grid gap-6 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="aspect-video animate-pulse rounded-lg bg-bone" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  )
}

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
