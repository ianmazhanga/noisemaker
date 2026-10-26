import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { SITE } from '../../config/site'

interface SeoProps {
  title?: string
  description?: string
  image?: string
  imageAlt?: string
  type?: 'website' | 'video.episode' | 'video.other' | 'profile' | 'article'
  /** Overrides the canonical URL, e.g. for an article that first appeared elsewhere */
  canonical?: string
  /** JSON-LD structured data object(s) */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
  noindex?: boolean
}

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.rel = 'canonical'
    document.head.appendChild(el)
  }
  el.href = href
}

/**
 * Per-route document metadata: title, description, canonical URL, Open Graph,
 * Twitter/X cards and JSON-LD. Updates the tags already in index.html, so
 * there are never duplicates.
 */
export function Seo({
  title,
  description = SITE.description,
  image = '/og-image.png',
  imageAlt = `${SITE.name}: ${SITE.tagline}`,
  type = 'website',
  jsonLd,
  noindex,
  canonical,
}: SeoProps) {
  const { pathname } = useLocation()
  const ldString = jsonLd ? JSON.stringify(jsonLd) : ''

  useEffect(() => {
    const fullTitle = title ? `${title} | ${SITE.name}` : `${SITE.name}: ${SITE.tagline}`
    const url = `${SITE.url}${pathname === '/' ? '' : pathname}`
    const absImage = image.startsWith('http') ? image : `${SITE.url}${image}`

    document.title = fullTitle
    setMeta('name', 'description', description)
    setMeta('name', 'robots', noindex ? 'noindex, follow' : 'index, follow')
    setCanonical(canonical || url || SITE.url)

    setMeta('property', 'og:title', title ?? fullTitle)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:type', type)
    setMeta('property', 'og:url', url || SITE.url)
    setMeta('property', 'og:image', absImage)
    setMeta('property', 'og:image:alt', imageAlt)

    setMeta('name', 'twitter:card', 'summary_large_image')
    setMeta('name', 'twitter:title', title ?? fullTitle)
    setMeta('name', 'twitter:description', description)
    setMeta('name', 'twitter:image', absImage)

    let script: HTMLScriptElement | null = null
    if (ldString) {
      script = document.createElement('script')
      script.type = 'application/ld+json'
      script.dataset.seo = 'route'
      script.textContent = ldString
      document.head.appendChild(script)
    }
    return () => script?.remove()
  }, [title, description, image, imageAlt, type, ldString, noindex, pathname, canonical])

  return null
}
