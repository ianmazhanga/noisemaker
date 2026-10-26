import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Check, ExternalLink, Eye, Megaphone, Plus, Search, Send, Upload, X } from 'lucide-react'
import { buttonClass } from '../components/ui/buttonClass'
import { inputClass } from '../components/inbox/shared'
import { ArticleBody } from '../components/news/ArticleBody'
import { ARTICLE_STATUS, ARTICLE_STATUSES, slugify, type ArticleSource, type ArticleStatus } from '../lib/newsroom'
import { TIME_ZONES, zonedToUtc, type Platform } from '../lib/social'
import { requestDrafts, defaultZone } from './social/shared'
import { useAdmin, friendlyError } from './context'
import { Spinner } from './AdminApp'
import { Badge, Card, ConfirmButton, Drawer, Empty, NeedsMigration, Notice, PageHeader, Warnings } from './ui'
import { labelClass, STATUS_TONE, uploadFile, useLoad, when } from './lib'

export interface Article {
  id: string
  slug: string
  title: string
  dek: string
  body: string
  category: string
  tags: string[]
  author_name: string
  featured_image_url: string
  featured_image_alt: string
  sources: ArticleSource[]
  editorial_notes: string
  fact_flags: string[]
  meta_title: string
  meta_description: string
  og_image_url: string
  canonical_url: string
  ai_generated: boolean
  status: ArticleStatus
  scheduled_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  approved_by: string | null
  approved_at: string | null
  rejection_reason: string
}

export default function NewsPage() {
  const { db, isWriter } = useAdmin()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [state, reload] = useLoad(async () => db.from('news_articles').select('*').order('updated_at', { ascending: false }).limit(500), [db])
  if (state.status === 'missing') return <NeedsMigration title="News Manager" />

  const status = (ARTICLE_STATUSES as string[]).includes(params.get('status') ?? '') ? (params.get('status') as ArticleStatus) : 'all'
  const openId = params.get('open')
  const articles = state.status === 'ready' ? (state.data as Article[]) : []
  const q = query.trim().toLowerCase()
  const shown = articles.filter((a) => (status === 'all' || a.status === status) && (!q || `${a.title} ${a.dek} ${a.tags.join(' ')} ${a.category}`.toLowerCase().includes(q)))
  const set = (k: string, v: string | null) => setParams((p) => (v ? p.set(k, v) : p.delete(k), p))

  async function create() {
    const title = 'Untitled article'
    const { data, error } = await db.from('news_articles').insert({ title, slug: `${slugify(title)}-${Date.now().toString(36)}` }).select('id').single()
    if (error) return
    await reload()
    set('open', (data as { id: string }).id)
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="News Manager"
        intro="Articles for the News section of the website. Drafts are never public; an owner approves each article before it’s published or scheduled."
        actions={
          isWriter && (
            <button type="button" className={buttonClass('primary', 'sm')} onClick={() => void create()}>
              <Plus className="size-4" aria-hidden /> New article
            </button>
          )
        }
      />
      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Status">
        {(['all', ...ARTICLE_STATUSES] as const).map((s) => (
          <button key={s} type="button" aria-pressed={status === s} className={buttonClass(status === s ? 'dark' : 'outline', 'sm')} onClick={() => set('status', s === 'all' ? null : s)}>
            {s === 'all' ? 'All' : ARTICLE_STATUS[s]}
            {s !== 'all' && <span className="tabular-nums opacity-70">{articles.filter((a) => a.status === s).length}</span>}
          </button>
        ))}
      </div>
      <label className="relative mt-3 block">
        <span className="sr-only">Search articles</span>
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input type="search" className={`${inputClass} min-h-11 pl-10`} placeholder="Search titles, tags, categories…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      <div className="mt-6">
        {state.status === 'loading' && <Spinner label="Loading articles…" />}
        {state.status === 'error' && <Notice kind="error">{state.message}</Notice>}
        {state.status === 'ready' &&
          (articles.length === 0 ? (
            <Empty title="No articles yet.">Write one with New article, or draft one from a story the AI News Agent found.</Empty>
          ) : shown.length === 0 ? (
            <p className="text-muted">Nothing matches.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
              {shown.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => set('open', a.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-bone">
                    <Badge className={STATUS_TONE[a.status]}>{ARTICLE_STATUS[a.status]}</Badge>
                    {a.ai_generated && <Badge className="bg-blue/10 text-blue-ink">AI draft</Badge>}
                    <span className="min-w-0 flex-1 font-semibold">{a.title}</span>
                    <span className="text-sm text-muted">{a.status === 'published' ? `Published ${when(a.published_at)}` : a.scheduled_at ? `Scheduled ${when(a.scheduled_at)}` : `Updated ${when(a.updated_at)}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </div>
      {openId && articles.find((a) => a.id === openId) && <Editor key={openId} article={articles.find((a) => a.id === openId)!} onClose={() => set('open', null)} onChanged={() => void reload()} />}
    </div>
  )
}

function Editor({ article, onClose, onChanged }: { article: Article; onClose: () => void; onChanged: () => void }) {
  const { db, session, isOwner, isWriter, toast } = useAdmin()
  const [a, setA] = useState(article)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [zone, setZone] = useState(() => defaultZone(TIME_ZONES))
  const [scheduleAt, setScheduleAt] = useState('')
  const [reason, setReason] = useState('')
  const set = <K extends keyof Article>(k: K, v: Article[K]) => setA((x) => ({ ...x, [k]: v }))
  const live = article.status === 'published'
  const locked = live || !isWriter
  const site = window.location.origin

  async function save(quiet = false) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.slug)) {
      toast('The web address may only use lowercase letters, numbers and dashes.', 'error')
      return false
    }
    setBusy(true)
    const { error } = await db
      .from('news_articles')
      .update({
        slug: a.slug,
        title: a.title.trim(),
        dek: a.dek,
        body: a.body,
        category: a.category,
        tags: a.tags,
        author_name: a.author_name,
        featured_image_url: a.featured_image_url,
        featured_image_alt: a.featured_image_alt,
        sources: a.sources.filter((s) => s.url.startsWith('https://') || s.url.startsWith('http://')),
        editorial_notes: a.editorial_notes,
        meta_title: a.meta_title,
        meta_description: a.meta_description,
        og_image_url: a.og_image_url,
        canonical_url: a.canonical_url,
      })
      .eq('id', article.id)
    setBusy(false)
    if (error) {
      toast(error.code === '23505' ? 'Another article already uses that web address.' : friendlyError(error), 'error')
      return false
    }
    if (!quiet) toast(['approved', 'scheduled'].includes(article.status) ? 'Saved. It needs approving again.' : 'Saved')
    onChanged()
    return true
  }

  async function rpc(name: string, args: Record<string, unknown>, done: string, saveFirst = false) {
    if (saveFirst && !(await save(true))) return
    setBusy(true)
    const { error } = await db.rpc(name, { article_id: article.id, ...args })
    setBusy(false)
    if (error) return toast(friendlyError(error), 'error')
    toast(done)
    onChanged()
  }

  async function image(file: File) {
    setBusy(true)
    try {
      const { publicUrl } = await uploadFile(db, session.access_token, file, 'image')
      if (publicUrl) set('featured_image_url', publicUrl)
      toast('Image uploaded. Save to keep it.')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  /** Automation B, by hand: social drafts that promote the article, waiting for approval. */
  async function promote() {
    setBusy(true)
    try {
      const url = `${site}/news/${article.slug}`
      const platforms: Platform[] = ['instagram', 'facebook', 'x']
      const { drafts } = await requestDrafts(session.access_token, { title: article.title, description: `${article.dek}\n\n${article.body.slice(0, 4000)}`, url }, platforms, 1)
      const rows = drafts.map((d) => ({ platform: d.platform, caption: d.caption, hashtags: d.hashtags, link_url: d.platform === 'instagram' ? '' : url, source_type: 'article', source_ref: article.id, source_title: article.title, article_id: article.id, ai_generated: true }))
      const { error } = await db.from('social_posts').insert(rows)
      if (error) throw error
      toast(`${rows.length} social drafts created in the Social Media Manager`)
    } catch (e) {
      toast(e instanceof Error ? e.message : friendlyError(e as never), 'error')
    } finally {
      setBusy(false)
    }
  }

  const field = (label: string, k: 'title' | 'dek' | 'category' | 'author_name' | 'meta_title' | 'meta_description' | 'og_image_url' | 'canonical_url' | 'featured_image_alt', max: number, hint?: string) => (
    <label className="block">
      <span className={labelClass}>
        {label} {max < 500 && <span className={`font-normal ${a[k].length > max ? 'text-danger' : 'text-muted'}`}>({a[k].length}/{max})</span>}
      </span>
      {hint && <span className="block text-xs text-muted">{hint}</span>}
      <input disabled={locked} maxLength={max} className={`${inputClass} mt-1 min-h-11`} value={a[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  )

  return (
    <Drawer title={article.title} onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge className={STATUS_TONE[article.status]}>{ARTICLE_STATUS[article.status]}</Badge>
        {article.approved_at && <span className="text-sm text-muted">Approved {when(article.approved_at)}</span>}
        {article.scheduled_at && <span className="text-sm text-muted">Goes live {when(article.scheduled_at)}</span>}
        {live && (
          <a href={`/news/${article.slug}`} target="_blank" rel="noopener noreferrer" className={buttonClass('outline', 'sm', 'ml-auto')}>
            <ExternalLink className="size-4" aria-hidden /> View on the site
          </a>
        )}
      </div>
      {live && <Notice kind="info">This article is live. Unpublish it to make changes.</Notice>}
      {article.status === 'rejected' && article.rejection_reason && <Notice kind="error">Rejected: {article.rejection_reason}</Notice>}
      {a.fact_flags.length > 0 && (
        <div className="mt-3">
          <Notice kind="warn">
            <p className="font-semibold">Check before approving (from the AI fact review)</p>
            <Warnings items={a.fact_flags} />
          </Notice>
        </div>
      )}

      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {field('Headline', 'title', 200)}
          {field('Summary (shown under the headline)', 'dek', 400)}
          <div>
            <div className="flex items-center justify-between">
              <span className={labelClass}>Article</span>
              <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-ink underline" onClick={() => setPreview(!preview)}>
                <Eye className="size-4" aria-hidden /> {preview ? 'Edit' : 'Preview'}
              </button>
            </div>
            {preview ? (
              <div className="mt-2 rounded-lg border border-line bg-paper p-5">
                <h1 className="font-display text-3xl font-[800]">{a.title}</h1>
                {a.dek && <p className="mt-2 text-lg text-muted">{a.dek}</p>}
                {a.featured_image_url && <img src={a.featured_image_url} alt={a.featured_image_alt} className="mt-4 rounded-lg" />}
                <div className="mt-5">
                  <ArticleBody body={a.body} />
                </div>
              </div>
            ) : (
              <>
                <textarea disabled={locked} rows={18} maxLength={60000} className={`${inputClass} mt-1 py-3 font-serif text-[1.0625rem] leading-relaxed`} value={a.body} onChange={(e) => set('body', e.target.value)} />
                <p className="mt-1 text-xs text-muted">Blank line between paragraphs · ## Subheading · - List item · [link text](https://…) · **bold**. Write in your own words and credit the original source.</p>
              </>
            )}
          </div>

          <Card title="Sources">
            <p className="text-sm text-muted">Every article that draws on other reporting links to it. Required before approving an article from the News Agent.</p>
            <ul className="mt-3 space-y-3">
              {a.sources.map((s, i) => (
                <li key={i} className="grid gap-2 rounded-lg bg-bone p-3 sm:grid-cols-2">
                  <input disabled={locked} aria-label="Source title" placeholder="Article title" className={`${inputClass} min-h-10 text-sm`} value={s.title} onChange={(e) => set('sources', a.sources.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} />
                  <input disabled={locked} aria-label="Publisher" placeholder="Publisher" className={`${inputClass} min-h-10 text-sm`} value={s.publisher} onChange={(e) => set('sources', a.sources.map((x, k) => (k === i ? { ...x, publisher: e.target.value } : x)))} />
                  <input disabled={locked} aria-label="Link" placeholder="https://" className={`${inputClass} min-h-10 text-sm sm:col-span-2`} value={s.url} onChange={(e) => set('sources', a.sources.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))} />
                  {!locked && (
                    <button type="button" className="justify-self-start text-sm font-semibold text-danger underline" onClick={() => set('sources', a.sources.filter((_, k) => k !== i))}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!locked && (
              <button type="button" className={buttonClass('outline', 'sm', 'mt-3')} onClick={() => set('sources', [...a.sources, { title: '', url: '', publisher: '' }])}>
                Add a source
              </button>
            )}
          </Card>

          <label className="block">
            <span className={labelClass}>Editorial notes (private)</span>
            <textarea disabled={!isWriter} rows={3} maxLength={10000} className={`${inputClass} mt-1 py-2.5`} value={a.editorial_notes} onChange={(e) => set('editorial_notes', e.target.value)} />
          </label>
        </div>

        <div className="space-y-4">
          <Card title="Details">
            <div className="space-y-3">
              {field('Category', 'category', 60)}
              <label className="block">
                <span className={labelClass}>Tags (comma separated)</span>
                <input disabled={locked} className={`${inputClass} mt-1 min-h-11`} value={a.tags.join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 15))} />
              </label>
              {field('Author', 'author_name', 120)}
              <div>
                <span className={labelClass}>Featured image</span>
                {a.featured_image_url && <img src={a.featured_image_url} alt="" className="mt-1 rounded-lg" />}
                {!locked && (
                  <>
                    <input id="article-image" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && void image(e.target.files[0])} />
                    <label htmlFor="article-image" className={buttonClass('outline', 'sm', 'mt-2 cursor-pointer')}>
                      <Upload className="size-4" aria-hidden /> Upload image
                    </label>
                  </>
                )}
              </div>
              {a.featured_image_url && field('Image description (for screen readers)', 'featured_image_alt', 300)}
            </div>
          </Card>
          <Card title="Search and sharing">
            <div className="space-y-3">
              <label className="block">
                <span className={labelClass}>Web address</span>
                <span className="block text-xs break-all text-muted">{site}/news/{a.slug}</span>
                <input disabled={locked} maxLength={100} className={`${inputClass} mt-1 min-h-11 font-mono text-sm`} value={a.slug} onChange={(e) => set('slug', e.target.value.toLowerCase())} />
                {!locked && (
                  <button type="button" className="mt-1 text-sm font-semibold text-blue-ink underline" onClick={() => set('slug', slugify(a.title))}>
                    Make from headline
                  </button>
                )}
              </label>
              {field('Search title', 'meta_title', 70, 'Leave empty to use the headline.')}
              {field('Search description', 'meta_description', 170, 'Leave empty to use the summary.')}
              {field('Sharing image link', 'og_image_url', 500, 'Leave empty to use the featured image.')}
              {field('Canonical link', 'canonical_url', 500, 'Only if this article first appeared elsewhere.')}
            </div>
          </Card>

          <Card title="Publishing">
            <div className="flex flex-col gap-2">
              {!locked && (
                <button type="button" disabled={busy} className={buttonClass('dark', 'md')} onClick={() => void save()}>
                  {busy ? 'Saving…' : 'Save draft'}
                </button>
              )}
              {isWriter && ['draft', 'rejected', 'unpublished'].includes(article.status) && (
                <button type="button" disabled={busy} className={buttonClass('outline', 'md')} onClick={() => void rpc('submit_article', {}, 'Sent for approval', true)}>
                  <Send className="size-4" aria-hidden /> Send for approval
                </button>
              )}
              {isOwner && ['draft', 'pending_approval', 'rejected', 'unpublished'].includes(article.status) && (
                <button type="button" disabled={busy} className={buttonClass('primary', 'md', '!border-[#1f7a4d] !bg-[#1f7a4d]')} onClick={() => void rpc('approve_article', {}, 'Approved', true)}>
                  <Check className="size-4" aria-hidden /> Approve
                </button>
              )}
              {isOwner && ['approved', 'scheduled'].includes(article.status) && (
                <>
                  <ConfirmButton label="Publish now" confirm="Put it on the website now?" onConfirm={() => void rpc('set_article_live', { live: true }, 'Published')} />
                  <div className="rounded-lg border border-line p-2">
                    <span className={labelClass}>Or schedule</span>
                    <input type="datetime-local" aria-label="Publish at" className={`${inputClass} mt-1 min-h-10`} value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
                    <select aria-label="Time zone" className={`${inputClass} mt-1 min-h-10`} value={zone} onChange={(e) => setZone(e.target.value)}>
                      {TIME_ZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
                    </select>
                    <button
                      type="button"
                      disabled={!scheduleAt || busy}
                      className={buttonClass('outline', 'sm', 'mt-2')}
                      onClick={() => {
                        try {
                          void rpc('schedule_article', { at: zonedToUtc(scheduleAt, zone).toISOString() }, 'Scheduled')
                        } catch {
                          toast('Choose a date and time.', 'error')
                        }
                      }}
                    >
                      Schedule
                    </button>
                    {article.status === 'scheduled' && (
                      <button type="button" className={buttonClass('outline', 'sm', 'mt-2 ml-2')} onClick={() => void rpc('schedule_article', { at: null }, 'Unscheduled')}>
                        Unschedule
                      </button>
                    )}
                  </div>
                </>
              )}
              {isOwner && live && <ConfirmButton label="Unpublish" confirm="Take it off the website?" onConfirm={() => void rpc('set_article_live', { live: false }, 'Unpublished')} />}
              {isWriter && ['approved', 'scheduled', 'published'].includes(article.status) && (
                <button type="button" disabled={busy} className={buttonClass('outline', 'md')} onClick={() => void promote()}>
                  <Megaphone className="size-4" aria-hidden /> Create social posts
                </button>
              )}
              {isOwner && !['pending_approval', 'archived'].includes(article.status) && !live && <ConfirmButton label="Archive" confirm="Archive this article?" onConfirm={() => void rpc('archive_article', {}, 'Archived')} />}
              {isOwner && ['pending_approval', 'approved', 'scheduled'].includes(article.status) && (
                <div className="flex gap-2">
                  <input aria-label="Reason for rejecting" placeholder="Reason (optional)" className={`${inputClass} min-h-10 text-sm`} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button type="button" className={buttonClass('outline', 'sm')} onClick={() => void rpc('reject_article', { reason }, 'Rejected')}>
                    <X className="size-4" aria-hidden /> Reject
                  </button>
                </div>
              )}
              {!live && (isOwner || ['draft', 'rejected'].includes(article.status)) && isWriter && (
                <ConfirmButton
                  label="Delete"
                  danger
                  confirm="Delete permanently?"
                  onConfirm={() =>
                    void db
                      .from('news_articles')
                      .delete()
                      .eq('id', article.id)
                      .then(({ error }) => (error ? toast(friendlyError(error), 'error') : (toast('Deleted'), onClose(), onChanged())))
                  }
                />
              )}
            </div>
          </Card>
        </div>
      </div>
    </Drawer>
  )
}
