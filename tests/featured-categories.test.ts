import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildCatalog, pickFeatured } from '../src/lib/catalog.ts'
import { suggestTopic } from '../src/lib/categorize.ts'
import { EPISODES } from '../src/data/episodes.ts'
import { CLIPS } from '../src/data/clips.ts'
import type { Episode, SyncedVideo, YouTubeSnapshot } from '../src/types/content.ts'

const video = (id: string, title: string, description: string[], publishedAt: string, kind: 'episode' | 'short' = 'episode'): SyncedVideo => ({
  youtubeId: id.padEnd(11, 'x').slice(0, 11),
  kind,
  slug: kind === 'episode' ? id : undefined,
  title,
  description,
  publishedAt,
  durationSeconds: kind === 'episode' ? 2400 : 40,
  hd: true,
  restricted: false,
})

test('clear stories get a category; unclear ones are left for review', () => {
  assert.equal(suggestTopic('My Breast Cancer Journey', ['A survivor shares her diagnosis, treatment, faith and hope.']).topic, 'life-stories')
  assert.equal(suggestTopic('Why couples stop talking', ['A conversation about marriage and communication.']).topic, 'marriage')
  assert.equal(suggestTopic('Raising teenagers abroad', ['Parenting children far from family.']).topic, 'family')
  assert.equal(suggestTopic('The Kokakora Love Story', []).topic, 'love-stories')
  // Nothing clear: no guess.
  assert.equal(suggestTopic('One Doctor, 6 Countries, 4 Continents', ['Cultural experiences around the world.']).topic, null)
  // Two categories equally strong: no guess.
  assert.equal(suggestTopic('Marriage and parenting', []).topic, null)
})

test('the rules never contradict the hand-written categories', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../src/data/youtube.json', import.meta.url), 'utf8')) as YouTubeSnapshot
  const byId = new Map(snapshot.videos.map((v) => [v.youtubeId, v]))
  for (const e of EPISODES.filter((x) => x.topic)) {
    const v = byId.get(e.youtubeId)
    const { topic } = suggestTopic(v?.title ?? e.title, v?.description ?? [e.summary])
    assert.ok(topic === null || topic === e.topic, `${e.title}: suggested ${topic}, hand-written ${e.topic}`)
  }
})

test('synced interviews get automatic categories; hand-written ones keep theirs', () => {
  const snapshot: YouTubeSnapshot = {
    channelId: 'UC',
    videos: [video('cancer', 'My Breast Cancer Journey', ['A survivor shares her diagnosis and treatment.'], '2026-11-01T10:00:00Z'), video('vet', 'One Vet, 6 Countries', ['Cultural experiences.'], '2026-10-31T10:00:00Z')],
  }
  const { episodes } = buildCatalog(snapshot, [], [])
  assert.deepEqual(
    episodes.map((e) => [e.title, e.topic ?? null, e.topicSource ?? null]),
    [
      ['My Breast Cancer Journey', 'life-stories', 'auto'],
      ['One Vet, 6 Countries', null, null],
    ],
  )
  const curated: Episode = { ...episodes[0], topic: 'family', topicSource: undefined }
  const again = buildCatalog(snapshot, [curated], [])
  assert.deepEqual([again.episodes[0].topic, again.episodes[0].topicSource], ['family', 'curated'])
})

test('the newest interview is featured, and a newer upload takes its place', () => {
  const before: YouTubeSnapshot = { channelId: 'UC', videos: [video('older', 'Older interview', ['Talk.'], '2026-10-01T10:00:00Z')] }
  assert.equal(pickFeatured(buildCatalog(before, [], []).episodes)?.title, 'Older interview')

  const after: YouTubeSnapshot = {
    channelId: 'UC',
    videos: [
      video('short', 'A newer Short', ['Clip.'], '2026-11-03T10:00:00Z', 'short'),
      video('trailer', 'Season 2 Trailer', ['Coming soon.'], '2026-11-02T10:00:00Z'),
      video('newest', 'Newest interview', ['Talk.'], '2026-11-01T10:00:00Z'),
      ...before.videos,
      // A repeat of the same video is ignored.
      video('newest', 'Newest interview', ['Talk.'], '2026-11-01T10:00:00Z'),
    ],
  }
  const { episodes } = buildCatalog(after, [], [])
  assert.equal(pickFeatured(episodes)?.title, 'Newest interview', 'not the Short or the trailer')
  assert.ok(episodes.some((e) => e.title === 'Older interview'), 'the previous one stays in Episodes')
  assert.equal(episodes.filter((e) => e.title === 'Newest interview').length, 1)
  assert.equal(pickFeatured([]), undefined)
})

test('on the real catalogue, the featured interview is the newest full episode', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../src/data/youtube.json', import.meta.url), 'utf8')) as YouTubeSnapshot
  const { episodes } = buildCatalog(snapshot, EPISODES, CLIPS)
  const featured = pickFeatured(episodes)!
  assert.ok(featured.durationSeconds > 180, 'never a Short')
  assert.ok(!episodes.some((e) => e.publishedAt > featured.publishedAt && !/trailer|teaser/i.test(e.title)))
  assert.ok(featured.summary.length > 0)
})
