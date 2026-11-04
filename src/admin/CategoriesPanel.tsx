import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { inputClass } from '../components/inbox/shared'
import { getBuiltTopic, getEpisodes, getTopic, getTopics } from '../lib/content'
import { loadCategoryOverrides } from '../lib/categoryOverrides'
import { formatRuntime } from '../lib/format'
import { buttonClass } from '../components/ui/buttonClass'
import { useAdmin, friendlyError } from './context'
import { Spinner } from './AdminApp'
import { Badge, Notice } from './ui'
import { day, useLoad } from './lib'

const SOURCE: Record<string, { label: string; tone: string }> = {
  admin: { label: 'Chosen here', tone: 'bg-blue text-white' },
  curated: { label: 'Hand-written', tone: 'bg-bone text-ink ring-1 ring-line' },
  auto: { label: 'Automatic', tone: 'bg-blue/10 text-blue-ink' },
  none: { label: 'Needs review', tone: 'bg-yellow text-ink' },
}

/**
 * Every interview on the site with its category. Choosing one saves it in episode_categories,
 * which the public site reads, and it's kept through every future YouTube sync.
 */
export function CategoriesPanel() {
  const { db, isWriter, toast } = useAdmin()
  const [filter, setFilter] = useState<'review' | 'all'>('all')
  const [saving, setSaving] = useState<string | null>(null)
  const [state, reload] = useLoad(async () => db.from('episode_categories').select('youtube_id, topic, updated_at'), [db])
  if (state.status === 'loading') return <Spinner label="Loading categories…" />
  if (state.status === 'missing')
    return (
      <Notice kind="warn">
        <p className="font-semibold">One small database update is needed to change categories here.</p>
        <p className="mt-1">
          In Supabase → SQL Editor, run <code className="font-mono text-sm">supabase/migrations/20261105000000_episode_categories.sql</code> from the GitHub repository. It only adds one table and is safe to run again. Until then, new interviews are still categorised
          automatically where possible.
        </p>
      </Notice>
    )
  if (state.status === 'error') return <Notice kind="error">{state.message}</Notice>

  const chosen = new Map((state.data as { youtube_id: string; topic: string }[]).map((r) => [r.youtube_id, r.topic]))
  const rows = getEpisodes().map((e) => {
    const built = getBuiltTopic(e.youtubeId)
    const pick = chosen.get(e.youtubeId)
    const topic = pick ?? built.topic
    return { e, built, pick, topic, source: pick ? 'admin' : topic ? (built.topicSource ?? 'curated') : 'none' }
  })
  const review = rows.filter((r) => r.source === 'none').length
  const shown = filter === 'review' ? rows.filter((r) => r.source === 'none') : rows

  async function choose(youtubeId: string, topic: string, builtTopic: string | undefined) {
    setSaving(youtubeId)
    // Choosing the category it already has without a dashboard choice clears the choice.
    const { error } =
      !topic || topic === builtTopic
        ? await db.from('episode_categories').delete().eq('youtube_id', youtubeId)
        : await db.from('episode_categories').upsert({ youtube_id: youtubeId, topic }, { onConflict: 'youtube_id' })
    setSaving(null)
    if (error) return toast(friendlyError(error), 'error')
    toast(topic ? `Category saved: ${getTopic(topic)?.name}. It shows on the website now.` : 'Category choice removed.')
    await reload()
    void loadCategoryOverrides(true)
  }

  return (
    <div>
      <p className="max-w-3xl text-muted">
        New interviews get a category automatically when their title and description make it clear. The rest show <strong>Needs review</strong>. Choosing a category here updates the website straight away and is kept
        when YouTube syncs again.
      </p>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Show">
        <button type="button" aria-pressed={filter === 'all'} className={buttonClass(filter === 'all' ? 'dark' : 'outline', 'sm')} onClick={() => setFilter('all')}>
          All interviews <span className="tabular-nums opacity-70">{rows.length}</span>
        </button>
        <button type="button" aria-pressed={filter === 'review'} className={buttonClass(filter === 'review' ? 'dark' : 'outline', 'sm')} onClick={() => setFilter('review')}>
          Needs review <span className="tabular-nums opacity-70">{review}</span>
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="mt-6 text-muted">Nothing needs reviewing. Every interview has a category.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
          {shown.map(({ e, built, topic, source }) => (
            <li key={e.youtubeId} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
              <img src={`https://i.ytimg.com/vi/${e.youtubeId}/mqdefault.jpg`} alt="" width={160} height={90} loading="lazy" className="aspect-video w-full rounded-lg object-cover sm:w-36" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug">{e.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {day(e.publishedAt)} · {formatRuntime(e.durationSeconds)}
                  <Badge className={SOURCE[source].tone}>{SOURCE[source].label}</Badge>
                  <a href={`/episodes/${e.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-ink underline">
                    On the website <ExternalLink className="size-3" aria-hidden />
                  </a>
                </p>
              </div>
              <label className="sm:w-56">
                <span className="sr-only">Category for {e.title}</span>
                <select
                  className={`${inputClass} min-h-11`}
                  disabled={!isWriter || saving !== null}
                  value={topic ?? ''}
                  onChange={(ev) => void choose(e.youtubeId, ev.target.value, built.topic)}
                >
                  <option value="">{built.topic ? `Back to ${built.topicSource === 'auto' ? 'automatic' : 'hand-written'}: ${getTopic(built.topic)?.name}` : 'No category yet'}</option>
                  {getTopics().map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
