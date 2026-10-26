/**
 * Encrypts social media access tokens before they are stored (AES-256-GCM).
 *
 * TOKEN_ENCRYPTION_KEY: 32 random bytes, base64-encoded. Make one with
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Changing it makes stored tokens unreadable, so accounts would need connecting again.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { HttpError } from './server.ts'

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY ?? ''
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new HttpError(503, 'encryption-not-configured')
  return buf
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${data.toString('base64url')}`
}

export function decrypt(sealed: string): string {
  if (!sealed) return ''
  const [version, iv, tag, data] = sealed.split(':')
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unreadable token')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

/** URL-safe random string, e.g. for OAuth state values. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

/** PKCE: the challenge sent with the sign-in for a verifier kept on the server. */
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

/** One-way hash for storing values that only need comparing, e.g. IP addresses for rate limits. */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
