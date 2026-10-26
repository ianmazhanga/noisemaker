import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ExternalLink, FileText, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { buttonClass } from '../components/ui/buttonClass'
import { inputClass } from '../components/inbox/shared'
import { NEWS_COUNTRIES, slugify } from '../lib/newsroom'
import { useAdmin, friendlyError } from './context'
import { Spinner } from './AdminApp'
import { Badge, Card, ConfirmButton, Empty, NeedsMigration, Notice, PageHeader, Tabs, Warnings } from './ui'
import { api, labelClass, useLoad, when } from './lib'

interface Source {
  id: string
  name: string
  feed_url: string
  homepage_url: string
  country: string
  topics: string[]
  enabled: boolean
  last_fetched_at: string | null
  last_success_at: string | null
  last_error: string
}

interface Analysis {
  summary?: string
  key_facts?: string[]
  flags?: string[]
  relevance?: number
  headlines?: string[]
}

interface Item {
  id: string
  source_id: string
  url: string
  title: string
  excerpt: string
  published_at: string | null
  fetched_at: string
  matched_topics: string[]
  duplicate_of: string | null
  status: 'new' | 'shortlisted' | 'dismissed' | 'drafted'
  analysis: Analysis
}

interface Draft {
  title: string
  dek: string
  body: string
  category: string
  tags: string[]
  meta_description: string
  fact_flags: string[]
  sources: { title: string; url: string; publisher: string; published_at?: string }[]
}

export default function NewsAgentPage() {
  const { db, session, isWriter, isOwner, toast } = useAdmin()
  const [tab, setTab] = useState<'stories' | 'sources' | 'announcement'>('stories')
  const [busy, setBusy] = useState(false)
  const [state, reload] = useLoad(async () => {
    const [s, i, settings] = await Promise.all([
      db.from('news_sources').select('*').order('name'),
      db.from('news_items').select('id, source_id, url, title, excerpt, published_at, fetched_at, matched_topics, duplicate_of, status, analysis').order('published_at', { ascending: false, nullsFirst: false }).limit(400),
      db.from('app_settings').select('news_topics, news_countries').maybeSingle(),
    ])
    return { data: { sources: (s.data ?? []) as Source[], items: (i.data ?? []) as Item[], settings: (settings.data ?? { news_topics: [], news_countries: [] }) as { news_topics: string[]; news_countries: string[] } }, error: s.error ?? i.error ?? settings.error }
  }, [db])

  if (state.status === 'missing') return <NeedsMigration title="AI News Agent" />

  async function fetchNow() {
    setBusy(true)
    try {
      const r = await api<{ sources: number; added?: number; failed?: number }>(session.access_token, '/api/admin/run', { task: 'news' }, 120_000)
      toast(r.sources ? `Checked ${r.sources} sources: ${r.added ?? 0} new stories${r.failed ? `, ${r.failed} couldn’t be read` : ''}.` : 'Add a news source first.')
      void reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="AI News Agent"
        intro="Finds new stories from the sources you choose, flags repeats and unverified claims, and drafts original articles with credit to the source. Every draft goes to the News Manager for review and an owner’s approval."
        actions={
          isWriter && (
            <button type="button" disabled={busy} className={buttonClass('outline', 'sm')} onClick={() => void fetchNow()}>
              <RefreshCw className="size-4" aria-hidden /> {busy ? 'Checking…' : 'Check sources now'}
            </button>
          )
        }
      />
      <div className="mt-6">
        <Tabs label="News agent" value={tab} onChange={setTab} tabs={{ stories: 'Discovered stories', sources: 'Sources and topics', announcement: 'Draft from an announcement' }} />
      </div>
      <div className="mt-6">
        {state.status === 'loading' && <Spinner label="Loading…" />}
        {state.status === 'error' && <Notice kind="error">{state.message}</Notice>}
        {state.status === 'ready' &&
          (tab === 'stories' ? (
            <Stories items={state.data.items} sources={state.data.sources} onChanged={() => void reload()} />
          ) : tab === 'sources' ? (
            <Sources sources={state.data.sources} settings={state.data.settings} canEditTopics={isOwner} onChanged={() => void reload()} />
          ) : (
            <Announcement />
          ))}
      </div>
    </div>
  )
}

/** Saves an AI draft as a News Manager article and opens it there. */
function useSaveDraft() {
  const { db, toast } = useAdmin()
  const navigate = useNavigate()
  return async (draft: Draft, itemId: string | null) => {
    const { data, error } = await db
      .from('news_articles')
      .insert({
        slug: `${slugify(draft.title || 'news')}-${Date.now().toString(36)}`.slice(0, 100),
        title: draft.title || 'Untitled',
        dek: draft.dek,
        body: draft.body,
        category: draft.category,
        tags: draft.tags,
        meta_description: draft.meta_description,
        fact_flags: draft.fact_flags,
        sources: draft.sources,
        ai_generated: true,
        news_item_id: itemId,
      })
      .select('id')
      .single()
    if (error) return toast(friendlyError(error), 'error')
    if (itemId) await db.from('news_items').update({ status: 'drafted' }).eq('id', itemId)
    toast('Draft saved in the News Manager')
    navigate(`/admin/news?open=${(data as { id: string }).id}`)
  }
}

function Stories({ items, sources, onChanged }: { items: Item[]; sources: Source[]; onChanged: () => void }) {
  const { db, session, isWriter, toast } = useAdmin()
  const saveDraft = useSaveDraft()
  const [status, setStatus] = useState<Item['status'] | 'all'>('new')
  const [country, setCountry] = useState('all')
  const [topicOnly, setTopicOnly] = useState(false)
  const [showRepeats, setShowRepeats] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const sourceOf = (id: string) => sources.find((s) => s.id === id)
  const repeats = (id: string) => items.filter((i) => i.duplicate_of === id)
  const shown = items.filter(
    (i) => (status === 'all' || i.status === status) && (showRepeats || !i.duplicate_of) && (!topicOnly || i.matched_topics.length) && (country === 'all' || sourceOf(i.source_id)?.country === country),
  )

  async function review(item: Item) {
    setBusy(`review-${item.id}`)
    try {
      await api(session.access_token, '/api/ai/news-review', { itemId: item.id })
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  async function draft(item: Item) {
    setBusy(`draft-${item.id}`)
    try {
      await saveDraft(await api<Draft>(session.access_token, '/api/ai/article-draft', { itemId: item.id }), item.id)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  async function mark(item: Item, next: Item['status']) {
    const { error } = await db.from('news_items').update({ status: next }).eq('id', item.id)
    if (error) return toast(friendlyError(error), 'error')
    onChanged()
  }

  if (!sources.length) return <Empty title="No news sources yet.">Add the RSS feeds of outlets you trust under Sources and topics. The agent checks them every hour.</Empty>

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Status" className={`${inputClass} min-h-10 w-auto py-1`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="new">New</option>
          <option value="shortlisted">Shortlisted</option>
          <option value="drafted">Drafted</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All</option>
        </select>
        <select aria-label="Country" className={`${inputClass} min-h-10 w-auto py-1`} value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="all">All countries</option>
          {Object.entries(NEWS_COUNTRIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-blue" checked={topicOnly} onChange={(e) => setTopicOnly(e.target.checked)} /> Only stories matching our topics
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-blue" checked={showRepeats} onChange={(e) => setShowRepeats(e.target.checked)} /> Show repeats
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="mt-6 text-muted">Nothing here. New stories arrive with each hourly check.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {shown.map((item) => {
            const src = sourceOf(item.source_id)
            const also = repeats(item.id)
            const a = item.analysis ?? {}
            return (
              <li key={item.id} className="rounded-xl border border-line bg-paper p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-semibold text-ink">{src?.name ?? 'Unknown source'}</span>
                  {src && <span>{NEWS_COUNTRIES[src.country] ?? src.country}</span>}
                  <span>{item.published_at ? when(item.published_at) : `found ${when(item.fetched_at)}`}</span>
                  {item.matched_topics.map((t) => <Badge key={t} className="bg-blue/10 text-blue-ink">{t}</Badge>)}
                  {item.duplicate_of && <Badge>Repeat of another story</Badge>}
                  {also.length > 0 && <Badge className="bg-bone text-ink">Also reported by {also.length} more</Badge>}
                  {typeof a.relevance === 'number' && <Badge className="bg-yellow/40 text-ink">Relevance {a.relevance}</Badge>}
                </div>
                <h3 className="mt-1 text-lg font-semibold">
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {item.title} <ExternalLink className="inline size-3.5 opacity-60" aria-hidden />
                    <span className="sr-only"> (opens the original article)</span>
                  </a>
                </h3>
                {item.excerpt && <p className="mt-1 text-sm text-muted">{item.excerpt}</p>}
                {a.summary && (
                  <div className="mt-3 rounded-lg bg-bone p-3 text-sm">
                    <p className="font-semibold">AI review</p>
                    <p className="mt-1">{a.summary}</p>
                    {a.key_facts?.length ? (
                      <>
                        <p className="mt-2 font-semibold">Key facts (as reported)</p>
                        <ul className="list-disc pl-5">{a.key_facts.map((f) => <li key={f}>{f}</li>)}</ul>
                      </>
                    ) : null}
                    {a.flags?.length ? (
                      <div className="mt-2">
                        <p className="font-semibold">Check before using</p>
                        <Warnings items={a.flags} />
                      </div>
                    ) : null}
                  </div>
                )}
                {isWriter && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={busy !== null} className={buttonClass('outline', 'sm')} onClick={() => void review(item)}>
                      <Sparkles className="size-4" aria-hidden /> {busy === `review-${item.id}` ? 'Reviewing…' : a.summary ? 'Review again' : 'AI review'}
                    </button>
                    <button type="button" disabled={busy !== null} className={buttonClass('dark', 'sm')} onClick={() => void draft(item)}>
                      <FileText className="size-4" aria-hidden /> {busy === `draft-${item.id}` ? 'Drafting…' : 'Draft an article'}
                    </button>
                    {item.status !== 'shortlisted' && (
                      <button type="button" className={buttonClass('outline', 'sm')} onClick={() => void mark(item, 'shortlisted')}>
                        Shortlist
                      </button>
                    )}
                    {item.status !== 'dismissed' && (
                      <button type="button" className={buttonClass('outline', 'sm')} onClick={() => void mark(item, 'dismissed')}>
                        Dismiss
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Sources({ sources, settings, canEditTopics, onChanged }: { sources: Source[]; settings: { news_topics: string[]; news_countries: string[] }; canEditTopics: boolean; onChanged: () => void }) {
  const { db, isWriter, toast } = useAdmin()
  const [name, setName] = useState('')
  const [feed, setFeed] = useState('')
  const [country, setCountry] = useState('ZA')
  const [topics, setTopics] = useState(settings.news_topics.join(', '))

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!feed.trim().startsWith('https://')) return toast('The feed address must start with https://', 'error')
    const { error } = await db.from('news_sources').insert({ name: name.trim(), feed_url: feed.trim(), country })
    if (error) return toast(error.code === '23505' ? 'That feed is already a source.' : friendlyError(error), 'error')
    setName('')
    setFeed('')
    toast('Source added. It’s checked at the next hourly run, or press Check sources now.')
    onChanged()
  }

  async function saveTopics() {
    const { error } = await db.from('app_settings').update({ news_topics: topics.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 40) }).eq('id', true)
    if (error) return toast(friendlyError(error), 'error')
    toast('Topics saved')
    onChanged()
  }

  async function update(s: Source, patch: Partial<Source>) {
    const { error } = await db.from('news_sources').update(patch).eq('id', s.id)
    if (error) return toast(friendlyError(error), 'error')
    onChanged()
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <div>
        {sources.length === 0 ? (
          <Empty title="No sources yet.">Add outlets you trust. Most news sites have an RSS feed: look for “RSS” at the bottom of their pages.</Empty>
        ) : (
          <ul className="space-y-3">
            {sources.map((s) => (
              <li key={s.id} className="rounded-xl border border-line bg-paper p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{s.name}</span>
                  <Badge>{NEWS_COUNTRIES[s.country] ?? s.country}</Badge>
                  {!s.enabled && <Badge className="bg-bone text-muted">Paused</Badge>}
                  {s.last_error ? <Badge className="bg-danger text-white">Problem</Badge> : s.last_success_at ? <Badge className="bg-[#1f7a4d] text-white">Working</Badge> : <Badge>Not checked yet</Badge>}
                </div>
                <p className="mt-1 text-sm break-all text-muted">{s.feed_url}</p>
                {s.last_error && <p className="mt-1 text-sm text-danger">{s.last_error}</p>}
                {s.last_success_at && <p className="text-xs text-muted">Last read {when(s.last_success_at)}</p>}
                {isWriter && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={buttonClass('outline', 'sm')} onClick={() => void update(s, { enabled: !s.enabled })}>
                      {s.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <ConfirmButton label="Remove" confirm="Remove this source and its stories?" danger onConfirm={() => void db.from('news_sources').delete().eq('id', s.id).then(onChanged)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-5">
        {isWriter && (
          <Card title="Add a source">
            <form onSubmit={add} className="space-y-3">
              <label className="block">
                <span className={labelClass}>Name</span>
                <input required maxLength={120} className={`${inputClass} mt-1 min-h-11`} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block">
                <span className={labelClass}>RSS or Atom feed address</span>
                <input required type="url" placeholder="https://…/rss" className={`${inputClass} mt-1 min-h-11`} value={feed} onChange={(e) => setFeed(e.target.value)} />
              </label>
              <label className="block">
                <span className={labelClass}>Country</span>
                <select className={`${inputClass} mt-1 min-h-11`} value={country} onChange={(e) => setCountry(e.target.value)}>
                  {Object.entries(NEWS_COUNTRIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <button type="submit" className={buttonClass('primary', 'sm')}>
                <Plus className="size-4" aria-hidden /> Add source
              </button>
              <p className="text-xs text-muted">Only use official feeds that outlets publish for this purpose. The agent keeps the headline, link, date and the feed’s short summary; it never copies full articles.</p>
            </form>
          </Card>
        )}
        <Card title="Topics we cover">
          <p className="text-sm text-muted">Stories mentioning these words are marked as matches.</p>
          <textarea disabled={!canEditTopics} rows={3} className={`${inputClass} mt-2 py-2`} placeholder="marriage, parenting, faith, recovery, diaspora" value={topics} onChange={(e) => setTopics(e.target.value)} />
          {canEditTopics ? (
            <button type="button" className={buttonClass('dark', 'sm', 'mt-2')} onClick={() => void saveTopics()}>
              Save topics
            </button>
          ) : (
            <p className="mt-1 text-xs text-muted">An owner changes the topics.</p>
          )}
        </Card>
      </div>
    </div>
  )
}

function Announcement() {
  const { session, isWriter, toast } = useAdmin()
  const saveDraft = useSaveDraft()
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  if (!isWriter) return <p className="text-muted">Viewers can’t draft articles.</p>

  async function draft(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await saveDraft(await api<Draft>(session.access_token, '/api/ai/article-draft', { sourceText: text, sourceUrl: url.trim() }), null)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={draft} className="max-w-3xl space-y-4">
      <p className="text-muted">Paste an official announcement or press release you have permission to report on. The AI writes an original draft from it, with the source credited.</p>
      <label className="block">
        <span className={labelClass}>Link to the announcement</span>
        <input type="url" placeholder="https://" className={`${inputClass} mt-1 min-h-11`} value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="block">
        <span className={labelClass}>Announcement text</span>
        <textarea required minLength={50} rows={12} maxLength={15000} className={`${inputClass} mt-1 py-3`} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button type="submit" disabled={busy || text.trim().length < 50} className={buttonClass('primary', 'md')}>
        <Sparkles className="size-4" aria-hidden /> {busy ? 'Drafting…' : 'Draft an article'}
      </button>
    </form>
  )
}
