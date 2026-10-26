/**
 * Connecting social media accounts with each platform's official OAuth sign-in. The owner
 * signs in on the platform's own page; no passwords ever pass through this site. Tokens
 * are encrypted (crypto.ts) and stored where no dashboard account can read them.
 *
 * Each platform needs a developer app. Environment variables:
 *   Facebook + Instagram  META_APP_ID, META_APP_SECRET            (one sign-in connects both)
 *   X                     X_CLIENT_ID, X_CLIENT_SECRET
 *   YouTube               GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   TikTok                TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
 * Redirect URL to register with every app: <site>/api/oauth/callback
 */
import type { Platform } from '../../src/lib/social.ts'
import { decrypt, encrypt, pkceChallenge } from './crypto.ts'
import { HttpError, rest } from './server.ts'

export type Provider = 'meta' | 'x' | 'google' | 'tiktok'

export const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}`

export const PROVIDER_OF: Record<Platform, Provider> = { facebook: 'meta', instagram: 'meta', x: 'x', youtube: 'google', tiktok: 'tiktok' }

const ENV: Record<Provider, [string, string]> = {
  meta: ['META_APP_ID', 'META_APP_SECRET'],
  x: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
}

export const providerConfigured = (p: Provider) => ENV[p].every((name) => Boolean(process.env[name]))
export const missingEnv = (p: Provider) => ENV[p].filter((name) => !process.env[name])

function credentials(p: Provider) {
  if (!providerConfigured(p)) throw new HttpError(503, 'provider-not-configured', { missing: missingEnv(p) })
  return { id: process.env[ENV[p][0]]!, secret: process.env[ENV[p][1]]! }
}

const SCOPES: Record<Provider, string> = {
  meta: 'pages_show_list,pages_read_engagement,pages_manage_posts,read_insights,instagram_basic,instagram_content_publish,instagram_manage_insights,business_management',
  x: 'tweet.read tweet.write users.read offline.access',
  google: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.upload',
  tiktok: 'user.info.basic,user.info.stats,video.list,video.upload,video.publish',
}

/** The platform sign-in page to send the owner to. */
export function authorizeUrl(p: Provider, state: string, verifier: string, redirectUri: string): string {
  const { id } = credentials(p)
  const challenge = pkceChallenge(verifier)
  switch (p) {
    case 'meta':
      return `https://www.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}/dialog/oauth?${new URLSearchParams({ client_id: id, redirect_uri: redirectUri, state, scope: SCOPES.meta, response_type: 'code' })}`
    case 'x':
      return `https://x.com/i/oauth2/authorize?${new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: redirectUri, scope: SCOPES.x, state, code_challenge: challenge, code_challenge_method: 'S256' })}`
    case 'google':
      return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.google, state, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', code_challenge: challenge, code_challenge_method: 'S256' })}`
    case 'tiktok':
      return `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({ client_key: id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.tiktok, state, code_challenge: challenge, code_challenge_method: 'S256' })}`
  }
}

/** What gets saved for each connected platform. */
export interface NewConnection {
  platform: Platform
  provider: Provider
  external_account_id: string
  account_name: string
  profile_url: string
  access_token: string
  refresh_token: string
  expires_at: string | null
  scopes: string[]
  meta: Record<string, unknown>
}

type F = typeof fetch

async function form(fetchImpl: F, url: string, params: Record<string, string>, basic?: { id: string; secret: string }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (basic) headers.Authorization = `Basic ${Buffer.from(`${basic.id}:${basic.secret}`).toString('base64')}`
  const res = await fetchImpl(url, { method: 'POST', headers, body: new URLSearchParams(params), signal: AbortSignal.timeout(15_000) })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || body.error) throw new Error(`Token exchange failed (${res.status}${typeof body.error === 'string' ? `: ${body.error}` : ''})`)
  return body
}

async function getJson(fetchImpl: F, url: string, token?: string) {
  const res = await fetchImpl(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15_000) })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`)
  return body
}

const expiry = (seconds: unknown) => (typeof seconds === 'number' && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null)

/** Swaps the sign-in code for tokens and looks up which account was connected. */
export async function exchangeCode(p: Provider, code: string, verifier: string, redirectUri: string, fetchImpl: F = fetch): Promise<NewConnection[]> {
  const c = credentials(p)
  if (p === 'meta') {
    const short = await getJson(fetchImpl, `${GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri, code })}`)
    // Long-lived user token (about 60 days); Page tokens made from it don't expire.
    const long = await getJson(fetchImpl, `${GRAPH}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: c.id, client_secret: c.secret, fb_exchange_token: String(short.access_token) })}`)
    const pages = (await getJson(fetchImpl, `${GRAPH}/me/accounts?fields=id,name,access_token,link,instagram_business_account{id,username}&access_token=${encodeURIComponent(String(long.access_token))}`)) as {
      data?: { id: string; name: string; access_token: string; link?: string; instagram_business_account?: { id: string; username?: string } }[]
    }
    const wanted = process.env.META_PAGE_ID
    const page = pages.data?.find((pg) => !wanted || pg.id === wanted)
    if (!page) throw new HttpError(409, 'no-facebook-page')
    const out: NewConnection[] = [
      { platform: 'facebook', provider: 'meta', external_account_id: page.id, account_name: page.name, profile_url: page.link?.startsWith('https://') ? page.link : `https://www.facebook.com/${page.id}`, access_token: page.access_token, refresh_token: '', expires_at: null, scopes: SCOPES.meta.split(','), meta: {} },
    ]
    const ig = page.instagram_business_account
    if (ig) out.push({ platform: 'instagram', provider: 'meta', external_account_id: ig.id, account_name: ig.username ?? page.name, profile_url: ig.username ? `https://www.instagram.com/${ig.username}` : '', access_token: page.access_token, refresh_token: '', expires_at: null, scopes: SCOPES.meta.split(','), meta: { page_id: page.id } })
    return out
  }
  if (p === 'x') {
    const t = await form(fetchImpl, 'https://api.x.com/2/oauth2/token', { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, client_id: c.id }, c)
    const me = (await getJson(fetchImpl, 'https://api.x.com/2/users/me', String(t.access_token))) as { data?: { id: string; username: string; name: string } }
    return [{ platform: 'x', provider: 'x', external_account_id: me.data?.id ?? '', account_name: me.data?.username ? `@${me.data.username}` : '', profile_url: me.data?.username ? `https://x.com/${me.data.username}` : '', access_token: String(t.access_token), refresh_token: String(t.refresh_token ?? ''), expires_at: expiry(t.expires_in), scopes: String(t.scope ?? '').split(' '), meta: {} }]
  }
  if (p === 'google') {
    const t = await form(fetchImpl, 'https://oauth2.googleapis.com/token', { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, client_id: c.id, client_secret: c.secret })
    const ch = (await getJson(fetchImpl, 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', String(t.access_token))) as { items?: { id: string; snippet?: { title?: string; customUrl?: string } }[] }
    const channel = ch.items?.[0]
    if (!channel) throw new HttpError(409, 'no-youtube-channel')
    return [{ platform: 'youtube', provider: 'google', external_account_id: channel.id, account_name: channel.snippet?.title ?? '', profile_url: `https://www.youtube.com/channel/${channel.id}`, access_token: String(t.access_token), refresh_token: String(t.refresh_token ?? ''), expires_at: expiry(t.expires_in), scopes: String(t.scope ?? '').split(' '), meta: {} }]
  }
  const t = await form(fetchImpl, 'https://open.tiktokapis.com/v2/oauth/token/', { client_key: c.id, client_secret: c.secret, code, grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: verifier })
  const me = (await getJson(fetchImpl, 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,profile_deep_link', String(t.access_token))) as { data?: { user?: { open_id: string; display_name: string; profile_deep_link?: string } } }
  const user = me.data?.user
  return [{ platform: 'tiktok', provider: 'tiktok', external_account_id: user?.open_id ?? String(t.open_id ?? ''), account_name: user?.display_name ?? '', profile_url: user?.profile_deep_link?.startsWith('https://') ? user.profile_deep_link : '', access_token: String(t.access_token), refresh_token: String(t.refresh_token ?? ''), expires_at: expiry(t.expires_in), scopes: String(t.scope ?? '').split(','), meta: {} }]
}

/** Saves connections: encrypted tokens in social_connections, the visible status in social_accounts. */
export async function saveConnections(list: NewConnection[], userId: string) {
  const now = new Date().toISOString()
  for (const c of list) {
    await rest('social_connections?on_conflict=platform', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ platform: c.platform, provider: c.provider, external_account_id: c.external_account_id, access_token_enc: encrypt(c.access_token), refresh_token_enc: c.refresh_token ? encrypt(c.refresh_token) : '', token_expires_at: c.expires_at, scopes: c.scopes, meta: c.meta, connected_by: userId, connected_at: now, updated_at: now }),
    })
    const account: Record<string, unknown> = { provider: c.provider, status: 'connected', account_name: c.account_name, display_name: c.account_name, connected_at: now, expires_at: c.refresh_token ? null : c.expires_at, last_error: '', last_checked_at: now, updated_by: userId, updated_at: now }
    if (c.profile_url) account.profile_url = c.profile_url
    await rest(`social_accounts?platform=eq.${c.platform}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(account) })
  }
}

export interface Connection {
  platform: Platform
  provider: Provider
  accountId: string
  accessToken: string
  meta: Record<string, unknown>
}

interface ConnectionRow {
  platform: Platform
  provider: Provider
  external_account_id: string
  access_token_enc: string
  refresh_token_enc: string
  token_expires_at: string | null
  meta: Record<string, unknown>
}

/** Marks a connection as needing the owner to sign in again. */
export async function markExpired(platform: Platform, error: string) {
  await rest(`social_accounts?platform=eq.${platform}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'expired', last_error: error.slice(0, 300), last_checked_at: new Date().toISOString() }) })
}

/** The usable tokens for a platform, refreshed first if they expire within 10 minutes. Null if not connected. */
export async function connection(platform: Platform, fetchImpl: F = fetch): Promise<Connection | null> {
  const [row] = await rest<ConnectionRow[]>(`social_connections?select=*&platform=eq.${platform}`)
  if (!row) return null
  let accessToken = decrypt(row.access_token_enc)
  const expiresSoon = row.token_expires_at && Date.parse(row.token_expires_at) < Date.now() + 10 * 60_000
  if (expiresSoon) {
    const refresh = decrypt(row.refresh_token_enc)
    if (!refresh) {
      await markExpired(platform, 'The sign-in has expired. Connect the account again.')
      throw new HttpError(409, 'account-expired')
    }
    try {
      const c = credentials(row.provider)
      const t =
        row.provider === 'x'
          ? await form(fetchImpl, 'https://api.x.com/2/oauth2/token', { grant_type: 'refresh_token', refresh_token: refresh, client_id: c.id }, c)
          : row.provider === 'google'
            ? await form(fetchImpl, 'https://oauth2.googleapis.com/token', { grant_type: 'refresh_token', refresh_token: refresh, client_id: c.id, client_secret: c.secret })
            : await form(fetchImpl, 'https://open.tiktokapis.com/v2/oauth/token/', { grant_type: 'refresh_token', refresh_token: refresh, client_key: c.id, client_secret: c.secret })
      accessToken = String(t.access_token)
      const patch: Record<string, unknown> = { access_token_enc: encrypt(accessToken), token_expires_at: expiry(t.expires_in), updated_at: new Date().toISOString() }
      if (t.refresh_token) patch.refresh_token_enc = encrypt(String(t.refresh_token))
      await rest(`social_connections?platform=eq.${platform}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) })
    } catch (error) {
      if (error instanceof HttpError) throw error
      await markExpired(platform, 'Couldn’t renew the sign-in. Connect the account again.')
      throw new HttpError(409, 'account-expired')
    }
  }
  return { platform, provider: row.provider, accountId: row.external_account_id, accessToken, meta: row.meta ?? {} }
}
