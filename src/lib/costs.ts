/**
 * Cost estimates for paid AI and video processing, shown before expensive jobs start and
 * recorded after each call. Prices are the providers' published list prices when this was
 * written; check them on the providers' pricing pages and change them here if they move.
 *
 * No imports, so the server, the video worker, the dashboard and tests share it.
 */

/** US$ per million tokens: [input, output]. */
export const TEXT_PRICES: Record<string, [number, number]> = {
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4o': [2.5, 10],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1': [2, 8],
}

/** Transcription with word timings (OpenAI whisper-1), US$ per minute of audio. */
export const TRANSCRIBE_USD_PER_MINUTE = 0.006

/**
 * Rendering runs on the video worker. On GitHub Actions it is free for public repositories
 * and US$0.008 per minute of Linux runner time beyond the free allowance for private ones.
 */
export const RENDER_USD_PER_RUNNER_MINUTE = 0.008

/** Unknown models are priced like the most expensive listed one, so estimates err high. */
export function textCost(model: string, inputTokens: number, outputTokens: number): number {
  const [input, output] = TEXT_PRICES[model] ?? [Math.max(...Object.values(TEXT_PRICES).map((p) => p[0])), Math.max(...Object.values(TEXT_PRICES).map((p) => p[1]))]
  return (inputTokens * input + outputTokens * output) / 1_000_000
}

export const transcribeCost = (seconds: number) => (Math.max(0, seconds) / 60) * TRANSCRIBE_USD_PER_MINUTE

/** Roughly 4 characters per token for English text. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4)

export interface JobEstimate {
  usd: number
  /** Plain-English breakdown shown to the owner before they confirm. */
  lines: string[]
}

/** Transcribing and analysing a recording: transcription by the minute, plus one AI pass over the transcript. */
export function estimateAnalysis(durationSeconds: number, model = 'gpt-4o-mini', clips = 6): JobEstimate {
  const minutes = durationSeconds / 60
  const transcribe = transcribeCost(durationSeconds)
  // About 150 spoken words a minute, ~1.4 tokens a word with timings, plus instructions and the reply.
  const inputTokens = Math.round(minutes * 150 * 1.4) + 2000
  const analyse = textCost(model, inputTokens, 400 * clips)
  const runner = Math.ceil(minutes / 10 + 2) * RENDER_USD_PER_RUNNER_MINUTE
  return {
    usd: round(transcribe + analyse + runner),
    lines: [
      `Transcription of ${minutes.toFixed(0)} min: about $${transcribe.toFixed(2)}`,
      `AI clip analysis and captions: about $${analyse.toFixed(2)}`,
      `Worker time (free on a public GitHub repository): up to $${runner.toFixed(2)}`,
    ],
  }
}

/** Rendering one clip. Encoding 1080×1920 takes about 1–3× the clip's length on a standard runner. */
export function estimateRender(clipSeconds: number, final: boolean): JobEstimate {
  const runnerMinutes = Math.ceil(((clipSeconds * (final ? 3 : 1.5)) / 60) + 1)
  const usd = round(runnerMinutes * RENDER_USD_PER_RUNNER_MINUTE)
  return { usd, lines: [`${final ? 'Final' : 'Preview'} render, about ${runnerMinutes} min of worker time: up to $${usd.toFixed(2)} (free on a public GitHub repository)`] }
}

const round = (n: number) => Math.round(n * 10000) / 10000

/** Would spending `extra` go over the month’s budget? A budget of 0 allows no paid processing at all. */
export const overBudget = (spent: number, budget: number, extra: number) => spent + extra > budget
