import { parseArticle, articlePlainText, type Inline } from '../../src/lib/articleText.ts'

const ORIGIN = 'https://noisemakersnews.com'
const BRAND = 'Noisemakers News'
const SLUG = /^[a-z0-9-]{1,100}$/
const COLUMNS = 'slug,title,dek,body,author_name,featured_image_url,featured_image_alt,meta_title,meta_description,og_image_url,canonical_url,published_at,updated_at'
type Article = Record<string, string>
type Dependencies = { env: NodeJS.ProcessEnv; fetch: typeof fetch; readAsset: (name: string) => Promise<string>; now: () => Date }
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const safeUrl = (value: string, fallback: string) => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : fallback } catch { return fallback }
}
const inline = (items: Inline[]) => items.map((i) => i.type === 'bold' ? `<strong>${escapeHtml(i.text)}</strong>` : i.type === 'link' ? `<a href="${escapeHtml(safeUrl(i.href, ORIGIN))}" rel="nofollow noopener noreferrer">${escapeHtml(i.text)}</a>` : escapeHtml(i.text)).join('')
export const renderBody = (body: string) => parseArticle(body).map((b) => b.type === 'h2' ? `<h2>${escapeHtml(b.text)}</h2>` : b.type === 'p' ? `<p>${inline(b.content)}</p>` : `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`).join('')

export function renderArticle(template: string, article: Article): string {
  const url = `${ORIGIN}/news/${article.slug}`
  const canonical = safeUrl(article.canonical_url, url)
  const title = `${article.meta_title || article.title} | ${BRAND}`
  const description = article.meta_description || article.dek || articlePlainText(article.body).slice(0, 160)
  const image = safeUrl(article.og_image_url || article.featured_image_url, `${ORIGIN}/og-image.png`)
  const schema = {
    '@context': 'https://schema.org', '@type': 'NewsArticle', headline: article.title, description,
    datePublished: article.published_at, dateModified: article.updated_at || article.published_at,
    image: [image], mainEntityOfPage: canonical,
    author: article.author_name ? { '@type': 'Person', name: article.author_name } : { '@type': 'Organization', name: BRAND },
    publisher: { '@type': 'Organization', name: BRAND, url: ORIGIN, logo: { '@type': 'ImageObject', url: `${ORIGIN}/apple-touch-icon.png` } },
  }
  const meta = (attr: string, key: string, value: string) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`
  const head = [`<title>${escapeHtml(title)}</title>`, `<link rel="canonical" href="${escapeHtml(canonical)}" />`, meta('name', 'description', description), meta('name', 'robots', 'index, follow, max-image-preview:large'),
    ...Object.entries({ 'og:type': 'article', 'og:site_name': BRAND, 'og:title': title, 'og:description': description, 'og:url': canonical, 'og:image': image, 'og:image:alt': article.featured_image_alt || article.title, 'article:published_time': article.published_at, 'article:modified_time': article.updated_at || article.published_at }).map(([k,v]) => meta('property', k, v)),
    ...Object.entries({ 'twitter:card': 'summary_large_image', 'twitter:title': title, 'twitter:description': description, 'twitter:image': image, 'twitter:image:alt': article.featured_image_alt || article.title }).map(([k,v]) => meta('name', k, v)),
    `<script type="application/ld+json" data-seo="build">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`].join('\n')
  const body = `<nav aria-label="Primary"><a href="/">${BRAND}</a> · <a href="/news">News</a></nav><main id="main" class="wrap py-12"><article><h1>${escapeHtml(article.title)}</h1>${article.dek ? `<p>${escapeHtml(article.dek)}</p>` : ''}${article.author_name ? `<p>${escapeHtml(article.author_name)}</p>` : ''}<time datetime="${escapeHtml(article.published_at)}">${escapeHtml(article.published_at.slice(0,10))}</time>${renderBody(article.body)}</article></main>`
  return template.replace(/<title>[\s\S]*?<\/title>/gi, '').replace(/<meta\s+[^>]*(?:name="(?:description|robots|twitter:[^"]+)"|property="(?:og:|article:)[^"]+")[^>]*>/gi, '').replace(/<link\s+[^>]*rel="canonical"[^>]*>/gi, '').replace(/<script\s+[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi, '').replace('</head>', `${head}</head>`).replace(/<div id="root">[\s\S]*?<\/div>/, `<div id="root">${body}</div>`)
}

export function createNewsSeoHandler(deps: Dependencies) {
  const respond = (body: string, status = 200, type = 'text/html; charset=utf-8') => new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', ...(status !== 200 ? { 'X-Robots-Tag': 'noindex' } : {}) } })
  const error = (status: number, message: string) => respond(`<!doctype html><html lang="en"><head><meta name="robots" content="noindex"><title>${message} | ${BRAND}</title></head><body><main><h1>${message}</h1><a href="/news">Browse news</a></main></body></html>`, status)
  const publicConfig = () => {
    const url = deps.env.VITE_SUPABASE_URL || ''
    const key = deps.env.VITE_SUPABASE_KEY || ''
    if (!url || !key) return null
    let anon = key.startsWith('sb_publishable_')
    try { anon ||= JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon' } catch { /* Publishable keys aren't JWTs. */ }
    if (!anon || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) throw new Error('Invalid public news configuration')
    return { url: url.replace(/\/$/, ''), key }
  }
  const query = async (params: URLSearchParams): Promise<Article[]> => {
    const config = publicConfig()
    if (!config) return []
    const headers: Record<string,string> = { apikey: config.key }
    if (config.key.startsWith('eyJ')) headers.Authorization = `Bearer ${config.key}`
    // No user token or privileged key: the existing anon RLS policy excludes drafts and future publications.
    params.set('published_at', `lte.${deps.now().toISOString()}`)
    const res = await deps.fetch(`${config.url}/rest/v1/news_articles?${params}`, { headers, signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`Public news query failed (${res.status})`)
    const rows: unknown = await res.json()
    if (!Array.isArray(rows)) throw new Error('Invalid news response')
    return rows.filter((a): a is Article => a && typeof a.slug === 'string' && SLUG.test(a.slug) && typeof a.published_at === 'string' && Number.isFinite(Date.parse(a.published_at)) && Date.parse(a.published_at) <= deps.now().getTime())
  }
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    try {
      if (url.searchParams.get('sitemap') === '1') {
        const base = await deps.readAsset('sitemap-base.xml')
        const entries: string[] = []
        for (let offset = 0; offset < 50000; offset += 1000) {
          const rows = await query(new URLSearchParams({ select: 'slug,canonical_url,published_at,updated_at', order: 'slug.asc', limit: '1000', offset: String(offset) }))
          for (const a of rows) {
            const own = `${ORIGIN}/news/${a.slug}`
            if (safeUrl(a.canonical_url, own) !== own) continue
            const modified = Number.isFinite(Date.parse(a.updated_at)) ? new Date(a.updated_at).toISOString() : new Date(a.published_at).toISOString()
            entries.push(`<url><loc>${escapeHtml(own)}</loc><lastmod>${modified}</lastmod></url>`)
          }
          if (rows.length < 1000) break
          if (offset === 49000) throw new Error('Sitemap pagination limit reached')
        }
        if ((base.match(/<loc>/g)?.length || 0) + entries.length > 50000) throw new Error('Sitemap limit reached')
        return respond(base.replace('</urlset>', `${entries.join('\n')}\n</urlset>`), 200, 'application/xml; charset=utf-8')
      }
      const slug = url.searchParams.get('slug') || ''
      if (!SLUG.test(slug)) return error(404, 'Article not found')
      if (!publicConfig()) return error(503, 'News temporarily unavailable')
      const [article] = await query(new URLSearchParams({ select: COLUMNS, slug: `eq.${slug}`, limit: '1' }))
      if (!article) return error(404, 'Article not found')
      if (typeof article.title !== 'string' || typeof article.body !== 'string') throw new Error('Invalid article')
      return respond(renderArticle(await deps.readAsset('index.html'), article))
    } catch {
      return error(503, 'News temporarily unavailable')
    }
  }
}
