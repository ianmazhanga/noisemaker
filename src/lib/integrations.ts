/**
 * Every outside service the dashboard can use: what it does, which server settings it needs
 * and how to set it up. The server reports which settings are present (never their values);
 * Settings → Integrations shows the rest.
 *
 * No imports, so the server and tests can run this file directly in Node.
 */

export interface IntegrationInfo {
  label: string
  /** Vercel environment variables (server-side, never VITE_). Present = configured. */
  env: string[]
  features: string[]
  setup: string[]
  /** Connected through an OAuth sign-in in Social Media Manager → Accounts, after the env is set. */
  oauthPlatform?: string
  /** Not something this dashboard can connect to; explains the alternative. */
  unavailable?: string
}

export const INTEGRATIONS: Record<string, IntegrationInfo> = {
  supabase: {
    label: 'Supabase (database, sign-in, file storage)',
    env: ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'],
    features: ['Story submissions', 'Every dashboard section', 'Video and image storage'],
    setup: ['Already connected for the Story Inbox. See docs/admin-setup.md.', 'Run supabase/migrations/20261028000000_newsroom.sql in the SQL Editor to switch on the newsroom sections.'],
  },
  openai: {
    label: 'OpenAI (AI writing and transcription)',
    env: ['OPENAI_API_KEY'],
    features: ['Social captions', 'Interview assistant', 'News summaries and drafts', 'Newsletter drafts', 'Shorts transcription and clip finding'],
    setup: ['platform.openai.com → API keys → Create a secret key (a project key with a monthly limit is safest).', 'Vercel → Settings → Environment Variables → OPENAI_API_KEY. Add the same as a GitHub secret for the video worker.', 'Optional: OPENAI_MODEL (default gpt-4o-mini).'],
  },
  youtube_data: {
    label: 'YouTube Data API',
    env: ['YOUTUBE_API_KEY'],
    features: ['YouTube Manager video list', 'Public view, like and comment counts', 'New-video automation'],
    setup: ['Use the same key as the site’s YouTube sync (Google Cloud → APIs & Services → Credentials).', 'Add it in Vercel as YOUTUBE_API_KEY (it’s already a GitHub secret for the site sync).'],
  },
  youtube_analytics: {
    label: 'YouTube Analytics and uploads',
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    oauthPlatform: 'youtube',
    features: ['Watch time and subscriber analytics', 'Publishing approved Shorts to YouTube'],
    setup: [
      'Google Cloud → enable “YouTube Analytics API” and “YouTube Data API v3”.',
      'APIs & Services → OAuth consent screen (External; add the owners as test users until Google verifies the app).',
      'Credentials → Create OAuth client ID → Web application. Authorised redirect URI: <your site>/api/oauth/callback',
      'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel, then connect YouTube in Social Media Manager → Accounts.',
    ],
  },
  facebook: {
    label: 'Facebook Page',
    env: ['META_APP_ID', 'META_APP_SECRET'],
    oauthPlatform: 'facebook',
    features: ['Publishing approved posts and videos', 'Follower counts'],
    setup: [
      'developers.facebook.com → Create app (type: Business). Add “Facebook Login for Business”.',
      'Valid OAuth redirect URI: <your site>/api/oauth/callback',
      'Request pages_manage_posts, pages_read_engagement, pages_show_list, read_insights (and the Instagram permissions below). Posting for others needs Meta App Review; your own Page works while the app is in development if you are an app admin.',
      'Add META_APP_ID and META_APP_SECRET in Vercel (optional META_PAGE_ID to pick a Page), then connect in Social Media Manager → Accounts.',
    ],
  },
  instagram: {
    label: 'Instagram (Business or Creator account)',
    env: ['META_APP_ID', 'META_APP_SECRET'],
    oauthPlatform: 'instagram',
    features: ['Publishing approved images and Reels', 'Follower counts'],
    setup: ['The Instagram account must be a Business or Creator account linked to the Facebook Page.', 'Same Meta app as Facebook, with instagram_basic, instagram_content_publish and instagram_manage_insights.', 'Connecting Facebook connects Instagram too.'],
  },
  tiktok: {
    label: 'TikTok',
    env: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
    oauthPlatform: 'tiktok',
    features: ['Uploading approved clips', 'Follower counts'],
    setup: [
      'developers.tiktok.com → Manage apps → Create app. Add “Login Kit” and “Content Posting API”; redirect URI <your site>/api/oauth/callback',
      'Until TikTok audits the app, posts made through the API are visible only to the account owner (SELF_ONLY). Post publicly by hand, or apply for the audit and then set TIKTOK_PRIVACY=PUBLIC_TO_EVERYONE.',
      'Add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in Vercel, then connect in Social Media Manager → Accounts.',
    ],
  },
  x: {
    label: 'X (Twitter)',
    env: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
    oauthPlatform: 'x',
    features: ['Publishing approved text posts', 'Follower counts'],
    setup: [
      'developer.x.com → Projects & Apps → your app → User authentication settings: OAuth 2.0, type “Web App”, callback <your site>/api/oauth/callback, permissions Read and write.',
      'Posting needs an X API plan that allows it; check X’s current plans and limits.',
      'Add X_CLIENT_ID and X_CLIENT_SECRET in Vercel, then connect in Social Media Manager → Accounts.',
    ],
  },
  buffer: {
    label: 'Buffer',
    env: [],
    features: [],
    setup: [],
    unavailable:
      'Not connected: Buffer hasn’t been accepting new developer apps, so this dashboard doesn’t post through it (check buffer.com/developers in case that has changed). If you use Buffer, approved posts can be copied into it with the Publish → Copy text button. The direct connections above do the same job.',
  },
  mailchimp: {
    label: 'Mailchimp (newsletter)',
    env: ['MAILCHIMP_API_KEY', 'MAILCHIMP_AUDIENCE_ID', 'MAILCHIMP_FROM_EMAIL'],
    features: ['Sign-up confirmation emails (double opt-in)', 'Sending newsletters and test emails', 'Open, click and unsubscribe reports'],
    setup: [
      'mailchimp.com → create an Audience; turn on “Enable double opt-in” in its settings.',
      'Profile → Extras → API keys → Create a key. Audience → Settings → Audience ID.',
      'Verify your sending domain in Mailchimp, then add MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID and MAILCHIMP_FROM_EMAIL in Vercel.',
    ],
  },
  email: {
    label: 'Email alerts (Resend)',
    env: ['RESEND_API_KEY', 'NOTIFY_FROM_EMAIL'],
    features: ['Optional email copies of dashboard notifications'],
    setup: ['resend.com → verify your domain → API keys.', 'Add RESEND_API_KEY and NOTIFY_FROM_EMAIL (e.g. Noisemakers <alerts@yourdomain>) in Vercel.'],
  },
  social_tokens: {
    label: 'Token encryption',
    env: ['TOKEN_ENCRYPTION_KEY'],
    features: ['Needed before any social account can be connected'],
    setup: ['Make a key: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"', 'Add it in Vercel as TOKEN_ENCRYPTION_KEY. Keep it: changing it means reconnecting every account.'],
  },
  scheduler: {
    label: 'Scheduler (publishing, syncs, automations)',
    env: ['CRON_SECRET'],
    features: ['Scheduled posts, articles and newsletters', 'Hourly YouTube and news sync', 'Daily analytics, expiry checks and file clean-up', 'Weekly newsletter draft'],
    setup: [
      'Make a long random value (e.g. with the command under Token encryption).',
      'Add it in Vercel as CRON_SECRET, and in GitHub → Settings → Secrets → Actions as CRON_SECRET, with SITE_URL set to your site address.',
      'The “Scheduled jobs” GitHub Action then runs every 15 minutes.',
    ],
  },
  video_worker: {
    label: 'Video worker (FFmpeg)',
    env: [],
    features: ['Transcription, clip finding and rendering for AI Shorts'],
    setup: [
      'Runs as the “Video worker” GitHub Action (or the Docker image in worker/), never on Vercel.',
      'GitHub → Settings → Secrets → Actions: SUPABASE_URL, SUPABASE_SECRET_KEY, OPENAI_API_KEY.',
      'Optional, for jobs to start within a minute instead of at the next 15-minute check: a fine-grained GitHub token with Actions read/write on this repository, saved in Vercel as GITHUB_DISPATCH_TOKEN.',
    ],
  },
  web_analytics: {
    label: 'Website analytics',
    env: [],
    features: [],
    setup: [],
    unavailable: 'Not connected. Visitor numbers can be switched on in Vercel → Analytics (shown in Vercel’s own dashboard). This dashboard doesn’t track visitors itself.',
  },
}

export const INTEGRATION_KEYS = Object.keys(INTEGRATIONS)
