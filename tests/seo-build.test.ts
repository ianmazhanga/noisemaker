import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('SEO build follows catalogue additions/removals and escapes untrusted video text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'noisemakers-seo-'))
  try {
    await mkdir(join(directory, 'src/data'), { recursive: true })
    await mkdir(join(directory, 'dist'), { recursive: true })
    await writeFile(join(directory, 'dist/index.html'), '<html><head><title>Old</title><meta name="description" content="Old" /></head><body><div id="root"></div></body></html>')
    await writeFile(join(directory, 'src/data/youtube.json'), JSON.stringify({ videos: [{
      youtubeId: 'abcdefghijk', kind: 'episode', slug: 'new-episode', title: 'A <script>unsafe</script> title',
      description: ['A genuine new conversation.'], publishedAt: '2026-11-03T10:00:00Z',
      durationSeconds: 300, hd: false, restricted: false,
    }] }))
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', resolve('scripts/build-seo.mjs')], { cwd: directory, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const sitemap = await readFile(join(directory, 'dist/sitemap.xml'), 'utf8')
    assert.match(sitemap, /https:\/\/noisemakersnews.com\/episodes\/new-episode/)
    assert.doesNotMatch(sitemap, /innocent-mathe|\/admin|\/inbox/)
    const html = await readFile(join(directory, 'dist/episodes/new-episode/index.html'), 'utf8')
    assert.equal((html.match(/<title>/g) ?? []).length, 1)
    assert.match(html, /rel="canonical" href="https:\/\/noisemakersnews.com\/episodes\/new-episode"/)
    assert.match(html, /A &lt;script&gt;unsafe&lt;\/script&gt; title/)
    assert.doesNotMatch(html, /<script>unsafe/)
    const schema = JSON.parse(html.match(/data-seo="build">(.*?)<\/script>/)?.[1] ?? '')
    assert.equal(schema['@graph'][0].name, 'Noisemakers News')
    assert.equal(schema['@graph'][2]['@type'], 'VideoObject')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
