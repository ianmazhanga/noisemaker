import { useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Check } from 'lucide-react'
import { CONSENT_TEXT, EMAIL_PATTERN } from '../../lib/newsletter'
import { buttonClass } from '../ui/buttonClass'

/** Newsletter sign-up: email and explicit consent. The address goes only to the site's own /api/newsletter/subscribe. */
export function NewsletterSignup({ dark = false }: { dark?: boolean }) {
  const id = useId()
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [state, setState] = useState<{ kind: 'idle' | 'sending' | 'error' | 'done'; text?: string }>({ kind: 'idle' })
  const honeypot = useRef<HTMLInputElement>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!EMAIL_PATTERN.test(email.trim())) return setState({ kind: 'error', text: 'Please enter a valid email address.' })
    if (!consent) return setState({ kind: 'error', text: 'Please tick the box to agree to receive the newsletter.' })
    setState({ kind: 'sending' })
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), consent: true, honeypot: honeypot.current?.value ?? '' }),
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await res.json().catch(() => ({}))) as { confirmation?: string }
      if (!res.ok) throw new Error(String(res.status))
      setState({ kind: 'done', text: body.confirmation === 'email' ? 'Nearly done: check your inbox and click the link to confirm.' : 'Thank you. We’ll email you a link to confirm your subscription.' })
    } catch (error) {
      setState({ kind: 'error', text: (error as Error).message === '429' ? 'Lots of people are signing up right now. Please try again in a few minutes.' : 'That didn’t work. Please try again in a moment.' })
    }
  }

  const text = dark ? 'text-paper/80' : 'text-muted'
  if (state.kind === 'done')
    return (
      <p role="status" className={`flex items-start gap-2 font-semibold ${dark ? 'text-paper' : 'text-ink'}`}>
        <Check className="mt-1 size-4 shrink-0" aria-hidden /> {state.text}
      </p>
    )
  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`${id}-email`} className="sr-only">
          Email address
        </label>
        <input
          id={`${id}-email`}
          type="email"
          autoComplete="email"
          required
          placeholder="Your email address"
          className="min-h-12 w-full rounded-full border-[1.5px] border-ink/20 bg-white px-5 text-ink placeholder:text-muted/70 focus:border-ink focus:outline-none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" disabled={state.kind === 'sending'} className={buttonClass(dark ? 'yellow' : 'primary', 'lg', 'shrink-0')}>
          {state.kind === 'sending' ? 'Sending…' : 'Subscribe'}
        </button>
      </div>
      <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <label className={`flex items-start gap-2 text-sm ${text}`}>
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-blue" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          {CONSENT_TEXT.replace(' as described in the privacy policy.', ' as described in the ')}
          <Link to="/privacy" className="font-semibold underline underline-offset-2">
            privacy policy
          </Link>
          .
        </span>
      </label>
      {state.kind === 'error' && (
        <p role="alert" className={dark ? 'font-semibold text-yellow' : 'font-semibold text-danger'}>
          {state.text}
        </p>
      )}
    </form>
  )
}
