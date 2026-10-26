import { test } from 'node:test'
import assert from 'node:assert/strict'
import { articlePlainText, parseArticle, parseInline, readingMinutes } from '../src/lib/articleText.ts'

test('articles parse into headings, paragraphs and lists', () => {
  const blocks = parseArticle('## What happened\n\nThe library opened on Monday.\nIt has 10,000 books.\n\n- Free entry\n- Open daily\n\nSource: Example News')
  assert.deepEqual(blocks.map((b) => b.type), ['h2', 'p', 'ul', 'p'])
  assert.equal(blocks[0].type === 'h2' && blocks[0].text, 'What happened')
  assert.equal(blocks[2].type === 'ul' && blocks[2].items.length, 2)
})

test('only https links become links; markup stays text', () => {
  assert.deepEqual(parseInline('See [the report](https://example.org/r) and **this**.'), [
    { type: 'text', text: 'See ' },
    { type: 'link', text: 'the report', href: 'https://example.org/r' },
    { type: 'text', text: ' and ' },
    { type: 'bold', text: 'this' },
    { type: 'text', text: '.' },
  ])
  assert.deepEqual(parseInline('[x](javascript:alert(1)) <script>'), [{ type: 'text', text: '[x](javascript:alert(1)) <script>' }])
})

test('plain text and reading time', () => {
  assert.equal(articlePlainText('## Hi\n\nThere [you](https://a.b) go'), 'Hi There you go')
  assert.equal(readingMinutes('word '.repeat(460)), 2)
})
