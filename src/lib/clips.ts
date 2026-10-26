/**
 * AI Shorts: picking clip boundaries from a transcript, building subtitles, and writing
 * them as an ASS subtitle file for FFmpeg to burn in. Shared by the video worker (which
 * renders), the server (which checks AI suggestions) and the dashboard (which previews).
 *
 * Times are seconds. "Source" times are positions in the original recording; "clip" times
 * start at 0 at the clip's first frame, after any cuts.
 *
 * No imports, so tests and the worker can run this file directly in Node.
 */

export interface Word {
  w: string
  s: number
  e: number
}

export interface Segment {
  start: number
  end: number
  text: string
  words?: Word[]
}

export interface Cue {
  start: number
  end: number
  text: string
  words: Word[]
}

const SENTENCE_END = /[.?!…]["”’)]*$/
/** A pause this long between segments is a natural place to start or stop. */
const PAUSE = 0.6

/** The parts of [start, end] that stay after removing `cuts`, in order. */
export function keptRanges(start: number, end: number, cuts: [number, number][] = []): [number, number][] {
  const sorted = cuts
    .map(([a, b]) => [Math.max(start, Math.min(a, b)), Math.min(end, Math.max(a, b))] as [number, number])
    .filter(([a, b]) => b - a > 0.05)
    .sort((x, y) => x[0] - y[0])
  const out: [number, number][] = []
  let cursor = start
  for (const [a, b] of sorted) {
    if (a > cursor + 0.05) out.push([cursor, a])
    cursor = Math.max(cursor, b)
  }
  if (end > cursor + 0.05) out.push([cursor, end])
  return out
}

/** Length of the clip once cuts are removed. */
export const clipLength = (start: number, end: number, cuts: [number, number][] = []) => keptRanges(start, end, cuts).reduce((sum, [a, b]) => sum + b - a, 0)

/** A source time → clip time, or null if it falls inside a cut or outside the clip. */
export function toClipTime(t: number, ranges: [number, number][]): number | null {
  let offset = 0
  for (const [a, b] of ranges) {
    if (t >= a && t <= b) return offset + (t - a)
    offset += b - a
  }
  return null
}

/** Every word in the transcript, with segment text split evenly when the transcript has no word timings. */
export function allWords(segments: Segment[]): Word[] {
  const words: Word[] = []
  for (const seg of segments) {
    if (seg.words?.length) {
      words.push(...seg.words.filter((w) => w.w.trim() && w.e >= w.s))
      continue
    }
    const parts = seg.text.trim().split(/\s+/).filter(Boolean)
    const step = (seg.end - seg.start) / Math.max(1, parts.length)
    parts.forEach((w, i) => words.push({ w, s: seg.start + i * step, e: seg.start + (i + 1) * step }))
  }
  return words.sort((a, b) => a.s - b.s)
}

/** Good places to start (after a sentence ends or a pause) and to stop (at a sentence end). */
export function boundaries(segments: Segment[]): { starts: number[]; ends: number[] } {
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const starts: number[] = []
  const ends: number[] = []
  sorted.forEach((seg, i) => {
    const prev = sorted[i - 1]
    if (!prev || SENTENCE_END.test(prev.text.trim()) || seg.start - prev.end >= PAUSE) starts.push(seg.start)
    const next = sorted[i + 1]
    if (SENTENCE_END.test(seg.text.trim()) || !next || next.start - seg.end >= PAUSE) ends.push(seg.end)
  })
  return { starts, ends }
}

/**
 * Moves a suggested clip so it starts and ends where a sentence does, never mid-word, and
 * keeps its length between min and max seconds. Returns null if no such clip fits.
 */
export function snapClip(segments: Segment[], start: number, end: number, opts: { min: number; max: number; slack?: number }): { start: number; end: number } | null {
  const { min, max } = opts
  const slack = opts.slack ?? 6
  if (!segments.length) return null
  const { starts, ends } = boundaries(segments)
  const nearest = (list: number[], t: number) => list.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), list[0])

  const startCandidates = starts.filter((s) => Math.abs(s - start) <= slack)
  const s0 = startCandidates.length ? nearest(startCandidates, start) : nearest(starts, start)
  // The sentence end closest to the requested end that keeps the length within limits.
  const fitting = ends.filter((e) => e - s0 >= min - 0.5 && e - s0 <= max + 0.5)
  if (fitting.length) return { start: round(s0), end: round(nearest(fitting, Math.max(end, s0 + min))) }

  // No sentence ends in range: fall back to the nearest word end, so nobody is cut off mid-word.
  const words = allWords(segments).filter((w) => w.e - s0 >= min && w.e - s0 <= max)
  if (!words.length) return null
  const target = Math.min(Math.max(end, s0 + min), s0 + max)
  return { start: round(s0), end: round(words.reduce((best, w) => (Math.abs(w.e - target) < Math.abs(best.e - target) ? w : best)).e) }
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Subtitle cues for a clip: words grouped into short lines (at most `maxChars` per line and
 * `maxLines` lines on screen), each on screen while it's being said. Words inside cuts are dropped.
 */
export function buildCues(words: Word[], start: number, end: number, cuts: [number, number][] = [], opts: { maxChars?: number; maxLines?: number; maxSeconds?: number } = {}): Cue[] {
  // About 20 characters fit across a 9:16 frame at the default subtitle size.
  const maxChars = opts.maxChars ?? 20
  const maxLines = opts.maxLines ?? 2
  const maxSeconds = opts.maxSeconds ?? 3.2
  const ranges = keptRanges(start, end, cuts)
  const inClip: Word[] = []
  for (const w of words) {
    const mid = (w.s + w.e) / 2
    const t = toClipTime(mid, ranges)
    if (t === null) continue
    const s = toClipTime(Math.max(w.s, ranges.find(([a, b]) => mid >= a && mid <= b)![0]), ranges) ?? t
    const e = toClipTime(Math.min(w.e, ranges.find(([a, b]) => mid >= a && mid <= b)![1]), ranges) ?? t
    inClip.push({ w: w.w.trim(), s: round(s), e: round(Math.max(e, s + 0.05)) })
  }

  const cues: Cue[] = []
  let current: Word[] = []
  const lines = (list: Word[]) => wrapWords(list.map((w) => w.w), maxChars)
  const flush = () => {
    if (!current.length) return
    cues.push({ start: current[0].s, end: current[current.length - 1].e, text: lines(current).join('\n'), words: current })
    current = []
  }
  for (const w of inClip) {
    const next = [...current, w]
    const tooLong = lines(next).length > maxLines || (current.length && w.e - current[0].s > maxSeconds)
    const gap = current.length && w.s - current[current.length - 1].e > PAUSE
    if (current.length && (tooLong || gap)) flush()
    current.push(w)
    if (SENTENCE_END.test(w.w)) flush()
  }
  flush()
  // Close tiny gaps so subtitles don't flicker between cues.
  for (let i = 0; i < cues.length - 1; i++) if (cues[i + 1].start - cues[i].end < 0.25) cues[i].end = cues[i + 1].start
  return cues
}

/** Splits words into lines of at most maxChars (a single long word gets its own line). */
export function wrapWords(words: string[], maxChars: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if (line && (line + ' ' + w).length > maxChars) {
      lines.push(line)
      line = w
    } else line = line ? `${line} ${w}` : w
  }
  if (line) lines.push(line)
  return lines
}

/** Cues from the database, dropping anything malformed. */
export function readCues(raw: unknown): Cue[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c): c is Cue => Boolean(c) && typeof c.start === 'number' && typeof c.end === 'number' && typeof c.text === 'string' && c.end > c.start)
    .map((c) => ({ start: c.start, end: c.end, text: c.text.slice(0, 200), words: Array.isArray(c.words) ? c.words.filter((w) => w && typeof w.w === 'string' && typeof w.s === 'number' && typeof w.e === 'number') : [] }))
}

/**
 * After someone corrects a cue's text, its words no longer match. Spread the new words
 * over the cue's time so highlighting still roughly follows the speech.
 */
export function retimeCue(cue: Cue, text: string): Cue {
  const parts = text.replace(/\n/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.join(' ') === cue.words.map((w) => w.w).join(' ')) return { ...cue, text }
  const step = (cue.end - cue.start) / Math.max(1, parts.length)
  return { ...cue, text, words: parts.map((w, i) => ({ w, s: round(cue.start + i * step), e: round(cue.start + (i + 1) * step) })) }
}

// ---------------------------------------------------------------------------
// ASS subtitles (burned in by FFmpeg's libass)
// ---------------------------------------------------------------------------

export interface AssOptions {
  width: number
  height: number
  font: string
  /** Line height as a share of the video height */
  size: number
  /** Distance from the bottom as a share of the height */
  position: number
  background: 'none' | 'box' | 'shadow'
  highlight: boolean
  highlightColor: string
  uppercase: boolean
  /** Shown at the top for the whole clip, e.g. a headline */
  title?: string
  /** Clip length, for the title */
  duration?: number
}

/** "#F7D046" → "&H0046D0F7" (ASS colours are AABBGGRR). */
export function assColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) ?? ['', 'FF', 'FF', 'FF']
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${m[3]}${m[2]}${m[1]}`.toUpperCase()
}

/** 3.456 → "0:00:03.46" */
export function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

/** Text is shown literally: braces and backslashes would otherwise be ASS commands. */
export const assEscape = (text: string) => text.replace(/\\/g, '＼').replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).replace(/\r?\n/g, '\\N')

export function toAss(cues: Cue[], o: AssOptions): string {
  const fontSize = Math.round(o.height * o.size)
  const marginV = Math.round(o.height * o.position)
  // BorderStyle 3 = opaque box behind the text; 1 = outline plus shadow.
  const box = o.background === 'box'
  const outline = o.background === 'none' ? 2 : box ? 14 : 5
  const shadow = o.background === 'shadow' ? 3 : 0
  const back = box ? assColor('#0B0B0C', 0x40) : assColor('#000000', 0x60)
  const style = (name: string, size: number, margin: number, align: number) =>
    `Style: ${name},${o.font},${size},&H00FFFFFF,&H00FFFFFF,${assColor('#0B0B0C')},${back},-1,0,0,0,100,100,0,0,${box ? 3 : 1},${outline},${shadow},${align},80,80,${margin},1`
  const caseOf = (s: string) => (o.uppercase ? s.toUpperCase() : s)

  const events: string[] = []
  if (o.title?.trim()) events.push(`Dialogue: 1,${assTime(0)},${assTime(o.duration ?? 3600)},Title,,0,0,0,,${assEscape(caseOf(o.title.trim()))}`)
  for (const cue of cues) {
    const lines = cue.text.split('\n')
    if (!o.highlight || !cue.words.length) {
      events.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,${assEscape(caseOf(cue.text))}`)
      continue
    }
    // One event per spoken word, with that word coloured. Words are matched to the cue's lines in order.
    const flat = lines.join(' ').split(/\s+/).filter(Boolean)
    cue.words.forEach((word, i) => {
      const from = i === 0 ? cue.start : word.s
      const to = i === cue.words.length - 1 ? cue.end : cue.words[i + 1].s
      if (to <= from) return
      let k = 0
      const text = lines
        .map((line) =>
          line
            .split(/\s+/)
            .filter(Boolean)
            .map((w) => {
              const piece = assEscape(caseOf(w))
              return k++ === i && i < flat.length ? `{\\c${assColor(o.highlightColor)}}${piece}{\\c&H00FFFFFF&}` : piece
            })
            .join(' '),
        )
        .join('\\N')
      events.push(`Dialogue: 0,${assTime(from)},${assTime(to)},Caption,,0,0,0,,${text}`)
    })
  }

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${o.width}`,
    `PlayResY: ${o.height}`,
    // Smart wrapping: a line that's still too wide is broken rather than cut off.
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Caption', fontSize, marginV, 2),
    style('Title', Math.round(fontSize * 0.9), Math.round(o.height * 0.08), 8),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Checking AI clip suggestions
// ---------------------------------------------------------------------------

/** The transcript as timestamped lines for the AI: "[83.2–90.1] So we decided to move…" */
export function transcriptForAi(segments: Segment[], maxChars = 120_000): string {
  const lines = segments.map((s) => `[${s.start.toFixed(1)}–${s.end.toFixed(1)}] ${s.text.trim()}`)
  let out = ''
  for (const line of lines) {
    if (out.length + line.length > maxChars) break
    out += line + '\n'
  }
  return out
}

/** What was said between two source times. */
export function spokenText(segments: Segment[], start: number, end: number): string {
  return allWords(segments)
    .filter((w) => (w.s + w.e) / 2 >= start && (w.s + w.e) / 2 <= end)
    .map((w) => w.w.trim())
    .join(' ')
}

export interface ClipSuggestion {
  start: number
  end: number
  title: string
  category: string
  reason: string
  score: number
}

const CATEGORIES = ['emotional', 'insight', 'educational', 'story', 'discussion', 'other']

/**
 * Keeps AI suggestions that are inside the recording, snaps them to sentence boundaries,
 * drops ones that mostly overlap a better-scored clip, and keeps at most `limit`.
 */
export function checkSuggestions(raw: unknown, segments: Segment[], opts: { min: number; max: number; limit: number; duration: number }): ClipSuggestion[] {
  const list = Array.isArray((raw as { clips?: unknown })?.clips) ? ((raw as { clips: unknown[] }).clips) : Array.isArray(raw) ? raw : []
  const out: ClipSuggestion[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    const start = Number(c.start)
    const end = Number(c.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > opts.duration + 1 || end <= start) continue
    const snapped = snapClip(segments, start, end, { min: opts.min, max: opts.max })
    if (!snapped) continue
    out.push({
      ...snapped,
      title: String(c.title ?? '').trim().slice(0, 120) || 'Untitled clip',
      category: CATEGORIES.includes(String(c.category)) ? String(c.category) : 'other',
      reason: String(c.reason ?? '').trim().slice(0, 600),
      score: Math.max(0, Math.min(100, Math.round(Number(c.score) || 50))),
    })
  }
  out.sort((a, b) => b.score - a.score)
  const kept: ClipSuggestion[] = []
  for (const c of out) {
    const overlaps = kept.some((k) => Math.min(k.end, c.end) - Math.max(k.start, c.start) > 0.5 * Math.min(k.end - k.start, c.end - c.start))
    if (!overlaps) kept.push(c)
    if (kept.length >= opts.limit) break
  }
  return kept.sort((a, b) => a.start - b.start)
}

/** "125.5" → "2:05" */
export function formatSeconds(t: number): string {
  const s = Math.max(0, Math.round(t))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
