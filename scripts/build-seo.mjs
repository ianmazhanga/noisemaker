import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { SITE } from '../src/config/site.ts'
import { EPISODES } from '../src/data/episodes.ts'
import { CLIPS } from '../src/data/clips.ts'
import { buildCatalog, pickFeatured } from '../src/lib/catalog.ts'

// Use the same catalogue merge as the UI, including removals and curated slugs.
const snapshot = JSON.parse(await readFile('src/data/youtube.json', 'utf8'))
const { episodes } = buildCatalog(snapshot, EPISODES, CLIPS)
const template = await readFile('dist/index.html', 'utf8')
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const organization = {
  '@type': 'Organization', '@id': `${SITE.url}/#organization`, name: SITE.name,
  url: `${SITE.url}/`, description: SITE.description,
  logo: { '@type': 'ImageObject', url: `${SITE.url}/apple-touch-icon.png` },
  sameAs: [SITE.youtube.channelUrl],
}
const website = {
  '@type': 'WebSite', '@id': `${SITE.url}/#website`, name: SITE.name,
  alternateName: 'Noisemakers', url: `${SITE.url}/`,
  publisher: { '@id': organization['@id'] }, inLanguage: 'en',
}
// The homepage's NEW EPISODE section, so search engines see the newest interview first.
const featured = pickFeatured(episodes)
const featuredHtml = featured
  ? `<section><h2>New episode</h2><h3><a href="/episodes/${escape(featured.slug)}">${escape(featured.title)}</a></h3><p>${escape(featured.summary)}</p><a href="https://www.youtube.com/watch?v=${escape(featured.youtubeId)}">Watch the latest interview on YouTube</a></section>`
  : ''
const listing = episodes.map((e) => `<li><a href="/episodes/${escape(e.slug)}">${escape(e.title)}</a><p>${escape(e.summary)}</p></li>`).join('')
const pages = [
  { path: '/', title: `${SITE.name} | Inspirational Interviews & Stories`, description: SITE.description, body: `<h1>${escape(SITE.name)}</h1><p>${escape(SITE.description)}</p>${featuredHtml}<h2>Latest interviews and stories</h2><ul>${listing}</ul>` },
  { path: '/episodes', title: `Episodes | ${SITE.name}`, description: 'Explore inspirational interviews and life stories from Noisemakers News.', body: `<h1>Episodes</h1><ul>${listing}</ul>` },
  ...[
    ['/clips', 'Clips', 'Short highlights from Noisemakers News interviews and conversations.'],
    ['/news', 'News', 'News and stories from Noisemakers News.'],
    ['/books', 'Books', 'Books by guests featured in Noisemakers News interviews.'],
    ['/about', 'About', 'Learn about Noisemakers News and its inspirational interviews and impactful stories.'],
    ['/tell-your-story', 'Tell your story', 'Share your story with Noisemakers News or request an introductory conversation.'],
    ['/newsletter', 'Newsletter', 'Subscribe to updates, conversations and stories from Noisemakers News.'],
    ['/privacy', 'Privacy Policy', 'How Noisemakers News handles your personal data and story submissions.'],
    ['/terms-of-service', 'Terms of Service', 'The rules for using the Noisemakers News website, sending a story, and how the Noisemakers team publishes to social media.'],
  ].map(([path, title, description]) => ({ path, title: `${title} | ${SITE.name}`, description, body: `<h1>${escape(title)}</h1><p>${escape(description)}</p>` })),
  ...episodes.map((e) => {
    const image = `https://i.ytimg.com/vi/${e.youtubeId}/${e.hd ? 'maxresdefault' : 'sddefault'}.jpg`
    return {
      path: `/episodes/${e.slug}`, title: `${e.title} | ${SITE.name}`, description: e.summary, image,
      type: 'video.episode',
      body: `<article><h1>${escape(e.title)}</h1><p>${escape(e.summary)}</p>${e.description.map((p) => `<p>${escape(p)}</p>`).join('')}<a href="https://www.youtube.com/watch?v=${escape(e.youtubeId)}">Watch this interview on YouTube</a></article>`,
      schema: { '@type': 'VideoObject', name: e.title, description: e.summary,
        thumbnailUrl: [image], uploadDate: e.publishedAt, duration: `PT${e.durationSeconds}S`,
        embedUrl: `https://www.youtube.com/embed/${e.youtubeId}`, url: `${SITE.url}/episodes/${e.slug}` },
    }
  }),
]

for (const page of pages) {
  if (page.path !== '/' && !/^\/[a-z0-9/-]+$/.test(page.path)) throw new Error(`Invalid SEO path: ${page.path}`)
  const url = new URL(page.path, SITE.url).href
  const image = page.image || `${SITE.url}/og-image.png`
  const imageAlt = page.path.startsWith('/episodes/') ? page.title.replace(` | ${SITE.name}`, '') : `${SITE.name}: ${SITE.tagline}`
  const meta = (attr, key, value) => `<meta ${attr}="${key}" content="${escape(value)}" />`
  const head = [
    `<title>${escape(page.title)}</title>`,
    `<link rel="canonical" href="${escape(url)}" />`,
    meta('name', 'description', page.description),
    meta('name', 'robots', 'index, follow, max-image-preview:large'),
    ...Object.entries({ 'og:site_name': SITE.name, 'og:type': page.type || 'website', 'og:title': page.title,
      'og:description': page.description, 'og:url': url, 'og:image': image, 'og:image:alt': imageAlt }).map(([key, value]) => meta('property', key, value)),
    ...Object.entries({ 'twitter:card': 'summary_large_image', 'twitter:title': page.title,
      'twitter:description': page.description, 'twitter:image': image, 'twitter:image:alt': imageAlt }).map(([key, value]) => meta('name', key, value)),
    `<script type="application/ld+json" data-seo="build">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [organization, website, ...(page.schema ? [page.schema] : [])] }).replace(/</g, '\\u003c')}</script>`,
  ].join('\n')
  const nav = `<nav aria-label="Primary"><a href="/">${escape(SITE.name)}</a> · <a href="/episodes">Episodes</a> · <a href="/about">About</a></nav>`
  const html = template
    .replace(/<title>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\s+[^>]*(?:name="(?:description|robots|twitter:[^"]+)"|property="og:[^"]+")[^>]*>/gi, '')
    .replace(/<link\s+[^>]*rel="canonical"[^>]*>/gi, '')
    .replace('</head>', `${head}\n</head>`)
    .replace('<div id="root"></div>', `<div id="root"><section data-seo-fallback>${nav}<main id="main" class="wrap py-12">${page.body}</main></section></div>`)
  const directory = page.path === '/' ? 'dist' : join('dist', page.path.slice(1))
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'index.html'), html)
}
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${escape(new URL(p.path, SITE.url).href)}</loc></url>`).join('\n')}\n</urlset>\n`
await writeFile('dist/sitemap-base.xml', sitemap)
await rm('dist/sitemap.xml', { force: true })
console.log(`SEO: generated initial HTML and sitemap for ${pages.length} public URLs.`)
