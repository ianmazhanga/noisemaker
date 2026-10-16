import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { AlertCircle, CalendarClock, Check, Copy, Mic, PenLine } from 'lucide-react'
import { Seo } from '../components/seo/Seo'
import { PageIntro } from '../components/ui/PageIntro'
import { buttonClass } from '../components/ui/buttonClass'
import { YouTubeIcon } from '../components/ui/BrandIcons'
import { SITE } from '../config/site'
import { breadcrumbLd } from '../lib/structuredData'
import {
  DIAL_CODES,
  EMPTY_FORM,
  HONEYPOT,
  LIMITS,
  STORY_TOPICS,
  SUMMARY_MIN,
  encodeSubmission,
  fingerprint,
  makeReference,
  toSubmission,
  validate,
  type RequestType,
  type StoryForm,
} from '../lib/storyForm'

/** Order fields are checked in, so the first problem on the page gets focus. */
const FIELD_ORDER: (keyof StoryForm)[] = [
  'fullName',
  'email',
  'contactMethod',
  'phoneCountry',
  'phoneCustomCode',
  'phone',
  'profileUrl',
  'storyTitle',
  'storySummary',
  'whyShare',
  'topics',
  'interviewFormat',
  'availability',
  'additionalInfo',
  'consentPrivacy',
  'consentContact',
  'consentAge',
]

// Remembers stories already sent in this browser tab, so a double click or a reload doesn't send one twice.
const SENT_KEY = 'nm-story-sent'
function readSent(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(SENT_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}
function rememberSent(print: string, reference: string) {
  try {
    sessionStorage.setItem(SENT_KEY, JSON.stringify({ ...readSent(), [print]: reference }))
  } catch {
    // Storage can be unavailable (private browsing). Duplicate protection then relies on the disabled button.
  }
}

const input =
  'w-full rounded-lg border-[1.5px] border-ink/20 bg-white px-4 text-base text-ink placeholder:text-muted/70 transition-colors hover:border-ink/40 focus:border-ink focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue aria-invalid:border-danger'

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'error'; message: string } | { kind: 'duplicate'; reference: string }

export default function TellYourStoryPage() {
  const [form, setForm] = useState<StoryForm>(EMPTY_FORM)
  const [touched, setTouched] = useState<Partial<Record<keyof StoryForm, boolean>>>({})
  const [attempted, setAttempted] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [sent, setSent] = useState<{ reference: string; requestType: RequestType; contactMethod: StoryForm['contactMethod'] } | null>(null)
  const honeypotRef = useRef<HTMLInputElement>(null)
  const sendingRef = useRef(false)

  const isStory = form.requestType === 'story'
  const liveErrors = useMemo(() => validate(form), [form])
  const errorFor = (k: keyof StoryForm) => (attempted || touched[k] ? liveErrors[k] : undefined)
  const errorCount = Object.keys(liveErrors).length

  const set = <K extends keyof StoryForm>(key: K, value: StoryForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (status.kind === 'error' || status.kind === 'duplicate') setStatus({ kind: 'idle' })
  }
  const blur = (key: keyof StoryForm) => () => setTouched((t) => ({ ...t, [key]: true }))

  async function submit(force = false) {
    if (sendingRef.current) return
    setAttempted(true)
    const errors = validate(form)
    const first = FIELD_ORDER.find((k) => errors[k])
    if (first) {
      document.getElementById(`field-${first}`)?.focus()
      return
    }

    const print = fingerprint(form)
    const previous = readSent()[print]
    if (previous && !force) {
      setStatus({ kind: 'duplicate', reference: previous })
      return
    }

    sendingRef.current = true
    setStatus({ kind: 'sending' })
    const reference = makeReference()
    try {
      const body = encodeSubmission(toSubmission(form, reference), honeypotRef.current?.value ?? '')
      if (import.meta.env.DEV) {
        // Netlify Forms only exists on the deployed site. Locally, pretend it worked so the flow can be tested.
        await new Promise((r) => setTimeout(r, 600))
      } else {
        const res = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
        if (!res.ok) throw new Error(String(res.status))
      }
      rememberSent(print, reference)
      setSent({ reference, requestType: form.requestType, contactMethod: form.contactMethod })
      window.scrollTo({ top: 0, behavior: 'instant' })
    } catch {
      setStatus({
        kind: 'error',
        message: navigator.onLine === false ? 'You seem to be offline. Your answers are still here: reconnect and press Send again.' : 'Something went wrong and your story wasn’t sent. Your answers are still here, so please try again in a moment.',
      })
    } finally {
      sendingRef.current = false
    }
  }

  return (
    <>
      <Seo
        title="Tell your story"
        description="Have an experience, perspective or journey worth sharing? Tell Noisemakers about it, or request an introductory call."
        jsonLd={breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Tell your story', path: '/tell-your-story' },
        ])}
      />
      {sent ? (
        <Confirmation {...sent} />
      ) : (
        <>
          <PageIntro
            kicker="Tell your story"
            title={
              <>
                Your story deserves to be <span className="accent">heard.</span>
              </>
            }
            intro="Have an experience, perspective, or journey worth sharing? Tell us about it. The Noisemakers team will review your submission and contact you if it is a fit for an upcoming conversation."
            crumbs={[{ label: 'Home', to: '/' }, { label: 'Tell your story' }]}
          />

          <div className="wrap grid gap-12 pb-20 md:pb-28 lg:grid-cols-12 lg:gap-10">
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
              className="lg:col-span-8"
              aria-describedby="form-intro"
            >
              <p id="form-intro" className="sr-only">
                Fields marked “required” must be filled in.
              </p>
              {/* Honeypot: hidden from people and screen readers. */}
              <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label>
                  Leave this empty
                  <input ref={honeypotRef} name={HONEYPOT} tabIndex={-1} autoComplete="off" />
                </label>
              </div>

              <fieldset>
                <legend className="title text-2xl">How would you like to start?</legend>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <ChoiceCard
                    name="requestType"
                    checked={form.requestType === 'story'}
                    onChange={() => set('requestType', 'story')}
                    icon={<PenLine className="size-5" aria-hidden />}
                    title="Submit my story"
                    body="Tell us about it here. The team reviews it and gets in touch if it’s a fit."
                  />
                  <ChoiceCard
                    name="requestType"
                    checked={form.requestType === 'call'}
                    onChange={() => set('requestType', 'call')}
                    icon={<CalendarClock className="size-5" aria-hidden />}
                    title="Request an introductory call"
                    body="Rather talk first? Just leave your details and the team will contact you to arrange a short call."
                  />
                </div>
              </fieldset>

              <Section index="01" title="About you">
                <Field id="fullName" label="Full name" required error={errorFor('fullName')}>
                  {(a) => <input {...a} className={`${input} h-12`} autoComplete="name" maxLength={LIMITS.fullName + 20} value={form.fullName} onChange={(e) => set('fullName', e.target.value)} onBlur={blur('fullName')} />}
                </Field>
                <Field id="email" label="Email address" required error={errorFor('email')}>
                  {(a) => (
                    <input
                      {...a}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      spellCheck={false}
                      className={`${input} h-12`}
                      value={form.email}
                      onChange={(e) => set('email', e.target.value)}
                      onBlur={blur('email')}
                    />
                  )}
                </Field>

                <RadioGroup
                  id="contactMethod"
                  legend="How should we contact you?"
                  required
                  error={errorFor('contactMethod')}
                  value={form.contactMethod}
                  onChange={(v) => set('contactMethod', v as StoryForm['contactMethod'])}
                  options={[
                    { value: 'email', label: 'Email' },
                    { value: 'phone', label: 'Phone call' },
                    { value: 'whatsapp', label: 'WhatsApp' },
                  ]}
                />

                <fieldset>
                  <legend className="font-semibold">
                    Phone number{' '}
                    <span className="font-normal text-muted">{form.contactMethod === 'phone' || form.contactMethod === 'whatsapp' ? '(required)' : '(optional)'}</span>
                  </legend>
                  <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,15rem)_1fr]">
                    <div>
                      <label htmlFor="field-phoneCountry" className="sr-only">
                        Country code
                      </label>
                      <select
                        id="field-phoneCountry"
                        className={`${input} h-12 pr-8`}
                        autoComplete="tel-country-code"
                        aria-invalid={Boolean(errorFor('phoneCountry')) || undefined}
                        aria-describedby={errorFor('phoneCountry') ? 'error-phoneCountry' : undefined}
                        value={form.phoneCountry}
                        onChange={(e) => set('phoneCountry', e.target.value)}
                        onBlur={blur('phoneCountry')}
                      >
                        <option value="">Country code</option>
                        {DIAL_CODES.map((d) => (
                          <option key={d.country} value={`${d.country}|${d.code}`}>
                            {d.country} ({d.code})
                          </option>
                        ))}
                        <option value="other">Other (type the code)</option>
                      </select>
                      {form.phoneCountry === 'other' && (
                        <>
                          <label htmlFor="field-phoneCustomCode" className="sr-only">
                            Your country code
                          </label>
                          <input
                            id="field-phoneCustomCode"
                            className={`${input} mt-3 h-12`}
                            inputMode="tel"
                            placeholder="+000"
                            maxLength={5}
                            value={form.phoneCustomCode}
                            onChange={(e) => set('phoneCustomCode', e.target.value)}
                          />
                        </>
                      )}
                    </div>
                    <div>
                      <label htmlFor="field-phone" className="sr-only">
                        Phone number, without the country code
                      </label>
                      <input
                        id="field-phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel-national"
                        placeholder="e.g. 77 123 4567"
                        className={`${input} h-12`}
                        aria-invalid={Boolean(errorFor('phone')) || undefined}
                        aria-describedby={errorFor('phone') ? 'error-phone' : 'hint-phone'}
                        value={form.phone}
                        onChange={(e) => set('phone', e.target.value)}
                        onBlur={blur('phone')}
                      />
                    </div>
                  </div>
                  <p id="hint-phone" className="mt-2 text-sm text-muted">
                    Choose your country, then enter your number without the country code.
                  </p>
                  <FieldError id="phoneCountry" error={errorFor('phoneCountry')} />
                  <FieldError id="phone" error={errorFor('phone')} />
                </fieldset>

                <Field id="profileUrl" label="Social media or professional profile" optional hint="Instagram, Facebook, LinkedIn, a website…" error={errorFor('profileUrl')}>
                  {(a) => (
                    <input
                      {...a}
                      type="url"
                      inputMode="url"
                      autoComplete="url"
                      spellCheck={false}
                      placeholder="https://"
                      className={`${input} h-12`}
                      value={form.profileUrl}
                      onChange={(e) => set('profileUrl', e.target.value)}
                      onBlur={blur('profileUrl')}
                    />
                  )}
                </Field>
              </Section>

              {isStory ? (
                <>
                <Section index="02" title="Your story">
                  <Field id="storyTitle" label="A title for your story" required hint="A working title is fine, e.g. “Raising our children far from home”." error={errorFor('storyTitle')}>
                    {(a) => <input {...a} className={`${input} h-12`} value={form.storyTitle} onChange={(e) => set('storyTitle', e.target.value)} onBlur={blur('storyTitle')} />}
                  </Field>
                  <TextArea
                    id="storySummary"
                    label="Tell us your story"
                    hint="What happened, and what you learned along the way. A few paragraphs is plenty."
                    required
                    rows={7}
                    min={SUMMARY_MIN}
                    max={LIMITS.storySummary}
                    value={form.storySummary}
                    error={errorFor('storySummary')}
                    onChange={(v) => set('storySummary', v)}
                    onBlur={blur('storySummary')}
                  />
                  <TextArea
                    id="whyShare"
                    label="Why do you want to share it?"
                    hint="Who do you hope it will help, or what do you want people to take away?"
                    required
                    rows={4}
                    max={LIMITS.whyShare}
                    value={form.whyShare}
                    error={errorFor('whyShare')}
                    onChange={(v) => set('whyShare', v)}
                    onBlur={blur('whyShare')}
                  />
                  <fieldset aria-describedby={errorFor('topics') ? 'error-topics' : undefined}>
                    <legend className="font-semibold">
                      Which topics does it touch on? <span className="font-normal text-muted">(choose any)</span>
                    </legend>
                    <div className="mt-3 flex flex-wrap gap-2" id="field-topics" tabIndex={-1}>
                      {STORY_TOPICS.map((t) => {
                        const on = form.topics.includes(t)
                        return (
                          <label
                            key={t}
                            className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-4 text-[0.9375rem] font-medium transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue ${
                              on ? 'border-ink bg-ink text-paper' : 'border-ink/20 bg-white hover:border-ink/50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={on}
                              onChange={() => {
                                set('topics', on ? form.topics.filter((x) => x !== t) : [...form.topics, t])
                                setTouched((x) => ({ ...x, topics: true }))
                              }}
                            />
                            {on && <Check className="size-4" aria-hidden />}
                            {t}
                          </label>
                        )
                      })}
                    </div>
                    <FieldError id="topics" error={errorFor('topics')} />
                  </fieldset>
                </Section>

                <Section index="03" title="The conversation">
                  <RadioGroup
                    id="interviewFormat"
                    legend="How would you prefer to talk?"
                    required
                    error={errorFor('interviewFormat')}
                    value={form.interviewFormat}
                    onChange={(v) => set('interviewFormat', v as StoryForm['interviewFormat'])}
                    options={[
                      { value: 'in-person', label: 'In person' },
                      { value: 'remote', label: 'Remote (video call)' },
                      { value: 'undecided', label: 'Not sure yet' },
                    ]}
                  />
                  <TextArea
                    id="availability"
                    label="When are you usually available?"
                    hint="Days, times or dates that work for you, with your time zone."
                    optional
                    rows={3}
                    max={LIMITS.availability}
                    value={form.availability}
                    error={errorFor('availability')}
                    onChange={(v) => set('availability', v)}
                    onBlur={blur('availability')}
                  />
                  <TextArea
                    id="additionalInfo"
                    label="Anything else we should know?"
                    optional
                    rows={3}
                    max={LIMITS.additionalInfo}
                    value={form.additionalInfo}
                    error={errorFor('additionalInfo')}
                    onChange={(v) => set('additionalInfo', v)}
                    onBlur={blur('additionalInfo')}
                  />
                </Section>
                </>
              ) : (
                <Section index="02" title="Your call">
                  <p className="text-muted">That’s all we need. Someone from the team will contact you to arrange a short, no-pressure call.</p>
                  <TextArea
                    id="availability"
                    label="When would suit you for a call?"
                    hint="Days and times that work for you, with your time zone, e.g. “Weekday evenings after 6pm UK time”. Nothing is booked until the team confirms with you."
                    optional
                    rows={3}
                    max={LIMITS.availability}
                    value={form.availability}
                    error={errorFor('availability')}
                    onChange={(v) => set('availability', v)}
                    onBlur={blur('availability')}
                  />
                  <Field id="storyTitle" label="What would you like to talk about?" optional hint="A few words is enough, e.g. “Raising children abroad”." error={errorFor('storyTitle')}>
                    {(a) => <input {...a} className={`${input} h-12`} value={form.storyTitle} onChange={(e) => set('storyTitle', e.target.value)} onBlur={blur('storyTitle')} />}
                  </Field>
                </Section>
              )}

              <Section index={isStory ? '04' : '03'} title="Before you send">
                <div className="rounded-lg bg-bone p-5 text-[0.9375rem] text-muted md:p-6">
                  <h3 className="font-sans font-semibold text-ink">How we handle your details</h3>
                  <p className="mt-2">
                    We use what you share only to consider your story and contact you about it. It is stored by our website host, Netlify, and seen only by the Noisemakers team. Nothing
                    you send is published without your agreement, and it is never sold. You can ask us to delete your submission at any time.{' '}
                    <Link to="/privacy" className="font-semibold text-blue-ink underline underline-offset-4">
                      Read the privacy notice
                    </Link>
                  </p>
                </div>
                <div className="space-y-3">
                  <Checkbox id="consentPrivacy" checked={form.consentPrivacy} onChange={(v) => set('consentPrivacy', v)} error={errorFor('consentPrivacy')}>
                    I’ve read how my details will be used and stored.
                  </Checkbox>
                  <Checkbox id="consentContact" checked={form.consentContact} onChange={(v) => set('consentContact', v)} error={errorFor('consentContact')}>
                    The Noisemakers team may contact me about my {isStory ? 'story' : 'request'} by my chosen method.
                  </Checkbox>
                  <Checkbox id="consentAge" checked={form.consentAge} onChange={(v) => set('consentAge', v)} error={errorFor('consentAge')}>
                    I’m 18 or over.
                  </Checkbox>
                </div>
                {isStory && (
                <p className="text-[0.9375rem] text-muted">
                  We read every story with care, but we can’t feature every one. If yours isn’t a fit for an upcoming conversation, we may not be in touch.
                </p>
                )}
              </Section>

              <div className="mt-10 border-t border-line pt-8">
                <div aria-live="polite">
                  {attempted && errorCount > 0 && (
                    <p className="mb-5 flex items-start gap-2 font-semibold text-danger">
                      <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
                      {errorCount === 1 ? 'One thing needs your attention before you send.' : `${errorCount} things need your attention before you send.`}
                    </p>
                  )}
                  {status.kind === 'error' && (
                    <p role="alert" className="mb-5 flex items-start gap-2 rounded-lg border-[1.5px] border-danger/30 bg-white p-4 font-semibold text-danger">
                      <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
                      {status.message}
                    </p>
                  )}
                  {status.kind === 'duplicate' && (
                    <div role="alert" className="mb-5 rounded-lg border-[1.5px] border-ink/15 bg-white p-4">
                      <p className="font-semibold">
                        You already sent this story from this browser (reference <span className="font-mono">{status.reference}</span>). There’s no need to send it again.
                      </p>
                      <button type="button" onClick={() => void submit(true)} className="mt-2 min-h-11 font-semibold text-blue-ink underline underline-offset-4">
                        I’ve changed something, send it again
                      </button>
                    </div>
                  )}
                </div>
                <button type="submit" disabled={status.kind === 'sending'} className={buttonClass('primary', 'lg', 'w-full sm:w-auto')}>
                  {status.kind === 'sending' ? (
                    <>
                      <span className="size-4 animate-spin-slow rounded-full border-2 border-white/30 border-t-white" aria-hidden /> Sending…
                    </>
                  ) : !isStory ? (
                    'Request a call'
                  ) : (
                    'Send my story'
                  )}
                </button>
              </div>
            </form>

            <aside className="lg:col-span-4" aria-label="What happens next">
              <div className="rounded-lg bg-ink p-6 text-paper md:p-8 lg:sticky lg:top-[calc(var(--header-h)+1.5rem)]">
                <Mic className="size-6 text-yellow" aria-hidden />
                <h2 className="title mt-4 text-2xl">What happens next</h2>
                <ol className="mt-5 space-y-4 text-paper/80">
                  {(isStory
                    ? [
                        'You get a reference number as soon as you send your story.',
                        'The Noisemakers team reads it and considers it for an upcoming conversation.',
                        'If it’s a fit, the team contacts you by email, phone or WhatsApp, whichever you chose, to talk it through and arrange a time.',
                      ]
                    : [
                        'You get a reference number as soon as you send your request.',
                        'The Noisemakers team contacts you by email, phone or WhatsApp, whichever you chose.',
                        'Together you agree a time for a short call about your story.',
                      ]
                  ).map((step, i) => (
                    <li key={step} className="flex gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-paper/10 text-sm font-semibold text-paper">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-6 border-t border-line-dark pt-5 text-sm text-paper/70">
                  Calls are never booked automatically. A call request stays pending until someone from the team confirms a time with you.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
    </>
  )
}

function Confirmation({ reference, requestType, contactMethod }: { reference: string; requestType: RequestType; contactMethod: StoryForm['contactMethod'] }) {
  const [copied, setCopied] = useState(false)
  const via = contactMethod === 'whatsapp' ? 'WhatsApp' : contactMethod === 'phone' ? 'phone' : 'email'
  return (
    <div className="wrap pt-10 pb-20 md:pt-16 md:pb-28">
      <div className="max-w-3xl">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-yellow text-ink">
          <Check className="size-7" aria-hidden />
        </span>
        <h1 className="display-lg mt-6" tabIndex={-1} ref={(el) => el?.focus()}>
          Thank you. Your {requestType === 'call' ? 'request' : 'story'} has been <span className="accent">sent.</span>
        </h1>
        <div className="mt-8 inline-flex flex-wrap items-center gap-3 rounded-lg bg-bone px-5 py-4">
          <span className="kicker text-muted">Your reference</span>
          <span className="font-mono text-xl font-semibold tracking-wide">{reference}</span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(reference).then(() => setCopied(true), () => undefined)
            }}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-blue-ink hover:bg-paper"
          >
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="measure mt-8 text-lg text-muted">
          Keep this reference in case you need to contact us about your submission.{' '}
          {requestType === 'call'
            ? `The Noisemakers team will get in touch by ${via} to arrange your call.`
            : `The Noisemakers team reviews every story and will get in touch by ${via} if yours is a fit for an upcoming conversation.`}
        </p>
        {requestType === 'call' && (
          <p className="measure mt-4 rounded-lg border-[1.5px] border-ink/15 p-5 text-lg">
            <strong>Your call request is pending.</strong> Nothing is booked yet. The team will contact you to agree a time that suits you both.
          </p>
        )}
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link to="/episodes" className={buttonClass('dark', 'lg', 'w-full sm:w-auto')}>
            Watch the episodes
          </Link>
          <a href={SITE.youtube.subscribeUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('outline', 'lg', 'w-full sm:w-auto')}>
            <YouTubeIcon className="size-5 text-[#ff0033]" /> Subscribe on YouTube<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </div>
  )
}

/* ---- Form building blocks ------------------------------------------------ */

function Section({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="mt-12 border-t border-line pt-8">
      <h2 id={id} className="title flex items-baseline gap-3 text-2xl">
        <span className="kicker text-blue-ink">{index}</span>
        {title}
      </h2>
      <div className="mt-6 space-y-6">{children}</div>
    </section>
  )
}

function Label({ htmlFor, label, required, optional }: { htmlFor: string; label: string; required?: boolean; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="block font-semibold">
      {label} {required && <span className="font-normal text-muted">(required)</span>}
      {optional && <span className="font-normal text-muted">(optional)</span>}
    </label>
  )
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null
  return (
    <p id={`error-${id}`} className="mt-2 flex items-start gap-1.5 text-[0.9375rem] font-medium text-danger">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {error}
    </p>
  )
}

interface ControlProps {
  id: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  'aria-required'?: boolean
}

function describedBy(id: string, hint?: string, error?: string) {
  return [error && `error-${id}`, hint && `hint-${id}`].filter(Boolean).join(' ') || undefined
}

function Field({
  id,
  label,
  hint,
  required,
  optional,
  error,
  children,
}: {
  id: keyof StoryForm
  label: string
  hint?: string
  required?: boolean
  optional?: boolean
  error?: string
  children: (props: ControlProps) => ReactNode
}) {
  return (
    <div>
      <Label htmlFor={`field-${id}`} label={label} required={required} optional={optional} />
      {hint && (
        <p id={`hint-${id}`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      <div className="mt-2">
        {children({ id: `field-${id}`, 'aria-invalid': Boolean(error) || undefined, 'aria-describedby': describedBy(id, hint, error), 'aria-required': required || undefined })}
      </div>
      <FieldError id={id} error={error} />
    </div>
  )
}

function TextArea({
  id,
  label,
  hint,
  required,
  optional,
  rows,
  min,
  max,
  value,
  error,
  onChange,
  onBlur,
}: {
  id: keyof StoryForm
  label: string
  hint?: string
  required?: boolean
  optional?: boolean
  rows: number
  min?: number
  max: number
  value: string
  error?: string
  onChange: (v: string) => void
  onBlur: () => void
}) {
  const length = value.trim().length
  const over = length > max
  return (
    <Field id={id} label={label} hint={hint} required={required} optional={optional} error={error}>
      {(a) => (
        <>
          <textarea {...a} rows={rows} className={`${input} block py-3 leading-relaxed`} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
          <p className={`mt-1 text-right text-xs tabular-nums ${over ? 'font-semibold text-danger' : 'text-muted'}`} aria-hidden>
            {min && length < min ? `${length} / at least ${min}` : `${length} / ${max}`}
          </p>
        </>
      )}
    </Field>
  )
}

function RadioGroup({
  id,
  legend,
  required,
  error,
  value,
  onChange,
  options,
}: {
  id: keyof StoryForm
  legend: string
  required?: boolean
  error?: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <fieldset aria-describedby={error ? `error-${id}` : undefined}>
      <legend className="font-semibold">
        {legend} {required && <span className="font-normal text-muted">(required)</span>}
      </legend>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((o, i) => (
          <label
            key={o.value}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-full border-[1.5px] px-4 text-[0.9375rem] font-medium transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue ${
              value === o.value ? 'border-ink bg-ink text-paper' : `bg-white hover:border-ink/50 ${error ? 'border-danger' : 'border-ink/20'}`
            }`}
          >
            <input
              type="radio"
              name={id}
              value={o.value}
              id={i === 0 ? `field-${id}` : undefined}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
              aria-invalid={Boolean(error) || undefined}
            />
            <span aria-hidden className={`size-4 rounded-full border-[1.5px] ${value === o.value ? 'border-paper bg-paper ring-3 ring-ink ring-inset' : 'border-ink/40'}`} />
            {o.label}
          </label>
        ))}
      </div>
      <FieldError id={id} error={error} />
    </fieldset>
  )
}

function Checkbox({ id, checked, onChange, error, children }: { id: keyof StoryForm; checked: boolean; onChange: (v: boolean) => void; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={`field-${id}`} className="flex cursor-pointer items-start gap-3">
        <input
          id={`field-${id}`}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `error-${id}` : undefined}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-blue"
        />
        <span>
          {children} <span className="text-muted">(required)</span>
        </span>
      </label>
      <div className="pl-8">
        <FieldError id={id} error={error} />
      </div>
    </div>
  )
}

function ChoiceCard({ name, checked, onChange, icon, title, body }: { name: string; checked: boolean; onChange: () => void; icon: ReactNode; title: string; body: string }) {
  return (
    <label
      className={`relative flex cursor-pointer flex-col gap-2 rounded-lg border-[1.5px] p-5 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue ${
        checked ? 'border-blue bg-blue/5' : 'border-ink/15 bg-white hover:border-ink/40'
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      <span className="flex items-center justify-between">
        <span className={`inline-flex size-10 items-center justify-center rounded-full ${checked ? 'bg-blue text-white' : 'bg-bone text-ink'}`}>{icon}</span>
        <span aria-hidden className={`size-5 rounded-full border-[1.5px] ${checked ? 'border-blue bg-blue ring-3 ring-white ring-inset' : 'border-ink/30'}`} />
      </span>
      <span className="title text-lg">{title}</span>
      <span className="text-[0.9375rem] text-muted">{body}</span>
    </label>
  )
}
