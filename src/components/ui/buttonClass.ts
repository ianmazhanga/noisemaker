/** Shared button styles, for links and buttons that need to look like buttons. */
export type Variant = 'primary' | 'dark' | 'outline' | 'light' | 'outline-light' | 'yellow'
export type Size = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-full border-[1.5px] font-sans font-semibold leading-none whitespace-nowrap transition-[background-color,color,border-color] duration-200 ease-[var(--ease-out)] disabled:pointer-events-none disabled:opacity-50'

const variants: Record<Variant, string> = {
  primary: 'border-blue bg-blue text-white hover:border-blue-deep hover:bg-blue-deep',
  dark: 'border-ink bg-ink text-paper hover:border-ink-3 hover:bg-ink-3',
  outline: 'border-ink/25 bg-transparent text-ink hover:border-ink hover:bg-ink hover:text-paper',
  light: 'border-paper bg-paper text-ink hover:border-yellow hover:bg-yellow',
  'outline-light': 'border-paper/40 bg-transparent text-paper hover:border-paper hover:bg-paper hover:text-ink',
  yellow: 'border-yellow bg-yellow text-ink hover:border-paper hover:bg-paper',
}

const sizes: Record<Size, string> = {
  sm: 'min-h-10 px-4 text-sm',
  md: 'min-h-11 px-5 text-[0.9375rem]',
  lg: 'min-h-13 px-6 text-base',
}

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = '') {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`
}

