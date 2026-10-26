/**
 * Article text: paragraphs separated by blank lines, "## " subheadings, "- " bullet lists,
 * [link text](https://…) and **bold**. Parsed into plain data, never HTML, so whatever is
 * typed can only ever show as text and safe links.
 *
 * No imports, so tests can run this file directly in Node.
 */

export type Inline = { type: 'text'; text: string } | { type: 'bold'; text: string } | { type: 'link'; text: string; href: string }
export type Block = { type: 'p'; content: Inline[] } | { type: 'h2'; text: string } | { type: 'ul'; items: Inline[][] }

const LINK = /\[([^\]\n]{1,300})\]\((https:\/\/[^\s)]{1,2000})\)|\*\*([^*\n]{1,500})\*\*/g

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of text.matchAll(LINK)) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    if (m[2]) out.push({ type: 'link', text: m[1], href: m[2] })
    else out.push({ type: 'bold', text: m[3] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

export function parseArticle(body: string): Block[] {
  const blocks: Block[] = []
  for (const chunk of body.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim())
    if (!lines.length) continue
    if (lines.length === 1 && /^#{2,3}\s+/.test(lines[0])) {
      blocks.push({ type: 'h2', text: lines[0].replace(/^#{2,3}\s+/, '').trim() })
      continue
    }
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      blocks.push({ type: 'ul', items: lines.map((l) => parseInline(l.replace(/^\s*[-*•]\s+/, ''))) })
      continue
    }
    blocks.push({ type: 'p', content: parseInline(lines.join(' ').trim()) })
  }
  return blocks
}

/** Plain text, e.g. for a description when no summary was written. */
export const articlePlainText = (body: string) =>
  parseArticle(body)
    .map((b) => (b.type === 'h2' ? b.text : b.type === 'p' ? b.content.map((i) => i.text).join('') : b.items.map((it) => it.map((i) => i.text).join('')).join(' ')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Minutes to read at about 230 words a minute. */
export const readingMinutes = (body: string) => Math.max(1, Math.round(articlePlainText(body).split(' ').length / 230))
