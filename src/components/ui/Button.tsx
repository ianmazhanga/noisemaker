import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router'
import { buttonClass, type Size, type Variant } from './buttonClass'

interface CommonProps {
  variant?: Variant
  size?: Size
  className?: string
  children: ReactNode
}

export function Button({ variant, size, className, children, type = 'button', ...rest }: CommonProps & Omit<ComponentProps<'button'>, 'className'>) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </button>
  )
}

export function ButtonLink({ variant, size, className, children, to }: CommonProps & { to: string }) {
  return (
    <Link to={to} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  )
}

/** External link that opens in a new tab. */
export function ExternalButton({ variant, size, className, children, href }: CommonProps & { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass(variant, size, className)}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
