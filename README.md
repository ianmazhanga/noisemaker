# Noisemakers website

The website for **Noisemakers**, a video podcast of inspirational interviews and stories about marriage, parenting, family and recovery. Episodes are published on YouTube as [Noisemakers News Network (@noisemakersnews)](https://www.youtube.com/@noisemakersnews).

React 19 · TypeScript · Vite · Tailwind CSS 4 · React Router 7 · Framer Motion (dialogs only) · Lucide icons. Fonts are self-hosted with Fontsource (Archivo, Inter, Source Serif 4).

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # content integrity checks
npm run lint         # oxlint
npm run build        # type-check + production build to dist/
npm run preview      # serve the production build
npm run check:feed   # list new YouTube uploads that aren't on the site yet
```

## Pages

| Path | What it is |
| --- | --- |
| `/` | Hero, The Conversations, Latest conversations, Clips, Meet the noisemakers, community invitation |
| `/episodes` | Every episode. Search by title or guest (`?q=`), filter by topic (`?topic=`) or guest (`?guest=`), sort (`?sort=oldest`) |
| `/episodes/:slug` | Episode page: inline player, description, discussion points, guests, series parts, related clips and episodes |
| `/clips` | Every YouTube Short, with links to the full episode where there is one |
| `/about` | About the podcast, topics, and every guest |
| `/collaborate` | How to suggest a story or guest |
| `/privacy` | What the site does and doesn't collect |

Old URLs from the site's earlier layout (`/videos`, `/latest`, `/contact`) redirect to their replacements.

## Content

All content lives in `src/data/` and `src/config/site.ts`, and everything in them was taken from the YouTube channel. Nothing was invented.

| To change | Edit |
| --- | --- |
| Episodes | `src/data/episodes.ts` |
| Clips (Shorts) | `src/data/clips.ts` |
| Guests | `src/data/guests.ts` |
| Topics | `src/data/topics.ts` |
| Homepage curation: lead episode, The Conversations, hero collage, featured guest | `HOMEPAGE` in `src/config/site.ts` |
| Site name, URL, YouTube links, social links, contact email | `SITE` in `src/config/site.ts` |

### Adding a new upload

1. Run `npm run check:feed`. It lists recent uploads that aren't on the site yet.
2. Add an entry to `episodes.ts` (long-form) or `clips.ts` (Shorts). You need the 11-character YouTube ID, the title, the publish time (UTC) and the duration in seconds. Thumbnails, players and links are all built from the ID.
3. Write the summary and description from the video's own YouTube description. Only link a clip to an episode (`episodeSlug`) when that link can be verified.
4. If the thumbnail is used as a portrait crop, set `focus` so the face stays in frame: `x: 0` for faces on the left, `x: 1` for faces on the right. Add `zoom` if headline text still shows.
5. Run `npm test`. It catches bad YouTube IDs, duplicate slugs, unknown guests or topics, and homepage slots that point at missing episodes.

The newest episode becomes the homepage lead automatically. To pin a different one, set `HOMEPAGE.leadEpisode` to its slug.

### What's missing

- **Host:** the channel doesn't name its host, so the site has no host profile. Add one to `guests.ts`, or as a new section, once there's verified information.
- **Social links:** the channel links none. Add them to `SITE.social` and they appear in the footer and community section.
- **Contact email:** not public. Set `SITE.contactEmail` and the Collaborate page and footer show it. Until then, Collaborate points people to YouTube comments, which is where the channel itself asks for suggestions.
- **Production URL:** `SITE.url` and the Open Graph URLs in `index.html` assume `https://noisemakersnews.com`. Change both if the domain is different.

## Automatic syncing (not enabled)

Episodes are maintained by hand. `npm run check:feed` uses the channel's public RSS feed. It needs no key, but it only covers the 15 most recent uploads and has no durations.

Full automation would use the **YouTube Data API v3** (`playlistItems.list` on the channel's uploads playlist, then `videos.list` for durations). It needs a Google Cloud API key. The default quota of 10,000 units a day is plenty, since each sync costs a few units. Run it at build time or in a scheduled job, never in the browser, so the key stays private. Summaries and topics would still need writing by hand.

## How it's built

- **Content layer:** components read content only through `src/lib/content.ts`, never from the data files directly. To move to a CMS, re-implement those functions and map the results to the types in `src/types/content.ts`.
- **Thumbnails:** come straight from YouTube (`i.ytimg.com`). `<Thumb>` crops YouTube's letterboxed 4:3 thumbnails to the picture area at any aspect ratio, fades images in, and falls back to a branded tile if an image fails. Shorts use YouTube's vertical frame.
- **Video:** no YouTube code loads until someone presses play. Players use the privacy-enhanced `youtube-nocookie.com` domain. Every play button opens a working player: the site-wide modal player for cards, an inline player on episode pages, and a 9:16 player for Shorts.
- **SEO:** per-page title, description, canonical URL, Open Graph and Twitter/X tags (`src/components/seo/Seo.tsx`). Structured data includes `PodcastSeries` and `WebSite` on the homepage, `VideoObject` and `BreadcrumbList` on episode pages, and an `ItemList` of videos on Clips. `public/og-image.png` is the default share image. Episode pages use the episode thumbnail.
- **Accessibility:**
  - skip link and visible focus states
  - focus-trapped dialogs that close with Escape
  - labelled controls, with headings in order
  - spoken durations for screen readers
  - touch targets of 40px or more
  - reduced-motion support
- **Deploying:** it's a single-page app. SPA rewrites are included for Netlify (`public/_redirects`) and Vercel (`vercel.json`). Other hosts need to serve `index.html` for unknown paths.

### Known limitations

- Metadata is set in the browser, so crawlers that don't run JavaScript (some link-preview bots) see the defaults from `index.html` instead of per-episode tags. If per-episode previews matter, add prerendering (for example `vite-plugin-prerender` or a move to a static-site framework).
- `maxresdefault` thumbnails exist for only some videos. The rest use YouTube's 640px image, which looks soft when shown very large.
