import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EMPTY_FORM, FIELD_NAMES, fingerprint, makeReference, toE164, toSubmission, validate, type StoryForm } from '../src/lib/storyForm.ts'

const valid: StoryForm = {
  ...EMPTY_FORM,
  fullName: 'Tendai Moyo',
  email: 'tendai@example.com',
  contactMethod: 'whatsapp',
  phoneCountry: 'Zimbabwe|+263',
  phone: '077 123 4567',
  storyTitle: 'Raising our children far from home',
  storySummary: 'We moved abroad with two young children and had to learn how to parent without family nearby.',
  whyShare: 'So other families know they are not alone.',
  topics: ['Family & parenting', 'Life in the diaspora'],
  interviewFormat: 'remote',
  consentPrivacy: true,
  consentContact: true,
  consentAge: true,
}

test('a complete submission passes', () => {
  assert.deepEqual(validate(valid), {})
})

test('missing required fields each get their own message', () => {
  const errors = validate(EMPTY_FORM)
  for (const key of ['fullName', 'email', 'contactMethod', 'storyTitle', 'storySummary', 'whyShare', 'topics', 'interviewFormat', 'consentPrivacy', 'consentContact', 'consentAge'] as const) {
    assert.ok(errors[key], `${key} should be required`)
  }
  assert.equal(errors.availability, undefined, 'availability is optional for a story')
  assert.equal(errors.phone, undefined, 'phone is optional until phone or WhatsApp is chosen')
})

test('invalid email, phone and link are rejected', () => {
  assert.ok(validate({ ...valid, email: 'tendai@example' }).email)
  assert.ok(validate({ ...valid, email: 'not an email' }).email)
  assert.ok(validate({ ...valid, phone: '12' }).phone)
  assert.ok(validate({ ...valid, phoneCountry: '' }).phoneCountry)
  assert.ok(validate({ ...valid, profileUrl: 'javascript:alert(1)' }).profileUrl)
  assert.equal(validate({ ...valid, profileUrl: 'instagram.com/tendai' }).profileUrl, undefined)
})

test('phone or WhatsApp contact needs a phone number; email does not', () => {
  assert.ok(validate({ ...valid, phone: '' }).phone)
  assert.equal(validate({ ...valid, contactMethod: 'email', phone: '', phoneCountry: '' }).phone, undefined)
})

test('a call request needs only personal details and consent', () => {
  const call: StoryForm = { ...EMPTY_FORM, requestType: 'call', fullName: 'Tendai Moyo', email: 'tendai@example.com', contactMethod: 'email', consentPrivacy: true, consentContact: true, consentAge: true }
  assert.deepEqual(validate(call), {})
  // Personal details and consent are still required.
  const errors = validate({ ...EMPTY_FORM, requestType: 'call' })
  for (const key of ['fullName', 'email', 'contactMethod', 'consentPrivacy', 'consentContact', 'consentAge'] as const) assert.ok(errors[key], `${key} should be required`)
  for (const key of ['storyTitle', 'storySummary', 'whyShare', 'topics', 'interviewFormat', 'availability'] as const) assert.equal(errors[key], undefined, `${key} should not be required for a call`)
  assert.ok(validate({ ...call, contactMethod: 'whatsapp' }).phone, 'WhatsApp still needs a number')
})

test('every consent box is required', () => {
  assert.ok(validate({ ...valid, consentPrivacy: false }).consentPrivacy)
  assert.ok(validate({ ...valid, consentContact: false }).consentContact)
  assert.ok(validate({ ...valid, consentAge: false }).consentAge)
})

test('over-long answers are rejected', () => {
  assert.ok(validate({ ...valid, storySummary: 'x'.repeat(2001) }).storySummary)
})

test('phone numbers are normalised to international format', () => {
  assert.equal(toE164('+263', '077 123 4567'), '+263771234567')
  assert.equal(toE164('+44', '07700 900123'), '+447700900123')
  assert.equal(toE164('+44', '+44 7700 900123'), '+447700900123')
  assert.equal(toE164('+44', '0044 7700 900123'), '+447700900123')
  assert.equal(toE164('+1', '(415) 555-0132'), '+14155550132')
  assert.equal(toE164('+44', '+263 77 123 4567'), null, 'a different country code typed into the number')
  assert.equal(toE164('+263', '12'), null)
})

test('references are readable and unique enough', () => {
  const ref = makeReference(new Date('2026-10-16T12:00:00Z'), () => new Uint8Array([0, 1, 2, 31]))
  assert.equal(ref, 'NM-261016-ABC9')
  const many = new Set(Array.from({ length: 500 }, () => makeReference()))
  assert.ok(many.size > 495)
})

test('the same story gets the same fingerprint, so repeats can be caught', () => {
  assert.equal(fingerprint(valid), fingerprint({ ...valid, storySummary: `  ${valid.storySummary.toUpperCase()} ` }))
  assert.notEqual(fingerprint(valid), fingerprint({ ...valid, storyTitle: 'Another story' }))
})

test('the submission is readable, says a call is pending, and has exactly the database columns', () => {
  const story = toSubmission(valid, 'NM-261016-ABCD')
  assert.equal(story.topics, 'Family & parenting, Life in the diaspora')
  assert.doesNotMatch(story.request_type, /pending/)

  const fields = toSubmission({ ...valid, requestType: 'call', availability: 'Saturday mornings' }, 'NM-261016-ABCD')
  assert.equal(fields.phone, '+263771234567')
  assert.equal(fields.preferred_contact, 'WhatsApp')
  assert.match(fields.request_type, /pending/)
  assert.equal(fields.availability, 'Saturday mornings')
  // Story answers typed before switching to a call request are not sent.
  assert.equal(fields.story_summary, '')
  assert.equal(fields.topics, '')
  assert.equal(fields.reference, 'NM-261016-ABCD')
  assert.deepEqual(Object.keys(fields).sort(), [...FIELD_NAMES].sort())
})

test('applicant details only go to the Story Inbox function', () => {
  // The page must not log, put details in URLs or send them to other services.
  const page = readFileSync(new URL('../src/pages/TellYourStoryPage.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(page, /console\./)
  assert.doesNotMatch(page, /localStorage/)
  assert.deepEqual([...page.matchAll(/fetch\(([^,]+),/g)].map((m) => m[1]), ["'/api/stories'"])
})
