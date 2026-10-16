# Noisemakers website

The website for **Noisemakers**, a video podcast of inspirational interviews and stories about marriage, parenting, family and recovery. Episodes are published on YouTube as [Noisemakers News Network (@noisemakersnews)](https://www.youtube.com/@noisemakersnews).

React 19 · TypeScript · Vite · Tailwind CSS 4 · React Router 7 · Framer Motion (dialogs only) · Lucide icons. Fonts are self-hosted with Fontsource (Archivo, Inter, Source Serif 4). Hosted on **Netlify**. There is no database and no server code of our own.

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # content checks + automated tests
npm run lint           # oxlint
npm run build          # type-check + production build to dist/
npm run preview        # serve the production build
npm run sync:youtube   # fetch the channel's videos now (needs YOUTUBE_API_KEY)
npm run check:feed     # no-key check for recent uploads the sync hasn't picked up yet
```

## Pages

| Path | What it is |
| --- | --- |
| `/` | Hero (Watch the latest episode, Tell your story, Subscribe), The Conversations, Latest conversations, Clips, Meet the noisemakers, community invitation |
| `/episodes` | Every episode, newest first. Search by title or guest (`?q=`), filter by topic (`?topic=`) or guest (`?guest=`), sort (`?sort=oldest`) |
| `/episodes/:slug` | Episode page: inline player, description, discussion points, guests, series parts, related clips and episodes |
| `/clips` | Every YouTube Short, with links to the full episode where there is one |
| `/about` | About the podcast, topics, and every guest |
| `/tell-your-story` | Form for people who want to share their story or request an introductory call |
| `/privacy` | What the site collects and why |

Old URLs redirect: `/videos` and `/latest` go to `/episodes`; `/contact` and `/collaborate` go to `/tell-your-story`.

---

## Setup checklist (one-off)

1. **Netlify:** connect the site (below). Until then, the old GitHub Pages site stays up exactly as it was last published, and the form won't work.
2. **YouTube API key:** add it to GitHub (below) so new videos appear automatically.
3. **Story alerts:** choose how the owner is told about new submissions (below).
4. **Domain:** `SITE.url` in `src/config/site.ts` and the Open Graph URLs in `index.html` assume `https://noisemakersnews.com`. Point that domain at Netlify, or change both to the real address.
5. **Turn off GitHub Pages** once Netlify is live: GitHub repo → Settings → Pages → unpublish.

### Connecting Netlify

1. Sign up at [netlify.com](https://www.netlify.com) (the free plan is enough to start) with the GitHub account that owns this repo.
2. **Add new site → Import an existing project → GitHub →** choose `noisemaker`. Netlify reads `netlify.toml`, so leave the build settings as they are.
3. When it's deployed, go to **Site configuration → Forms** and make sure **form detection is enabled**. Then trigger one more deploy (**Deploys → Trigger deploy**) so Netlify finds the "tell-your-story" form.
4. To use your own domain: **Domain management → Add a domain**, and follow Netlify's DNS instructions.

`netlify.toml` runs `npm test` before every build, so a deploy with broken data fails instead of going live. It also sets the security headers (a Content Security Policy that only allows YouTube's image and video domains, no framing, HSTS).

---

## YouTube sync

New uploads appear on the site automatically. Nobody needs to edit anything.

**How it works:**

1. Every hour, the GitHub Action **Sync YouTube videos** (`.github/workflows/sync-youtube.yml`) asks the YouTube Data API v3 for every public video on channel `UCD49Bigk35BXat_YPimii0Q`.
2. It updates `src/data/youtube.json` and runs the tests.
3. If anything changed, it commits the file. Netlify sees the commit and republishes the site.

**Expect a new upload on the site within about 1–2 hours** of publishing it. GitHub sometimes starts scheduled jobs late, so it isn't instant. To update straight away: GitHub → **Actions → Sync YouTube videos → Run workflow**.

**What the sync does:**

- **New videos** appear with YouTube's own title (hashtags removed), date, length, thumbnail and description, newest first. Videos up to 3 minutes long are treated as Shorts (shown on `/clips`), and longer ones as episodes.
- **Hand-written details win.** If a video has an entry in `src/data/episodes.ts` or `clips.ts`, that entry's summary, topic, guests and slug are used. You can add one at any time to enrich a new upload.
- **Deleted or private videos** disappear from the site on the next sync. Unlisted videos, live streams and upcoming premieres aren't shown.
- **Restricted videos** (embedding turned off, or age-restricted) show a "Watch on YouTube" link instead of a player.
- **Episode URLs never change.** Each episode's slug is fixed the first time it's seen, even if its YouTube title changes later.
- **Safety net:** if YouTube is unavailable, the sync retries and then gives up, and the site keeps its current list. If more than half the videos would vanish at once, it refuses (run `npm run sync:youtube -- --force` locally if that's really intended).
- **Quota:** each run uses about 2–4 of the API's 10,000 free daily units.

### Adding the API key

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or use an existing one).
2. **APIs & Services → Library →** enable **YouTube Data API v3**.
3. **APIs & Services → Credentials → Create credentials → API key.** Click the new key, and under **API restrictions** choose **Restrict key → YouTube Data API v3**. Save.
4. In GitHub: repo → **Settings → Secrets and variables → Actions → New repository secret**. Name it `YOUTUBE_API_KEY` and paste the key.
5. **Actions → Sync YouTube videos → Run workflow** to check it works.

The key lives only in GitHub's encrypted secrets. It's never in the code or the website. Without a key, the sync skips itself with a warning and the site keeps its current list.

### Monitoring

- GitHub emails the repo owner when a scheduled run fails. The run's log says why: a bad key, quota, or YouTube being down.
- `npm run check:feed` compares the channel's public RSS feed with the site, without needing a key.
- GitHub pauses scheduled workflows in repos with no activity for 60 days. The sync's own commits count as activity, but if the channel is quiet for two months, re-enable the workflow under **Actions**.

---

## Story submissions

`/tell-your-story` lets people either **submit their story** or **request an introductory call**. There's no database, no login and no automatic emails to applicants.

**What happens:**

1. The visitor fills in the form. It checks every field before sending: name, email, phone with country code (required if they choose phone or WhatsApp), story, topics, preferred format, consent, and confirmation that they're 18 or over.
2. The page sends the answers to **Netlify Forms** and shows a confirmation with a reference number such as `NM-261016-K3QX`.
3. A call request is marked **"pending: not booked until the team confirms"**. The site never books a call or claims one is confirmed.
4. The owner reads the submission in Netlify and contacts the person by email, phone or WhatsApp, as they prefer.

**Reading submissions:** Netlify → your site → **Forms → tell-your-story**. Every field is listed under its name (`full_name`, `story_summary`, `reference`…). From there you can also **download a CSV** or **delete** a submission. You can do this from a phone browser too.

**Getting alerts:** Netlify → **Site configuration → Notifications → Emails and webhooks → Form submission notifications**. The options are:

- **Email notification:** Netlify emails the owner when a story arrives. This goes to the owner only, never to the applicant.
- **Slack:** gives phone push notifications through the Slack app.
- Or skip alerts and check the Forms page regularly.

**Spam:** a hidden "honeypot" field catches simple bots, and Netlify filters spam automatically. Netlify marks suspected spam rather than deleting it, so check **Forms → Spam submissions** now and then.

**Privacy and retention:**

- The privacy page promises that submissions not taken forward are deleted within **12 months**. Delete old submissions in Netlify at least that often. If you want a different period, change `RETENTION` in `src/pages/PrivacyPage.tsx`.
- If someone asks for their submission to be deleted, find it by their reference number and delete it.
- Downloaded CSVs contain personal details. Store them somewhere private, and delete them when you're done.
- The page never logs answers, puts them in URLs or sends them anywhere except Netlify (a test checks this).

**Limits:**

- Netlify's free plan caps form submissions per month. Check your plan's current limit under **Forms**.
- Duplicate protection only works in the visitor's browser: the button locks while sending, and the same story can't be re-sent from the same tab without confirming.
- Netlify Forms has no statuses or notes. To track progress, keep your own notes, for example in a spreadsheet of reference numbers.

**Changing the form:** fields live in `src/lib/storyForm.ts`. Netlify only stores fields it knows about, so if you add or rename one, update the hidden form near the bottom of `index.html` to match. `npm test` fails if they differ.

---

## Content

Everything on the site was taken from the YouTube channel. Nothing was invented.

| To change | Edit |
| --- | --- |
| Episode details (summary, topic, guests, discussion points, series, thumbnail crop) | `src/data/episodes.ts` |
| Clip details (caption, guests, linked episode) | `src/data/clips.ts` |
| Which videos exist, with titles, dates and durations | Automatic: `src/data/youtube.json`, written by the sync. Don't edit by hand, except to correct a video's `kind`. |
| Guests | `src/data/guests.ts` |
| Topics | `src/data/topics.ts` |
| Homepage curation: lead episode, The Conversations, hero collage, featured guest | `HOMEPAGE` in `src/config/site.ts` |
| Site name, URL, YouTube links, social links, contact email | `SITE` in `src/config/site.ts` |
| Story form topics and country codes | `src/lib/storyForm.ts` |

### Enriching a new upload (optional)

1. Copy an entry in `episodes.ts` (or `clips.ts` for a Short). Use the same 11-character YouTube ID and the slug already in `youtube.json`.
2. Write the summary and description from the video's own YouTube description. Only link a clip to an episode (`episodeSlug`) when that link can be verified.
3. If the thumbnail is used as a portrait crop, set `focus` so the face stays in frame: `x: 0` for faces on the left, `x: 1` for faces on the right.
4. Run `npm test`. It catches bad YouTube IDs, duplicate or mismatched slugs, unknown guests or topics, and homepage slots that point at missing episodes. It warns (without failing) when a hand-written video is no longer public on YouTube.

The newest episode becomes the homepage lead automatically. To pin a different one, set `HOMEPAGE.leadEpisode` to its slug.

### What's missing

- **Host:** the channel doesn't name its host, so the site has no host profile.
- **Social links:** the channel links none. Add them to `SITE.social` and they appear in the footer and community section.
- **Contact email:** not public. Set `SITE.contactEmail` and it appears in the footer and on the privacy page, as the address for deletion requests.

---

## How it's built

- **Content layer:** components read content only through `src/lib/content.ts`. It merges the sync snapshot with the hand-written data using `src/lib/catalog.ts`.
- **Thumbnails:** come straight from YouTube (`i.ytimg.com`). `<Thumb>` crops YouTube's letterboxed 4:3 thumbnails to the picture area at any aspect ratio, fades images in, and falls back to a branded tile if an image fails.
- **Video:** no YouTube code loads until someone presses play, and nothing autoplays with sound on page load. Players use the privacy-enhanced `youtube-nocookie.com` domain.
- **Fallbacks:** if the episode list were ever empty, the homepage points to the YouTube channel instead of showing a broken section.
- **SEO:** per-page title, description, canonical URL, Open Graph and Twitter/X tags (`src/components/seo/Seo.tsx`), plus structured data for the podcast, episodes and clips.
- **Accessibility:**
  - skip link and visible focus states
  - focus-trapped dialogs that close with Escape
  - labelled controls, with headings in order
  - form errors linked to their fields, with focus moved to the first problem
  - touch targets of 40px or more
  - reduced-motion support
- **Tests:** `npm test` runs the content checks (`scripts/validate-content.ts`) and the Node test suites in `tests/`, which cover the YouTube sync, the catalog merge and the story form.

### Known limitations

- Metadata is set in the browser, so crawlers that don't run JavaScript (some link-preview bots) see the defaults from `index.html` instead of per-episode tags.
- `maxresdefault` thumbnails exist for only some videos. The rest use YouTube's 640px image.
- New uploads appear within about 1–2 hours, not instantly.
- Automatically added episodes have no topic or guests until someone adds a hand-written entry, so they don't appear under topic filters.
