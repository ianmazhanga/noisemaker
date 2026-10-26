# Noisemakers website

The website for **Noisemakers**, a video podcast of inspirational interviews and stories about marriage, parenting, family and recovery. Episodes are published on YouTube as [Noisemakers News Network (@noisemakersnews)](https://www.youtube.com/@noisemakersnews).

React 19 · TypeScript · Vite · Tailwind CSS 4 · React Router 7 · Framer Motion (dialogs only) · Lucide icons. Fonts are self-hosted with Fontsource (Archivo, Inter, Source Serif 4). Hosted on **Vercel**, with a **Supabase** database for story submissions, news and the owner dashboard. Server code is in `api/`; the video worker is in `worker/`.

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
| `/episodes/:slug` | Episode page: thumbnail that opens the video on YouTube, description, discussion points, guests, series parts, related clips and episodes |
| `/clips` | Every YouTube Short, with links to the full episode where there is one |
| `/about` | About the podcast, topics, and every guest |
| `/tell-your-story` | Form for people who want to share their story or request an introductory call |
| `/news`, `/news/:slug` | Published news articles (from the News Manager) |
| `/newsletter` | Newsletter sign-up (double opt-in) |
| `/privacy` | What the site collects and why |

Old URLs redirect: `/videos` and `/latest` go to `/episodes`; `/contact` and `/collaborate` go to `/tell-your-story`.

---

## Setup checklist (one-off)

1. **Vercel:** connect the site (below).
2. **Supabase and the owner dashboard:** follow [docs/admin-setup.md](docs/admin-setup.md). Story submissions are saved there, so the form needs it.
3. **YouTube API key:** add it to GitHub (below) so new videos appear automatically.
4. **Domain:** `SITE.url` in `src/config/site.ts` and the Open Graph URLs in `index.html` assume `https://noisemakersnews.com`. Point that domain at Vercel, or change both to the real address.
5. **Turn off the old copies** once Vercel is live: GitHub Pages (repo → Settings → Pages → unpublish) and the Netlify site.

### Connecting Vercel

1. Sign up at [vercel.com](https://vercel.com) (the free Hobby plan is enough to start) with the GitHub account that owns this repo.
2. **Add New → Project → Import** `noisemaker`. Vercel reads `vercel.json`, so leave the build settings as they are.
3. Before the first deploy, add the four environment variables from [docs/admin-setup.md](docs/admin-setup.md#5-connect-the-website-vercel).
4. To use your own domain: **Project → Settings → Domains**, and follow Vercel's DNS instructions.

`vercel.json` runs `npm test` before every build, so a deploy with broken data fails instead of going live. It also sets the security headers (a Content Security Policy that only allows YouTube's images and the Supabase project, no framing, HSTS). The server functions live in `api/`.

---

## YouTube sync

New uploads appear on the site automatically. Nobody needs to edit anything.

**How it works:**

1. Every hour, the GitHub Action **Sync YouTube videos** (`.github/workflows/sync-youtube.yml`) asks the YouTube Data API v3 for every public video on channel `UCD49Bigk35BXat_YPimii0Q`.
2. It updates `src/data/youtube.json` and runs the tests.
3. If anything changed, it commits the file. Vercel sees the commit and republishes the site.

**Expect a new upload on the site within about 1–2 hours** of publishing it. GitHub sometimes starts scheduled jobs late, so it isn't instant. To update straight away: GitHub → **Actions → Sync YouTube videos → Run workflow**.

**What the sync does:**

- **New videos** appear with YouTube's own title (hashtags removed), date, length, thumbnail and description, newest first. Videos up to 3 minutes long are treated as Shorts (shown on `/clips`), and longer ones as episodes.
- **Hand-written details win.** If a video has an entry in `src/data/episodes.ts` or `clips.ts`, that entry's summary, topic, guests and slug are used. You can add one at any time to enrich a new upload.
- **Deleted or private videos** disappear from the site on the next sync. Unlisted videos, live streams and upcoming premieres aren't shown.
- **Restricted videos** (embedding turned off, or age-restricted) are flagged by the sync. Videos always play on YouTube, so this no longer changes what the site shows.
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

## Owner dashboard

`/admin` is the private newsroom dashboard: a separate sign-in for each person (Owner, Editor, Content Manager or Viewer); the **Story Inbox**; **Social Media Manager**; **Video Production** with an AI interview assistant; the **AI Shorts Generator**; **AI News Agent** and **News Manager** (which publishes to `/news`); **Newsletter Manager**; **Content Calendar**; **YouTube Manager**; **Analytics**; notifications, team management and integration settings. Owners approve everything before it's published or sent.

It runs on Supabase (`supabase/migrations/`), Vercel Functions in `api/` (shared code in `api/_lib/`), a video worker in `worker/` (FFmpeg, run by GitHub Actions), and scheduled jobs (`.github/workflows/scheduled-jobs.yml` plus Vercel's daily cron).

**Setup: [docs/admin-setup.md](docs/admin-setup.md), then [docs/newsroom-setup.md](docs/newsroom-setup.md).**

---

## Story submissions

`/tell-your-story` lets people either **submit their story** or **request an introductory call**. Nothing is emailed to applicants.

**What happens:**

1. The visitor fills in the form. It checks every field before sending: name, email, phone with country code (required if they choose phone or WhatsApp), story, topics, preferred format, consent, and confirmation that they're 18 or over.
2. The page sends the answers to `api/stories.ts`, which checks them again with the same rules and saves them in Supabase. The visitor sees a confirmation with a reference number such as `NM-261016-K3QX`.
3. A call request is marked **"pending: not booked until the team confirms"**. The site never books a call or claims one is confirmed.
4. The story appears in the **Story Inbox** at `/admin/stories` straight away, with a live "new" counter and a notification. Each submission has **Contact on WhatsApp**, **Call now** and **Send email** buttons, the person's preferred one first and marked, plus a ready-made message the team edits before sending. Nothing is sent automatically.

**Spam and repeats:** a hidden "honeypot" field catches simple bots. The same story from the same email within 24 hours is saved only once. If more than 20 submissions arrive within ten minutes, further ones are turned away for a while, since that's almost certainly a bot.

**Alerts:** new stories show up in the dashboard (counter and notification bell). Email alerts aren't set up yet; they need an email service (see [docs/admin-setup.md](docs/admin-setup.md)).

**Privacy and retention:**

- The privacy page promises that submissions not taken forward are deleted within **12 months**. Delete them from the Story Inbox (owners only). If you want a different period, change `RETENTION` in `src/pages/PrivacyPage.tsx`.
- If someone asks for their submission to be deleted, find it by their reference number and delete it.
- The page never logs answers, puts them in URLs or sends them anywhere except the site's own `/api/stories` (a test checks this).

**Changing the form:** fields live in `src/lib/storyForm.ts`. Each one is also a column in `story_submissions` (`supabase/migrations/`). To add a field, add a new migration with the column as well.

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
- **Social links:** the channel links none. Paste Instagram, X and TikTok profile URLs into `SITE.social` and their logos appear beside YouTube's in the footer, community section, About page and mobile menu.
- **Contact email:** not public. Set `SITE.contactEmail` and it appears in the footer and on the privacy page, as the address for deletion requests.

---

## How it's built

- **Content layer:** components read content only through `src/lib/content.ts`. It merges the sync snapshot with the hand-written data using `src/lib/catalog.ts`.
- **Thumbnails:** come straight from YouTube (`i.ytimg.com`). `<Thumb>` crops YouTube's letterboxed 4:3 thumbnails to the picture area at any aspect ratio, fades images in, and falls back to a branded tile if an image fails.
- **Video:** the site embeds no YouTube player. Every play button, thumbnail and clip links to the video on YouTube and opens it in a new tab.
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
