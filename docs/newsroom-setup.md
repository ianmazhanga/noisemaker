# Newsroom setup: switching everything on

The dashboard's newsroom sections are built and deployed: Video Production, AI Shorts Generator, AI News Agent, News Manager, Newsletter Manager, Content Calendar, YouTube Manager, Analytics, Team Management and Integration Settings. Each one needs some setup before it works. Until a step is done, the dashboard says exactly what's missing. It never shows sample data or pretends a service is connected.

**Do the steps in order.** Steps 1–3 switch on every section. The rest connect outside services one at a time, and you can do them whenever you're ready.

---

## 1. Update the database (5 minutes, required)

1. Supabase → your project → **SQL Editor → New query**.
2. Open [`supabase/migrations/20261028000000_newsroom.sql`](../supabase/migrations/20261028000000_newsroom.sql) on GitHub, copy the whole file, paste it and press **Run**. You should see "Success. No rows returned".
3. Reload the dashboard. Every section now opens instead of showing "One database update is needed".

The update only adds things. Existing stories, posts and accounts are kept. It's safe to run again.

It also creates two storage buckets: **media**, which is private and holds recordings and clips, and **site-images**, which is public and holds article images.

> **File size limit:** the Supabase Free plan accepts uploads up to **50 MB** per file. A long interview recording is usually bigger. To upload full recordings, move to the Pro plan (currently US$25/month). Then raise the limit under **Storage → Settings → Upload file size limit**.

## 2. Add the scheduler secret (5 minutes, required for anything scheduled)

Scheduled posts, articles and newsletters, the hourly YouTube and news syncs, and the daily analytics all run on a schedule.

1. Make a long random value:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. **Vercel → Project → Settings → Environment Variables:** add `CRON_SECRET` with that value.
3. **GitHub → repository → Settings → Secrets and variables → Actions → New repository secret:**
   - `CRON_SECRET`: the same value
   - `SITE_URL`: `https://noisemaker-olive.vercel.app`, or your own domain once it's connected
4. Redeploy in Vercel (Deployments → ⋯ → Redeploy).

The **Scheduled jobs** GitHub Action then calls the site every 15 minutes. Vercel also runs the daily job by itself. To test it: GitHub → **Actions → Scheduled jobs → Run workflow**.

## 3. Turn on AI (5 minutes)

1. platform.openai.com → **API keys → Create new secret key**. A project key with a monthly spending limit is safest.
2. Vercel: add `OPENAI_API_KEY`. GitHub secrets: add `OPENAI_API_KEY` as well, for the video worker.
3. Redeploy.
4. In the dashboard, **Settings → AI and costs:** check the monthly budgets, by default US$20 each for AI and for video.

The AI drafts social captions, interview preparation, news summaries and articles, newsletter text and clip captions. It's told to use only the material it's given, and anything it quotes that isn't in the source is flagged. Everything it writes is a draft for a person to check.

---

## 4. AI Shorts: the video worker

Video processing never runs on Vercel. The **Video worker** GitHub Action does it, free on this public repository:

1. GitHub secrets: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (the same values as in Vercel) and `OPENAI_API_KEY`.
2. That's it. The worker checks for jobs every 15 minutes.
3. Optional, so that jobs start within a minute:
   - Create a fine-grained GitHub token at github.com → Settings → Developer settings → Fine-grained tokens. Limit it to this repository, with **Actions: Read and write**.
   - Add it in Vercel as `GITHUB_DISPATCH_TOKEN`.

**Using it:** AI Shorts Generator → **Upload a recording**. Upload the original video file: YouTube's API can't provide video files, even for your own channel. Then:

1. Choose the clip lengths and press **Check cost**.
2. Confirm the estimate.
3. Review the suggestions. Edit trim, framing, subtitles, branding and captions as needed.
4. Render a preview, then the final video.
5. An owner approves the clip.
6. **Send to Social** creates posts that wait for approval.

**Prefer your own server?** `worker/Dockerfile` runs the same worker anywhere that can run containers.

## 5. YouTube Manager and Analytics

- **Video list and public counts:** add `YOUTUBE_API_KEY` in Vercel. Use the same key that's already a GitHub secret for the site's video list.
- **Watch time, and publishing Shorts to YouTube:** Google Cloud → enable **YouTube Analytics API** → create an OAuth client (type: Web application). The redirect URL is `<your site>/api/oauth/callback`. Then:
  1. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel.
  2. Social Media Manager → Accounts → **Connect YouTube**.

## 6. Social media accounts

First add `TOKEN_ENCRYPTION_KEY` in Vercel. Make it with the command in step 2. Connection tokens are encrypted with it. Keep it: changing it means every account must be connected again.

Then, for each platform, create a developer app, add its keys in Vercel, redeploy, and press **Connect** in Social Media Manager → Accounts. Owners sign in on the platform's own page; no passwords are ever entered in the dashboard. **Settings → Integrations** has the exact steps for each:

| Platform | Vercel variables | What works once connected |
|---|---|---|
| Facebook + Instagram (one sign-in) | `META_APP_ID`, `META_APP_SECRET` (optional `META_PAGE_ID`) | Page posts (text, link, image, video), Instagram images and Reels, follower counts |
| X | `X_CLIENT_ID`, `X_CLIENT_SECRET` | Text posts, follower count (posting needs an X API plan that allows it) |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Video uploads. These are private to the account until TikTok audits the app. |
| YouTube | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Shorts uploads, analytics |

**Platform review:** Meta and TikTok review apps before they can post publicly for an account. Plan for this: the review can take days or weeks.

**Until an account is connected:** approved posts are published by hand. The Publish button copies the text and opens the app. Scheduled posts for unconnected accounts send the owners a reminder at the scheduled time instead.

**Safety:** a post is only ever claimed for publishing once. If a platform doesn't confirm, the post is marked **Failed**, with the reason, and the owners are notified. It's never retried automatically. Check the platform, then press **Retry**.

## 7. Newsletter (Mailchimp)

1. Mailchimp → create an Audience.
2. In its settings, turn on **double opt-in**.
3. Verify your sending domain.
4. Add these in Vercel: `MAILCHIMP_API_KEY`, `MAILCHIMP_AUDIENCE_ID` and `MAILCHIMP_FROM_EMAIL`.

Sign-ups from the website's Newsletter page and footer are stored with a consent record. Mailchimp emails each person a confirmation link. People who signed up before Mailchimp was connected get their confirmation email at the next hourly sync.

Every Monday, a draft newsletter is prepared from the week's approved content. **Nothing is sent until an owner approves it** and presses Send or schedules it.

## 8. Email alerts (optional)

Add `RESEND_API_KEY` and `NOTIFY_FROM_EMAIL` in Vercel, using resend.com with your domain verified. Each person then switches email copies on under **Notifications → Preferences**.

---

## Roles

| | Owner | Editor | Content Manager | Viewer |
|---|---|---|---|---|
| Read the dashboard | ✓ | ✓ | ✓ | ✓ |
| Story submissions | ✓ | if ticked | if ticked | ✗ |
| Write drafts, use AI, start video jobs | ✓ | ✓ | ✓ | ✗ |
| Approve, schedule, publish, send | ✓ | ✗ | ✗ | ✗ |
| Accounts, settings, budgets, team, subscribers | ✓ | ✗ | ✗ | ✗ |

These rules are enforced by the database itself (`tests/newsroom-db.test.ts` checks them), not just by hiding buttons.

## What it costs

These are rough figures; check each provider's current pricing.

- **OpenAI:**
  - Captions and drafts cost fractions of a cent each.
  - Transcription costs about US$0.006 per minute of recording, so an hour-long interview costs roughly US$0.40–0.60 to analyse.
  - The dashboard shows the estimate before starting, and keeps to your monthly budget.
- **GitHub Actions:** free for this public repository.
- **Supabase:**
  - The Free plan works for everything except uploading large recordings.
  - Pro is currently US$25/month, with 100 GB of storage included.
- **Mailchimp:** free up to its free-plan contact limit, then paid by audience size.
- **Vercel Hobby:** free. It allows daily cron jobs only, which is why GitHub runs the 15-minute schedule.
- **Meta, TikTok and Google APIs:** free to use. **X:** posting needs a paid API plan.
