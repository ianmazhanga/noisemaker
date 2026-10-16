import { Play } from 'lucide-react'

const sizes = {
  sm: 'size-10 [&>svg]:size-4',
  md: 'size-13 [&>svg]:size-5',
  lg: 'size-16 md:size-20 [&>svg]:size-6 md:[&>svg]:size-7',
}

/** Visual play affordance. Always sits inside a button or link that does the playing. */
export function PlayIcon({ size = 'md', className = '' }: { size?: keyof typeof sizes; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center rounded-full bg-blue text-white shadow-[0_6px_24px_-6px_rgb(11_11_12/0.5)] transition-transform duration-300 ease-[var(--ease-out)] group-hover:scale-[1.06] ${sizes[size]} ${className}`}
    >
      <Play className="ml-[8%] fill-current" />
    </span>
  )
}
