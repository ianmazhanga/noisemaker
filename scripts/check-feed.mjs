/**
 * Quick check, with no API key, for recent uploads the hourly YouTube sync
 * hasn't picked up yet. Run with `npm run check:feed`.
 *
 * Uses the channel's public RSS feed, which only covers the 15 most recent
 * uploads. If something is listed here for more than a couple of hours, check
 * the "Sync YouTube videos" workflow on GitHub (see README).
 */
import { readFile } from 'node:fs/promises'

const CHANNEL_ID = 'UCD49Bigk35BXat_YPimii0Q'
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

const snapshot = JSON.parse(await readFile(new URL('../src/data/youtube.json', import.meta.url), 'utf8'))
const known = new Set(snapshot.videos.map((v) => v.youtubeId))

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
  console.log('\nThe hourly sync should add these. If it doesn’t, check the "Sync YouTube videos" workflow on GitHub.')
}
