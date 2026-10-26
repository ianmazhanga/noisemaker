import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIELD_NAMES } from '../src/lib/storyForm.ts'
import { defaultMessage, emailSubject, isCallRequest, mailtoLink, matchesSearch, preferredContact, receivedWithin, safeWebLink, telLink, whatsappLink, type InboxEntry } from '../src/lib/inbox.ts'

/** A submission as the Story Inbox sees it, with any unspecified field empty. */
const makeEntry = (id: string, receivedAt: string, values: Partial<InboxEntry['fields']>): InboxEntry => ({
  id,
  receivedAt,
  fields: { ...(Object.fromEntries(FIELD_NAMES.map((n) => [n, ''])) as InboxEntry['fields']), ...values },
})

test('search, call-request filter and safe links', () => {
  const entry = makeEntry('a1', '2026-10-20T10:00:00Z', { full_name: 'Tendai Moyo', request_type: 'Request an introductory call (pending: not booked until the team confirms)' })
  assert.equal(isCallRequest(entry), true)
  assert.equal(matchesSearch(entry, 'tendai'), true)
  assert.equal(matchesSearch(entry, 'nobody'), false)
  assert.equal(whatsappLink('+263771234567'), 'https://wa.me/263771234567')
  assert.equal(whatsappLink('077 123'), null)
  assert.equal(safeWebLink('javascript:alert(1)'), null)
  assert.equal(safeWebLink('https://instagram.com/x'), 'https://instagram.com/x')
})

test('contact links follow the chosen method and carry the edited message', () => {
  const entry = makeEntry('a1', '2026-10-20T10:00:00Z', { full_name: 'Tendai Moyo', reference: 'NM-261020-ABCD', preferred_contact: 'WhatsApp', phone: '+263771234567', email: 't@example.com' })
  assert.equal(preferredContact(entry), 'whatsapp')
  assert.equal(preferredContact({ ...entry, fields: { ...entry.fields, preferred_contact: 'Phone call' } }), 'phone')
  assert.equal(preferredContact({ ...entry, fields: { ...entry.fields, preferred_contact: '' } }), null)
  assert.match(defaultMessage(entry), /^Hello Tendai, thank you for submitting your story to Noisemakers/)
  assert.equal(whatsappLink('+263771234567', 'Hi & thanks'), 'https://wa.me/263771234567?text=Hi%20%26%20thanks')
  assert.equal(telLink('+263 77 123 4567'), 'tel:+263771234567')
  assert.equal(telLink('n/a'), null)
  assert.equal(mailtoLink('t@example.com', emailSubject(entry), 'Hi'), 'mailto:t@example.com?subject=Your%20Noisemakers%20story%20(NM-261020-ABCD)&body=Hi')
  assert.equal(mailtoLink('t@example.com?bcc=x@y.z', 'S'), null)
  assert.equal(receivedWithin(entry, 7, Date.parse('2026-10-26T10:00:00Z')), true)
  assert.equal(receivedWithin(entry, 3, Date.parse('2026-10-26T10:00:00Z')), false)
})
