/** Supabase Storage with the secret key: signed links for uploads and downloads, and deletes. */
import { sb, supabaseConfig } from './server.ts'

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** A link anyone holding it can download from for `seconds`. Used to hand files to the worker and to social networks. */
export async function signedDownloadUrl(bucket: string, path: string, seconds = 3600): Promise<string> {
  const { url } = supabaseConfig()
  const res = await sb<{ signedURL: string }>(`/storage/v1/object/sign/${bucket}/${enc(path)}`, { method: 'POST', body: JSON.stringify({ expiresIn: seconds }) })
  return `${url}/storage/v1${res.signedURL.startsWith('/') ? '' : '/'}${res.signedURL}`
}

/** A one-time upload link for one path (valid for two hours). The browser uploads straight to Storage with it. */
export async function signedUploadUrl(bucket: string, path: string): Promise<{ url: string; token: string }> {
  const { url } = supabaseConfig()
  const res = await sb<{ url: string }>(`/storage/v1/object/upload/sign/${bucket}/${enc(path)}`, { method: 'POST', body: '{}' })
  const token = new URL(`${url}/storage/v1${res.url}`).searchParams.get('token') ?? ''
  return { url: `${url}/storage/v1${res.url}`, token }
}

/** Size and type of an uploaded file, or null if it isn't there. */
export async function objectInfo(bucket: string, path: string): Promise<{ size: number; mimeType: string } | null> {
  const { url, key } = supabaseConfig()
  const headers: Record<string, string> = { apikey: key }
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`
  const res = await fetch(`${url}/storage/v1/object/authenticated/${bucket}/${enc(path)}`, { method: 'HEAD', headers, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return null
  return { size: Number(res.headers.get('content-length') ?? 0), mimeType: res.headers.get('content-type') ?? '' }
}

export async function removeObjects(bucket: string, paths: string[]) {
  if (!paths.length) return
  await sb(`/storage/v1/object/${bucket}`, { method: 'DELETE', body: JSON.stringify({ prefixes: paths }) })
}
