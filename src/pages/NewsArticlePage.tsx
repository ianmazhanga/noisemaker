import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Seo } from '../components/seo/Seo'
import { ArticleBody } from '../components/news/ArticleBody'
import { NewsletterSignup } from '../components/news/NewsletterSignup'
import { ShareButton } from '../components/ui/ShareButton'
import { SITE } from '../config/site'
import { articlePlainText, readingMinutes } from '../lib/articleText'
import { getArticle, type PublicArticle } from '../lib/publicNews'
import NotFoundPage from './NotFoundPage'

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

export default function NewsArticlePage() {
  const { slug = '' } = useParams()
  const [article, setArticle] = useState<PublicArticle | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    getArticle(slug)
      .then((a) => live && setArticle(a))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [slug])

  if (failed) return <p className="wrap py-20 text-lg text-muted">This article couldn’t be loaded just now. Please try again in a moment.</p>
  if (article === undefined)
    return (
      <p className="wrap py-20 text-muted" role="status">
        Loading…
      </p>
    )
  if (!article) return <NotFoundPage />

  const description = article.meta_description || article.dek || articlePlainText(article.body).slice(0, 160)
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description,
    datePublished: article.published_at,
    dateModified: article.updated_at,
    ...(article.featured_image_url ? { image: [article.featured_image_url] } : {}),
    ...(article.author_name ? { author: { '@type': 'Person', name: article.author_name } } : { author: { '@type': 'Organization', name: SITE.name } }),
    publisher: { '@type': 'Organization', name: SITE.name, logo: { '@type': 'ImageObject', url: `${SITE.url}/apple-touch-icon.png` } },
    mainEntityOfPage: `${SITE.url}/news/${article.slug}`,
  }

  return (
    <>
      <Seo
        title={article.meta_title || article.title}
        description={description}
        image={article.og_image_url || article.featured_image_url || undefined}
        imageAlt={article.featured_image_alt || article.title}
        type="article"
        canonical={article.canonical_url || undefined}
        jsonLd={ld}
      />
      <article className="wrap pt-8 pb-20 md:pt-14 md:pb-28">
        <nav aria-label="Breadcrumb" className="mb-8 text-sm text-muted">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link to="/" className="hover:text-ink">Home</Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link to="/news" className="hover:text-ink">News</Link>
            </li>
          </ol>
        </nav>
        <div className="mx-auto max-w-[44rem]">
          {article.category && <p className="kicker text-blue-ink">{article.category}</p>}
          <h1 className="mt-3 font-display text-4xl font-[800] tracking-[-0.02em] md:text-5xl">{article.title}</h1>
          {article.dek && <p className="mt-4 text-xl text-muted">{article.dek}</p>}
          <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {article.author_name && <span className="font-semibold text-ink">{article.author_name}</span>}
            <time dateTime={article.published_at}>{date(article.published_at)}</time>
            <span>{readingMinutes(article.body)} min read</span>
            <span className="ml-auto">
              <ShareButton title={article.title} />
            </span>
          </p>
          {article.featured_image_url && (
            <figure className="mt-8">
              <img src={article.featured_image_url} alt={article.featured_image_alt} className="w-full rounded-xl" />
            </figure>
          )}
          <div className="mt-8">
            <ArticleBody body={article.body} />
          </div>
          {article.sources.length > 0 && (
            <aside aria-labelledby="sources-heading" className="mt-10 border-t border-line pt-6">
              <h2 id="sources-heading" className="kicker text-muted">
                Sources
              </h2>
              <ul className="mt-3 space-y-2">
                {article.sources
                  .filter((s) => /^https?:\/\//.test(s.url))
                  .map((s) => (
                    <li key={s.url}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-blue-ink underline underline-offset-4">
                        {s.title || s.url}
                      </a>
                      {s.publisher && <span className="text-muted"> · {s.publisher}</span>}
                    </li>
                  ))}
              </ul>
            </aside>
          )}
          {article.tags.length > 0 && <p className="mt-6 text-sm text-muted">Tags: {article.tags.join(', ')}</p>}
          <section aria-labelledby="newsletter-heading" className="mt-14 rounded-2xl bg-bone p-6">
            <h2 id="newsletter-heading" className="font-display text-xl font-[800]">
              Get the Noisemakers newsletter
            </h2>
            <div className="mt-4">
              <NewsletterSignup />
            </div>
          </section>
        </div>
      </article>
    </>
  )
}
