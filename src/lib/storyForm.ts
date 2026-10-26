/**
 * "Tell your story" form: fields, validation and submission encoding.
 *
 * The page sends the answers to api/stories.ts, which checks them again with the same
 * rules and saves them to the database. FIELD_NAMES are the database's column names.
 *
 * No imports, so tests can run this file directly in Node.
 */

/** Hidden field that people never see. Bots fill it in and the server discards those submissions. */
export const HONEYPOT = 'bot-field'

export type RequestType = 'story' | 'call'
export type ContactMethod = 'email' | 'phone' | 'whatsapp'
export type InterviewFormat = 'in-person' | 'remote' | 'undecided'

export interface StoryForm {
  requestType: RequestType
  fullName: string
  email: string
  /** Dial code such as "+263", or "other" while the applicant types their own. */
  phoneCountry: string
  /** Used when phoneCountry is "other". */
  phoneCustomCode: string
  phone: string
  contactMethod: ContactMethod | ''
  profileUrl: string
  storyTitle: string
  storySummary: string
  whyShare: string
  topics: string[]
  interviewFormat: InterviewFormat | ''
  availability: string
  additionalInfo: string
  consentPrivacy: boolean
  consentContact: boolean
  consentAge: boolean
}

export const EMPTY_FORM: StoryForm = {
  requestType: 'story',
  fullName: '',
  email: '',
  phoneCountry: '',
  phoneCustomCode: '',
  phone: '',
  contactMethod: '',
  profileUrl: '',
  storyTitle: '',
  storySummary: '',
  whyShare: '',
  topics: [],
  interviewFormat: '',
  availability: '',
  additionalInfo: '',
  consentPrivacy: false,
  consentContact: false,
  consentAge: false,
}

export const STORY_TOPICS = ['Marriage', 'Family & parenting', 'Faith', 'Addiction & recovery', 'Overcoming adversity', 'Life in the diaspora', 'Love story', 'Something else']

export const LIMITS = {
  fullName: 100,
  email: 254,
  profileUrl: 300,
  storyTitle: 120,
  storySummary: 2000,
  whyShare: 1500,
  availability: 500,
  additionalInfo: 1500,
} as const

export const SUMMARY_MIN = 50

/** Countries with their dial codes, alphabetical. "Other" lets people type any code. */
export const DIAL_CODES: { country: string; code: string }[] = [
  { country: 'Australia', code: '+61' },
  { country: 'Belgium', code: '+32' },
  { country: 'Botswana', code: '+267' },
  { country: 'Brazil', code: '+55' },
  { country: 'Canada', code: '+1' },
  { country: 'China', code: '+86' },
  { country: 'DR Congo', code: '+243' },
  { country: 'Denmark', code: '+45' },
  { country: 'Egypt', code: '+20' },
  { country: 'Eswatini', code: '+268' },
  { country: 'Ethiopia', code: '+251' },
  { country: 'France', code: '+33' },
  { country: 'Germany', code: '+49' },
  { country: 'Ghana', code: '+233' },
  { country: 'India', code: '+91' },
  { country: 'Ireland', code: '+353' },
  { country: 'Italy', code: '+39' },
  { country: 'Kenya', code: '+254' },
  { country: 'Lesotho', code: '+266' },
  { country: 'Malawi', code: '+265' },
  { country: 'Mozambique', code: '+258' },
  { country: 'Namibia', code: '+264' },
  { country: 'Netherlands', code: '+31' },
  { country: 'New Zealand', code: '+64' },
  { country: 'Nigeria', code: '+234' },
  { country: 'Norway', code: '+47' },
  { country: 'Poland', code: '+48' },
  { country: 'Portugal', code: '+351' },
  { country: 'Qatar', code: '+974' },
  { country: 'Rwanda', code: '+250' },
  { country: 'Saudi Arabia', code: '+966' },
  { country: 'South Africa', code: '+27' },
  { country: 'Spain', code: '+34' },
  { country: 'Sweden', code: '+46' },
  { country: 'Switzerland', code: '+41' },
  { country: 'Tanzania', code: '+255' },
  { country: 'Uganda', code: '+256' },
  { country: 'United Arab Emirates', code: '+971' },
  { country: 'United Kingdom', code: '+44' },
  { country: 'United States', code: '+1' },
  { country: 'Zambia', code: '+260' },
  { country: 'Zimbabwe', code: '+263' },
]

export type FieldErrors = Partial<Record<keyof StoryForm, string>>

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** "+263", "077 123 4567" → "+263771234567". Null if it can't be a real international number. */
export function toE164(dialCode: string, phone: string): string | null {
  const code = dialCode.trim().replace(/^00/, '+')
  if (!/^\+\d{1,4}$/.test(code)) return null
  let national = phone.replace(/[\s().-]/g, '')
  // People often type their number with the country code already in it, or with a leading 0.
  if (national.startsWith('+')) national = national.startsWith(code) ? national.slice(code.length) : ''
  else if (national.startsWith('00' + code.slice(1))) national = national.slice(2 + code.length - 1)
  national = national.replace(/^0+/, '')
  if (!/^\d{4,14}$/.test(national)) return null
  const full = code + national
  // E.164 allows at most 15 digits.
  return full.length - 1 <= 15 && full.length - 1 >= 8 ? full : null
}

export const dialCodeOf = (form: Pick<StoryForm, 'phoneCountry' | 'phoneCustomCode'>) =>
  form.phoneCountry === 'other' ? form.phoneCustomCode : form.phoneCountry.split('|')[1] ?? ''

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.')
  } catch {
    return false
  }
}

/** Accepts "instagram.com/name" as well as full URLs. */
export const normaliseUrl = (value: string) => {
  const v = value.trim()
  return v && !/^[a-z]+:\/\//i.test(v) ? `https://${v}` : v
}

export function validate(form: StoryForm): FieldErrors {
  const e: FieldErrors = {}
  const len = (k: keyof typeof LIMITS) => (form[k] as string).trim().length
  const tooLong = (k: keyof typeof LIMITS) => len(k) > LIMITS[k] && `Please keep this under ${LIMITS[k]} characters.`

  if (len('fullName') < 2) e.fullName = 'Please tell us your full name.'
  else if (tooLong('fullName')) e.fullName = tooLong('fullName') as string

  if (!form.email.trim()) e.email = 'Please enter your email address.'
  else if (!EMAIL.test(form.email.trim()) || len('email') > LIMITS.email) e.email = 'That doesn’t look like an email address. Check for typos, e.g. name@example.com.'

  if (!form.contactMethod) e.contactMethod = 'Please choose how you’d like us to contact you.'

  const needsPhone = form.contactMethod === 'phone' || form.contactMethod === 'whatsapp'
  const hasPhone = Boolean(form.phone.trim())
  if (needsPhone && !hasPhone) e.phone = `Please add your phone number so we can reach you by ${form.contactMethod === 'whatsapp' ? 'WhatsApp' : 'phone'}.`
  if (hasPhone) {
    const code = dialCodeOf(form)
    if (!code) e.phoneCountry = 'Please choose your country code.'
    else if (!/^\+?\d{1,4}$/.test(code.trim())) e.phoneCountry = 'Enter a country code such as +44.'
    else if (!toE164(code.startsWith('+') ? code : `+${code}`, form.phone)) e.phone = 'Please check this number. Enter it without the country code, e.g. 77 123 4567.'
  }

  if (form.profileUrl.trim()) {
    if (!isHttpUrl(normaliseUrl(form.profileUrl))) e.profileUrl = 'Please enter a full link, e.g. https://instagram.com/yourname.'
    else if (tooLong('profileUrl')) e.profileUrl = tooLong('profileUrl') as string
  }

  if (form.requestType === 'story') {
    if (len('storyTitle') < 3) e.storyTitle = 'Please give your story a title, even a working one.'
    else if (tooLong('storyTitle')) e.storyTitle = tooLong('storyTitle') as string

    if (len('storySummary') < SUMMARY_MIN) e.storySummary = `Please tell us a little more (at least ${SUMMARY_MIN} characters).`
    else if (tooLong('storySummary')) e.storySummary = tooLong('storySummary') as string

    if (len('whyShare') < 10) e.whyShare = 'Please tell us why you’d like to share it.'
    else if (tooLong('whyShare')) e.whyShare = tooLong('whyShare') as string

    if (!form.topics.length) e.topics = 'Please choose at least one topic.'
    if (!form.interviewFormat) e.interviewFormat = 'Please choose a format, or “Not sure yet”.'
    if (tooLong('additionalInfo')) e.additionalInfo = tooLong('additionalInfo') as string
  } else if (tooLong('storyTitle')) {
    // A call request only needs personal details. The one-line topic is optional.
    e.storyTitle = tooLong('storyTitle') as string
  }

  if (tooLong('availability')) e.availability = tooLong('availability') as string

  if (!form.consentPrivacy) e.consentPrivacy = 'Please confirm you’ve read how we handle your details.'
  if (!form.consentContact) e.consentContact = 'Please agree to us contacting you about your story.'
  if (!form.consentAge) e.consentAge = 'You need to be 18 or over to submit a story.'
  return e
}

/** Short, readable reference such as "NM-261016-K3QX". Avoids characters that are easy to misread (0/O, 1/I). */
export function makeReference(now = new Date(), random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const date = now.toISOString().slice(2, 10).replace(/-/g, '')
  const code = [...random(4)].map((b) => alphabet[b % alphabet.length]).join('')
  return `NM-${date}-${code}`
}

/** Identifies a submission's content, so the same story isn't sent twice by accident. */
export function fingerprint(form: StoryForm): string {
  const text = [form.email, form.storyTitle, form.storySummary].map((s) => s.trim().toLowerCase().replace(/\s+/g, ' ')).join('|')
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

const LABELS = {
  requestType: { story: 'Submit my story', call: 'Request an introductory call' },
  contactMethod: { email: 'Email', phone: 'Phone call', whatsapp: 'WhatsApp' },
  interviewFormat: { 'in-person': 'In person', remote: 'Remote (video call)', undecided: 'Not sure yet' },
} as const

/** Column names in the story_submissions table (supabase/migrations). */
export const FIELD_NAMES = [
  'reference',
  'request_type',
  'full_name',
  'email',
  'phone',
  'preferred_contact',
  'profile_link',
  'story_title',
  'story_summary',
  'why_share',
  'topics',
  'interview_format',
  'availability',
  'additional_info',
  'consents',
] as const

/** What gets saved: one readable value per field. */
export function toSubmission(form: StoryForm, reference: string): Record<(typeof FIELD_NAMES)[number], string> {
  const code = dialCodeOf(form)
  const phone = form.phone.trim() ? (toE164(code.startsWith('+') ? code : `+${code}`, form.phone) ?? `${code} ${form.phone}`.trim()) : ''
  const clean = (s: string) => s.trim()
  // A call request only sends the fields shown for it, even if story answers were typed before switching.
  const story = form.requestType === 'story'
  const ifStory = (s: string) => (story ? s : '')
  return {
    reference,
    request_type: LABELS.requestType[form.requestType] + (form.requestType === 'call' ? ' (pending: not booked until the team confirms)' : ''),
    full_name: clean(form.fullName),
    email: clean(form.email),
    phone,
    preferred_contact: form.contactMethod ? LABELS.contactMethod[form.contactMethod] : '',
    profile_link: normaliseUrl(form.profileUrl),
    story_title: clean(form.storyTitle),
    story_summary: ifStory(clean(form.storySummary)),
    why_share: ifStory(clean(form.whyShare)),
    topics: ifStory(form.topics.join(', ')),
    interview_format: ifStory(form.interviewFormat ? LABELS.interviewFormat[form.interviewFormat] : ''),
    availability: clean(form.availability),
    additional_info: ifStory(clean(form.additionalInfo)),
    consents: [form.consentPrivacy && 'privacy notice read', form.consentContact && 'agrees to be contacted', form.consentAge && '18 or over'].filter(Boolean).join('; '),
  }
}

/**
 * Rebuilds a StoryForm from untrusted JSON, for the server. Unknown keys are dropped
 * and wrongly typed values become empty, so validate() then rejects them.
 */
export function parseStoryForm(input: unknown): StoryForm | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const text = (key: keyof StoryForm) => (typeof raw[key] === 'string' ? (raw[key] as string).slice(0, 5000) : '')
  const pick = <T extends string>(key: keyof StoryForm, allowed: readonly T[]): T | '' => (allowed.includes(raw[key] as T) ? (raw[key] as T) : '')
  return {
    requestType: pick('requestType', ['story', 'call'] as const) || 'story',
    fullName: text('fullName'),
    email: text('email'),
    phoneCountry: text('phoneCountry'),
    phoneCustomCode: text('phoneCustomCode'),
    phone: text('phone'),
    contactMethod: pick('contactMethod', ['email', 'phone', 'whatsapp'] as const),
    profileUrl: text('profileUrl'),
    storyTitle: text('storyTitle'),
    storySummary: text('storySummary'),
    whyShare: text('whyShare'),
    topics: Array.isArray(raw.topics) ? [...new Set(raw.topics.filter((t): t is string => STORY_TOPICS.includes(t as string)))] : [],
    interviewFormat: pick('interviewFormat', ['in-person', 'remote', 'undecided'] as const),
    availability: text('availability'),
    additionalInfo: text('additionalInfo'),
    consentPrivacy: raw.consentPrivacy === true,
    consentContact: raw.consentContact === true,
    consentAge: raw.consentAge === true,
  }
}

export const REFERENCE_PATTERN = /^NM-\d{6}-[A-Z2-9]{4}$/

/**
 * What the visitor sees when sending fails, by the server's HTTP status (0 = no answer).
 * Every message says the answers are still on the page, because they are.
 */
export function submitErrorMessage(status: number, offline: boolean): string {
  if (offline) return 'You seem to be offline. Your answers are still here: reconnect and press Send again.'
  if (status === 400) return 'Something in the form wasn’t accepted. Please check your answers and press Send again.'
  if (status === 429) return 'We’re receiving a lot of submissions right now. Your answers are still here, so please try again in a few minutes.'
  if (status === 503) return 'The form is temporarily unavailable while we fix something on our side. Your answers are still here, so please try again later today.'
  return 'Something went wrong and your story wasn’t sent. Your answers are still here, so please try again in a moment.'
}
