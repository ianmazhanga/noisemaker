import { useState } from 'react'
import { Mail, MessageCircle, Phone, Star } from 'lucide-react'
import { buttonClass } from '../ui/buttonClass'
import { defaultMessage, emailSubject, mailtoLink, telLink, whatsappLink, type ContactMethod, type InboxEntry } from '../../lib/inbox'
import { inputClass, METHOD_LABEL } from './shared'

/**
 * Reply buttons for the ways this person can be reached, their chosen one first and marked.
 * Nothing is sent from here: each button opens WhatsApp, the phone dialler or the email app with the message ready to check.
 */
export function ContactPanel({ entry, preferred }: { entry: InboxEntry; preferred: ContactMethod | null }) {
  const f = entry.fields
  const [message, setMessage] = useState(() => defaultMessage(entry))
  const id = `message-${entry.id}`
  const options = [
    { method: 'whatsapp', href: whatsappLink(f.phone, message), label: 'Contact on WhatsApp', Icon: MessageCircle, external: true },
    { method: 'phone', href: telLink(f.phone), label: 'Call now', Icon: Phone, external: false },
    { method: 'email', href: mailtoLink(f.email, emailSubject(entry), message), label: 'Send email', Icon: Mail, external: false },
  ] as const
  const available = options.filter((o) => o.href).sort((a, b) => Number(b.method === preferred) - Number(a.method === preferred))
  const preferredMissing = preferred && !available.some((o) => o.method === preferred)

  return (
    <div className="border-t border-line bg-bone/60 p-4 md:p-5">
      <label htmlFor={id} className="kicker text-muted">
        Message (edit before sending)
      </label>
      <textarea id={id} rows={3} className={`${inputClass} mt-2 py-3`} value={message} onChange={(e) => setMessage(e.target.value)} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {available.map(({ method, href, label, Icon, external }) => (
          <a key={method} href={href ?? undefined} {...(external && { target: '_blank', rel: 'noopener noreferrer' })} className={buttonClass(method === preferred ? 'primary' : 'outline', 'md')}>
            <Icon className="size-4" aria-hidden /> {label}
            {method === preferred && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs">
                <Star className="size-3 fill-current" aria-hidden /> Preferred
              </span>
            )}
            {external && <span className="sr-only"> (opens in a new tab)</span>}
          </a>
        ))}
      </div>
      {preferredMissing && (
        <p className="mt-3 text-sm text-danger">They chose {METHOD_LABEL[preferred]}, but the details they gave can’t be used for it. Check their entry below.</p>
      )}
      {preferred === 'phone' && <p className="mt-3 text-sm text-muted">The message is for WhatsApp or email. For a call, use it as a guide for what to say.</p>}
    </div>
  )
}
