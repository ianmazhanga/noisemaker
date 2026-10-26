import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allWords, assColor, assTime, boundaries, buildCues, checkSuggestions, clipLength, keptRanges, retimeCue, snapClip, spokenText, toAss, wrapWords, type Segment } from '../src/lib/clips.ts'

/** A made-up interview transcript with word timings. */
function transcript(): Segment[] {
  const sentences = [
    'Welcome back to the show.',
    'Today we talk about starting over.',
    'When we moved, we had nothing.',
    'No family nearby, no friends, no plan.',
    'But my wife said something I will never forget.',
    'She said we will build it together.',
    'And that is exactly what we did.',
    'Now let us talk about the children.',
  ]
  const segments: Segment[] = []
  let t = 0
  for (const text of sentences) {
    const words = text.split(' ').map((w) => {
      const word = { w, s: t, e: t + 0.4 }
      t += 0.5
      return word
    })
    segments.push({ start: words[0].s, end: words[words.length - 1].e, text, words })
    t += 0.3
  }
  return segments
}

test('kept ranges skip the cut parts', () => {
  assert.deepEqual(keptRanges(10, 40, [[20, 25]]), [[10, 20], [25, 40]])
  assert.deepEqual(keptRanges(10, 40, [[5, 12], [38, 50]]), [[12, 38]])
  assert.equal(clipLength(10, 40, [[20, 25]]), 25)
})

test('clips start after a sentence ends and stop at a sentence end', () => {
  const segs = transcript()
  const { starts, ends } = boundaries(segs)
  assert.ok(starts.includes(segs[2].start))
  assert.ok(ends.includes(segs[5].end))
  // Ask for a clip starting mid-sentence: it moves to a sentence start.
  const snapped = snapClip(segs, segs[2].start + 1.1, segs[5].end - 0.7, { min: 5, max: 20 })!
  const near = (list: number[], t: number) => list.some((x) => Math.abs(x - t) < 0.01)
  assert.ok(near(starts, snapped.start), 'starts at a sentence')
  assert.ok(near(ends, snapped.end), 'ends at a sentence')
  assert.ok(snapped.end - snapped.start >= 5 && snapped.end - snapped.start <= 20)
})

test('when no sentence end fits the length, the clip still ends at a word boundary', () => {
  const segs: Segment[] = [{ start: 0, end: 60, text: 'one long run on sentence without any stop', words: Array.from({ length: 60 }, (_, i) => ({ w: `w${i}`, s: i, e: i + 0.8 })) }]
  const snapped = snapClip(segs, 0, 15, { min: 10, max: 20 })!
  assert.ok(segs[0].words!.some((w) => Math.abs(w.e - snapped.end) < 0.01))
})

test('subtitles: short lines, timed to the words, skipping cuts', () => {
  const segs = transcript()
  const words = allWords(segs)
  const start = segs[2].start
  const end = segs[5].end
  const cues = buildCues(words, start, end, [], { maxChars: 24, maxLines: 2 })
  assert.ok(cues.length >= 4)
  for (const c of cues) {
    for (const line of c.text.split('\n')) assert.ok(line.length <= 24 || !line.includes(' '), line)
    assert.ok(c.text.split('\n').length <= 2)
    assert.ok(c.start >= 0 && c.end > c.start)
  }
  assert.equal(cues[0].start, 0)
  // Everything said is in the subtitles, word for word.
  assert.equal(cues.map((c) => c.words.map((w) => w.w).join(' ')).join(' '), spokenText(segs, start, end))

  const cutFrom = segs[3].start
  const cutTo = segs[3].end
  const withCut = buildCues(words, start, end, [[cutFrom, cutTo]])
  assert.doesNotMatch(withCut.map((c) => c.text).join(' '), /No family nearby/)
})

test('corrected subtitle text is re-timed across the cue', () => {
  const cue = { start: 1, end: 3, text: 'we had nothing', words: [{ w: 'we', s: 1, e: 1.4 }, { w: 'had', s: 1.5, e: 2 }, { w: 'nothing', s: 2.1, e: 3 }] }
  const fixed = retimeCue(cue, 'we had almost nothing')
  assert.equal(fixed.words.length, 4)
  assert.equal(fixed.words[0].s, 1)
  assert.equal(fixed.words[3].e, 3)
  assert.equal(retimeCue(cue, 'we had nothing').words, cue.words)
})

test('ASS subtitles: valid header, highlighted words, literal text', () => {
  const ass = toAss(
    [{ start: 0, end: 2, text: 'Hello {world}\nagain', words: [{ w: 'Hello', s: 0, e: 0.5 }, { w: '{world}', s: 0.6, e: 1.2 }, { w: 'again', s: 1.3, e: 2 }] }],
    { width: 1080, height: 1920, font: 'Inter', size: 0.05, position: 0.2, background: 'shadow', highlight: true, highlightColor: '#F7D046', uppercase: false, title: 'Noisemakers', duration: 2 },
  )
  assert.match(ass, /PlayResX: 1080/)
  assert.match(ass, /PlayResY: 1920/)
  assert.match(ass, /Style: Caption,Inter,96,/)
  const dialogue = ass.split('\n').filter((l) => l.startsWith('Dialogue: 0'))
  assert.equal(dialogue.length, 3, 'one event per word')
  assert.match(dialogue[1], /\{\\c&H0046D0F7\}\(world\)\{\\c&H00FFFFFF&\}/)
  assert.match(dialogue[0], /\\Nagain/)
  assert.match(ass, /Dialogue: 1,0:00:00\.00,0:00:02\.00,Title,,0,0,0,,Noisemakers/)
  assert.equal(assTime(3725.456), '1:02:05.46')
  assert.equal(assColor('#112233'), '&H00332211')
  assert.deepEqual(wrapWords(['a', 'bb', 'ccc'], 4), ['a bb', 'ccc'])
})

test('AI clip suggestions are checked, snapped, de-duplicated and limited', () => {
  const segs = transcript()
  const duration = segs[segs.length - 1].end
  const raw = {
    clips: [
      { start: segs[2].start + 0.2, end: segs[5].end, title: 'Starting with nothing', category: 'story', reason: 'Personal moment', score: 90 },
      { start: segs[2].start + 0.5, end: segs[5].end - 0.3, title: 'Overlapping', category: 'story', score: 40 },
      { start: -5, end: 10, title: 'Before the start' },
      { start: 0, end: duration + 100, title: 'Past the end' },
      { start: 'x', end: 4 },
      { start: segs[4].start, end: segs[6].end, title: 'Build it together', category: 'made-up', score: 70 },
    ],
  }
  const kept = checkSuggestions(raw, segs, { min: 5, max: 20, limit: 5, duration })
  assert.equal(kept.length, 1, JSON.stringify(kept))
  assert.equal(kept[0].title, 'Starting with nothing')
  const two = checkSuggestions({ clips: [raw.clips[5], { start: 0, end: segs[1].end + 2, score: 10 }] }, segs, { min: 3, max: 20, limit: 5, duration })
  assert.equal(two.length, 2)
  assert.equal(two.find((c) => c.title === 'Build it together')?.category, 'other')
  assert.deepEqual(checkSuggestions('nonsense', segs, { min: 5, max: 20, limit: 5, duration }), [])
})
