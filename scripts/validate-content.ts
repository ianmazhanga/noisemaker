/**
 * Content integrity checks. Run with `npm test`.
 *
 * Catches the mistakes that would put a broken link, dead play button or
 * dangling reference on the site: malformed YouTube IDs, duplicate slugs,
 * unknown guests or topics, and homepage slots pointing at missing episodes.
 */
import { EPISODES } from '../src/data/episodes.ts'
import { CLIPS } from '../src/data/clips.ts'
import { GUESTS } from '../src/data/guests.ts'
import { TOPICS } from '../src/data/topics.ts'
import { HOMEPAGE, PRIMARY_NAV, SITE } from '../src/config/site.ts'

const errors: string[] = []
let checks = 0
function expect(condition: unknown, message: string) {
  checks++
  if (!condition) errors.push(message)
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s) && !Number.isNaN(Date.parse(s))

const topicSlugs = new Set(TOPICS.map((t) => t.slug))
const guestIds = new Set(GUESTS.map((g) => g.id))
const episodeSlugs = new Set(EPISODES.map((e) => e.slug))
const allYoutubeIds = [...EPISODES.map((e) => e.youtubeId), ...CLIPS.map((c) => c.youtubeId)]

expect(new Set(allYoutubeIds).size === allYoutubeIds.length, 'A YouTube ID appears more than once across episodes and clips')
expect(episodeSlugs.size === EPISODES.length, 'Duplicate episode slug')
expect(guestIds.size === GUESTS.length, 'Duplicate guest id')

for (const e of EPISODES) {
  const where = `Episode "${e.slug}"`
  expect(SLUG.test(e.slug), `${where}: slug must be lowercase-hyphenated`)
  expect(YOUTUBE_ID.test(e.youtubeId), `${where}: invalid YouTube ID "${e.youtubeId}"`)
  expect(e.title.trim() && !e.title.includes('#'), `${where}: title is empty or contains a hashtag`)
  expect(e.summary.trim().length > 20, `${where}: summary is missing or too short`)
  expect(e.description.length > 0 && e.description.every((p) => p.trim()), `${where}: description is empty`)
  expect(topicSlugs.has(e.topic), `${where}: unknown topic "${e.topic}"`)
  expect(isIsoDate(e.publishedAt), `${where}: publishedAt must be an ISO 8601 UTC time`)
  expect(Number.isInteger(e.durationSeconds) && e.durationSeconds > 0, `${where}: duration must be a positive whole number of seconds`)
  for (const g of e.guestIds) expect(guestIds.has(g), `${where}: unknown guest "${g}"`)
  if (e.focus) expect(e.focus.x >= 0 && e.focus.x <= 1, `${where}: focus.x must be between 0 and 1`)
  if (e.series) {
    const siblings = EPISODES.filter((o) => o.series?.name === e.series?.name)
    expect(new Set(siblings.map((o) => o.series?.part)).size === siblings.length, `${where}: duplicate part number in series "${e.series.name}"`)
  }
}

for (const c of CLIPS) {
  const where = `Clip "${c.youtubeId}"`
  expect(YOUTUBE_ID.test(c.youtubeId), `${where}: invalid YouTube ID`)
  expect(c.title.trim() && !c.title.includes('#'), `${where}: title is empty or contains a hashtag`)
  expect(isIsoDate(c.publishedAt), `${where}: publishedAt must be an ISO 8601 UTC time`)
  expect(Number.isInteger(c.durationSeconds) && c.durationSeconds > 0 && c.durationSeconds <= 180, `${where}: Shorts last 1–180 seconds`)
  for (const g of c.guestIds) expect(guestIds.has(g), `${where}: unknown guest "${g}"`)
  if (c.episodeSlug) {
    const episode = EPISODES.find((e) => e.slug === c.episodeSlug)
    expect(episode, `${where}: unknown episode "${c.episodeSlug}"`)
    if (episode) expect(c.guestIds.every((g) => episode.guestIds.includes(g)), `${where}: its guests don't appear in episode "${c.episodeSlug}"`)
  }
}

for (const g of GUESTS) {
  const where = `Guest "${g.id}"`
  expect(SLUG.test(g.id), `${where}: id must be lowercase-hyphenated`)
  expect(g.name.trim() && g.role.trim() && g.bio.trim(), `${where}: name, role and bio are required`)
  expect(YOUTUBE_ID.test(g.portrait.youtubeId) && allYoutubeIds.includes(g.portrait.youtubeId), `${where}: portrait must use one of the channel's own videos`)
  const { x, y = 0.5, zoom = 1 } = g.portrait.focus
  expect(x >= 0 && x <= 1 && y >= 0 && y <= 1 && zoom >= 1 && zoom <= 3, `${where}: portrait focus x/y must be 0–1 and zoom 1–3`)
  expect(EPISODES.some((e) => e.guestIds.includes(g.id)), `${where}: appears in no episode`)
  if (g.quote) {
    const episode = EPISODES.find((e) => e.slug === g.quote?.episodeSlug)
    expect(episode?.guestIds.includes(g.id), `${where}: quote must point to one of their own episodes`)
  }
  for (const l of g.links ?? []) expect(l.href.startsWith('https://'), `${where}: links must be https`)
}

for (const slug of HOMEPAGE.conversations) expect(episodeSlugs.has(slug), `HOMEPAGE.conversations: unknown episode "${slug}"`)
expect(HOMEPAGE.leadEpisode === 'latest' || episodeSlugs.has(HOMEPAGE.leadEpisode), `HOMEPAGE.leadEpisode: unknown episode "${HOMEPAGE.leadEpisode}"`)
expect(episodeSlugs.has(HOMEPAGE.heroCollage.portraitEpisode), 'HOMEPAGE.heroCollage.portraitEpisode: unknown episode')
expect(episodeSlugs.has(HOMEPAGE.heroCollage.landscapeEpisode), 'HOMEPAGE.heroCollage.landscapeEpisode: unknown episode')
expect(CLIPS.some((c) => c.youtubeId === HOMEPAGE.heroCollage.clip), 'HOMEPAGE.heroCollage.clip: unknown clip')
expect(guestIds.has(HOMEPAGE.featuredGuest), `HOMEPAGE.featuredGuest: unknown guest "${HOMEPAGE.featuredGuest}"`)

const ROUTES = ['/', '/episodes', '/clips', '/about', '/collaborate', '/privacy']
for (const item of PRIMARY_NAV) expect(ROUTES.includes(item.to), `Navigation item "${item.label}" points to an unknown route "${item.to}"`)
expect(SITE.url.startsWith('https://') && !SITE.url.endsWith('/'), 'SITE.url must be an https origin without a trailing slash')
for (const s of SITE.social) expect(s.href.startsWith('https://') && s.label.trim(), `Social link "${s.label}" must have a label and an https URL`)
expect(!SITE.contactEmail || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(SITE.contactEmail), 'SITE.contactEmail is not a valid address')

if (errors.length) {
  console.error(`✗ ${errors.length} of ${checks} content checks failed:\n`)
  for (const e of errors) console.error(`  • ${e}`)
  process.exit(1)
}
console.log(`✓ ${checks} content checks passed (${EPISODES.length} episodes, ${CLIPS.length} clips, ${GUESTS.length} guests)`)
