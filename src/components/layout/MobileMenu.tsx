import { useRef } from 'react'
import { NavLink } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { PRIMARY_NAV, SITE } from '../../config/site'
import { getLeadEpisode } from '../../lib/content'
import { useDialog } from '../../hooks/useDialog'
import { Logo } from '../brand/Logo'
import { YouTubeIcon } from '../ui/BrandIcons'
import { buttonClass } from '../ui/buttonClass'
import { usePlayer } from '../player/PlayerContext'

interface MobileMenuProps {
  open: boolean
  onClose: () => void
}

export function MobileMenu({ open, onClose }: MobileMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const { playEpisode } = usePlayer()
  const lead = getLeadEpisode()
  useDialog(panelRef, open, onClose, closeRef)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="menu"
          id="mobile-menu"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-paper lg:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="wrap flex h-[var(--header-h)] shrink-0 items-center justify-between">
            <Logo />
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="inline-flex size-11 items-center justify-center rounded-full border-[1.5px] border-ink/15 hover:border-ink"
              aria-label="Close menu"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>

          <nav aria-label="Mobile" className="wrap mt-6">
            <ul>
              {PRIMARY_NAV.map((item, i) => (
                <motion.li
                  key={item.to}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.03 + i * 0.03, duration: 0.25 }}
                  className="border-b border-line"
                >
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `display-md flex min-h-16 items-center justify-between py-3 ${isActive ? 'text-blue-ink' : 'text-ink'}`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {item.label}
                        {isActive && <span className="size-2 rounded-full bg-blue" aria-hidden />}
                      </>
                    )}
                  </NavLink>
                </motion.li>
              ))}
            </ul>
          </nav>

          <div className="wrap mt-auto flex flex-col gap-3 pt-10 pb-8">
            {lead && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  playEpisode(lead)
                }}
                className={buttonClass('dark', 'lg', 'w-full')}
              >
                Watch the latest episode
              </button>
            )}
            <a href={SITE.youtube.subscribeUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'lg', 'w-full')}>
              <YouTubeIcon className="size-5" /> Subscribe on YouTube<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
