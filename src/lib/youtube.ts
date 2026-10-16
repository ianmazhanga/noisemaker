export const youtubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`
export const youtubeShortUrl = (id: string) => `https://www.youtube.com/shorts/${id}`

/** Privacy-enhanced embed. Autoplays because it only loads after an explicit click. */
export const youtubeEmbedUrl = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`

const base = (id: string) => `https://i.ytimg.com/vi/${id}`

/**
 * Landscape thumbnail sources. hqdefault (480×360) and sddefault (640×480) are
 * 4:3 frames with the 16:9 picture letterboxed inside. <Thumb> always crops to
 * the 16:9 area, so the bars never show. maxresdefault exists only for some
 * videos, flagged with `hd`.
 */
export function landscapeThumb(id: string, hd?: boolean) {
  const srcSet = [`${base(id)}/hqdefault.jpg 480w`, `${base(id)}/sddefault.jpg 640w`]
  if (hd) srcSet.push(`${base(id)}/maxresdefault.jpg 1280w`)
  return { src: `${base(id)}/${hd ? 'maxresdefault' : 'sddefault'}.jpg`, srcSet: srcSet.join(', '), fallback: `${base(id)}/hqdefault.jpg` }
}

/** Vertical 1080×1920 frame that YouTube generates for Shorts. */
export const verticalThumb = (id: string) => ({ src: `${base(id)}/oar2.jpg`, fallback: `${base(id)}/hqdefault.jpg` })

/** Best single image URL, for Open Graph and structured data. */
export const shareImage = (id: string, hd?: boolean) => `${base(id)}/${hd ? 'maxresdefault' : 'sddefault'}.jpg`
