/**
 * GET /api/oauth/callback?code=...&state=...
 *
 * Where each platform sends the owner back after they approve the connection on the
 * platform's own sign-in page (started by POST /api/admin/oauth-start). The state value
 * is single-use, expires after 15 minutes and must belong to someone who is still an owner.
 * Register <site>/api/oauth/callback as the redirect URL in each platform's developer app.
 */
import { exchangeCode, PROVIDER_OF, saveConnections } from '../_lib/oauth.ts'
import { audit, HttpError, integration, rest, siteUrl } from '../_lib/server.ts'
import type { Platform } from '../../src/lib/social.ts'

const back = (req: Request, params: Record<string, string>) =>
  new Response(null, { status: 303, headers: { Location: `${siteUrl(req)}/admin/social?${new URLSearchParams({ tab: 'accounts', ...params })}`, 'Cache-Control': 'no-store' } })

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const state = url.searchParams.get('state') ?? ''
  const code = url.searchParams.get('code') ?? ''
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(state)) return back(req, { oauth_error: 'invalid' })
  try {
    // Single use: the state row is deleted as it is read.
    const [row] = await rest<{ platform: Platform; user_id: string; code_verifier: string; created_at: string }[]>(`oauth_states?state=eq.${state}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } })
    if (!row || Date.parse(row.created_at) < Date.now() - 15 * 60_000) return back(req, { oauth_error: 'expired' })
    if (url.searchParams.get('error') || !code) return back(req, { oauth_error: 'declined', platform: row.platform })
    const [owner] = await rest<{ role: string | null }[]>(`profiles?select=role&id=eq.${row.user_id}`)
    if (owner?.role !== 'owner') return back(req, { oauth_error: 'forbidden' })

    const provider = PROVIDER_OF[row.platform]
    const connections = await exchangeCode(provider, code, row.code_verifier, `${siteUrl(req)}/api/oauth/callback`)
    await saveConnections(connections, row.user_id)
    for (const c of connections) {
      await audit(row.user_id, 'account.connected', c.platform, { provider, account: c.account_name })
      await integration(c.platform, { ok: true })
    }
    return back(req, { connected: connections.map((c) => c.platform).join(',') })
  } catch (error) {
    const codeName = error instanceof HttpError ? error.code : 'failed'
    console.error(`oauth callback: ${error instanceof Error ? error.message : 'failed'}`)
    return back(req, { oauth_error: codeName })
  }
}
