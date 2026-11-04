import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupPosts, hashtagsFrom, isVideoFile, outcomeOf, videoPosting, videoType } from '../src/lib/posting.ts'

test('only connected accounts that support video post automatically', () => {
  assert.equal(videoPosting('instagram', undefined).auto, false)
  assert.equal(videoPosting('instagram', { platform: 'instagram', status: 'not_connected' }).auto, false)
  assert.equal(videoPosting('facebook', { platform: 'facebook', status: 'expired' }).auto, false)
  assert.match(videoPosting('tiktok', { platform: 'tiktok', status: 'error', last_error: 'Missing permission' }).reason, /Missing permission/)
  assert.equal(videoPosting('instagram', { platform: 'instagram', status: 'connected' }).auto, true)
  assert.equal(videoPosting('youtube', { platform: 'youtube', status: 'connected' }).auto, true)
  assert.equal(videoPosting('x', { platform: 'x', status: 'connected' }).auto, false, 'X video posts are manual')
  assert.match(videoPosting('tiktok', { platform: 'tiktok', status: 'connected' }).reason, /visible only to your account/)
})

test('a post only counts as published when it really was', () => {
  const now = Date.parse('2026-11-05T12:00:00Z')
  assert.equal(outcomeOf({ status: 'published', scheduled_at: null }, true, now), 'published')
  assert.equal(outcomeOf({ status: 'approved', scheduled_at: null }, false, now), 'manual')
  assert.equal(outcomeOf({ status: 'scheduled', scheduled_at: '2026-11-06T09:00:00Z' }, false, now), 'scheduled')
  assert.equal(outcomeOf({ status: 'scheduled', scheduled_at: '2026-11-05T09:00:00Z' }, false, now), 'manual', 'time passed and nothing can post it')
  assert.equal(outcomeOf({ status: 'scheduled', scheduled_at: '2026-11-05T09:00:00Z' }, true, now), 'scheduled')
  assert.equal(outcomeOf({ status: 'approved', scheduled_at: null, publish_started_at: '2026-11-05T11:59:00Z' }, true, now), 'publishing')
  assert.equal(outcomeOf({ status: 'failed', scheduled_at: null }, true, now), 'failed')
  assert.equal(outcomeOf({ status: 'pending_approval', scheduled_at: null }, true, now), 'waiting_approval')
})

test('hashtags are tidied', () => {
  assert.deepEqual(hashtagsFrom('#Family faith, #family  #Hope!'), ['Family', 'faith', 'Hope'])
})

test('CapCut exports are accepted; other files are not', () => {
  assert.ok(isVideoFile({ type: 'video/mp4', name: 'a.mp4' }))
  assert.ok(isVideoFile({ type: '', name: 'Clip.MOV' }))
  assert.ok(!isVideoFile({ type: 'image/png', name: 'a.png' }))
  assert.equal(videoType({ type: '', name: 'Clip.MOV' }), 'video/quicktime')
})

test('one video’s posts are grouped together', () => {
  const p = (ref: string, created: string, media: string | null = 'm1', type = 'manual') => ({ source_ref: ref, source_type: type, media_asset_id: media, created_at: created })
  const groups = groupPosts([p('video-post:a', '2026-11-01'), p('video-post:a', '2026-11-01'), p('video-post:b', '2026-11-03'), p('x', '2026-11-04'), p('video-post:c', '2026-11-04', null), p('video-post:d', '2026-11-04', 'm', 'youtube')])
  assert.deepEqual(groups.map((g) => [g.id, g.posts.length]), [['video-post:b', 1], ['video-post:a', 2]])
})
