import { useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { Search, X } from 'lucide-react'
import { Seo } from '../components/seo/Seo'
import { PageIntro } from '../components/ui/PageIntro'
import { EpisodeGridCard } from '../components/episodes/EpisodeCards'
import { buttonClass } from '../components/ui/buttonClass'
import { SITE } from '../config/site'
import { countByTopic, getEpisodes, getGuest, getTopics, isTopicSlug, searchEpisodes } from '../lib/content'
import { breadcrumbLd } from '../lib/structuredData'

type Sort = 'newest' | 'oldest'

export default function EpisodesPage() {
  const [params, setParams] = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const all = getEpisodes()
  const topics = getTopics()

  const query = params.get('q') ?? ''
  const topicParam = params.get('topic')
  const topic = isTopicSlug(topicParam) ? topicParam : null
  const guest = getGuest(params.get('guest') ?? undefined)
  const sort: Sort = params.get('sort') === 'oldest' ? 'oldest' : 'newest'

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true, preventScrollReset: true })
  }

  const results = useMemo(() => {
    let list = all
    if (topic) list = list.filter((e) => e.topic === topic)
    if (guest) list = list.filter((e) => e.guestIds.includes(guest.id))
    list = searchEpisodes(query, list)
    return sort === 'oldest' ? [...list].reverse() : list
  }, [all, topic, guest, query, sort])

  const filtered = Boolean(query || topic || guest)
  const clearAll = () => {
    setParams({}, { replace: true, preventScrollReset: true })
    inputRef.current?.focus()
  }

  const chip = (active: boolean) =>
    `inline-flex min-h-10 items-center gap-2 rounded-full border-[1.5px] px-4 text-sm font-semibold transition-colors ${
      active ? 'border-ink bg-ink text-paper' : 'border-ink/15 bg-transparent text-ink hover:border-ink'
    }`

  return (
    <>
      <Seo
        title="Episodes"
        description={`All ${all.length} Noisemakers episodes: conversations about marriage, parenting, family and recovery, plus short animated love stories. Search by title or guest.`}
        jsonLd={breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Episodes', path: '/episodes' },
        ])}
      />
      <PageIntro
        kicker="Episodes"
        title={
          <>
            Every <span className="accent">conversation</span>
          </>
        }
        intro={`${all.length} episodes since ${SITE.since}: long-form interviews, life stories and short animated love stories.`}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Episodes' }]}
      />

      <div className="wrap pb-20 md:pb-28">
        <div className="flex flex-col gap-5 border-y border-line py-5 lg:flex-row lg:items-center lg:justify-between">
          <form role="search" onSubmit={(e) => e.preventDefault()} className="relative w-full lg:max-w-sm">
            <label htmlFor="episode-search" className="sr-only">
              Search episodes by title or guest
            </label>
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              ref={inputRef}
              id="episode-search"
              type="search"
              value={query}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Search by title or guest"
              autoComplete="off"
              className="h-12 w-full rounded-full border-[1.5px] border-ink/15 bg-white pr-12 pl-11 text-base placeholder:text-muted focus:border-ink focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  update({ q: null })
                  inputRef.current?.focus()
                }}
                className="absolute top-1/2 right-1.5 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-bone hover:text-ink"
                aria-label="Clear search"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </form>

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by topic">
            <button type="button" className={chip(!topic)} aria-pressed={!topic} onClick={() => update({ topic: null })}>
              All
            </button>
            {topics.map((t) => (
              <button key={t.slug} type="button" className={chip(topic === t.slug)} aria-pressed={topic === t.slug} onClick={() => update({ topic: topic === t.slug ? null : t.slug })}>
                {t.name}
                <span className={`tabular-nums ${topic === t.slug ? 'text-paper/60' : 'text-muted'}`}>{countByTopic(t.slug)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted" aria-live="polite">
              {filtered ? `${results.length} of ${all.length} episodes` : `${all.length} episodes`}
            </p>
            {guest && (
              <button type="button" onClick={() => update({ guest: null })} className="inline-flex min-h-9 items-center gap-2 rounded-full bg-bone px-3.5 text-sm font-semibold hover:bg-line">
                With {guest.name}
                <X className="size-3.5" aria-hidden />
                <span className="sr-only">: remove this filter</span>
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            Sort
            <select
              value={sort}
              onChange={(e) => update({ sort: e.target.value === 'oldest' ? 'oldest' : null })}
              className="h-10 rounded-full border-[1.5px] border-ink/15 bg-white px-3 font-semibold text-ink focus:border-ink"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        </div>

        {results.length ? (
          <ul className="mt-8 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-8">
            {results.map((episode, i) => (
              <li key={episode.slug}>
                <EpisodeGridCard episode={episode} as="h2" priority={i < 3} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-10 rounded-lg bg-bone px-6 py-14 text-center md:py-20">
            <p className="kicker text-muted">No matches</p>
            <h2 className="display-md mx-auto mt-4 max-w-xl">
              {query ? <>No episodes match “{query}”{topic || guest ? ' with these filters' : ''}.</> : 'No episodes match these filters.'}
            </h2>
            <p className="mx-auto mt-4 max-w-md text-muted">Try a guest’s name or a single word such as “marriage” or “parenting”, or clear the filters to see everything.</p>
            <button type="button" onClick={clearAll} className={buttonClass('dark', 'md', 'mt-8')}>
              Clear search and filters
            </button>
          </div>
        )}
      </div>
    </>
  )
}
