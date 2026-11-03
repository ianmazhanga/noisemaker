import test from 'node:test'
import assert from 'node:assert/strict'
import { createNewsSeoHandler } from '../api/_lib/news-seo.ts'

const template = '<html><head><title>Old</title><link rel="canonical" href="https://noisemakersnews.com/"><meta name="description" content="Old"><script type="application/ld+json" data-seo="build">{}</script><script type="module" src="/assets/app.js"></script></head><body><div id="root"><main>Old content</main></div></body></html>'
const article = { slug: 'real-story', title: 'A <script>story</script>', body: 'A **real** story.\n\n## Background\n\n- First fact\n- Second fact', dek: 'An interview', author_name: 'Actual Author', published_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-02T10:00:00Z', canonical_url: '', og_image_url: 'javascript:alert(1)' }
const request = (query: string) => new Request(`https://noisemakersnews.com/api/public-seo?${query}`)
const env = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_KEY: 'sb_publishable_test' }
const make = (fetcher: typeof fetch, settings = env) => createNewsSeoHandler({ env: settings, fetch: fetcher, readAsset: async (name) => name === 'index.html' ? template : '<urlset><url><loc>https://noisemakersnews.com/</loc></url></urlset>', now: () => new Date('2026-11-03T10:00:00Z') })

test('article HTML includes readable content, escaped metadata, schema and application assets', async () => {
  const handler = make(async (input, init) => {
    assert.match(String(input), /slug=eq.real-story/)
    assert.match(String(input), /published_at=lte./)
    assert.equal(new Headers(init?.headers).get('apikey'), env.VITE_SUPABASE_KEY)
    return Response.json([article])
  })
  const response = await handler(request('slug=real-story'))
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.match(html, /<strong>real<\/strong>/)
  assert.match(html, /<h2>Background<\/h2>/)
  assert.match(html, /A &lt;script&gt;story&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>story|javascript:alert|Old content/)
  assert.match(html, /src="\/assets\/app.js"/)
  assert.equal((html.match(/<title>/g) || []).length, 1)
  const ld = JSON.parse(html.match(/data-seo="build">(.*?)<\/script>/)?.[1] || '')
  assert.equal(ld['@type'], 'NewsArticle')
  assert.equal(ld.author.name, 'Actual Author')
  assert.equal(ld.mainEntityOfPage, 'https://noisemakersnews.com/news/real-story')
})

test('unpublished, nonexistent, future and malformed article requests return 404', async () => {
  for (const rows of [[], [{ ...article, published_at: '2099-01-01' }]]) {
    const response = await make(async () => Response.json(rows))(request('slug=real-story'))
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex')
  }
  assert.equal((await make(async () => { throw Error('must not query') })(request('slug=../private'))).status, 404)
})

test('upstream errors and privileged keys fail closed without caching', async () => {
  const unavailable = await make(async () => new Response('', { status: 500 }))(request('slug=real-story'))
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.headers.get('Cache-Control'), 'no-store')
  const privileged = make(async () => { throw Error('must not query') }, { ...env, VITE_SUPABASE_KEY: 'sb_secret_do-not-use' })
  assert.equal((await privileged(request('slug=real-story'))).status, 503)
})

test('live sitemap includes published local articles and excludes syndicated external canonicals', async () => {
  const response = await make(async () => Response.json([article, { ...article, slug: 'syndicated', canonical_url: 'https://example.org/story' }]))(request('sitemap=1'))
  const xml = await response.text()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Content-Type') || '', /application\/xml/)
  assert.match(xml, /https:\/\/noisemakersnews.com\/news\/real-story/)
  assert.match(xml, /<lastmod>2026-11-02T10:00:00.000Z<\/lastmod>/)
  assert.doesNotMatch(xml, /syndicated/)
})
