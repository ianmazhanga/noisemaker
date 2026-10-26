/**
 * Newsletter: the sign-up consent wording and the email itself, built from a campaign's
 * blocks. Every piece of text is escaped and only https links are used, so a newsletter
 * can't carry markup or scripts from anywhere.
 *
 * No imports, so the server and tests can run this file directly in Node.
 */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** What people agree to on the sign-up form. Stored with each subscriber as their consent record. */
export const CONSENT_TEXT =
  'Yes, email me the Noisemakers News newsletter. I can unsubscribe at any time with the link in every email. My email address is used only for the newsletter, as described in the privacy policy.'

export type BlockType = 'video' | 'article' | 'story' | 'interview' | 'social' | 'text'

export interface Block {
  type: BlockType
  title: string
  url?: string
  text?: string
  image?: string
}

export interface Campaign {
  subject: string
  preheader: string
  intro: string
  blocks: Block[]
}

export const BLOCK_LABEL: Record<BlockType, string> = {
  video: 'New on YouTube',
  article: 'News',
  story: 'Featured story',
  interview: 'Coming up',
  social: 'From our socials',
  text: '',
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const safeUrl = (u: string | undefined) => (u && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : '')

/** Blocks from the database, dropping anything malformed. */
export function readBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((b): b is Block => Boolean(b) && typeof b === 'object' && typeof (b as Block).title === 'string' && (b as Block).type in BLOCK_LABEL)
    .map((b) => ({ type: b.type, title: b.title.slice(0, 200), url: safeUrl(b.url), text: typeof b.text === 'string' ? b.text.slice(0, 2000) : '', image: safeUrl(b.image) }))
}

const paragraphs = (text: string, style: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="${style}">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')

/**
 * The email as HTML. `unsubscribe` is the provider's merge tag (Mailchimp: *|UNSUB|*),
 * which the provider replaces with each reader's own link.
 */
export function renderEmail(c: Campaign, opts: { siteUrl: string; unsubscribe: string; address?: string }): string {
  const body = 'margin:0 0 16px;font:16px/1.6 Arial,Helvetica,sans-serif;color:#0b0b0c'
  const blocks = readBlocks(c.blocks)
    .map((b) => {
      const url = safeUrl(b.url)
      const label = BLOCK_LABEL[b.type]
      const title = url ? `<a href="${esc(url)}" style="color:#0b0b0c;text-decoration:none">${esc(b.title)}</a>` : esc(b.title)
      return [
        '<tr><td style="padding:20px 0;border-top:1px solid #e2ded5">',
        label ? `<p style="margin:0 0 6px;font:bold 12px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#1554d6">${esc(label)}</p>` : '',
        b.image ? `<img src="${esc(b.image)}" alt="" width="560" style="display:block;width:100%;max-width:560px;height:auto;border-radius:8px;margin:0 0 12px">` : '',
        `<h2 style="margin:0 0 8px;font:bold 20px/1.3 Arial,Helvetica,sans-serif;color:#0b0b0c">${title}</h2>`,
        b.text ? paragraphs(b.text, body) : '',
        url ? `<p style="margin:0"><a href="${esc(url)}" style="font:bold 15px Arial,sans-serif;color:#1554d6">${b.type === 'video' ? 'Watch now' : 'Read more'} →</a></p>` : '',
        '</td></tr>',
      ].join('')
    })
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(c.subject)}</title></head>
<body style="margin:0;background:#f1eee7">
<span style="display:none;max-height:0;overflow:hidden">${esc(c.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1eee7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fbfaf7;border-radius:12px"><tr><td style="padding:28px 20px">
<p style="margin:0 0 20px;font:900 22px Arial Black,Arial,sans-serif;color:#0b0b0c">Noisemakers News</p>
${c.intro ? paragraphs(c.intro, body) : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${blocks}</table>
<p style="margin:24px 0 0;font:13px/1.5 Arial,sans-serif;color:#5b5954">You're receiving this because you subscribed at <a href="${esc(safeUrl(opts.siteUrl))}" style="color:#5b5954">${esc(opts.siteUrl.replace(/^https:\/\//, ''))}</a>.
<a href="${opts.unsubscribe}" style="color:#5b5954">Unsubscribe</a>${opts.address ? `<br>${esc(opts.address)}` : ''}</p>
</td></tr></table></td></tr></table></body></html>`
}

/** Plain-text version, for email apps that don't show HTML. */
export function renderText(c: Campaign, opts: { siteUrl: string; unsubscribe: string }): string {
  const parts = [c.intro.trim()]
  for (const b of readBlocks(c.blocks)) parts.push([BLOCK_LABEL[b.type] && BLOCK_LABEL[b.type].toUpperCase(), b.title, b.text, b.url].filter(Boolean).join('\n'))
  parts.push(`You're receiving this because you subscribed at ${opts.siteUrl}.\nUnsubscribe: ${opts.unsubscribe}`)
  return parts.filter(Boolean).join('\n\n')
}
