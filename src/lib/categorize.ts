/**
 * Suggests a category (topic) for an interview the YouTube sync added without a
 * hand-written entry, from the words in its title and description.
 *
 * It only answers when the evidence is clear: a strong phrase, and a clear lead over the
 * next category. Otherwise it returns null and the interview shows as "Needs review" in
 * YouTube Manager → Categories, rather than being put in the wrong place.
 *
 * Who decides, strongest first: an admin's choice in the dashboard, then the hand-written
 * topic in src/data/episodes.ts, then these rules.
 *
 * To teach it new words, add phrases below. No imports, so tests can run it directly in Node.
 */

type Rule = [pattern: RegExp, weight: number]

/** Title words count double: titles say what an interview is about. */
const TITLE_WEIGHT = 2

export const CATEGORY_RULES: Record<string, Rule[]> = {
  marriage: [
    [/\bmarriages?\b|\bmarried\b|\bmarital\b/, 3],
    [/\b(husband|wife|spouse)s?\b/, 2],
    [/\bcouples?\b/, 2],
    [/\bwedding|divorce|in-laws?\b/, 2],
  ],
  family: [
    [/\bparent(s|ing|hood)?\b/, 3],
    [/\bfather(s|hood)?\b|\bmother(s|hood)?\b|\bdads?\b|\bmums?\b|\bmoms?\b/, 2],
    [/\bchild(ren)?\b|\bkids\b|\bteenagers?\b/, 2],
    [/\bfamil(y|ies)\b/, 2],
    [/\bdiaspora\b/, 1],
  ],
  'life-stories': [
    [/\b(my|her|his|their) (\w+ )?(journey|story)\b|\btestimon(y|ies)\b/, 3],
    [/\bsurviv(or|ors|ed|ing)\b|\bovercam?e|overcoming\b/, 3],
    [/\bcancer|diagnos(is|ed)|illness|disease|chemo(therapy)?\b/, 3],
    [/\baddict(ion|ed)|alcohol|recovery|rehab\b/, 3],
    [/\bbull(ied|ying)\b|\babuse\b|\btrauma\b|\bgrief\b|\bdepression\b|\bmental health\b/, 3],
    [/\bforgiv(e|en|eness|ing)\b|\bapolog(y|ise|ize|ised|ized)\b|\bsay sorry\b/, 3],
    [/\bjourney\b|\bhope\b|\bresilien(ce|t)\b|\bstruggles?\b/, 1],
  ],
  'love-stories': [
    [/\blove stor(y|ies)\b/, 4],
    [/\bblind date\b|\bhow (we|they) met\b/, 3],
  ],
}

export interface Suggestion {
  topic: string | null
  scores: Record<string, number>
}

function score(text: string, rules: Rule[]): number {
  return rules.reduce((total, [pattern, weight]) => total + (pattern.test(text) ? weight : 0), 0)
}

/**
 * The best category for an interview, or null when it isn't clear. Needs at least 3 points
 * and twice the runner-up's score (ties and close calls go to review).
 */
export function suggestTopic(title: string, description: string[] | string, known: string[] = Object.keys(CATEGORY_RULES)): Suggestion {
  const t = title.toLowerCase()
  const d = (Array.isArray(description) ? description.join(' ') : description).toLowerCase()
  const scores: Record<string, number> = {}
  for (const topic of known) {
    const rules = CATEGORY_RULES[topic]
    if (rules) scores[topic] = score(t, rules) * TITLE_WEIGHT + score(d, rules)
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [best, second] = ranked
  if (!best || best[1] < 3 || (second && best[1] < second[1] * 2)) return { topic: null, scores }
  return { topic: best[0], scores }
}
