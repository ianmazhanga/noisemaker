/**
 * Builds a newsletter draft from content the team has already approved: published
 * articles, recent YouTube videos and upcoming interviews. The blocks come straight from
 * the database; the AI (when allowed) only writes the subject line and the introduction
 * from those blocks. Used by the dashboard's "Write with AI" and the weekly automation.
 */
import type { Block } from '../../src/lib/newsletter.ts'
import { chatJson, HOUSE_RULES, strings, text } from './ai.ts'
import { rest, siteUrl } from './server.ts'

export interface Draft {
  subject: string
  subjects: string[]
  preheader: string
  intro: string
  blocks: Block[]
  ai: boolean
}

export async function gatherBlocks(days = 7): Promise<Block[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const now = new Date().toISOString()
  const site = siteUrl()
  const [articles, videos, interviews] = await Promise.all([
    rest<{ slug: string; title: string; dek: string; featured_image_url: string }[]>(
      `news_articles?select=slug,title,dek,featured_image_url&status=eq.published&published_at=gte.${encodeURIComponent(since)}&order=published_at.desc&limit=6`,
    ),
    rest<{ youtube_id: string; title: string; description: string; kind: string; thumbnail_url: string }[]>(
      `youtube_videos?select=youtube_id,title,description,kind,thumbnail_url&published_at=gte.${encodeURIComponent(since)}&order=published_at.desc&limit=6`,
    ),
    rest<{ title: string }[]>(`video_projects?select=title&recording_at=gte.${encodeURIComponent(now)}&status=in.(interview_scheduled,recording_scheduled,preparing,scripting)&order=recording_at&limit=3`),
  ])
  const blocks: Block[] = []
  for (const v of videos.filter((x) => x.kind === 'episode'))
    blocks.push({ type: 'video', title: v.title, url: `https://www.youtube.com/watch?v=${v.youtube_id}`, text: v.description.split(/\n\s*\n/)[0]?.slice(0, 400) ?? '', image: v.thumbnail_url.startsWith('https://') ? v.thumbnail_url : '' })
  for (const a of articles) blocks.push({ type: 'article', title: a.title, url: `${site}/news/${a.slug}`, text: a.dek, image: a.featured_image_url })
  const shorts = videos.filter((x) => x.kind === 'short')
  if (shorts.length) blocks.push({ type: 'social', title: 'New Shorts this week', url: 'https://www.youtube.com/@noisemakersnews/shorts', text: shorts.map((s) => `• ${s.title}`).join('\n') })
  // Upcoming interviews are listed by working title only; the owner confirms before sending.
  for (const i of interviews) blocks.push({ type: 'interview', title: i.title, text: '[check: confirm the guest is happy for this to be announced]' })
  blocks.push({ type: 'text', title: 'Have a story to tell?', url: `${site}/tell-your-story`, text: 'We would love to hear it. Tell us about your experience and we may invite you on the show.' })
  return blocks
}

export async function draftNewsletter(opts: { userId: string | null; useAi: boolean; days?: number }): Promise<Draft> {
  const blocks = await gatherBlocks(opts.days ?? 7)
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Johannesburg' })
  const fallback: Draft = {
    subject: `This week at Noisemakers News: ${date}`,
    subjects: [],
    preheader: blocks[0]?.title ?? 'The latest conversations and news',
    intro: 'Hello, and welcome to this week’s Noisemakers News newsletter. Here is what’s new.',
    blocks,
    ai: false,
  }
  if (!opts.useAi || blocks.length <= 1) return fallback
  const source = blocks.map((b) => `- [${b.type}] ${b.title}${b.text ? `: ${b.text}` : ''}`).join('\n')
  const raw = await chatJson({
    feature: 'newsletter-draft',
    userId: opts.userId,
    maxTokens: 700,
    system: [
      HOUSE_RULES,
      'You write the subject line and a short introduction for the weekly Noisemakers News email newsletter, using only the items listed in the SOURCE.',
      'Reply with JSON only: {"subjects": [3 subject lines, each under 70 characters], "preheader": "under 100 characters", "intro": "2 short paragraphs, under 120 words"}.',
    ].join('\n'),
    user: `SOURCE (this week's items):\n${source}`,
  })
  const subjects = strings(raw.subjects, 3, 90)
  return {
    subject: subjects[0] ?? fallback.subject,
    subjects,
    preheader: text(raw.preheader, 150) || fallback.preheader,
    intro: text(raw.intro, 1500) || fallback.intro,
    blocks,
    ai: true,
  }
}
