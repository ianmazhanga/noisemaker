import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Clip, Episode, SyncedVideo, YouTubeSnapshot } from '../src/types/content.ts'
import { buildCatalog } from '../src/lib/catalog.ts'
import { EPISODES } from '../src/data/episodes.ts'
import { CLIPS } from '../src/data/clips.ts'

const curated: Episode = {
  slug: 'hand-written',
  youtubeId: 'aaaaaaaaaaa',
  title: 'Hand-written title',
  summary: 'A hand-written summary of this episode.',
  description: ['Hand-written description.'],
  topic: 'marriage',
  guestIds: [],
  publishedAt: '2026-01-01T10:00:00Z',
  durationSeconds: 3000,
}
const curatedClip: Clip = { youtubeId: 'ccccccccccc', title: 'Clip', publishedAt: '2026-01-02T10:00:00Z', durationSeconds: 40, guestIds: [], episodeSlug: 'hand-written' }

const synced = (v: Partial<SyncedVideo> & Pick<SyncedVideo, 'youtubeId' | 'publishedAt'>): SyncedVideo => ({
  kind: 'episode',
  title: 'From YouTube',
  description: ['First paragraph from YouTube.', 'Second paragraph.'],
  durationSeconds: 2000,
  hd: false,
  restricted: false,
  ...v,
})
const snap = (...videos: SyncedVideo[]): YouTubeSnapshot => ({ channelId: 'UCD49Bigk35BXat_YPimii0Q', videos })

test('hand-written details win; new uploads appear with YouTube’s own text, newest first', () => {
  const { episodes } = buildCatalog(
    snap(synced({ youtubeId: 'bbbbbbbbbbb', slug: 'from-youtube', publishedAt: '2026-02-01T10:00:00Z' }), synced({ youtubeId: 'aaaaaaaaaaa', slug: 'hand-written', publishedAt: '2026-01-01T10:00:00Z' })),
    [curated],
    [],
  )
  assert.deepEqual(episodes.map((e) => e.slug), ['from-youtube', 'hand-written'])
  assert.equal(episodes[1].title, 'Hand-written title')
  const auto = episodes[0]
  assert.equal(auto.summary, 'First paragraph from YouTube.')
  assert.deepEqual(auto.description, ['Second paragraph.'], 'summary is not repeated in the description')
  assert.equal(auto.topic, undefined, 'no invented topic')
  assert.deepEqual(auto.guestIds, [], 'no invented guests')
})

test('videos no longer public are hidden, and clips stop linking to them', () => {
  const { episodes, clips, hidden } = buildCatalog(snap(synced({ youtubeId: 'ccccccccccc', kind: 'short', publishedAt: '2026-01-02T10:00:00Z' })), [curated], [curatedClip])
  assert.equal(episodes.length, 0)
  assert.deepEqual(hidden, ['aaaaaaaaaaa'])
  assert.equal(clips[0].episodeSlug, undefined)
})

test('playback restrictions from the sync apply to hand-written entries', () => {
  const { episodes } = buildCatalog(snap(synced({ youtubeId: 'aaaaaaaaaaa', slug: 'hand-written', publishedAt: '2026-01-01T10:00:00Z', restricted: true })), [curated], [])
  assert.equal(episodes[0].restricted, true)
})

test('an automatic slug that clashes with a hand-written one is renamed; the hand-written one never changes', () => {
  const { episodes } = buildCatalog(
    snap(synced({ youtubeId: 'bbbbbbbbbbb', slug: 'hand-written', publishedAt: '2026-02-01T10:00:00Z' }), synced({ youtubeId: 'aaaaaaaaaaa', slug: 'hand-written', publishedAt: '2026-01-01T10:00:00Z' })),
    [curated],
    [],
  )
  assert.equal(episodes.find((e) => e.youtubeId === 'aaaaaaaaaaa')?.slug, 'hand-written')
  assert.equal(episodes.find((e) => e.youtubeId === 'bbbbbbbbbbb')?.slug, 'hand-written-bbbbbbbbbbb')
})

test('duplicate entries in the snapshot appear once', () => {
  const v = synced({ youtubeId: 'bbbbbbbbbbb', slug: 'x', publishedAt: '2026-02-01T10:00:00Z' })
  assert.equal(buildCatalog(snap(v, v), [], []).episodes.length, 1)
})

test('an empty snapshot falls back to the hand-written lists', () => {
  const { episodes, clips } = buildCatalog(snap(), [curated], [curatedClip])
  assert.equal(episodes.length, 1)
  assert.equal(clips.length, 1)
  assert.equal(buildCatalog(null, [curated], []).episodes.length, 1)
})

test('the committed snapshot shows every current episode and clip, newest first', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../src/data/youtube.json', import.meta.url), 'utf8')) as YouTubeSnapshot
  const { episodes, clips } = buildCatalog(snapshot, EPISODES, CLIPS)
  assert.equal(episodes.length, EPISODES.length)
  assert.equal(clips.length, CLIPS.length)
  for (let i = 1; i < episodes.length; i++) assert.ok(episodes[i - 1].publishedAt >= episodes[i].publishedAt)
  // Every existing episode URL keeps working.
  assert.deepEqual(new Set(episodes.map((e) => e.slug)), new Set(EPISODES.map((e) => e.slug)))
})
