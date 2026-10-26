/**
 * News discovery: reads RSS 2.0 and Atom feeds, tidies links and spots the same story
 * reported by different outlets. Only the feed's own title, link, date and short summary
 * are kept: full articles are never copied.
 *
 * No imports, so the server and tests can run this file directly in Node.
 */

export interface FeedItem {
  title: string
  url: string
  excerpt: string
  publishedAt: string | null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

/** HTML or XML text → plain text: CDATA unwrapped, tags removed, entities decoded, whitespace tidied. */
export function plainText(raw: string): string {
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  // Entities first, because many feeds escape their HTML (&lt;p&gt;).
  return decodeEntities(decodeEntities(unwrapped).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml)
  return m ? m[1] : ''
}

const toIso = (value: string) => {
  const t = Date.parse(value.trim())
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Shortens text to at most `max` characters, at a word boundary. */
export function excerpt(text: string, max = 400): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : max).replace(/[\s,;:.-]+$/, '') + '…'
}

/** Items from an RSS or Atom document. Anything without a title and an http(s) link is skipped. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = []
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml)
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? []
  for (const block of blocks) {
    const title = plainText(tag(block, 'title'))
    let url = ''
    if (isAtom) {
      const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1])
      const alternate = links.find((a) => /rel=["']alternate["']/i.test(a)) ?? links.find((a) => !/rel=/i.test(a)) ?? links[0] ?? ''
      url = decodeEntities(/href=["']([^"']+)["']/i.exec(alternate)?.[1] ?? '')
    } else {
      url = plainText(tag(block, 'link'))
      if (!/^https?:\/\//i.test(url)) {
        const guid = plainText(tag(block, 'guid'))
        if (/^https?:\/\//i.test(guid)) url = guid
      }
    }
    if (!title || !/^https?:\/\//i.test(url)) continue
    const summary = plainText(isAtom ? tag(block, 'summary') || tag(block, 'content') : tag(block, 'description'))
    const date = isAtom ? tag(block, 'published') || tag(block, 'updated') : tag(block, 'pubDate') || tag(block, 'dc:date')
    items.push({ title: excerpt(title, 300), url: url.trim(), excerpt: excerpt(summary), publishedAt: date ? toIso(plainText(date)) : null })
  }
  return items
}

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ocid|cmpid|ref|ref_src|igshid|at_medium|at_campaign)$/i

/** The same article has many links (tracking codes, http/https, trailing slashes). This is one key for all of them. */
export function urlKey(url: string): string {
  try {
    const u = new URL(url)
    u.protocol = 'https:'
    u.hash = ''
    u.hostname = u.hostname.toLowerCase().replace(/^(www|m|amp)\./, '')
    for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key)
    u.searchParams.sort()
    const path = u.pathname.replace(/\/amp\/?$/, '/').replace(/\/+$/, '') || '/'
    return `${u.hostname}${path}${u.search}`
  } catch {
    return url.trim().toLowerCase()
  }
}

const STOP = new Set(
  'a an and are as at be by for from has have he her his in is it its of on or says said she that the their they this to was were will with after over new how why what who amid into about up out more than not no but can could would should may as'.split(' '),
)

/** Distinctive title words, sorted. Two headlines about the same event usually share most of them. */
export function titleWords(title: string): string[] {
  return [...new Set(title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))].sort()
}

/** A short key for grouping: the six most distinctive words. Used to find candidates; `sameStory` decides. */
export const clusterKey = (title: string) => titleWords(title).sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, 6).sort().join(' ')

/** Do two headlines describe the same story? Jaccard similarity of their distinctive words. */
export function sameStory(a: string, b: string, threshold = 0.5): boolean {
  const x = new Set(titleWords(a))
  const y = new Set(titleWords(b))
  if (!x.size || !y.size) return false
  const shared = [...x].filter((w) => y.has(w)).length
  return shared / (x.size + y.size - shared) >= threshold
}

/** Which of the chosen topics a story mentions (whole words, any case). */
export function matchTopics(text: string, topics: string[]): string[] {
  const lower = ` ${text.toLowerCase()} `
  return topics.filter((t) => t.trim() && new RegExp(`[^a-z0-9]${t.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`).test(lower))
}
