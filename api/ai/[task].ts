/**
 * POST /api/ai/<task>   Header: Authorization: Bearer <a team member's access token>
 *
 * AI writing for the dashboard. Every task only returns or saves drafts: nothing is
 * published, scheduled or sent here, and every result is reviewed by a person.
 *
 *   interview      { projectId, tool }            AI Interview Assistant (questions, outline, script, titles…)
 *   news-review    { itemId }                     key facts, unverified claims and relevance of a discovered story
 *   article-draft  { itemId? , sourceText?, sourceUrl? }   an original draft article with attribution
 *   newsletter     {}                             a newsletter draft from approved content
 *   clip-captions  { clipId }                     per-platform captions for an AI Short (saved on the clip)
 *   youtube-meta   { youtubeId? , projectId? }    title, description, thumbnail text and hashtags
 *
 * Viewers can't use AI. Limits and budgets are in Settings → AI and costs.
 * Environment: OPENAI_API_KEY, OPENAI_MODEL (optional), SUPABASE_URL, SUPABASE_SECRET_KEY.
 */
import { spokenText, type Segment } from '../../src/lib/clips.ts'
import { INTERVIEW_TOOLS, type InterviewTool } from '../../src/lib/newsroom.ts'
import { cleanHashtags } from '../../src/lib/social.ts'
import { chatJson, HOUSE_RULES, strings, text, unsupportedQuotes } from '../_lib/ai.ts'
import { writeClipCaptions } from '../_lib/captions.ts'
import { draftNewsletter } from '../_lib/newsletter-draft.ts'
import { caller, failure, HttpError, json, readBody, rest, routeName, type Caller } from '../_lib/server.ts'

const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null)
const one = async <T,>(path: string) => {
  const [row] = await rest<T[]>(path)
  if (!row) throw new HttpError(404, 'not-found')
  return row
}

// ---------------------------------------------------------------------------
// AI Interview Assistant
// ---------------------------------------------------------------------------

const TOOL_BRIEF: Record<InterviewTool, string> = {
  questions: 'Write 12 open interview questions, in a sensible order, that let the guest tell their story in their own words. Sensitive topics are approached gently.',
  followups: 'Write 10 follow-up questions the host can use when an answer opens up something worth exploring. Group them by the theme they follow.',
  outline: 'Write an interview outline: opening, 4–6 sections with the aim of each, and a closing. Include rough timings for a 45–60 minute conversation.',
  topics: 'List 8 discussion topics this conversation could cover, each with one sentence on why it matters to the audience.',
  research:
    'Write a guest research summary using ONLY the verified information given. Separate "What we know (verified by the team)" from "What to confirm with the guest". Do not add anything from general knowledge about this person.',
  script: 'Write a short video script: a 20–30 second cold open for the host, an introduction of the guest and topic, segment transitions, and a closing call to subscribe and share their story.',
  titles: 'Suggest 8 YouTube titles, each under 70 characters, honest about what the video contains.',
  description: 'Write a YouTube description: a 2–3 sentence summary, what viewers will hear about, and an invitation to subscribe and to share their own story at the Tell Your Story page.',
  thumbnail: 'Suggest 8 options for thumbnail text, each at most 4 words, in the channel style of a bold statement with one highlighted word (mark it with *asterisks*).',
  hashtags: 'Suggest 12 relevant hashtags, without the # sign.',
  captions: 'Write promotional captions for Instagram, Facebook, TikTok and X announcing the interview.',
}

async function interview(who: Caller, body: Record<string, unknown>) {
  const id = uuid(body.projectId)
  const tool = body.tool as InterviewTool
  if (!id || !(tool in INTERVIEW_TOOLS)) throw new HttpError(400, 'invalid')
  const p = await one<{ title: string; summary: string; guest_name: string; guest_verified_info: string; guest_links: string[]; notes: string; story_id: string | null }>(
    `video_projects?select=title,summary,guest_name,guest_verified_info,guest_links,notes,story_id&id=eq.${id}`,
  )
  // The guest's own words from the Story Inbox, only for people allowed to read stories.
  let story = ''
  if (p.story_id && who.canViewStories) {
    const [s] = await rest<{ story_title: string; story_summary: string; why_share: string; topics: string }[]>(`story_submissions?select=story_title,story_summary,why_share,topics&id=eq.${p.story_id}`)
    if (s) story = `Story submitted by the guest (their own words):\nTitle: ${s.story_title}\n${s.story_summary}\nWhy they want to share it: ${s.why_share}\nTopics: ${s.topics}`
  }
  const source = [
    `Project: ${p.title}`,
    p.summary && `Summary: ${p.summary}`,
    p.guest_name && `Guest: ${p.guest_name}`,
    `Verified information about the guest (checked by the team):\n${p.guest_verified_info || '(none yet)'}`,
    p.guest_links.length ? `Public links the team provided (not opened by you): ${p.guest_links.join(', ')}` : '',
    story,
    p.notes && `Team notes:\n${p.notes.slice(0, 4000)}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const list = tool !== 'script' && tool !== 'description' && tool !== 'research' && tool !== 'outline'
  const raw = await chatJson({
    feature: `interview-${tool}`,
    userId: who.id,
    maxTokens: tool === 'script' ? 1800 : 1200,
    temperature: 0.6,
    system: [
      HOUSE_RULES,
      'You help the Noisemakers team prepare interviews. You only know what is in the SOURCE: never state facts about the guest from general knowledge, and mark anything that needs confirming with [check: ...].',
      TOOL_BRIEF[tool],
      list ? 'Reply with JSON only: {"items": [string, ...], "uncertain": [things to confirm]}.' : 'Reply with JSON only: {"text": string, "uncertain": [things to confirm]}.',
    ].join('\n'),
    user: `SOURCE:\n${source}`,
  })
  const items = tool === 'hashtags' ? cleanHashtags(raw.items, 15) : strings(raw.items, 20, 600)
  const out = list ? items.join('\n') : text(raw.text, 12_000)
  const warnings = unsupportedQuotes(out, source).map((q) => `Contains a quote that isn't in the project notes: “${q}”. Check it or remove it.`)
  return { tool, label: INTERVIEW_TOOLS[tool], items: list ? items : [], text: list ? '' : out, uncertain: strings(raw.uncertain, 15, 300), warnings }
}

// ---------------------------------------------------------------------------
// AI News Agent
// ---------------------------------------------------------------------------

interface ItemRow {
  id: string
  title: string
  url: string
  excerpt: string
  published_at: string | null
  source: { name: string; country: string } | null
}

const itemSource = (i: ItemRow) =>
  [`Outlet: ${i.source?.name ?? 'Unknown'}`, `Headline: ${i.title}`, `Published: ${i.published_at ?? 'unknown'}`, `Link: ${i.url}`, `Feed summary: ${i.excerpt || '(none)'}`].join('\n')

async function newsReview(who: Caller, body: Record<string, unknown>) {
  const id = uuid(body.itemId)
  if (!id) throw new HttpError(400, 'invalid')
  const item = await one<ItemRow>(`news_items?select=id,title,url,excerpt,published_at,source:news_sources(name,country)&id=eq.${id}`)
  const raw = await chatJson({
    feature: 'news-review',
    userId: who.id,
    maxTokens: 800,
    temperature: 0.2,
    system: [
      HOUSE_RULES,
      'You review a news item for the Noisemakers editors. You have only the outlet, headline and the feed summary, not the full article.',
      '- summary: two neutral sentences in your own words.',
      '- key_facts: facts stated in the SOURCE, each attributed ("According to <outlet>, ...").',
      '- flags: claims that are unverified, one-sided, sensational or possibly misleading, and anything the editor must check in the original article. Always include that the full article has not been read.',
      '- relevance: 0–100 for an audience interested in family, marriage, parenting, faith, recovery and life in the African diaspora, in South Africa, the US and internationally.',
      '- headlines: 3 original draft headlines.',
      'Reply with JSON only: {"summary", "key_facts": [], "flags": [], "relevance": number, "headlines": []}.',
    ].join('\n'),
    user: `SOURCE:\n${itemSource(item)}`,
  })
  const analysis = {
    summary: text(raw.summary, 600),
    key_facts: strings(raw.key_facts, 10, 400),
    flags: strings(raw.flags, 10, 400),
    relevance: Math.max(0, Math.min(100, Math.round(Number(raw.relevance) || 0))),
    headlines: strings(raw.headlines, 5, 200),
  }
  await rest(`news_items?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ analysis, analyzed_at: new Date().toISOString() }) })
  return analysis
}

async function articleDraft(who: Caller, body: Record<string, unknown>) {
  const id = uuid(body.itemId)
  const pasted = text(body.sourceText, 15_000)
  const pastedUrl = typeof body.sourceUrl === 'string' && /^https:\/\//.test(body.sourceUrl) ? body.sourceUrl.slice(0, 500) : ''
  if (!id && pasted.length < 50) throw new HttpError(400, 'invalid')
  const item = id ? await one<ItemRow>(`news_items?select=id,title,url,excerpt,published_at,source:news_sources(name,country)&id=eq.${id}`) : null
  const source = item ? itemSource(item) + (pasted ? `\n\nAdditional source text provided by the editor:\n${pasted}` : '') : `Source text provided by the editor${pastedUrl ? ` (from ${pastedUrl})` : ''}:\n${pasted}`

  const raw = await chatJson({
    feature: 'article-draft',
    userId: who.id,
    maxTokens: 1800,
    temperature: 0.4,
    system: [
      HOUSE_RULES,
      'You draft a short original news article for the Noisemakers News website from the SOURCE. Write it in your own words: never copy sentences from the source.',
      '- Attribute every fact to its source ("According to <outlet>, ..."). Do not present unverified claims as fact.',
      '- If the SOURCE is only a headline and short summary, write a brief article (2–4 short paragraphs) and do not pad it.',
      '- body: plain paragraphs separated by blank lines; "## " for a subheading if needed. End with a line "Source: <outlet>".',
      '- fact_flags: every claim the editor must verify in the original before publishing.',
      '- captions: short promotional captions for instagram, facebook and x, without links.',
      'Reply with JSON only: {"headline", "dek" (one sentence), "body", "category", "tags": [], "meta_description" (under 160 characters), "fact_flags": [], "captions": {"instagram", "facebook", "x"}}.',
    ].join('\n'),
    user: `SOURCE:\n${source}`,
  })
  const bodyText = text(raw.body, 20_000)
  const warnings = unsupportedQuotes(bodyText, source).map((q) => `The draft quotes words that aren't in the source: “${q}”. Remove or verify.`)
  const captions = (raw.captions && typeof raw.captions === 'object' ? raw.captions : {}) as Record<string, unknown>
  return {
    title: text(raw.headline, 200),
    dek: text(raw.dek, 300),
    body: bodyText,
    category: text(raw.category, 60),
    tags: strings(raw.tags, 8, 40),
    meta_description: text(raw.meta_description, 160),
    fact_flags: [...strings(raw.fact_flags, 15, 400), ...warnings],
    captions: { instagram: text(captions.instagram, 2000), facebook: text(captions.facebook, 2000), x: text(captions.x, 256) },
    sources: item
      ? [{ title: item.title, url: item.url, publisher: item.source?.name ?? '', published_at: item.published_at ?? '' }]
      : pastedUrl
        ? [{ title: 'Source provided by the editor', url: pastedUrl, publisher: new URL(pastedUrl).hostname }]
        : [],
  }
}

// ---------------------------------------------------------------------------
// Clips and YouTube
// ---------------------------------------------------------------------------

async function clipCaptions(who: Caller, body: Record<string, unknown>) {
  const id = uuid(body.clipId)
  if (!id) throw new HttpError(400, 'invalid')
  const clip = await one<{ title: string; start_s: number; end_s: number; asset_id: string; status: string }>(`video_clips?select=title,start_s,end_s,asset_id,status&id=eq.${id}`)
  if (clip.status === 'sent_to_social') throw new HttpError(409, 'locked')
  const [transcript] = await rest<{ segments: Segment[] }[]>(`transcripts?select=segments&asset_id=eq.${clip.asset_id}`)
  if (!transcript) throw new HttpError(409, 'no-transcript')
  const [asset] = await rest<{ filename: string; project: { title: string } | null }[]>(`media_assets?select=filename,project:video_projects(title)&id=eq.${clip.asset_id}`)
  const spoken = spokenText(transcript.segments, Number(clip.start_s), Number(clip.end_s))
  if (spoken.length < 20) throw new HttpError(409, 'no-speech')
  const captions = await writeClipCaptions({ userId: who.id, title: clip.title, spoken, videoTitle: asset?.project?.title ?? asset?.filename ?? '' })
  await rest(`video_clips?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ captions }) })
  return captions
}

async function youtubeMeta(who: Caller, body: Record<string, unknown>) {
  let source = ''
  if (typeof body.youtubeId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(body.youtubeId)) {
    const v = await one<{ title: string; description: string }>(`youtube_videos?select=title,description&youtube_id=eq.${body.youtubeId}`)
    source = `Current title: ${v.title}\n\nCurrent description:\n${v.description.slice(0, 6000)}`
  } else if (uuid(body.projectId)) {
    const p = await one<{ title: string; summary: string; guest_name: string; guest_verified_info: string; notes: string }>(
      `video_projects?select=title,summary,guest_name,guest_verified_info,notes&id=eq.${body.projectId}`,
    )
    source = `Working title: ${p.title}\nGuest: ${p.guest_name}\nSummary: ${p.summary}\nVerified guest information: ${p.guest_verified_info}\nNotes: ${p.notes.slice(0, 4000)}`
  } else throw new HttpError(400, 'invalid')
  const raw = await chatJson({
    feature: 'youtube-meta',
    userId: who.id,
    maxTokens: 1100,
    system: [
      HOUSE_RULES,
      'You suggest YouTube metadata for a Noisemakers video, using only the SOURCE.',
      'Reply with JSON only: {"titles": [5, each under 70 characters], "description": string, "thumbnail_text": [5, each at most 4 words], "hashtags": [up to 10, without #]}.',
    ].join('\n'),
    user: `SOURCE:\n${source}`,
  })
  const description = text(raw.description, 5000)
  return {
    titles: strings(raw.titles, 5, 100),
    description,
    thumbnail_text: strings(raw.thumbnail_text, 5, 40),
    hashtags: cleanHashtags(raw.hashtags, 10),
    warnings: unsupportedQuotes(description, source).map((q) => `Quotes words that aren't in the source: “${q}”.`),
  }
}

// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  try {
    const task = routeName(req)
    const who = await caller(req, 'writer')
    const body = await readBody(req, 40_000)
    switch (task) {
      case 'interview':
        return json(await interview(who, body))
      case 'news-review':
        return json(await newsReview(who, body))
      case 'article-draft':
        return json(await articleDraft(who, body))
      case 'newsletter':
        return json(await draftNewsletter({ userId: who.id, useAi: true }))
      case 'clip-captions':
        return json(await clipCaptions(who, body))
      case 'youtube-meta':
        return json(await youtubeMeta(who, body))
      default:
        throw new HttpError(404, 'not-found')
    }
  } catch (error) {
    return failure(error, 'AI task')
  }
}
