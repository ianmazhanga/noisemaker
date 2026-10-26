import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readBlocks, renderEmail, renderText } from '../src/lib/newsletter.ts'
import { findConflicts, slugify, toCsv, type CalendarItem } from '../src/lib/newsroom.ts'
import { estimateAnalysis, estimateRender, overBudget, textCost } from '../src/lib/costs.ts'

const campaign = {
  subject: 'This week <b>at</b> Noisemakers',
  preheader: 'New episode',
  intro: 'Hello friends,\n\nHere is what is new.',
  blocks: [
    { type: 'video', title: 'Starting over <script>alert(1)</script>', url: 'https://www.youtube.com/watch?v=abcdefghijk', text: 'A conversation.' },
    { type: 'article', title: 'Bad link', url: 'javascript:alert(1)' },
    { type: 'nonsense', title: 'Dropped' },
  ],
}

test('the email escapes every piece of text and keeps only https links', () => {
  const html = renderEmail({ ...campaign, blocks: campaign.blocks as never }, { siteUrl: 'https://noisemakersnews.com', unsubscribe: '*|UNSUB|*' })
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /Starting over &lt;script&gt;/)
  assert.doesNotMatch(html, /javascript:/)
  assert.doesNotMatch(html, /Dropped/)
  assert.match(html, /href="\*\|UNSUB\|\*"/)
  assert.match(html, /<title>This week &lt;b&gt;at&lt;\/b&gt; Noisemakers<\/title>/)
  const text = renderText({ ...campaign, blocks: campaign.blocks as never }, { siteUrl: 'https://noisemakersnews.com', unsubscribe: '*|UNSUB|*' })
  assert.match(text, /NEW ON YOUTUBE\nStarting over/)
  assert.equal(readBlocks(campaign.blocks).length, 2)
})

test('slugs are URL-safe', () => {
  assert.equal(slugify('Mamelodi’s new library opens — finally!'), 'mamelodis-new-library-opens-finally')
  assert.equal(slugify('!!!'), 'article')
})

test('CSV exports quote cells and defuse spreadsheet formulas', () => {
  assert.equal(toCsv([['a', 'b"c'], ['=SUM(A1)', -5]]), '"a","b""c"\r\n"\'=SUM(A1)","-5"')
})

test('calendar conflicts: same channel within an hour, ignoring published items', () => {
  const item = (uid: string, channel: string, at: string, status = 'scheduled'): CalendarItem => ({ uid, item_type: 'post', item_id: uid, channel, title: uid, at, status, approved: true, person_id: null, link: '' })
  const clash = findConflicts([
    item('a', 'instagram', '2026-11-01T10:00:00Z'),
    item('b', 'instagram', '2026-11-01T10:30:00Z'),
    item('c', 'facebook', '2026-11-01T10:15:00Z'),
    item('d', 'instagram', '2026-11-01T13:00:00Z'),
    item('e', 'facebook', '2026-11-01T10:20:00Z', 'published'),
  ])
  assert.deepEqual([...clash].sort(), ['a', 'b'])
})

test('cost estimates', () => {
  assert.equal(textCost('gpt-4o-mini', 1_000_000, 1_000_000), 0.75)
  assert.ok(textCost('unknown-model', 1000, 1000) >= textCost('gpt-4o', 1000, 1000))
  const hour = estimateAnalysis(3600)
  assert.ok(hour.usd > 0.36 && hour.usd < 1, String(hour.usd))
  assert.equal(hour.lines.length, 3)
  assert.ok(estimateRender(60, true).usd > estimateRender(60, false).usd)
  assert.ok(overBudget(19.5, 20, 1))
  assert.ok(overBudget(0, 0, 0.01), 'a zero budget allows nothing')
  assert.ok(!overBudget(5, 20, 1))
})
