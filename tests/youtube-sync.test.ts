import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { YouTubeSnapshot } from '../src/types/content.ts'
import {
  buildSnapshot,
  cleanDescription,
  cleanTitle,
  fetchChannelVideos,
  getJson,
  parseIsoDuration,
  slugify,
  uploadsPlaylistId,
  type ApiVideo,
  type FetchLike,
} from '../scripts/lib/youtube-sync.ts'

const CHANNEL = 'UCD49Bigk35BXat_YPimii0Q'
const empty: YouTubeSnapshot = { channelId: CHANNEL, videos: [] }

function video(id: string, publishedAt: string, opts: Partial<{ title: string; duration: string; privacy: string; embeddable: boolean; ageRestricted: boolean; live: string; maxres: boolean }> = {}): ApiVideo {
  return {
    id,
    snippet: {
      title: opts.title ?? `Video ${id}`,
      description: `About ${id}.\n\nSecond paragraph.\n\n#noisemakers #podcast`,
      publishedAt,
      liveBroadcastContent: opts.live ?? 'none',
      thumbnails: opts.maxres ? { high: {}, maxres: {} } : { high: {} },
    },
    contentDetails: { duration: opts.duration ?? 'PT45M', contentRating: opts.ageRestricted ? { ytRating: 'ytAgeRestricted' } : {} },
    status: { privacyStatus: opts.privacy ?? 'public', uploadStatus: 'processed', embeddable: opts.embeddable ?? true },
  }
}

test('parses ISO 8601 durations', () => {
  assert.equal(parseIsoDuration('PT1H4M32S'), 3872)
  assert.equal(parseIsoDuration('PT44S'), 44)
  assert.equal(parseIsoDuration('PT2M'), 120)
  assert.equal(parseIsoDuration('P0D'), 0)
  assert.equal(parseIsoDuration(undefined), 0)
})

test('cleans titles, descriptions and slugs', () => {
  assert.equal(cleanTitle('Why couples struggle to communicate #marriage #shorts'), 'Why couples struggle to communicate')
  assert.equal(cleanTitle('#Family  Meetings  |'), 'Meetings')
  assert.deepEqual(cleanDescription('One.\n\n#a #b\n\nTwo\nlines.\n\n\n'), ['One.', 'Two\nlines.'])
  assert.equal(slugify('Alcohol Addiction, Recovery & Hope: The Innocent Mathe Story'), 'alcohol-addiction-recovery-hope-the-innocent-mathe-story')
  assert.equal(slugify('Ambuya Chihwai’s story — Part 1'), 'ambuya-chihwais-story-part-1')
  assert.ok(slugify('word '.repeat(40)).length <= 70)
  assert.equal(slugify('!!!'), 'episode')
})

test('initial import: every public video, newest first, with slugs for episodes only', () => {
  const { snapshot, added } = buildSnapshot(
    [video('aaaaaaaaaaa', '2026-01-01T10:00:00Z', { title: 'First episode' }), video('bbbbbbbbbbb', '2026-03-01T10:00:00Z', { duration: 'PT40S', title: 'A short' }), video('ccccccccccc', '2026-02-01T10:00:00Z', { maxres: true })],
    empty,
  )
  assert.deepEqual(snapshot.videos.map((v) => v.youtubeId), ['bbbbbbbbbbb', 'ccccccccccc', 'aaaaaaaaaaa'])
  assert.equal(added.length, 3)
  const [short, hd, first] = snapshot.videos
  assert.equal(short.kind, 'short')
  assert.equal(short.slug, undefined)
  assert.equal(first.kind, 'episode')
  assert.equal(first.slug, 'first-episode')
  assert.equal(hd.hd, true)
  assert.deepEqual(first.description, ['About aaaaaaaaaaa.', 'Second paragraph.'])
})

test('new upload is added on the next sync; existing slugs never change', () => {
  const first = buildSnapshot([video('aaaaaaaaaaa', '2026-01-01T10:00:00Z', { title: 'Original title' })], empty).snapshot
  const { snapshot, added, removed } = buildSnapshot(
    [video('aaaaaaaaaaa', '2026-01-01T10:00:00Z', { title: 'Renamed on YouTube' }), video('ddddddddddd', '2026-05-01T10:00:00Z', { title: 'Brand new' })],
    first,
  )
  assert.deepEqual(added.map((v) => v.youtubeId), ['ddddddddddd'])
  assert.equal(removed.length, 0)
  assert.equal(snapshot.videos[0].youtubeId, 'ddddddddddd', 'newest first')
  assert.equal(snapshot.videos[1].title, 'Renamed on YouTube')
  assert.equal(snapshot.videos[1].slug, 'original-title', 'slug kept after a title change')
})

test('duplicate video IDs and clashing slugs are handled', () => {
  const { snapshot } = buildSnapshot(
    [
      video('aaaaaaaaaaa', '2026-01-01T10:00:00Z', { title: 'Same title' }),
      video('aaaaaaaaaaa', '2026-01-01T10:00:00Z', { title: 'Same title' }),
      video('bbbbbbbbbbb', '2026-02-01T10:00:00Z', { title: 'Same title' }),
    ],
    empty,
  )
  assert.equal(snapshot.videos.length, 2)
  assert.deepEqual(snapshot.videos.map((v) => v.slug).sort(), ['same-title', 'same-title-2'])
  // A removed video's slug is never handed to a new one.
  const later = buildSnapshot([video('bbbbbbbbbbb', '2026-02-01T10:00:00Z', { title: 'Same title' }), video('ccccccccccc', '2026-03-01T10:00:00Z', { title: 'Same title' })], snapshot)
  assert.equal(later.snapshot.videos.find((v) => v.youtubeId === 'ccccccccccc')?.slug, 'same-title-3')
})

test('private, deleted, unprocessed, live and upcoming videos are left out; restricted ones are flagged', () => {
  const { snapshot } = buildSnapshot(
    [
      video('aaaaaaaaaaa', '2026-01-01T10:00:00Z'),
      video('ppppppppppp', '2026-01-02T10:00:00Z', { privacy: 'private' }),
      video('uuuuuuuuuuu', '2026-01-03T10:00:00Z', { privacy: 'unlisted' }),
      video('lllllllllll', '2026-01-04T10:00:00Z', { live: 'live' }),
      video('fffffffffff', '2026-01-05T10:00:00Z', { live: 'upcoming' }),
      { ...video('xxxxxxxxxxx', '2026-01-06T10:00:00Z'), status: { privacyStatus: 'public', uploadStatus: 'uploaded' } },
      video('eeeeeeeeeee', '2026-01-07T10:00:00Z', { embeddable: false }),
      video('rrrrrrrrrrr', '2026-01-08T10:00:00Z', { ageRestricted: true }),
    ],
    empty,
  )
  assert.deepEqual(snapshot.videos.map((v) => v.youtubeId), ['rrrrrrrrrrr', 'eeeeeeeeeee', 'aaaaaaaaaaa'])
  assert.equal(snapshot.videos[0].restricted, true)
  assert.equal(snapshot.videos[1].restricted, true)
  assert.equal(snapshot.videos[2].restricted, false)
})

test('a video deleted on YouTube is removed; a mass removal is refused', () => {
  const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd']
  const full = buildSnapshot(ids.map((id, i) => video(id, `2026-0${i + 1}-01T10:00:00Z`)), empty).snapshot
  const { removed, snapshot } = buildSnapshot(ids.slice(1).map((id, i) => video(id, `2026-0${i + 2}-01T10:00:00Z`)), full)
  assert.deepEqual(removed.map((v) => v.youtubeId), ['aaaaaaaaaaa'])
  assert.equal(snapshot.videos.length, 3)

  assert.throws(() => buildSnapshot([video('aaaaaaaaaaa', '2026-01-01T10:00:00Z')], full), /would be removed/)
  assert.doesNotThrow(() => buildSnapshot([video('aaaaaaaaaaa', '2026-01-01T10:00:00Z')], full, { allowLargeRemoval: true }))
  assert.throws(() => buildSnapshot([], full), /no public videos/)
})

test('the kind of a known video is kept, so a manual correction sticks', () => {
  const previous: YouTubeSnapshot = { channelId: CHANNEL, videos: [{ youtubeId: 'aaaaaaaaaaa', kind: 'episode', slug: 'short-episode', title: 't', description: [], publishedAt: '2026-01-01T10:00:00Z', durationSeconds: 150, hd: false, restricted: false }] }
  const { snapshot } = buildSnapshot([video('aaaaaaaaaaa', '2026-01-01T10:00:00Z', { duration: 'PT2M30S' })], previous)
  assert.equal(snapshot.videos[0].kind, 'episode')
  assert.equal(snapshot.videos[0].slug, 'short-episode')
})

type Reply = { status: number; body?: unknown } | Error
function fakeFetch(replies: Reply[]): FetchLike & { calls: string[] } {
  const calls: string[] = []
  const fn = async (url: string) => {
    calls.push(url)
    const r = replies.shift()
    if (!r) throw new Error('unexpected request')
    if (r instanceof Error) throw r
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body }
  }
  return Object.assign(fn, { calls })
}

test('API failures are retried, then reported; 4xx errors are not retried', async () => {
  const flaky = fakeFetch([new Error('network down'), { status: 503 }, { status: 200, body: { ok: 1 } }])
  assert.deepEqual(await getJson('u', flaky, { retries: 3, baseDelayMs: 1 }), { ok: 1 })
  assert.equal(flaky.calls.length, 3)

  const down = fakeFetch([{ status: 500 }, { status: 500 }, { status: 500 }])
  await assert.rejects(getJson('u', down, { retries: 2, baseDelayMs: 1 }), /500/)

  const quota = fakeFetch([{ status: 403 }])
  await assert.rejects(getJson('u', quota, { retries: 3, baseDelayMs: 1 }), /403/)
  assert.equal(quota.calls.length, 1)
})

test('fetches every page of the uploads playlist, then video details in batches', async () => {
  const fetch = fakeFetch([
    { status: 200, body: { items: [{ contentDetails: { videoId: 'aaaaaaaaaaa' } }, { contentDetails: { videoId: 'bbbbbbbbbbb' } }], nextPageToken: 'p2' } },
    { status: 200, body: { items: [{ contentDetails: { videoId: 'ccccccccccc' } }, { contentDetails: { videoId: 'aaaaaaaaaaa' } }] } },
    // bbbbbbbbbbb was deleted, so YouTube leaves it out of the details.
    { status: 200, body: { items: [video('aaaaaaaaaaa', '2026-01-01T10:00:00Z'), video('ccccccccccc', '2026-02-01T10:00:00Z')] } },
  ])
  const items = await fetchChannelVideos(CHANNEL, 'test-key', fetch, { retries: 0 })
  assert.deepEqual(items.map((v) => v.id), ['aaaaaaaaaaa', 'ccccccccccc'])
  assert.match(fetch.calls[0], new RegExp(`playlistId=${uploadsPlaylistId(CHANNEL)}`))
  assert.match(fetch.calls[1], /pageToken=p2/)
  assert.match(fetch.calls[2], /id=aaaaaaaaaaa%2Cbbbbbbbbbbb%2Cccccccccccc/)
  assert.equal(uploadsPlaylistId(CHANNEL), 'UUD49Bigk35BXat_YPimii0Q')
})
