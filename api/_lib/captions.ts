/**
 * Titles and captions for an AI Short, written only from what is said in the clip.
 * Used by the dashboard (Regenerate captions) and the video worker (after analysis).
 */
import { cleanHashtags, PLATFORMS, POSTING_GUIDANCE } from '../../src/lib/social.ts'
import type { ClipCaptions } from '../../src/lib/newsroom.ts'
import { chatJson, HOUSE_RULES, text, unsupportedQuotes } from './ai.ts'

export async function writeClipCaptions(opts: { userId: string | null; title: string; spoken: string; videoTitle: string }): Promise<ClipCaptions> {
  const source = `Video: ${opts.videoTitle}\nClip working title: ${opts.title}\n\nWords spoken in the clip (transcript):\n${opts.spoken.slice(0, 6000)}`
  const raw = await chatJson({
    feature: 'clip-captions',
    userId: opts.userId,
    maxTokens: 1200,
    system: [
      HOUSE_RULES,
      'You write titles and captions for a short vertical clip from an interview. The SOURCE is the transcript of exactly what is said in the clip.',
      `- youtube_title: a YouTube Shorts title, at most 90 characters.`,
      `- youtube: a YouTube Shorts description, at most 300 characters.`,
      `- tiktok: ${PLATFORMS.tiktok.brief} At most 300 characters.`,
      `- instagram: an Instagram Reels caption, at most 600 characters.`,
      `- facebook: a Facebook Reels caption, at most 500 characters.`,
      `- x: at most 240 characters.`,
      '- hashtags: up to 8, without the # sign.',
      '- description: one neutral sentence saying what the clip is about.',
      'Only quote words that appear word for word in the transcript.',
      'Reply with JSON only: {"youtube_title", "youtube", "tiktok", "instagram", "facebook", "x", "hashtags": [], "description"}.',
    ].join('\n'),
    user: `SOURCE:\n${source}`,
  })
  const r = raw as Record<string, unknown>
  const captions: ClipCaptions = {
    youtube_title: text(r.youtube_title, 100),
    youtube: text(r.youtube, 500),
    tiktok: text(r.tiktok, PLATFORMS.tiktok.maxCaption),
    instagram: text(r.instagram, PLATFORMS.instagram.maxCaption),
    facebook: text(r.facebook, PLATFORMS.facebook.maxCaption),
    x: text(r.x, PLATFORMS.x.maxCaption),
    hashtags: cleanHashtags(r.hashtags, 8),
    description: text(r.description, 300),
    suggested_time: `TikTok: ${POSTING_GUIDANCE.tiktok}. Instagram: ${POSTING_GUIDANCE.instagram}. (General guidance, not this account's analytics.)`,
  }
  const warnings: string[] = []
  for (const key of ['youtube_title', 'youtube', 'tiktok', 'instagram', 'facebook', 'x', 'description'] as const) {
    const quote = unsupportedQuotes(captions[key] ?? '', opts.spoken)[0]
    if (quote) warnings.push(`The ${key} caption quotes words that aren't in the clip: “${quote}”. Check or remove it.`)
  }
  captions.warnings = warnings
  return captions
}
