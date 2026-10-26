# Owner dashboard setup

The owner dashboard lives at **`/admin`**. It has sign-in with a separate account for each person, Owner and Content Manager roles, and the **Story Inbox** with statuses, private notes, contact buttons, a live "new stories" counter and notifications.

Story submissions from `/tell-your-story` are saved in this same database, so the form needs these steps done too. Until they are, `/admin` shows "Dashboard not set up yet" and the form asks people to try again later.

Setup takes about 30 minutes. You need someone comfortable copying settings between two websites.

---

## 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a project. The **Free** plan is enough to start.
   - Choose a strong database password and keep it somewhere safe. The site doesn't need it.
   - Pick the region closest to most of your team.
2. Open **SQL Editor → New query**. Paste the whole of `supabase/migrations/20261026000000_foundation.sql`, then press **Run**. It should finish with "Success. No rows returned".

## 2. Lock down sign-ups and links

In **Authentication**:

1. **Sign In / Providers → Email:** turn **off** "Allow new users to sign up". Only invited people can then get an account. The database gives a new account no access until the owner grants a role, so this is a second safeguard, not the only one.
2. **URL Configuration:**
   - Site URL: `https://noisemakersnews.com`
   - Redirect URLs: add `https://noisemakersnews.com/admin/reset`
3. **Password policy** (if your plan shows it): set the minimum length to **12**. The dashboard asks for 12 as well.

## 3. Set up email sending (needed for invitations)

Invitations and "forgot password" emails come from Supabase. Its built-in sender is for testing only. It sends very few emails per hour, and it may only deliver to people in your Supabase organisation. So that a new Content Manager actually receives their invitation:

- **Authentication → Emails → SMTP Settings:** connect an email service. [Resend](https://resend.com) and [Brevo](https://www.brevo.com) both have free plans. Use an address on your own domain, such as `no-reply@noisemakersnews.com`. The service walks you through verifying the domain.

## 4. Create the owner's account

1. **Authentication → Users → Add user → Create new user.** Enter the owner's email and a password of 12+ characters, and tick **Auto confirm user**.
2. In **SQL Editor**, run this with the owner's real email:

   ```sql
   update public.profiles set role = 'owner', can_view_stories = true where email = 'owner@example.com';
   ```

Every other person is invited from the dashboard (**Settings → Team**), so this is the only time you need SQL.

## 5. Connect the website (Vercel)

In Supabase, open **Project Settings → API Keys** (and **Data API** for the URL). Then in Vercel, go to **Project → Settings → Environment Variables** and add these for **Production** (and Preview, if you use preview links):

| Name | Value | Who sees it |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL, e.g. `https://abcd1234.supabase.co` | Public (built into the dashboard pages) |
| `VITE_SUPABASE_KEY` | The **publishable** key (or legacy **anon** key) | Public: safe, because the database rules decide what it can do |
| `SUPABASE_URL` | Same project URL | Server functions only |
| `SUPABASE_SECRET_KEY` | The **secret** key (or legacy **service_role** key) | Server functions only. **Never** put this in a `VITE_` variable. |

Then **Deployments → ⋯ on the latest one → Redeploy**. `VITE_` variables are built into the pages, so a redeploy is needed after changing them.

## 6. Check it works

1. Open `https://noisemakersnews.com/admin` and sign in as the owner. You should see the Overview.
2. Send a test story from `/tell-your-story`. Within a few seconds:
   - Story Inbox shows **1 new**, and the bell shows a notification.
3. Open it, change its status to **Contacted**. The counter goes down. Add a note.
4. **Settings → Team:** invite the Content Manager. They get an email, choose a password at `/admin/reset`, and land on the dashboard. They won't see the Story Inbox unless you tick **Stories** next to their name.
5. Delete the test story (owner only).

---

## Day to day

- **Story Inbox:** each submission has the person's preferred contact method first (WhatsApp, call or email), with a message you can edit before sending. Nothing is sent automatically.
- **Statuses:** New → Under review → Contacted → Approved or Declined. The "new" counter counts only **New**.
- **Who can do what:**

  | | Owner | Content Manager |
  |---|---|---|
  | Overview, notifications, own account | ✓ | ✓ |
  | Read story submissions, change status, add notes | ✓ | Only if the owner ticks **Stories** |
  | Delete a submission | ✓ | ✗ |
  | Invite people, change roles, see the activity log | ✓ | ✗ |

  These rules are enforced by the database (Row Level Security), not just by hiding buttons. `tests/database.test.ts` checks them.
- **Removing someone:** Settings → Team → set their role to **No access**. Their account remains but can't see anything. To delete it fully, use Supabase → Authentication → Users.

## Privacy and retention

Submissions are stored only in the dashboard database. The privacy page promises that submissions not taken forward are deleted within 12 months, so delete those from the Story Inbox at least that often. When someone asks for their data to be removed, search for their reference number (e.g. `NM-261016-K3QX`) and delete it.

## Costs and limits

- **Supabase Free plan:** enough for the Story Inbox. Free projects are **paused after about a week with no activity**. **A paused project can't save new stories**, so the form shows an error until it's restored. Restore it from the Supabase dashboard, or move to the Pro plan (currently US$25/month) to avoid pausing.
- **Email service (SMTP):** free plans cover invitations and password resets.
- Check each provider's pricing page for current limits.

## Not built yet

Video production, AI editing suggestions, social media, YouTube management, the AI news agent, news articles, newsletters, the content calendar and analytics. They're listed under "Coming later" in the sidebar. Two-step sign-in (MFA) is also planned for the owner account. Each part will be added and tested separately.

The old `/inbox` address now goes to the Story Inbox.
