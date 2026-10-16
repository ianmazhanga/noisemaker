import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { Menu } from 'lucide-react'
import { PRIMARY_NAV, SITE } from '../../config/site'
import { Logo } from '../brand/Logo'
import { YouTubeIcon } from '../ui/BrandIcons'
import { buttonClass } from '../ui/buttonClass'
import { MobileMenu } from './MobileMenu'

export function Header() {
  const [scrolled, setScrolled] = useState(false)
  const { pathname } = useLocation()
  // The menu stays open only on the route it was opened on, so any navigation closes it.
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const menuOpen = menuPath === pathname

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <a
        href="#main"
        className="sr-only z-[100] rounded-full bg-ink px-5 py-3 font-semibold text-paper focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <header
        className={`sticky top-0 z-50 bg-paper transition-[border-color] duration-200 ${scrolled ? 'border-b border-line' : 'border-b border-transparent'}`}
      >
        <div className="wrap flex h-[var(--header-h)] items-center justify-between gap-6">
          <Link to="/" className="-m-1 rounded-md p-1" aria-label={`${SITE.name}, home`}>
            <Logo />
          </Link>

          <nav aria-label="Primary" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {PRIMARY_NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      `relative inline-flex min-h-11 items-center px-3.5 text-[0.9375rem] font-medium transition-colors ${
                        isActive ? 'text-ink after:absolute after:bottom-1.5 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-blue' : 'text-muted hover:text-ink'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            <a href={SITE.youtube.channelUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'sm', 'max-sm:hidden')}>
              <YouTubeIcon className="size-4" /> Watch on YouTube<span className="sr-only"> (opens in a new tab)</span>
            </a>
            <a
              href={SITE.youtube.channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex size-11 items-center justify-center rounded-full bg-blue text-white sm:hidden"
              aria-label="Watch on YouTube (opens in a new tab)"
            >
              <YouTubeIcon className="size-5" />
            </a>
            <button
              type="button"
              onClick={() => setMenuPath(pathname)}
              className="inline-flex size-11 items-center justify-center rounded-full border-[1.5px] border-ink/15 text-ink transition-colors hover:border-ink lg:hidden"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
            >
              <Menu className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      </header>
      <MobileMenu open={menuOpen} onClose={() => setMenuPath(null)} />
    </>
  )
}
