/** Styles and labels shared by the private inboxes (/inbox and /admin/stories). */
import type { ContactMethod } from '../../lib/inbox'

export const inputClass =
  'w-full rounded-lg border-[1.5px] border-ink/20 bg-white px-4 text-base text-ink placeholder:text-muted/70 transition-colors hover:border-ink/40 focus:border-ink focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue'

export const METHOD_LABEL: Record<ContactMethod, string> = { whatsapp: 'WhatsApp', phone: 'Phone call', email: 'Email' }
