/**
 * Published news articles for the public site, read with the publishable key. The
 * database only ever returns published articles to this key, and only their public
 * columns, so drafts and editorial notes can't be fetched from here.
 */
import type { ArticleSource } from './newsroom'

export interface PublicArticle {
  id: string
  slug: string
  title: string
  dek: string
  body: string
  category: string
  tags: string[]
  author_name: string
  featured_image_url: string
  featured_image_alt: string
  sources: ArticleSource[]
  meta_title: string
  meta_description: string
  og_image_url: string
  canonical_url: string
  published_at: string
  updated_at: string
}

const COLUMNS = 'id,slug,title,dek,body,category,tags,author_name,featured_image_url,featured_image_alt,sources,meta_title,meta_description,og_image_url,canonical_url,published_at,updated_at'
const LIST_COLUMNS = 'id,slug,title,dek,category,featured_image_url,featured_image_alt,published_at'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '')
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined

export const newsAvailable = Boolean(url && key)

async function get<T>(path: string): Promise<T> {
  if (!url || !key) return [] as T
  const headers: Record<string, string> = { apikey: key }
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`
  const res = await fetch(`${url}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(10_000) })
  // Before the newsroom tables exist the site simply has no news yet.
  if (res.status === 404) return [] as T
  if (!res.ok) throw new Error(`News couldn’t be loaded (${res.status})`)
  return (await res.json()) as T
}

export const listArticles = (limit = 30) => get<PublicArticle[]>(`news_articles?select=${LIST_COLUMNS}&order=published_at.desc&limit=${limit}`)

export async function getArticle(slug: string): Promise<PublicArticle | null> {
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) return null
  const [row] = await get<PublicArticle[]>(`news_articles?select=${COLUMNS}&slug=eq.${slug}&limit=1`)
  return row ?? null
}
