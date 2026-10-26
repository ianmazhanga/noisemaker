/**
 * POST /api/ai/social-drafts
 *   { "title": "...", "description": "...", "url": "https://...", "platforms": ["instagram", ...], "variations": 1-3 }
 * Header: Authorization: Bearer <a signed-in team member's access token>
 *
 * Writes draft captions with OpenAI from a video's own title and description. It only
 * returns text: the dashboard saves the results as drafts, and nothing is posted until
 * an owner approves it.
 *
 * Vercel environment variables:
 *   OPENAI_API_KEY    required for this feature; without it the function answers 503
 *   OPENAI_MODEL      optional, defaults to DEFAULT_MODEL
 *   SUPABASE_URL, SUPABASE_SECRET_KEY   to check the caller is on the team (see api/stories.ts)
 */
import { cleanHashtags, PLATFORM_KEYS, PLATFORMS, unsupportedQuotes, type Platform } from '../../src/lib/social.ts'
import { chatJson } from '../_lib/ai.ts'
import { caller, failure } from '../_lib/server.ts'

const MAX_SOURCE = 6000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export interface DraftSuggestion {
  platform: Platform
  caption: string
  hashtags: string[]
  /** Reasons to check this draft carefully before approving it. */
  warnings: string[]
}

export interface DraftsResponse {
  summary: string
  drafts: DraftSuggestion[]
}

export function instructions(platforms: Platform[], variations: number): string {
  return [
    'You write social media posts for Noisemakers News, a US-based storytelling, interview and podcast channel.',
    'Tone: warm, professional, engaging and informative. Plain English. No clickbait, no ALL CAPS, at most one emoji per post.',
    'STRICT RULES:',
    '- Use only facts stated in the SOURCE below. Do not add names, numbers, dates, places, claims or outcomes that are not in it.',
    '- Never invent quotations. Only put words in quotation marks if they appear word for word in the SOURCE.',
    '- If the SOURCE is thin, write a shorter, more general post rather than filling gaps.',
    '- Do not include URLs in captions; links are added separately.',
    `Write ${variations} variation(s) for each of these platforms:`,
    ...platforms.map((p) => `- ${p}: ${PLATFORMS[p].brief} At most ${PLATFORMS[p].maxCaption} characters and ${PLATFORMS[p].maxHashtags} hashtags.`),
    'Also write a 2–3 sentence neutral summary of the video, using only the SOURCE.',
    'Reply with JSON only: {"summary": string, "posts": [{"platform": string, "caption": string, "hashtags": string[]}]}. Hashtags without the # sign.',
  ].join('\n')
}

/** Keeps only well-formed drafts for the requested platforms, trimmed to each platform's limits, and flags anything to double-check. */
export function sanitise(raw: unknown, platforms: Platform[], source: string): DraftsResponse {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const drafts: DraftSuggestion[] = []
  for (const item of Array.isArray(obj.posts) ? obj.posts : []) {
    if (!item || typeof item !== 'object') continue
    const { platform, caption, hashtags } = item as Record<string, unknown>
    if (!platforms.includes(platform as Platform) || typeof caption !== 'string' || !caption.trim()) continue
    const info = PLATFORMS[platform as Platform]
    const warnings: string[] = []
    let text = caption.trim()
    if (text.length > info.maxCaption) {
      text = text.slice(0, info.maxCaption).trimEnd()
      warnings.push(`Shortened to ${info.label}'s ${info.maxCaption}-character limit.`)
    }
    const quotes = unsupportedQuotes(text, source)
    if (quotes.length) warnings.push(`Contains a quote that isn't in the video description: “${quotes[0]}”. Check it or remove it.`)
    if (/https?:\/\//i.test(text)) warnings.push('Contains a link. Links are usually added separately.')
    drafts.push({ platform: platform as Platform, caption: text, hashtags: cleanHashtags(hashtags, info.maxHashtags), warnings })
  }
  const summary = typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 1200) : ''
  return { summary, drafts }
}

export async function POST(req: Request): Promise<Response> {
  if (!req.headers.get('Authorization')?.match(/^Bearer (\S+)$/)) return json({ error: 'signed-out' }, 401)

  const body: unknown = await req.json().catch(() => null)
  const { title, description, platforms, variations } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const chosen = Array.isArray(platforms) ? PLATFORM_KEYS.filter((p) => platforms.includes(p)) : []
  const count = typeof variations === 'number' ? Math.min(3, Math.max(1, Math.round(variations))) : 2
  if (typeof title !== 'string' || !title.trim() || title.length > 300 || !chosen.length) return json({ error: 'invalid' }, 400)
  const source = `Title: ${title.trim()}

${typeof description === 'string' ? description.slice(0, MAX_SOURCE) : ''}`.trim()

  try {
    // Viewers can read the dashboard but not spend AI credit.
    const who = await caller(req, 'writer')
    const parsed = await chatJson({ feature: 'social-drafts', userId: who.id, system: instructions(chosen, count), user: `SOURCE:
${source}`, temperature: 0.7, maxTokens: 2000 })
    const result = sanitise(parsed, chosen, source)
    if (!result.drafts.length) return json({ error: 'ai-empty' }, 502)
    return json(result)
  } catch (error) {
    return failure(error, 'Writing drafts')
  }
}
