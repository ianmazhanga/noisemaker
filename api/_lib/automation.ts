/**
 * Scheduled work, run by api/cron/[job].ts. Every task is safe to run twice: records are
 * matched by their natural keys (video ID, link, date), and runs are guarded by the jobs
 * table so overlapping schedules don't do the same work at once.
 *
 *   tick    every 15 min  scheduled posts, articles and newsletters; stuck publishing; email alerts
 *   hourly  every hour    YouTube sync (Automation A), news discovery, subscriber sync
 *   daily   once a day    analytics snapshots, connection expiry checks, file retention, weekly newsletter (Automation E)
 */
import { fetchChannelVideos, cleanTitle, parseIsoDuration, SHORT_MAX_SECONDS } from '../../scripts/lib/youtube-sync.ts'
import { clusterKey, matchTopics, parseFeed, sameStory, urlKey } from '../../src/lib/rss.ts'
import { PLATFORMS, type Platform } from '../../src/lib/social.ts'
import { instructions, sanitise } from '../ai/social-drafts.ts'
import { chatJson } from './ai.ts'
import { emailConfigured, sendAlertEmail } from './email.ts'
import { addPending, mailchimpConfigured, memberStatus, report, sendNow, upsertCampaign, audienceStats } from './mailchimp.ts'
import { draftNewsletter } from './newsletter-draft.ts'
import { GRAPH, connection } from './oauth.ts'
import { publishDue } from './publish.ts'
import { integration, notify, rest, rpc, settings, siteUrl, type Settings } from './server.ts'
import { removeObjects } from './storage.ts'

const CHANNEL_ID = 'UCD49Bigk35BXat_YPimii0Q'
type Result = Record<string, unknown>

/** Runs `work` unless the same named run is already going (or done) for this time slot. */
export async function guarded(name: string, slot: string, work: () => Promise<Result>): Promise<Result> {
  const key = `cron:${name}:${slot}`
  const inserted = await rest<{ id: string }[]>('jobs?on_conflict=idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify({ kind: 'automation', status: 'running', idempotency_key: key, payload: { name }, started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), attempts: 1 }),
  }).catch(async (error: { status?: number }) => {
    if (error.status === 409) return [] as { id: string }[]
    throw error
  })
  const job = inserted?.[0]
  if (!job) return { skipped: 'already ran for this slot' }
  try {
    const result = await work()
    await rest(`jobs?id=eq.${job.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'succeeded', result, progress: 100, finished_at: new Date().toISOString() }) })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed'
    await rest(`jobs?id=eq.${job.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', error: message.slice(0, 500), finished_at: new Date().toISOString() }) })
    await notify('job.failed', `Background task failed: ${name}`, '/admin/settings?tab=integrations', 'owner', `job.failed:${key}`)
    throw error
  }
}

/** Runs each step even if an earlier one failed, and reports what happened. */
async function steps(list: Record<string, () => Promise<unknown>>): Promise<Result> {
  const out: Result = {}
  for (const [name, run] of Object.entries(list)) {
    try {
      out[name] = await run()
    } catch (error) {
      out[name] = { error: error instanceof Error ? error.message : 'failed' }
      console.error(`${name}: ${error instanceof Error ? error.message : 'failed'}`)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Every 15 minutes
// ---------------------------------------------------------------------------

export const tick = () =>
  steps({
    stuckPublishing: () => rpc('expire_stuck_publishing'),
    posts: async () => {
      const { counts, waiting } = await publishDue()
      // Scheduled posts for accounts that aren't connected: remind the owners to post them by hand.
      for (const p of waiting) await notify('post.due', `Time to post by hand: ${PLATFORMS[p.platform as Platform]?.label ?? p.platform}`, `/admin/social?status=scheduled&open=${p.id}`, 'owner', `post.due:${p.id}`)
      return { ...counts, waitingForManualPosting: waiting.length }
    },
    articles: () => rpc('publish_due_articles'),
    newsletters: sendDueNewsletters,
    alerts: emailAlerts,
  })

export async function sendDueNewsletters() {
  const due = await rest<{ id: string }[]>(`newsletter_campaigns?select=id&status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(new Date().toISOString())}&limit=5`)
  let sent = 0
  for (const c of due) if ((await sendCampaign(c.id)) === 'sent') sent++
  return { due: due.length, sent }
}

/**
 * Sends an approved (or due scheduled) newsletter through Mailchimp. The status moves to
 * "sending" first, and only from approved/scheduled, so the same newsletter is never sent twice.
 */
export async function sendCampaign(id: string): Promise<'sent' | 'skipped' | 'failed'> {
  const claimed = await rest<{ id: string; subject: string; preheader: string; intro: string; blocks: unknown; provider_campaign_id: string }[]>(
    `newsletter_campaigns?id=eq.${id}&status=in.(approved,scheduled)&approved_by=not.is.null`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'sending', error_message: '' }) },
  )
  const c = claimed[0]
  if (!c) return 'skipped'
  try {
    const s = await settings()
    const providerId = await upsertCampaign({ subject: c.subject, preheader: c.preheader, intro: c.intro, blocks: c.blocks as never, providerId: c.provider_campaign_id, fromName: s.newsletter_from_name, replyTo: s.newsletter_reply_to }, siteUrl())
    await rest(`newsletter_campaigns?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ provider_campaign_id: providerId }) })
    await sendNow(providerId)
    await rest(`newsletter_campaigns?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString() }) })
    await integration('mailchimp', { ok: true })
    return 'sent'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sending failed'
    await rest(`newsletter_campaigns?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', error_message: message.slice(0, 500) }) })
    await notify('job.failed', `Newsletter failed to send: ${c.subject}`, `/admin/newsletter?open=${id}`, 'owner', `newsletter.failed:${id}:${Date.now()}`)
    await integration('mailchimp', { ok: false, error: message })
    return 'failed'
  }
}

/** Emails unread, unmuted notifications to people who turned email alerts on. Each is emailed once. */
export async function emailAlerts() {
  if (!emailConfigured()) return { skipped: 'email not configured' }
  const prefs = await rest<{ user_id: string; muted_kinds: string[] }[]>('notification_preferences?select=user_id,muted_kinds&email_enabled=eq.true')
  if (!prefs.length) return { sent: 0 }
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString()
  const notes = await rest<{ id: string; kind: string; title: string; link: string; audience: string }[]>(`notifications?select=id,kind,title,link,audience&created_at=gte.${encodeURIComponent(since)}&order=created_at&limit=200`)
  let sent = 0
  for (const pref of prefs) {
    const [profile] = await rest<{ email: string; role: string | null; can_view_stories: boolean }[]>(`profiles?select=email,role,can_view_stories&id=eq.${pref.user_id}`)
    if (!profile?.role || !profile.email) continue
    const sees = (a: string) => (a === 'owner' ? profile.role === 'owner' : a === 'stories' ? profile.role === 'owner' || (profile.role !== 'viewer' && profile.can_view_stories) : true)
    const done = new Set((await rest<{ notification_id: string }[]>(`notification_emails?select=notification_id&user_id=eq.${pref.user_id}&sent_at=gte.${encodeURIComponent(since)}`)).map((r) => r.notification_id))
    const read = new Set((await rest<{ notification_id: string }[]>(`notification_reads?select=notification_id&user_id=eq.${pref.user_id}`)).map((r) => r.notification_id))
    const items = notes.filter((n) => sees(n.audience) && !pref.muted_kinds.includes(n.kind) && !done.has(n.id) && !read.has(n.id))
    if (!items.length) continue
    // Record first, so a crash after sending can't cause a second email.
    await rest('notification_emails?on_conflict=notification_id,user_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(items.map((n) => ({ notification_id: n.id, user_id: pref.user_id }))) })
    try {
      await sendAlertEmail(profile.email, items.slice(0, 20), siteUrl())
      sent++
      await integration('email', { ok: true })
    } catch (error) {
      await integration('email', { ok: false, error: error instanceof Error ? error.message : 'failed' })
    }
  }
  return { sent }
}

// ---------------------------------------------------------------------------
// Every hour
// ---------------------------------------------------------------------------

export const hourly = () => steps({ youtube: syncYouTube, news: fetchNews, subscribers: syncSubscribers })

/** Automation A: new videos are saved, the team is told, and (if AI automation is on) caption drafts are queued for approval. */
export async function syncYouTube(fetchImpl: typeof fetch = fetch) {
  const key = process.env.YOUTUBE_API_KEY ?? ''
  if (!key) return { skipped: 'YOUTUBE_API_KEY not set' }
  try {
    const items = await fetchChannelVideos(CHANNEL_ID, key, fetchImpl as never, { retries: 2, baseDelayMs: 500 }, 'snippet,contentDetails,status,statistics')
    const now = new Date().toISOString()
    const rows = items
      .filter((v) => v.status?.privacyStatus === 'public' && v.snippet?.liveBroadcastContent !== 'upcoming')
      .map((v) => {
        const duration = parseIsoDuration(v.contentDetails?.duration)
        const thumbs = (v.snippet?.thumbnails ?? {}) as Record<string, { url?: string }>
        return {
          youtube_id: v.id,
          title: cleanTitle(v.snippet?.title ?? '') || 'Untitled video',
          description: (v.snippet?.description ?? '').slice(0, 10_000),
          published_at: v.snippet?.publishedAt ?? null,
          duration_seconds: duration,
          kind: duration && duration <= SHORT_MAX_SECONDS ? 'short' : 'episode',
          thumbnail_url: thumbs.maxres?.url ?? thumbs.high?.url ?? thumbs.medium?.url ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
          privacy: 'public',
          view_count: v.statistics?.viewCount ? Number(v.statistics.viewCount) : null,
          like_count: v.statistics?.likeCount ? Number(v.statistics.likeCount) : null,
          comment_count: v.statistics?.commentCount ? Number(v.statistics.commentCount) : null,
          synced_at: now,
        }
      })
    const known = new Set((await rest<{ youtube_id: string }[]>('youtube_videos?select=youtube_id&limit=10000')).map((r) => r.youtube_id))
    if (rows.length) await rest('youtube_videos?on_conflict=youtube_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) })
    // On the very first sync every video is "new"; only announce videos published in the last week.
    const fresh = rows.filter((r) => !known.has(r.youtube_id) && r.published_at && Date.parse(r.published_at) > Date.now() - 7 * 86_400_000)
    const s = await settings()
    for (const v of fresh) await newVideoAutomation(v, s)
    for (const v of rows) {
      if (v.view_count !== null) await snapshot('youtube', 'views', v.youtube_id, v.view_count)
      if (v.like_count !== null) await snapshot('youtube', 'likes', v.youtube_id, v.like_count)
      if (v.comment_count !== null) await snapshot('youtube', 'comments', v.youtube_id, v.comment_count)
    }
    await integration('youtube_data', { ok: true, sync: true, details: { videos: rows.length } })
    return { videos: rows.length, new: fresh.length }
  } catch (error) {
    await integration('youtube_data', { ok: false, error: error instanceof Error ? error.message : 'failed' })
    throw error
  }
}

async function newVideoAutomation(v: { youtube_id: string; title: string; description: string; kind: string }, s: Settings) {
  // Claim the video so the automation runs once even if two syncs overlap.
  const claimed = await rest<unknown[]>(`youtube_videos?youtube_id=eq.${v.youtube_id}&automation_at=is.null`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ automation_at: new Date().toISOString() }) })
  if (!claimed.length) return
  let drafts = 0
  if (s.auto_ai_enabled && process.env.OPENAI_API_KEY) {
    try {
      const platforms: Platform[] = v.kind === 'short' ? ['instagram', 'tiktok', 'facebook'] : ['instagram', 'facebook', 'x']
      const source = `Title: ${v.title}\n\n${v.description.slice(0, 6000)}`
      const raw = await chatJson({ feature: 'auto-youtube-drafts', userId: null, system: instructions(platforms, 1), user: `SOURCE:\n${source}`, temperature: 0.7 })
      const url = v.kind === 'short' ? `https://www.youtube.com/shorts/${v.youtube_id}` : `https://www.youtube.com/watch?v=${v.youtube_id}`
      const posts = sanitise(raw, platforms, source).drafts.map((d) => ({
        platform: d.platform,
        caption: d.caption,
        hashtags: d.hashtags,
        link_url: d.platform === 'instagram' || d.platform === 'tiktok' ? '' : url,
        source_type: 'youtube',
        source_ref: v.youtube_id,
        source_title: v.title,
        ai_generated: true,
        status: 'pending_approval',
        submitted_at: new Date().toISOString(),
      }))
      if (posts.length) await rest('social_posts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(posts) })
      drafts = posts.length
    } catch (error) {
      console.error(`new video drafts: ${error instanceof Error ? error.message : 'failed'}`)
    }
  }
  const what = drafts ? `${drafts} AI caption drafts are waiting for approval` : 'create posts and Shorts for it'
  await notify('youtube.new', `New on YouTube: ${v.title.slice(0, 90)}. ${what}`, drafts ? '/admin/social?status=pending_approval' : `/admin/youtube?open=${v.youtube_id}`, 'staff', `youtube.new:${v.youtube_id}`)
}

/** Reads each enabled news source and saves new stories, marking repeats of stories already found. */
export async function fetchNews(fetchImpl: typeof fetch = fetch) {
  const sources = await rest<{ id: string; name: string; feed_url: string; topics: string[] }[]>('news_sources?select=id,name,feed_url,topics&enabled=eq.true')
  if (!sources.length) return { sources: 0 }
  const s = await settings()
  const recent = await rest<{ id: string; title: string; cluster_key: string }[]>(`news_items?select=id,title,cluster_key&fetched_at=gte.${encodeURIComponent(new Date(Date.now() - 14 * 86_400_000).toISOString())}&duplicate_of=is.null&limit=2000`)
  let added = 0
  let failed = 0
  for (const src of sources) {
    const now = new Date().toISOString()
    try {
      const res = await fetchImpl(src.feed_url, { headers: { 'User-Agent': 'NoisemakersNewsBot/1.0 (+https://noisemakersnews.com)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(10_000), redirect: 'follow' })
      if (!res.ok) throw new Error(`The feed answered ${res.status}`)
      const xml = (await res.text()).slice(0, 3_000_000)
      const items = parseFeed(xml).slice(0, 50)
      if (!items.length && !/<(rss|feed|rdf)/i.test(xml)) throw new Error('This address isn’t an RSS or Atom feed')
      const topics = [...new Set([...s.news_topics, ...src.topics])]
      const rows = items.map((i) => {
        const key = clusterKey(i.title)
        const dup = recent.find((r) => r.cluster_key === key || sameStory(r.title, i.title))
        return { source_id: src.id, url: i.url, url_key: urlKey(i.url), title: i.title, excerpt: i.excerpt, published_at: i.publishedAt, matched_topics: matchTopics(`${i.title} ${i.excerpt}`, topics), cluster_key: key, duplicate_of: dup?.id ?? null }
      })
      if (rows.length) {
        const saved = await rest<{ id: string; title: string; cluster_key: string }[]>('news_items?on_conflict=url_key&select=id,title,cluster_key', {
          method: 'POST',
          headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
          body: JSON.stringify(rows),
        })
        added += saved.length
        recent.push(...saved)
      }
      await rest(`news_sources?id=eq.${src.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_fetched_at: now, last_success_at: now, last_error: '' }) })
    } catch (error) {
      failed++
      await rest(`news_sources?id=eq.${src.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_fetched_at: now, last_error: (error instanceof Error ? error.message : 'failed').slice(0, 300) }) })
    }
  }
  await integration('news_feeds', failed === sources.length ? { ok: false, error: 'No news source could be read' } : { ok: true, sync: true, details: { sources: sources.length, failed } })
  return { sources: sources.length, added, failed }
}

/** Sends new sign-ups to Mailchimp (which emails them a confirmation link) and brings back confirmations and unsubscribes. */
export async function syncSubscribers() {
  if (!mailchimpConfigured()) return { skipped: 'Mailchimp not configured' }
  const fresh = await rest<{ id: string; email: string }[]>('newsletter_subscribers?select=id,email&status=eq.pending&provider_synced_at=is.null&limit=100')
  for (const sub of fresh) {
    try {
      const m = await addPending(sub.email)
      const patch: Record<string, unknown> = { provider_synced_at: new Date().toISOString() }
      if (m.status === 'subscribed') Object.assign(patch, { status: 'subscribed', confirmed_at: new Date().toISOString() })
      await rest(`newsletter_subscribers?id=eq.${sub.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) })
    } catch (error) {
      await integration('mailchimp', { ok: false, error: error instanceof Error ? error.message : 'failed' })
      throw error
    }
  }
  // Pending people who have since confirmed (or never will: after 30 days they're left as they are).
  const waiting = await rest<{ id: string; email: string }[]>(`newsletter_subscribers?select=id,email&status=eq.pending&provider_synced_at=not.is.null&created_at=gte.${encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString())}&limit=100`)
  let confirmed = 0
  for (const sub of waiting) {
    const status = await memberStatus(sub.email)
    if (status && status !== 'pending' && ['subscribed', 'unsubscribed', 'cleaned'].includes(status)) {
      await rest(`newsletter_subscribers?id=eq.${sub.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status, ...(status === 'subscribed' ? { confirmed_at: new Date().toISOString() } : { unsubscribed_at: new Date().toISOString() }) }) })
      if (status === 'subscribed') confirmed++
    }
  }
  await integration('mailchimp', { ok: true, sync: true })
  return { sent: fresh.length, confirmed }
}

// ---------------------------------------------------------------------------
// Once a day
// ---------------------------------------------------------------------------

export const daily = () => steps({ analytics: analyticsSnapshot, connections: checkConnections, retention: cleanUpFiles, weeklyNewsletter, campaignReports })

/** Saves one number per metric per day, exactly as each service reported it. */
async function snapshot(source: string, metric: string, subject: string, value: number) {
  if (!Number.isFinite(value)) return
  await rest('analytics_snapshots?on_conflict=source,metric,subject,captured_on', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ source, metric, subject, value, captured_on: new Date().toISOString().slice(0, 10), captured_at: new Date().toISOString() }),
  })
}

export async function analyticsSnapshot(fetchImpl: typeof fetch = fetch) {
  const done: string[] = []
  const attempt = async (name: string, run: () => Promise<void>) => {
    try {
      await run()
      done.push(name)
    } catch (error) {
      await integration(name, { ok: false, error: error instanceof Error ? error.message : 'failed' })
    }
  }
  const count = async (path: string) => {
    const { url, key } = { url: (process.env.SUPABASE_URL ?? '').replace(/\/+$/, ''), key: process.env.SUPABASE_SECRET_KEY ?? '' }
    const headers: Record<string, string> = { apikey: key, Prefer: 'count=exact' }
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`
    const res = await fetchImpl(`${url}/rest/v1/${path}`, { method: 'HEAD', headers })
    return Number(res.headers.get('content-range')?.split('/')[1] ?? NaN)
  }

  await attempt('stories', async () => {
    await snapshot('stories', 'total', 'all', await count('story_submissions?select=id'))
  })
  await attempt('newsletter', async () => {
    await snapshot('newsletter', 'subscribers', 'all', await count('newsletter_subscribers?select=id&status=eq.subscribed'))
    if (mailchimpConfigured()) {
      const stats = await audienceStats(fetchImpl)
      if (typeof stats.member_count === 'number') await snapshot('newsletter', 'mailchimp_members', 'all', stats.member_count)
    }
  })
  await attempt('youtube_data', async () => {
    const key = process.env.YOUTUBE_API_KEY
    if (!key) return
    const res = await fetchImpl(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${CHANNEL_ID}&key=${encodeURIComponent(key)}`)
    if (!res.ok) throw new Error(`YouTube answered ${res.status}`)
    const st = ((await res.json()) as { items?: { statistics?: { viewCount?: string; subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string } }[] }).items?.[0]?.statistics
    if (st?.viewCount) await snapshot('youtube', 'views', 'channel', Number(st.viewCount))
    if (st?.subscriberCount && !st.hiddenSubscriberCount) await snapshot('youtube', 'subscribers', 'channel', Number(st.subscriberCount))
    if (st?.videoCount) await snapshot('youtube', 'videos', 'channel', Number(st.videoCount))
  })
  await attempt('youtube_analytics', async () => {
    const c = await connection('youtube', fetchImpl).catch(() => null)
    if (!c) return
    const end = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
    const params = new URLSearchParams({ ids: 'channel==MINE', startDate: end, endDate: end, metrics: 'views,estimatedMinutesWatched,subscribersGained,likes,comments,shares' })
    const res = await fetchImpl(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, { headers: { Authorization: `Bearer ${c.accessToken}` } })
    if (!res.ok) throw new Error(`YouTube Analytics answered ${res.status}`)
    const r = (await res.json()) as { columnHeaders?: { name: string }[]; rows?: number[][] }
    const row = r.rows?.[0]
    if (row) for (const [i, h] of (r.columnHeaders ?? []).entries()) await snapshot('youtube', `daily_${h.name}`, end, row[i])
    await integration('youtube_analytics', { ok: true, sync: true })
  })
  await attempt('facebook', async () => {
    const c = await connection('facebook', fetchImpl).catch(() => null)
    if (!c) return
    const res = await fetchImpl(`${GRAPH}/${c.accountId}?fields=followers_count,fan_count&access_token=${encodeURIComponent(c.accessToken)}`)
    if (!res.ok) throw new Error(`Facebook answered ${res.status}`)
    const p = (await res.json()) as { followers_count?: number; fan_count?: number }
    if (typeof p.followers_count === 'number') await snapshot('facebook', 'followers', 'channel', p.followers_count)
    if (typeof p.fan_count === 'number') await snapshot('facebook', 'page_likes', 'channel', p.fan_count)
    await integration('facebook', { ok: true, sync: true })
  })
  await attempt('instagram', async () => {
    const c = await connection('instagram', fetchImpl).catch(() => null)
    if (!c) return
    const res = await fetchImpl(`${GRAPH}/${c.accountId}?fields=followers_count,media_count&access_token=${encodeURIComponent(c.accessToken)}`)
    if (!res.ok) throw new Error(`Instagram answered ${res.status}`)
    const p = (await res.json()) as { followers_count?: number; media_count?: number }
    if (typeof p.followers_count === 'number') await snapshot('instagram', 'followers', 'channel', p.followers_count)
    if (typeof p.media_count === 'number') await snapshot('instagram', 'posts', 'channel', p.media_count)
    await integration('instagram', { ok: true, sync: true })
  })
  await attempt('x', async () => {
    const c = await connection('x', fetchImpl).catch(() => null)
    if (!c) return
    const res = await fetchImpl('https://api.x.com/2/users/me?user.fields=public_metrics', { headers: { Authorization: `Bearer ${c.accessToken}` } })
    if (!res.ok) throw new Error(`X answered ${res.status}`)
    const m = ((await res.json()) as { data?: { public_metrics?: { followers_count?: number; tweet_count?: number } } }).data?.public_metrics
    if (typeof m?.followers_count === 'number') await snapshot('x', 'followers', 'channel', m.followers_count)
    if (typeof m?.tweet_count === 'number') await snapshot('x', 'posts', 'channel', m.tweet_count)
    await integration('x', { ok: true, sync: true })
  })
  await attempt('tiktok', async () => {
    const c = await connection('tiktok', fetchImpl).catch(() => null)
    if (!c) return
    const res = await fetchImpl('https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count', { headers: { Authorization: `Bearer ${c.accessToken}` } })
    if (!res.ok) throw new Error(`TikTok answered ${res.status}`)
    const u = ((await res.json()) as { data?: { user?: { follower_count?: number; likes_count?: number; video_count?: number } } }).data?.user
    if (typeof u?.follower_count === 'number') await snapshot('tiktok', 'followers', 'channel', u.follower_count)
    if (typeof u?.likes_count === 'number') await snapshot('tiktok', 'likes', 'channel', u.likes_count)
    if (typeof u?.video_count === 'number') await snapshot('tiktok', 'posts', 'channel', u.video_count)
    await integration('tiktok', { ok: true, sync: true })
  })
  return { saved: done }
}

/** Warns the owners a week before a connection's sign-in expires, and when it has. */
export async function checkConnections() {
  const accounts = await rest<{ platform: string; status: string; expires_at: string | null }[]>('social_accounts?select=platform,status,expires_at&status=in.(connected,expired)')
  let warned = 0
  for (const a of accounts) {
    const expired = a.status === 'expired' || (a.expires_at && Date.parse(a.expires_at) < Date.now())
    const soon = a.expires_at && Date.parse(a.expires_at) < Date.now() + 7 * 86_400_000
    if (!expired && !soon) continue
    if (expired && a.status !== 'expired') await rest(`social_accounts?platform=eq.${a.platform}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'expired' }) })
    const label = PLATFORMS[a.platform as Platform]?.label ?? a.platform
    await notify('account.expired', expired ? `${label} connection has expired: connect it again` : `${label} connection expires soon: connect it again`, '/admin/social?tab=accounts', 'owner', `account.expired:${a.platform}:${expired ? 'now' : a.expires_at?.slice(0, 10)}`)
    warned++
  }
  await rest(`oauth_states?created_at=lt.${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
  return { warned }
}

/** Deletes original recordings and renders older than the retention settings (0 = keep forever), plus files marked for deletion. */
export async function cleanUpFiles() {
  const s = await settings()
  const now = Date.now()
  const old = async (kinds: string, days: number) =>
    days > 0 ? rest<{ id: string; bucket: string; path: string }[]>(`media_assets?select=id,bucket,path&status=eq.ready&kind=in.(${kinds})&created_at=lt.${encodeURIComponent(new Date(now - days * 86_400_000).toISOString())}&limit=200`) : []
  const marked = await rest<{ id: string; bucket: string; path: string }[]>(`media_assets?select=id,bucket,path&status=neq.deleted&delete_after=lt.${encodeURIComponent(new Date(now).toISOString())}&limit=200`)
  // Clips already sent to social media keep their final render, so scheduled posts still have their video.
  const inUse = new Set((await rest<{ media_asset_id: string }[]>('social_posts?select=media_asset_id&media_asset_id=not.is.null&status=in.(pending_approval,approved,scheduled,failed)')).map((r) => r.media_asset_id))
  const list = [...(await old('source_video', s.source_retention_days)), ...(await old('clip_preview,clip_final', s.render_retention_days)), ...marked].filter((a) => !inUse.has(a.id))
  // Uploads that never finished.
  const abandoned = await rest<{ id: string; bucket: string; path: string }[]>(`media_assets?select=id,bucket,path&status=eq.pending_upload&created_at=lt.${encodeURIComponent(new Date(now - 86_400_000).toISOString())}&limit=200`)
  const all = [...list, ...abandoned]
  for (const bucket of new Set(all.map((a) => a.bucket))) await removeObjects(bucket, all.filter((a) => a.bucket === bucket).map((a) => a.path))
  for (const a of all) await rest(`media_assets?id=eq.${a.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'deleted', deleted_at: new Date().toISOString() }) })
  return { deleted: all.length }
}

/** Automation E: on Mondays (South African time), a newsletter draft from the past week's approved content. Never sent automatically. */
export async function weeklyNewsletter(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Johannesburg', weekday: 'short' }).format(now)
  if (day !== 'Mon') return { skipped: 'not Monday' }
  const week = now.toISOString().slice(0, 10)
  const existing = await rest<unknown[]>(`jobs?select=id&idempotency_key=eq.${encodeURIComponent(`weekly-newsletter:${week}`)}`)
  if (existing.length) return { skipped: 'already drafted' }
  await rest('jobs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ kind: 'weekly_newsletter', status: 'succeeded', idempotency_key: `weekly-newsletter:${week}`, finished_at: now.toISOString() }) })
  const s = await settings()
  const draft = await draftNewsletter({ userId: null, useAi: s.auto_ai_enabled && Boolean(process.env.OPENAI_API_KEY) })
  const [row] = await rest<{ id: string }[]>('newsletter_campaigns', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ subject: draft.subject, preheader: draft.preheader, intro: draft.intro, blocks: draft.blocks, ai_generated: draft.ai, timezone: s.default_timezone }),
  })
  await notify('newsletter.draft', 'The weekly newsletter draft is ready to review', `/admin/newsletter?open=${row?.id ?? ''}`, 'staff', `newsletter.draft:${week}`)
  return { drafted: row?.id }
}

/** Opens, clicks and unsubscribes for newsletters sent in the last 30 days, from Mailchimp's reports. */
export async function campaignReports() {
  if (!mailchimpConfigured()) return { skipped: 'Mailchimp not configured' }
  const sent = await rest<{ id: string; provider_campaign_id: string }[]>(`newsletter_campaigns?select=id,provider_campaign_id&status=eq.sent&provider_campaign_id=neq.&sent_at=gte.${encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString())}`)
  for (const c of sent) {
    const r = await report(c.provider_campaign_id)
    if (r) await rest(`newsletter_campaigns?id=eq.${c.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ stats: r }) })
  }
  return { updated: sent.length }
}
