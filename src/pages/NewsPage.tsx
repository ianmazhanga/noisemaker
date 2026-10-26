import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Seo } from '../components/seo/Seo'
import { PageIntro } from '../components/ui/PageIntro'
import { NewsletterSignup } from '../components/news/NewsletterSignup'
import { breadcrumbLd } from '../lib/structuredData'
import { listArticles, type PublicArticle } from '../lib/publicNews'

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

export default function NewsPage() {
  const [articles, setArticles] = useState<PublicArticle[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    listArticles()
      .then(setArticles)
      .catch(() => setFailed(true))
  }, [])

  return (
    <>
      <Seo title="News" description="News and stories from Noisemakers News." jsonLd={breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'News', path: '/news' }])} />
      <PageIntro kicker="News" title="News" intro="Stories and updates from the Noisemakers News team." crumbs={[{ label: 'Home', to: '/' }, { label: 'News' }]} />
      <div className="wrap pb-20 md:pb-28">
        {failed ? (
          <p className="text-lg text-muted">The news couldn’t be loaded just now. Please try again in a moment.</p>
        ) : !articles ? (
          <p className="text-muted" role="status">
            Loading…
          </p>
        ) : articles.length === 0 ? (
          <p className="max-w-2xl text-lg text-muted">
            No articles yet. In the meantime, watch the latest{' '}
            <Link to="/episodes" className="font-semibold text-blue-ink underline underline-offset-4">
              episodes
            </Link>
            .
          </p>
        ) : (
          <ul className="grid gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
            {articles.map((a) => (
              <li key={a.id}>
                <Link to={`/news/${a.slug}`} className="group block">
                  {a.featured_image_url && <img src={a.featured_image_url} alt={a.featured_image_alt} className="aspect-[16/10] w-full rounded-xl object-cover" loading="lazy" />}
                  <p className="kicker mt-4 text-muted">
                    {a.category && `${a.category} · `}
                    {a.published_at && <time dateTime={a.published_at}>{date(a.published_at)}</time>}
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-[800] tracking-[-0.01em] group-hover:underline">{a.title}</h2>
                  {a.dek && <p className="mt-2 text-muted">{a.dek}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <section aria-labelledby="newsletter-heading" className="mt-20 max-w-2xl rounded-2xl bg-bone p-6 md:p-8">
          <h2 id="newsletter-heading" className="font-display text-2xl font-[800]">
            Get the newsletter
          </h2>
          <p className="mt-2 mb-5 text-muted">New conversations, news and stories, once a week.</p>
          <NewsletterSignup />
        </section>
      </div>
    </>
  )
}
