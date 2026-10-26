import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { AlertTriangle, Sparkles } from 'lucide-react'
import { buttonClass } from '../../components/ui/buttonClass'
import { inputClass } from '../../components/inbox/shared'
import { cleanHashtags, PLATFORM_KEYS, PLATFORMS, type Platform } from '../../lib/social'
import { useAdmin, friendlyError } from '../context'
import { Spinner } from '../AdminApp'
import { PLATFORM_STYLE, requestDrafts, type ChannelVideo, type PostRow, type Suggestion } from './shared'

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })

interface Props {
  videos: ChannelVideo[]
  posts: PostRow[]
  onSaved: () => void
}

export function CreateTab({ videos, posts, onSaved }: Props) {
  const withPosts = new Set(posts.filter((p) => p.source_type === 'youtube').map((p) => p.source_ref))
  const [params] = useSearchParams()
  // ?video=<id> (from the YouTube Manager) opens with that video chosen.
  const [chosen, setChosen] = useState<ChannelVideo | null>(() => videos.find((v) => v.youtubeId === params.get('video')) ?? null)
  const [showAll, setShowAll] = useState(false)
  const list = showAll ? videos : videos.slice(0, 8)

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section aria-labelledby="videos-heading">
        <h2 id="videos-heading" className="text-xl font-semibold">
          From a YouTube video
        </h2>
        <p className="mt-1 text-sm text-muted">The channel’s videos, newest first. New uploads appear here automatically once the YouTube sync runs.</p>
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-paper">
          {list.map((v) => (
            <li key={v.youtubeId}>
              <button type="button" onClick={() => setChosen(v)} aria-pressed={chosen?.youtubeId === v.youtubeId} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-bone ${chosen?.youtubeId === v.youtubeId ? 'bg-bone' : ''}`}>
                <img src={`https://i.ytimg.com/vi/${v.youtubeId}/mqdefault.jpg`} alt="" className="aspect-video w-24 shrink-0 rounded object-cover" loading="lazy" />
                <span className="min-w-0 flex-1">
                  <span className="clamp-2 block font-semibold">{v.title}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {v.kind} · {day(v.publishedAt)}
                  </span>
                </span>
                {!withPosts.has(v.youtubeId) && <span className="shrink-0 rounded-full bg-yellow px-2 py-0.5 text-xs font-semibold">No posts yet</span>}
              </button>
            </li>
          ))}
        </ul>
        {videos.length > 8 && (
          <button type="button" className="mt-2 text-sm font-semibold text-blue-ink underline underline-offset-4" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer' : `Show all ${videos.length} videos`}
          </button>
        )}
      </section>

      <div className="space-y-8">
        {chosen ? <AiWriter key={chosen.youtubeId} video={chosen} onSaved={onSaved} /> : <p className="rounded-xl border border-dashed border-ink/20 p-5 text-muted">Choose a video to write posts about it with AI, or write a post yourself below.</p>}
        <ManualPost video={chosen} onSaved={onSaved} />
      </div>
    </div>
  )
}

function PlatformPicker({ value, onChange }: { value: Platform[]; onChange: (v: Platform[]) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold">Platforms</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {PLATFORM_KEYS.map((p) => (
          <label key={p} className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm font-semibold ${value.includes(p) ? 'border-ink bg-ink text-paper' : 'border-ink/20'}`}>
            <input type="checkbox" className="sr-only" checked={value.includes(p)} onChange={(e) => onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))} />
            {PLATFORMS[p].label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function AiWriter({ video, onSaved }: { video: ChannelVideo; onSaved: () => void }) {
  const { db, session, toast } = useAdmin()
  const [platforms, setPlatforms] = useState<Platform[]>(['instagram', 'facebook', 'tiktok', 'youtube', 'x'])
  const [variations, setVariations] = useState(2)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ summary: string; drafts: (Suggestion & { keep: boolean })[] } | null>(null)

  async function write() {
    setBusy(true)
    setError('')
    try {
      const { summary, drafts } = await requestDrafts(session.access_token, video, platforms, variations)
      setResult({ summary, drafts: drafts.map((d) => ({ ...d, keep: d.warnings.length === 0 })) })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!result) return
    const rows = result.drafts
      .filter((d) => d.keep && d.caption.trim())
      .map((d) => ({ platform: d.platform, caption: d.caption.trim(), hashtags: d.hashtags, link_url: video.url, source_type: 'youtube', source_ref: video.youtubeId, source_title: video.title, ai_generated: true }))
    if (!rows.length) return toast('Tick at least one draft to keep.', 'error')
    setBusy(true)
    const { error: e } = await db.from('social_posts').insert(rows)
    setBusy(false)
    if (e) return toast(friendlyError(e), 'error')
    toast(`${rows.length} draft${rows.length === 1 ? '' : 's'} saved. Send them for approval from the Posts tab.`)
    setResult(null)
    onSaved()
  }

  const update = (i: number, patch: Partial<Suggestion & { keep: boolean }>) => setResult((r) => r && { ...r, drafts: r.drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)) })

  return (
    <section aria-labelledby="ai-heading" className="rounded-xl border border-line bg-paper p-5">
      <h2 id="ai-heading" className="flex items-center gap-2 text-xl font-semibold">
        <Sparkles className="size-5 text-blue" aria-hidden /> Write with AI
      </h2>
      <p className="mt-1 text-sm text-muted">
        About <span className="font-semibold text-ink">{video.title}</span>. The AI uses only this video’s title and description, and is told never to invent quotes or facts. Everything it writes is saved
        as a draft for you to check.
      </p>
      <div className="mt-4 space-y-4">
        <PlatformPicker value={platforms} onChange={setPlatforms} />
        <label className="flex items-center gap-2 text-sm font-semibold">
          Variations per platform
          <select className={`${inputClass} min-h-10 w-auto py-1`} value={variations} onChange={(e) => setVariations(Number(e.target.value))}>
            {[1, 2, 3].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button type="button" className={buttonClass('primary', 'md')} disabled={busy || !platforms.length} onClick={() => void write()}>
          <Sparkles className="size-4" aria-hidden /> {busy && !result ? 'Writing…' : result ? 'Write again' : 'Write drafts'}
        </button>
        {busy && !result && <Spinner label="The AI is writing drafts. This takes up to half a minute…" />}
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-4 py-3 text-danger">
            {error}
          </p>
        )}
      </div>

      {result && (
        <div className="mt-6 space-y-4">
          {result.summary && (
            <div className="rounded-lg bg-bone px-4 py-3">
              <p className="kicker text-muted">AI summary</p>
              <p className="mt-1">{result.summary}</p>
            </div>
          )}
          {result.drafts.map((d, i) => (
            <div key={i} className={`rounded-lg border p-4 ${d.keep ? 'border-ink/30' : 'border-line opacity-70'}`}>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PLATFORM_STYLE[d.platform]}`}>{PLATFORMS[d.platform].label}</span>
                <label className="ml-auto flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" className="size-4 accent-blue" checked={d.keep} onChange={(e) => update(i, { keep: e.target.checked })} /> Keep
                </label>
              </div>
              {d.warnings.map((w) => (
                <p key={w} className="mt-2 flex gap-2 text-sm text-danger">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {w}
                </p>
              ))}
              <textarea rows={5} aria-label={`${PLATFORMS[d.platform].label} caption`} className={`${inputClass} mt-2 py-3`} value={d.caption} onChange={(e) => update(i, { caption: e.target.value })} />
              <p className="mt-1 text-xs text-muted">
                {d.caption.trim().length} / {PLATFORMS[d.platform].maxCaption} · {d.hashtags.map((h) => `#${h}`).join(' ')}
              </p>
            </div>
          ))}
          <button type="button" className={buttonClass('dark', 'md')} disabled={busy} onClick={() => void save()}>
            Save ticked drafts
          </button>
        </div>
      )}
    </section>
  )
}

function ManualPost({ video, onSaved }: { video: ChannelVideo | null; onSaved: () => void }) {
  const { db, toast } = useAdmin()
  const [platform, setPlatform] = useState<Platform>('instagram')
  const [caption, setCaption] = useState('')
  const [tags, setTags] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const info = PLATFORMS[platform]
  const length = caption.trim().length
  const url = link.trim() || video?.url || ''

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await db.from('social_posts').insert({
      platform,
      caption: caption.trim(),
      hashtags: cleanHashtags(tags.split(/[\s,]+/), info.maxHashtags),
      link_url: url,
      source_type: video ? 'youtube' : 'manual',
      source_ref: video?.youtubeId ?? '',
      source_title: video?.title ?? '',
    })
    setBusy(false)
    if (error) return toast(friendlyError(error), 'error')
    toast('Draft saved')
    setCaption('')
    setTags('')
    setLink('')
    onSaved()
  }

  return (
    <form onSubmit={save} className="rounded-xl border border-line bg-paper p-5" aria-labelledby="manual-heading">
      <h2 id="manual-heading" className="text-xl font-semibold">
        Write a post yourself
      </h2>
      {video && <p className="mt-1 text-sm text-muted">Linked to “{video.title}”.</p>}
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-sm font-semibold">Platform</span>
          <select className={`${inputClass} mt-1 min-h-11`} value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            {PLATFORM_KEYS.map((p) => (
              <option key={p} value={p}>
                {PLATFORMS[p].label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="flex justify-between text-sm font-semibold">
            Caption
            <span className={length > info.maxCaption ? 'text-danger' : 'text-muted'}>
              {length} / {info.maxCaption}
            </span>
          </span>
          <textarea required rows={5} className={`${inputClass} mt-1 py-3`} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">Hashtags (up to {info.maxHashtags}, separated by spaces)</span>
          <input className={`${inputClass} mt-1 min-h-11`} value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">Link (optional)</span>
          <input type="url" className={`${inputClass} mt-1 min-h-11`} placeholder={video?.url ?? 'https://'} value={link} onChange={(e) => setLink(e.target.value)} />
        </label>
        <button type="submit" className={buttonClass('dark', 'md')} disabled={busy || !caption.trim() || length > info.maxCaption || (url !== '' && !url.startsWith('https://'))}>
          Save draft
        </button>
      </div>
    </form>
  )
}
