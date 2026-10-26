import type { ComponentType } from 'react'
import { SITE } from '../../config/site'
import { InstagramIcon, TikTokIcon, XIcon, YouTubeIcon } from './BrandIcons'

const NETWORKS: { label: string; href: string; Icon: ComponentType<{ className?: string }> }[] = [
  { label: 'YouTube', href: SITE.youtube.channelUrl, Icon: YouTubeIcon },
  { label: 'Instagram', href: SITE.social.instagram, Icon: InstagramIcon },
  { label: 'X (Twitter)', href: SITE.social.x, Icon: XIcon },
  { label: 'TikTok', href: SITE.social.tiktok, Icon: TikTokIcon },
]

/** Round logo buttons for each profile that has a URL in SITE, in the networks' own colours. */
export function SocialLinks({ className = '' }: { className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-3 ${className}`} aria-label="Follow Noisemakers">
      {NETWORKS.filter((n) => n.href).map(({ label, href, Icon }) => (
        <li key={label}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={label}
            className="inline-flex size-12 items-center justify-center rounded-full bg-paper text-ink shadow-[0_6px_16px_-10px_rgb(11_11_12_/_0.6)] transition-transform duration-200 ease-[var(--ease-out)] hover:-translate-y-0.5"
          >
            <Icon className="size-6" />
            <span className="sr-only">Noisemakers on {label} (opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
