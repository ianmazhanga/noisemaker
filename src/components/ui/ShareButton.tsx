import { useEffect, useState } from 'react'
import { Check, Link2, Share2 } from 'lucide-react'
import { buttonClass } from './buttonClass'

type Status = 'idle' | 'copied' | 'failed'

/** Native share sheet where available (mostly mobile), otherwise copies the link. */
export function ShareButton({ title, className = '' }: { title: string; className?: string }) {
  const [status, setStatus] = useState<Status>('idle')
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    if (status === 'idle') return
    const t = window.setTimeout(() => setStatus('idle'), 2500)
    return () => window.clearTimeout(t)
  }, [status])

  const share = async () => {
    const url = window.location.href
    if (canShare) {
      try {
        await navigator.share({ title, url })
      } catch {
        // Dismissing the share sheet rejects. Nothing to do.
      }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
  }

  return (
    <>
      <button type="button" onClick={share} className={buttonClass('outline', 'md', className)}>
        {status === 'copied' ? <Check className="size-4" aria-hidden /> : canShare ? <Share2 className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
        {status === 'copied' ? 'Link copied' : canShare ? 'Share' : 'Copy link'}
      </button>
      <span className="sr-only" role="status">
        {status === 'copied' ? 'Link copied to clipboard' : status === 'failed' ? 'Couldn’t copy the link. Copy it from the address bar.' : ''}
      </span>
      {status === 'failed' && <span className="text-sm text-muted">Couldn’t copy. Use the address bar instead.</span>}
    </>
  )
}
