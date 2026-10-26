/**
 * OpenAI calls for the dashboard's AI features, with the cost controls from
 * Settings → AI and costs: a daily request limit per person, a monthly budget, and a
 * record of every call in ai_usage.
 *
 * Environment variables: OPENAI_API_KEY (required for AI), OPENAI_MODEL (optional).
 */
import { estimateTokens, overBudget, textCost } from '../../src/lib/costs.ts'
import { HttpError, isMissingTable, rest, settings } from './server.ts'

export const DEFAULT_MODEL = 'gpt-4o-mini'
export const model = () => process.env.OPENAI_MODEL || DEFAULT_MODEL

/** Rules every AI feature follows. Each feature adds its own on top. */
export const HOUSE_RULES = [
  'You work for Noisemakers News, a US-based international news, storytelling and podcast channel with a team in the United States and South Africa.',
  'Tone: warm, professional, engaging and informative. Plain English. No clickbait, no ALL CAPS.',
  'STRICT RULES:',
  '- Use only facts stated in the SOURCE you are given. Never add names, numbers, dates, places, claims, outcomes or credentials that are not in it.',
  '- Never invent quotations. Only put words in quotation marks if they appear word for word in the SOURCE.',
  '- If something is uncertain or missing, say so plainly (for example "[check: ...]") instead of guessing.',
  '- Do not include URLs unless they appear in the SOURCE.',
].join('\n')

/**
 * Throws if this call would go over today's request limit or the month's AI budget.
 * Until the newsroom migration has been run there are no limits to check, so features that
 * already worked (social drafts) keep working.
 */
export async function checkAiAllowance(userId: string | null, expectedUsd: number) {
  let s: Awaited<ReturnType<typeof settings>>
  try {
    s = await settings()
  } catch (error) {
    if (isMissingTable(error) || (error instanceof HttpError && error.code === 'database-update-needed')) return
    throw error
  }
  if (userId) {
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const recent = await rest<unknown[]>(`ai_usage?select=id&user_id=eq.${encodeURIComponent(userId)}&at=gte.${encodeURIComponent(since)}&limit=${s.max_ai_requests_per_day + 1}`)
    if (recent.length >= s.max_ai_requests_per_day) throw new HttpError(429, 'ai-daily-limit')
  }
  const usage = await rpcUsage()
  if (overBudget(usage.ai, s.monthly_ai_budget_usd, expectedUsd)) throw new HttpError(402, 'ai-budget', { spent: usage.ai, budget: s.monthly_ai_budget_usd })
}

/** This month's spending. Summed here because usage_this_month() answers only signed-in team members. */
export async function rpcUsage(): Promise<{ ai: number; video: number }> {
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  const rows = await rest<{ category: string; cost_usd: string }[]>(`ai_usage?select=category,cost_usd&at=gte.${encodeURIComponent(start.toISOString())}&limit=100000`)
  const sum = (c: string) => rows.filter((r) => r.category === c).reduce((t, r) => t + Number(r.cost_usd), 0)
  return { ai: sum('ai'), video: sum('video') }
}

export async function recordUsage(row: { user_id: string | null; feature: string; model: string; input_tokens?: number; output_tokens?: number; audio_seconds?: number; video_seconds?: number; category?: 'ai' | 'video'; cost_usd: number; job_id?: string }) {
  try {
    await rest('ai_usage', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ category: 'ai', ...row }) })
  } catch (error) {
    console.error(`usage: ${error instanceof Error ? error.message : 'failed'}`)
  }
}

/**
 * Asks the model for a JSON object. Checks the allowance first and records the cost after.
 * Throws HttpError codes the dashboard explains: ai-not-configured, ai-key-invalid, ai-busy, ai-daily-limit, ai-budget.
 */
export async function chatJson<T = Record<string, unknown>>(opts: { feature: string; userId: string | null; system: string; user: string; maxTokens?: number; temperature?: number; fetchImpl?: typeof fetch }): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY ?? ''
  if (!apiKey) throw new HttpError(503, 'ai-not-configured')
  const m = model()
  const maxTokens = opts.maxTokens ?? 1500
  await checkAiAllowance(opts.userId, textCost(m, estimateTokens(opts.system + opts.user), maxTokens))
  const res = await (opts.fetchImpl ?? fetch)('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: m,
      temperature: opts.temperature ?? 0.5,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
    signal: AbortSignal.timeout(55_000),
  })
  if (res.status === 401) throw new HttpError(502, 'ai-key-invalid')
  if (res.status === 429) throw new HttpError(429, 'ai-busy')
  if (!res.ok) throw new Error(`OpenAI ${res.status}`)
  const completion = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  const input = completion.usage?.prompt_tokens ?? estimateTokens(opts.system + opts.user)
  const output = completion.usage?.completion_tokens ?? 0
  await recordUsage({ user_id: opts.userId, feature: opts.feature, model: m, input_tokens: input, output_tokens: output, cost_usd: textCost(m, input, output) })
  try {
    const parsed: unknown = JSON.parse(completion.choices?.[0]?.message?.content ?? '')
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
    return parsed as T
  } catch {
    throw new HttpError(502, 'ai-empty')
  }
}

/** Keeps strings only, trimmed and limited. */
export const strings = (v: unknown, max = 20, len = 500): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && Boolean(x.trim())).map((x) => x.trim().slice(0, len)).slice(0, max) : []

export const text = (v: unknown, len = 5000) => (typeof v === 'string' ? v.trim().slice(0, len) : '')

// Re-exported so features can mark unsupported quotes the same way the social drafts do.
export { unsupportedQuotes } from '../../src/lib/social.ts'
