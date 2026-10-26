import { Fragment } from 'react'
import { parseArticle, type Inline } from '../../lib/articleText'

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((i, k) =>
        i.type === 'link' ? (
          <a key={k} href={i.href} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-blue-ink underline underline-offset-4">
            {i.text}
          </a>
        ) : i.type === 'bold' ? (
          <strong key={k}>{i.text}</strong>
        ) : (
          <Fragment key={k}>{i.text}</Fragment>
        ),
      )}
    </>
  )
}

/** An article's text, shown with the site's typography. */
export function ArticleBody({ body }: { body: string }) {
  return (
    <div className="space-y-5 font-serif text-[1.125rem] leading-[1.75] text-ink">
      {parseArticle(body).map((b, k) =>
        b.type === 'h2' ? (
          <h2 key={k} className="pt-3 font-display text-2xl font-[800] tracking-[-0.01em]">
            {b.text}
          </h2>
        ) : b.type === 'ul' ? (
          <ul key={k} className="list-disc space-y-2 pl-6">
            {b.items.map((item, i) => (
              <li key={i}>
                <Inlines items={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={k}>
            <Inlines items={b.content} />
          </p>
        ),
      )}
    </div>
  )
}
