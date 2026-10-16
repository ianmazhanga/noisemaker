/**
 * Syncs src/data/youtube.json with the channel's public uploads.
 * Run with `npm run sync:youtube` (needs YOUTUBE_API_KEY in the environment).
 * The scheduled GitHub Action .github/workflows/sync-youtube.yml runs it every hour.
 *
 * Flags: --force allows more than half the videos to disappear in one run.
 */
import { readFile, writeFile } from 'node:fs/promises'
import type { YouTubeSnapshot } from '../src/types/content.ts'
import { buildSnapshot, fetchChannelVideos } from './lib/youtube-sync.ts'

const FILE = new URL('../src/data/youtube.json', import.meta.url)

const apiKey = process.env.YOUTUBE_API_KEY?.trim()
if (!apiKey) {
  // Not an error, so the scheduled job stays green until the key is added.
  console.log('::warning::YOUTUBE_API_KEY is not set, so the YouTube sync was skipped. See README → "YouTube sync".')
  process.exit(0)
}

const previousText = await readFile(FILE, 'utf8')
const previous = JSON.parse(previousText) as YouTubeSnapshot

try {
  const items = await fetchChannelVideos(previous.channelId, apiKey, fetch)
  const { snapshot, added, removed } = buildSnapshot(items, previous, { allowLargeRemoval: process.argv.includes('--force') })
  const text = `${JSON.stringify(snapshot, null, 2)}\n`

  if (text === previousText) {
    console.log(`✓ Up to date: ${snapshot.videos.length} public videos.`)
  } else {
    await writeFile(FILE, text)
    console.log(`✓ Updated src/data/youtube.json: ${snapshot.videos.length} public videos.`)
    for (const v of added) console.log(`  + ${v.publishedAt.slice(0, 10)} ${v.kind.padEnd(7)} ${v.youtubeId}  ${v.title}`)
    for (const v of removed) console.log(`  − removed (deleted or no longer public)  ${v.youtubeId}  ${v.title}`)
    if (!added.length && !removed.length) console.log('  Titles, descriptions or playback settings changed.')
  }
} catch (err) {
  // The key is only ever sent as a URL parameter to Google, and error messages here never include URLs.
  console.error(`✗ YouTube sync failed: ${(err as Error).message}. The site keeps its existing video list.`)
  process.exit(1)
}
