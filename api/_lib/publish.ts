/**
 * Publishing approved posts to connected accounts with each platform's official API.
 *
 * Safety: publishPost() first claims the post with begin_publish(), which only succeeds
 * for an approved post that isn't already being published. The result is always recorded
 * with finish_publish(). Nothing is retried automatically: a failure is shown to the
 * owners, who check the platform and press Retry. So a post can't go out twice.
 *
 * What each platform supports through its API:
 *   Facebook Page  text, link, image or video posts
 *   Instagram      image or video (Reels) posts; Instagram has no text-only posts
 *   X              text posts (with the link); video posts are published by hand
 *   YouTube        Shorts (video upload); community posts can't be made through the API
 *   TikTok         video posts; until TikTok audits the app they're visible only to the account (SELF_ONLY)
 */
import { fullText, type Platform } from '../../src/lib/social.ts'
import { connection, GRAPH, type Connection } from './oauth.ts'
import { HttpError, rest, rpc } from './server.ts'
import { signedDownloadUrl } from './storage.ts'

type F = typeof fetch

export interface PostToPublish {
  id: string
  platform: Platform
  caption: string
  hashtags: string[]
  link_url: string
  source_title: string
  media_asset_id: string | null
}

interface Media {
  url: string
  mimeType: string
  size: number
  kind: 'image' | 'video'
}

export interface PublishResult {
  url: string
  platformId: string
}

/** Errors the owner can act on. Anything else is shown as the platform's own message. */
export class ManualOnly extends Error {}

async function json(res: Response, what: string) {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || body.error) {
    const err = body.error as { message?: string } | string | undefined
    const detail = typeof err === 'string' ? err : (err?.message ?? (body.detail as string) ?? '')
    throw new Error(`${what} failed (${res.status})${detail ? `: ${String(detail).slice(0, 200)}` : ''}`)
  }
  return body
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function facebook(c: Connection, post: PostToPublish, media: Media | null, f: F = fetch): Promise<PublishResult> {
  const message = fullText(post.caption, post.hashtags)
  const params = new URLSearchParams({ access_token: c.accessToken })
  let endpoint = 'feed'
  if (media?.kind === 'video') {
    endpoint = 'videos'
    params.set('file_url', media.url)
    params.set('description', message)
  } else if (media?.kind === 'image') {
    endpoint = 'photos'
    params.set('url', media.url)
    params.set('caption', message + (post.link_url ? `\n\n${post.link_url}` : ''))
  } else {
    params.set('message', message)
    if (post.link_url) params.set('link', post.link_url)
  }
  const body = await json(await f(`${GRAPH}/${c.accountId}/${endpoint}`, { method: 'POST', body: params, signal: AbortSignal.timeout(50_000) }), 'Facebook')
  const id = String(body.post_id ?? body.id ?? '')
  return { platformId: id, url: id ? `https://www.facebook.com/${id}` : '' }
}

export async function instagram(c: Connection, post: PostToPublish, media: Media | null, f: F = fetch, pollMs = 3000): Promise<PublishResult> {
  if (!media) throw new ManualOnly('Instagram posts need an image or video. Attach one, or post it by hand.')
  const caption = fullText(post.caption, post.hashtags)
  const create = new URLSearchParams({ access_token: c.accessToken, caption })
  if (media.kind === 'video') {
    create.set('media_type', 'REELS')
    create.set('video_url', media.url)
  } else create.set('image_url', media.url)
  const container = await json(await f(`${GRAPH}/${c.accountId}/media`, { method: 'POST', body: create, signal: AbortSignal.timeout(30_000) }), 'Instagram upload')
  const creationId = String(container.id)
  // Instagram processes videos before they can be published.
  for (let i = 0; media.kind === 'video' && i < 15; i++) {
    const status = await json(await f(`${GRAPH}/${creationId}?fields=status_code&access_token=${encodeURIComponent(c.accessToken)}`), 'Instagram status')
    if (status.status_code === 'FINISHED') break
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') throw new Error('Instagram couldn’t process the video. Check its format (MP4, H.264) and length.')
    if (i === 14) throw new Error('Instagram is still processing the video. Check Instagram before retrying, then retry in a few minutes.')
    await wait(pollMs)
  }
  const published = await json(await f(`${GRAPH}/${c.accountId}/media_publish`, { method: 'POST', body: new URLSearchParams({ access_token: c.accessToken, creation_id: creationId }), signal: AbortSignal.timeout(30_000) }), 'Instagram publish')
  const id = String(published.id)
  const info = await f(`${GRAPH}/${id}?fields=permalink&access_token=${encodeURIComponent(c.accessToken)}`).then((r) => r.json() as Promise<{ permalink?: string }>).catch(() => ({}) as { permalink?: string })
  return { platformId: id, url: info.permalink ?? '' }
}

export async function x(c: Connection, post: PostToPublish, media: Media | null, f: F = fetch): Promise<PublishResult> {
  if (media) throw new ManualOnly('Posts with video or images go on X by hand for now. Copy the text, attach the file and post it.')
  const text = [fullText(post.caption, post.hashtags), post.link_url].filter(Boolean).join('\n\n')
  const body = await json(
    await f('https://api.x.com/2/tweets', { method: 'POST', headers: { Authorization: `Bearer ${c.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20_000) }),
    'X',
  )
  const id = String((body.data as { id?: string })?.id ?? '')
  return { platformId: id, url: id ? `https://x.com/i/web/status/${id}` : '' }
}

export async function youtube(c: Connection, post: PostToPublish, media: Media | null, f: F = fetch): Promise<PublishResult> {
  if (media?.kind !== 'video') throw new ManualOnly('YouTube community posts can’t be made through the API. Post this one in YouTube Studio.')
  const title = (post.source_title || post.caption.split('\n')[0] || 'Noisemakers').slice(0, 90)
  const meta = {
    snippet: { title: /#shorts/i.test(title) ? title : `${title.slice(0, 90)} #Shorts`, description: fullText(post.caption, post.hashtags).slice(0, 4900), categoryId: '22' },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
  }
  const start = await f('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.accessToken}`, 'Content-Type': 'application/json', 'X-Upload-Content-Type': media.mimeType || 'video/mp4', 'X-Upload-Content-Length': String(media.size) },
    body: JSON.stringify(meta),
    signal: AbortSignal.timeout(20_000),
  })
  if (!start.ok) await json(start, 'YouTube upload')
  const location = start.headers.get('location')
  if (!location) throw new Error('YouTube didn’t return an upload address')
  const file = await f(media.url, { signal: AbortSignal.timeout(120_000) })
  if (!file.ok || !file.body) throw new Error('Couldn’t read the video from storage')
  const done = await json(
    await f(location, { method: 'PUT', headers: { 'Content-Type': media.mimeType || 'video/mp4', 'Content-Length': String(media.size) }, body: file.body, duplex: 'half', signal: AbortSignal.timeout(240_000) } as RequestInit),
    'YouTube upload',
  )
  const id = String(done.id ?? '')
  return { platformId: id, url: id ? `https://www.youtube.com/shorts/${id}` : '' }
}

export async function tiktok(c: Connection, post: PostToPublish, media: Media | null, f: F = fetch): Promise<PublishResult> {
  if (media?.kind !== 'video') throw new ManualOnly('TikTok posts need a video. Attach a clip, or post it by hand.')
  if (media.size > 64 * 1024 * 1024) throw new ManualOnly('This video is over 64 MB, so post it to TikTok by hand.')
  const auth = { Authorization: `Bearer ${c.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }
  const creator = await json(await f('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', { method: 'POST', headers: auth, body: '{}' }), 'TikTok account check')
  const allowed = ((creator.data as { privacy_level_options?: string[] })?.privacy_level_options ?? []) as string[]
  const wanted = process.env.TIKTOK_PRIVACY || 'SELF_ONLY'
  const privacy = allowed.includes(wanted) ? wanted : allowed.includes('SELF_ONLY') ? 'SELF_ONLY' : allowed[0]
  if (!privacy) throw new Error('TikTok didn’t allow posting from this account')
  const init = await json(
    await f('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        post_info: { title: fullText(post.caption, post.hashtags).slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false },
        source_info: { source: 'FILE_UPLOAD', video_size: media.size, chunk_size: media.size, total_chunk_count: 1 },
      }),
    }),
    'TikTok',
  )
  const { publish_id: publishId, upload_url: uploadUrl } = (init.data ?? {}) as { publish_id?: string; upload_url?: string }
  if (!publishId || !uploadUrl) throw new Error('TikTok didn’t return an upload address')
  const file = await f(media.url, { signal: AbortSignal.timeout(120_000) })
  if (!file.ok) throw new Error('Couldn’t read the video from storage')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const put = await f(uploadUrl, { method: 'PUT', headers: { 'Content-Type': media.mimeType || 'video/mp4', 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes, signal: AbortSignal.timeout(240_000) })
  if (!put.ok) throw new Error(`TikTok upload failed (${put.status})`)
  // TikTok gives no link until the video is processed; the post shows in the TikTok app.
  return { platformId: publishId, url: '' }
}

const ADAPTERS: Record<Platform, (c: Connection, post: PostToPublish, media: Media | null, f?: F) => Promise<PublishResult>> = { facebook, instagram, x, youtube, tiktok }

async function mediaFor(assetId: string | null): Promise<Media | null> {
  if (!assetId) return null
  const [asset] = await rest<{ bucket: string; path: string; mime_type: string; size_bytes: number; status: string }[]>(`media_assets?select=bucket,path,mime_type,size_bytes,status&id=eq.${assetId}`)
  if (!asset || asset.status !== 'ready') throw new Error('The attached file is missing or still uploading')
  return { url: await signedDownloadUrl(asset.bucket, asset.path, 3600), mimeType: asset.mime_type, size: Number(asset.size_bytes), kind: asset.mime_type.startsWith('image/') ? 'image' : 'video' }
}

/**
 * Publishes one approved post. Returns 'skipped' if it wasn't claimable (not approved, already
 * being published or already published). Every attempt ends with finish_publish().
 */
export async function publishPost(postId: string, f: F = fetch): Promise<'published' | 'failed' | 'skipped' | 'manual' | 'not-connected'> {
  // Not connected: leave the post as it is, for the owner to post by hand.
  const [target] = await rest<{ platform: string }[]>(`social_posts?select=platform&id=eq.${postId}`)
  if (!target) return 'skipped'
  if (!(await rest<unknown[]>(`social_connections?select=platform&platform=eq.${target.platform}`)).length) return 'not-connected'
  const claimed = await rpc<PostToPublish[]>('begin_publish', { post_id: postId })
  const post = claimed?.[0]
  if (!post) return 'skipped'
  try {
    const conn = await connection(post.platform, f)
    if (!conn) throw new ManualOnly(`${post.platform} isn’t connected. Post it by hand and mark it as published.`)
    const result = await ADAPTERS[post.platform](conn, post, await mediaFor(post.media_asset_id), f)
    await rpc('finish_publish', { post_id: post.id, ok: true, url: result.url, platform_id: result.platformId, error: '' })
    return 'published'
  } catch (error) {
    const message = error instanceof HttpError ? (error.code === 'account-expired' ? 'The account’s sign-in has expired. Connect it again in Accounts.' : error.code) : error instanceof Error ? error.message : 'Unknown error'
    await rpc('finish_publish', { post_id: post.id, ok: false, url: '', platform_id: '', error: message })
    return error instanceof ManualOnly ? 'manual' : 'failed'
  }
}

/** Publishes every scheduled post whose time has come. One at a time, so a failure doesn't stop the rest. */
export async function publishDue(f: F = fetch): Promise<{ counts: Record<string, number>; waiting: { id: string; platform: string }[] }> {
  const due = await rest<{ id: string; platform: string }[]>(`social_posts?select=id,platform&status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(new Date().toISOString())}&publish_started_at=is.null&order=scheduled_at&limit=20`)
  const connected = await rest<{ platform: string }[]>('social_connections?select=platform')
  const can = new Set(connected.map((c) => c.platform))
  const counts: Record<string, number> = { published: 0, failed: 0, skipped: 0, manual: 0, 'not-connected': 0 }
  // Posts for platforms that aren't connected stay scheduled: the owner posts them by hand on the day.
  const waiting = due.filter((p) => !can.has(p.platform))
  for (const p of due) if (can.has(p.platform)) counts[await publishPost(p.id, f)]++
  return { counts, waiting }
}
