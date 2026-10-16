/**
 * Lists recent uploads that aren't in the site's data yet. Run with
 * `npm run check:feed`.
 *
 * Uses the channel's public RSS feed: no API key, no quota, but only the 15
 * most recent uploads and no durations. Add new videos to
 * src/data/episodes.ts or src/data/clips.ts by hand, with the duration from
 * YouTube. Full automation would need the YouTube Data API (see README).
 */
import { readFile } from 'node:fs/promises'

const CHANNEL_ID = 'UCD49Bigk35BXat_YPimii0Q'
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

const known = new Set()
for (const file of ['src/data/episodes.ts', 'src/data/clips.ts']) {
  const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  for (const [, id] of text.matchAll(/youtubeId: '([A-Za-z0-9_-]{11})'/g)) known.add(id)
}

let xml
try {
  const res = await fetch(FEED)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  xml = await res.text()
} catch (err) {
  console.error(`Couldn't fetch the channel feed (${err.message}). Check your connection and try again.`)
  process.exit(1)
}

const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => ({
  id: entry.match(/<yt:videoId>([^<]+)/)?.[1],
  title: decode(entry.match(/<title>([^<]*)/)?.[1] ?? ''),
  published: entry.match(/<published>([^<]+)/)?.[1],
  isShort: /#shorts|#youtubeshorts/i.test(entry),
}))

const missing = entries.filter((e) => e.id && !known.has(e.id))
if (!missing.length) {
  console.log(`✓ Up to date. All ${entries.length} recent uploads are on the site.`)
} else {
  console.log(`${missing.length} recent upload(s) not on the site yet:\n`)
  for (const e of missing) {
    console.log(`  ${e.published?.slice(0, 10)}  ${e.id}  ${e.title}`)
    console.log(`              https://www.youtube.com/watch?v=${e.id}${e.isShort ? '  (looks like a Short)' : ''}`)
  }
  console.log('\nAdd each to src/data/episodes.ts or src/data/clips.ts, then run npm test.')
}
