import { ArrowRight, ShoppingBag } from 'lucide-react'
import { Seo } from '../components/seo/Seo'
import { PageIntro } from '../components/ui/PageIntro'
import { ButtonLink, ExternalButton } from '../components/ui/Button'
import { getBooks, getEpisode } from '../lib/content'
import { breadcrumbLd } from '../lib/structuredData'
import type { Book } from '../types/content'

export default function BooksPage() {
  const books = getBooks()
  return (
    <>
      <Seo
        title="Books"
        description="Books written by the people featured on Noisemakers, with links to the conversations where they talk about them."
        jsonLd={[
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Books', path: '/books' },
          ]),
          {
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            itemListElement: books.map((b, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              item: { '@type': 'Book', name: b.subtitle ? `${b.title}: ${b.subtitle}` : b.title, author: b.authors, ...(b.buyUrl && { url: b.buyUrl }) },
            })),
          },
        ]}
      />
      <PageIntro
        kicker="Books"
        title={
          <>
            Keep the conversation <span className="accent">going</span>
          </>
        }
        intro="Books written by the noisemakers, each linked to the conversation where they talk about it."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Books' }]}
      />

      <div className="wrap pb-20 md:pb-28">
        <ul className="divide-y divide-line border-t border-ink">
          {books.map((book, i) => (
            <li key={book.slug} className="py-12 md:py-16">
              <BookEntry book={book} tone={i % 2 ? 'ink' : 'blue'} />
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

function BookEntry({ book, tone }: { book: Book; tone: 'blue' | 'ink' }) {
  const episodes = book.episodeSlugs.map((slug) => getEpisode(slug)).filter((e) => e !== undefined)
  const headingId = `book-${book.slug}`
  return (
    <article aria-labelledby={headingId} className="grid gap-8 sm:grid-cols-[minmax(0,14rem)_1fr] md:gap-12 lg:grid-cols-[16rem_1fr]">
      {/* A typographic stand-in, not the real cover. */}
      <div
        aria-hidden
        className={`flex aspect-[2/3] w-full max-w-40 flex-col justify-between rounded-r-lg rounded-l-sm p-5 shadow-[inset_6px_0_0_rgb(0_0_0_/_0.18),0_18px_30px_-18px_rgb(11_11_12_/_0.5)] sm:max-w-56 lg:max-w-64 ${tone === 'blue' ? 'bg-blue text-white' : 'bg-ink text-paper'}`}
      >
        <div>
          <p className="font-display text-2xl leading-[1.05] font-[800] tracking-[-0.02em] [overflow-wrap:anywhere]">{book.title}</p>
          {book.subtitle && <p className="mt-3 text-sm leading-snug opacity-80">{book.subtitle}</p>}
        </div>
        <p className="text-xs font-semibold tracking-[0.06em] uppercase opacity-80">{book.authors.split(',')[0]}</p>
      </div>

      <div className="min-w-0">
        <h2 id={headingId} className="display-md">
          {book.title}
        </h2>
        {book.subtitle && <p className="mt-2 text-xl text-muted">{book.subtitle}</p>}
        <p className="mt-4 font-semibold">By {book.authors}</p>
        <p className="measure mt-5 text-lg text-muted">{book.description}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          {book.buyUrl && (
            <ExternalButton href={book.buyUrl} variant="primary">
              <ShoppingBag className="size-4" aria-hidden /> Buy on Amazon
            </ExternalButton>
          )}
          {episodes.map((episode) => (
            <ButtonLink key={episode.slug} to={`/episodes/${episode.slug}`} variant="outline">
              {episode.series ? `Watch part ${episode.series.part}` : 'Watch the conversation'} <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          ))}
        </div>
      </div>
    </article>
  )
}
