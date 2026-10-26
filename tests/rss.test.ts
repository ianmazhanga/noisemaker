import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clusterKey, excerpt, matchTopics, parseFeed, plainText, sameStory, urlKey } from '../src/lib/rss.ts'

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Example News</title>
  <item>
    <title><![CDATA[Cape Town opens new &amp; bigger library]]></title>
    <link>https://www.example.co.za/news/library/?utm_source=rss&amp;id=7</link>
    <description>&lt;p&gt;The library opened on &lt;b&gt;Monday&lt;/b&gt;.&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;</description>
    <pubDate>Mon, 26 Oct 2026 08:30:00 +0200</pubDate>
  </item>
  <item><title>No link here</title></item>
  <item><title>Guid link</title><guid isPermaLink="true">https://example.co.za/guid-story</guid></item>
</channel></rss>`

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
  <entry><title type="html">Election results &amp;#8211; final count</title>
    <link rel="self" href="https://example.org/self"/><link rel="alternate" href="https://example.org/results"/>
    <summary>Officials released the count.</summary><published>2026-10-25T10:00:00Z</published></entry>
</feed>`

test('reads RSS items: CDATA, escaped HTML, tracking links, dates', () => {
  const items = parseFeed(RSS)
  assert.equal(items.length, 2)
  assert.equal(items[0].title, 'Cape Town opens new & bigger library')
  assert.equal(items[0].excerpt, 'The library opened on Monday .')
  assert.equal(items[0].publishedAt, '2026-10-26T06:30:00.000Z')
  assert.equal(items[1].url, 'https://example.co.za/guid-story')
})

test('reads Atom entries and prefers the alternate link', () => {
  const [entry] = parseFeed(ATOM)
  assert.equal(entry.title, 'Election results – final count')
  assert.equal(entry.url, 'https://example.org/results')
  assert.equal(entry.publishedAt, '2026-10-25T10:00:00.000Z')
})

test('one key for every version of the same link', () => {
  const key = urlKey('https://www.example.co.za/news/library/?utm_source=rss&id=7#top')
  assert.equal(key, urlKey('http://example.co.za/news/library?id=7&fbclid=abc'))
  assert.notEqual(key, urlKey('https://example.co.za/news/library?id=8'))
})

test('spots the same story from different outlets', () => {
  assert.ok(sameStory('Cape Town opens new public library in Khayelitsha', 'New public library opens in Khayelitsha, Cape Town'))
  assert.ok(!sameStory('Cape Town opens new public library', 'Johannesburg water outage enters third day'))
  assert.equal(clusterKey('Library opens in Cape Town'), clusterKey('Cape Town: library opens'))
})

test('topics match whole words only', () => {
  assert.deepEqual(matchTopics('Parenting tips for the diaspora', ['parenting', 'faith', 'Diaspora']), ['parenting', 'Diaspora'])
  assert.deepEqual(matchTopics('Faithful supporters', ['faith']), [])
})

test('plain text and excerpts never contain markup', () => {
  assert.equal(plainText('<p>Hi&nbsp;<a href="x">there</a></p>'), 'Hi there')
  assert.ok(excerpt('word '.repeat(200), 50).length <= 51)
})
