-- Noisemakers newsroom: roles, video production, AI Shorts, news, newsletters, YouTube,
-- calendar, analytics, integrations, background jobs, cost controls and notifications.
--
-- Run it in one go (Supabase → SQL Editor → paste the whole file → Run). It only adds
-- things: no existing table, row or policy that the dashboard relies on is removed.
--
-- Rules that hold everywhere below (enforced here, not just by the dashboard):
--   * Owners approve, schedule and publish. Editors and Content Managers write drafts and
--     send them for approval. Viewers read only.
--   * Changing approved wording, media or timing sends the item back for approval.
--   * Nothing becomes published/sent unless an owner approved it, even when the server's
--     secret key (which skips Row Level Security) makes the change: triggers check it.
--   * Access tokens for connected accounts live in social_connections, which no dashboard
--     account can read. They are encrypted by the server before they are stored.
--   * Large files live in Supabase Storage; tables only hold their paths.
--
-- New roles are compared as text (role::text = 'editor'), so this file can add them and use
-- them in the same run.

alter type public.staff_role add value if not exists 'editor';
alter type public.staff_role add value if not exists 'viewer';

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

-- Owners, Editors and Content Managers write content. Viewers (and accounts with no role) don't.
create or replace function public.is_writer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role::text in ('owner', 'editor', 'content_manager') from public.profiles where id = auth.uid()), false)
$$;

-- Stories hold personal details: owners always, Editors and Content Managers when the owner ticks Stories.
create or replace function public.can_read_stories() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select role::text = 'owner' or (role::text in ('editor', 'content_manager') and can_view_stories)
    from public.profiles where id = auth.uid()
  ), false)
$$;

-- Same checks as before, plus: the last owner can't be removed by anyone.
create or replace function public.set_member_access(member_id uuid, new_role public.staff_role, stories boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change team access' using errcode = '42501';
  end if;
  if member_id = auth.uid() and new_role is distinct from 'owner' then
    raise exception 'You can''t remove your own owner access' using errcode = '42501';
  end if;
  update public.profiles
    set role = new_role, can_view_stories = coalesce(stories, false) or coalesce(new_role::text = 'owner', false)
    where id = member_id;
  if not found then
    raise exception 'No such team member' using errcode = 'P0002';
  end if;
  insert into public.audit_logs (actor_id, action, target, details)
    values (auth.uid(), 'member.access', member_id::text, jsonb_build_object('role', new_role, 'can_view_stories', coalesce(stories, false)));
end
$$;

-- Everyone on the team sees who else is on it (names and roles), so work can be assigned.
create or replace function public.team_members()
returns table (id uuid, full_name text, email text, role text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email, p.role::text from public.profiles p
  where public.is_staff() and p.role is not null
  order by p.full_name, p.email
$$;

revoke all on function public.is_writer(), public.team_members() from public, anon;
grant execute on function public.is_writer(), public.team_members() to authenticated;

-- Shared helper: keeps updated_at current.
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Notifications: no duplicates, and per-person preferences
-- ---------------------------------------------------------------------------

alter table public.notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_idx on public.notifications (dedupe_key);

-- Adds a notification once. A repeat with the same dedupe_key is ignored.
create or replace function public.notify(kind text, title text, link text, audience text, dedupe_key text default null)
returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (kind, title, link, audience, dedupe_key)
  values (kind, left(title, 200), link, audience, dedupe_key)
  on conflict (dedupe_key) do nothing
$$;

revoke all on function public.notify(text, text, text, text, text) from public, anon, authenticated;

create table if not exists public.notification_preferences (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  -- Notification kinds (e.g. 'post.pending') this person doesn't want to see
  muted_kinds text[] not null default '{}',
  -- Also email unmuted notifications to this person (needs an email service on the server)
  email_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists "Manage your own notification preferences" on public.notification_preferences;
create policy "Manage your own notification preferences"
  on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_staff());

revoke all on public.notification_preferences from anon, authenticated;
grant select, insert (muted_kinds, email_enabled), update (muted_kinds, email_enabled) on public.notification_preferences to authenticated;

drop trigger if exists notification_preferences_touch on public.notification_preferences;
create trigger notification_preferences_touch before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

-- Which notifications have been emailed to whom, so nobody gets the same email twice.
create table if not exists public.notification_emails (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notification_emails enable row level security;
revoke all on public.notification_emails from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settings and cost controls (one row)
-- ---------------------------------------------------------------------------

create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  -- Automations that spend money on AI without someone pressing a button (new YouTube video drafts, weekly newsletter intro…)
  auto_ai_enabled boolean not null default false,
  monthly_ai_budget_usd numeric(10, 2) not null default 20 check (monthly_ai_budget_usd >= 0),
  monthly_video_budget_usd numeric(10, 2) not null default 20 check (monthly_video_budget_usd >= 0),
  max_ai_requests_per_day integer not null default 200 check (max_ai_requests_per_day between 0 and 10000),
  max_video_minutes integer not null default 120 check (max_video_minutes between 1 and 600),
  max_upload_mb integer not null default 2048 check (max_upload_mb between 1 and 51200),
  max_clips_per_video integer not null default 8 check (max_clips_per_video between 1 and 30),
  -- Original recordings and rendered clips are deleted from storage after this many days (0 = keep)
  source_retention_days integer not null default 0 check (source_retention_days between 0 and 3650),
  render_retention_days integer not null default 0 check (render_retention_days between 0 and 3650),
  default_timezone text not null default 'Africa/Johannesburg',
  newsletter_from_name text not null default 'Noisemakers News' check (char_length(newsletter_from_name) <= 100),
  newsletter_reply_to text not null default '' check (newsletter_reply_to = '' or newsletter_reply_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  news_topics text[] not null default '{}',
  news_countries text[] not null default '{ZA,US,GB}',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "Team members read settings" on public.app_settings;
create policy "Team members read settings" on public.app_settings for select to authenticated using (public.is_staff());
drop policy if exists "Owners change settings" on public.app_settings;
create policy "Owners change settings" on public.app_settings for update to authenticated using (public.is_owner()) with check (public.is_owner());

revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
grant update (auto_ai_enabled, monthly_ai_budget_usd, monthly_video_budget_usd, max_ai_requests_per_day, max_video_minutes, max_upload_mb,
  max_clips_per_video, source_retention_days, render_retention_days, default_timezone, newsletter_from_name, newsletter_reply_to,
  news_topics, news_countries) on public.app_settings to authenticated;

create or replace function public.log_settings_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), 'settings.changed', 'app_settings');
  return new;
end
$$;

drop trigger if exists app_settings_changed on public.app_settings;
create trigger app_settings_changed before update on public.app_settings
  for each row execute function public.log_settings_change();

-- Every paid AI or video-processing call, with its estimated cost.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid references public.profiles (id) on delete set null,
  feature text not null,
  model text not null default '',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  audio_seconds numeric(12, 2) not null default 0,
  video_seconds numeric(12, 2) not null default 0,
  -- 'ai' or 'video', for the two monthly budgets
  category text not null default 'ai' check (category in ('ai', 'video')),
  cost_usd numeric(12, 5) not null default 0,
  job_id uuid
);

create index if not exists ai_usage_at_idx on public.ai_usage (at desc);
create index if not exists ai_usage_user_day_idx on public.ai_usage (user_id, at desc);

alter table public.ai_usage enable row level security;
drop policy if exists "Owners see AI usage" on public.ai_usage;
create policy "Owners see AI usage" on public.ai_usage for select to authenticated using (public.is_owner());
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

-- This month's spending against the budgets, for everyone on the team (amounts only).
create or replace function public.usage_this_month()
returns table (category text, cost_usd numeric, requests bigint, budget_usd numeric)
language sql stable security definer set search_path = '' as $$
  select c.category,
         coalesce(sum(u.cost_usd), 0),
         count(u.id),
         case c.category when 'ai' then s.monthly_ai_budget_usd else s.monthly_video_budget_usd end
  from (values ('ai'), ('video')) as c (category)
  cross join public.app_settings s
  left join public.ai_usage u on u.category = c.category and u.at >= date_trunc('month', now())
  where public.is_staff()
  group by c.category, s.monthly_ai_budget_usd, s.monthly_video_budget_usd
$$;

revoke all on function public.usage_this_month() from public, anon;
grant execute on function public.usage_this_month() to authenticated;

-- ---------------------------------------------------------------------------
-- Integrations: what's connected, when it last worked, what went wrong. Never keys.
-- ---------------------------------------------------------------------------

create table if not exists public.integration_status (
  key text primary key,
  last_success_at timestamptz,
  last_sync_at timestamptz,
  last_error text not null default '',
  last_error_at timestamptz,
  details jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.integration_status enable row level security;
drop policy if exists "Team members see integration status" on public.integration_status;
create policy "Team members see integration status" on public.integration_status for select to authenticated using (public.is_staff());
revoke all on public.integration_status from anon, authenticated;
grant select on public.integration_status to authenticated;

-- ---------------------------------------------------------------------------
-- Background jobs: transcription, clip analysis, rendering, syncs and automations
-- ---------------------------------------------------------------------------

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('transcribe', 'analyze', 'render', 'news_fetch', 'youtube_sync', 'analytics_snapshot', 'weekly_newsletter', 'automation')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  -- The same work is never queued twice while it's still queued, running or done (see the index below).
  idempotency_key text,
  payload jsonb not null default '{}',
  result jsonb not null default '{}',
  progress integer not null default 0 check (progress between 0 and 100),
  message text not null default '',
  error text not null default '',
  attempts integer not null default 0,
  max_attempts integer not null default 2,
  estimated_cost_usd numeric(10, 4) not null default 0,
  actual_cost_usd numeric(10, 4) not null default 0,
  requested_by uuid references public.profiles (id) on delete set null,
  locked_by text not null default '',
  heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists jobs_idempotency_idx on public.jobs (idempotency_key) where status in ('queued', 'running', 'succeeded');
create index if not exists jobs_queue_idx on public.jobs (status, kind, created_at);
create index if not exists jobs_created_idx on public.jobs (created_at desc);

alter table public.jobs enable row level security;
drop policy if exists "Team members see jobs" on public.jobs;
create policy "Team members see jobs" on public.jobs for select to authenticated using (public.is_staff());
revoke all on public.jobs from anon, authenticated;
grant select on public.jobs to authenticated;

drop trigger if exists jobs_touch on public.jobs;
create trigger jobs_touch before update on public.jobs for each row execute function public.touch_updated_at();

-- Stops a job. A running job notices at its next step and stops without saving results.
create or replace function public.cancel_job(job_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = job_id for update;
  if not found then raise exception 'No such job' using errcode = 'P0002'; end if;
  if not (public.is_owner() or (public.is_writer() and j.requested_by = auth.uid())) then
    raise exception 'Only an owner or whoever started it can cancel this job' using errcode = '42501';
  end if;
  if j.status not in ('queued', 'running') then raise exception 'This job has already finished' using errcode = '22023'; end if;
  update public.jobs set status = 'cancelled', finished_at = now(), message = 'Cancelled' where id = job_id;
  insert into public.audit_logs (actor_id, action, target, details) values (auth.uid(), 'job.cancelled', job_id::text, jsonb_build_object('kind', j.kind));
end
$$;

revoke all on function public.cancel_job(uuid) from public, anon;
grant execute on function public.cancel_job(uuid) to authenticated;

-- For the worker (secret key only): takes the oldest queued job of the given kinds, so two
-- workers never pick up the same one. Jobs whose worker stopped reporting are given another
-- try, or failed once they've had their attempts.
create or replace function public.claim_job(kinds text[], worker text)
returns setof public.jobs
language plpgsql security definer set search_path = '' as $$
begin
  update public.jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        error = case when attempts >= max_attempts then 'The worker stopped responding. Try again.' else error end,
        finished_at = case when attempts >= max_attempts then now() else null end,
        locked_by = ''
    where status = 'running' and heartbeat_at < now() - interval '20 minutes';
  return query
    update public.jobs j
      set status = 'running', locked_by = worker, heartbeat_at = now(), started_at = coalesce(j.started_at, now()), attempts = j.attempts + 1, error = ''
      where j.id = (
        select q.id from public.jobs q
        where q.status = 'queued' and q.kind = any (kinds)
        order by q.created_at
        for update skip locked
        limit 1
      )
      returning j.*;
end
$$;

revoke all on function public.claim_job(text[], text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Video production
-- ---------------------------------------------------------------------------

create table if not exists public.video_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  summary text not null default '' check (char_length(summary) <= 5000),
  status text not null default 'idea' check (status in (
    'idea', 'interview_scheduled', 'preparing', 'scripting', 'recording_scheduled', 'recorded',
    'awaiting_edit', 'editing', 'awaiting_approval', 'ready', 'published', 'archived')),
  story_id uuid references public.story_submissions (id) on delete set null,
  guest_name text not null default '' check (char_length(guest_name) <= 200),
  -- Facts about the guest the team has checked. The AI assistant is only given these.
  guest_verified_info text not null default '' check (char_length(guest_verified_info) <= 10000),
  guest_links text[] not null default '{}',
  recording_at timestamptz,
  recording_timezone text not null default 'Africa/Johannesburg',
  recording_location text not null default '' check (char_length(recording_location) <= 300),
  assigned_to uuid references public.profiles (id) on delete set null,
  youtube_id text not null default '' check (youtube_id = '' or youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  -- Saved AI assistant output, e.g. {"questions": [...], "outline": "..."}; edited by the team
  prep jsonb not null default '{}',
  notes text not null default '' check (char_length(notes) <= 20000),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  published_at timestamptz
);

create index if not exists video_projects_status_idx on public.video_projects (status, updated_at desc);
create index if not exists video_projects_recording_idx on public.video_projects (recording_at) where recording_at is not null;
create unique index if not exists video_projects_story_idx on public.video_projects (story_id) where story_id is not null;

alter table public.video_projects enable row level security;

drop policy if exists "Team members see video projects" on public.video_projects;
create policy "Team members see video projects" on public.video_projects for select to authenticated using (public.is_staff());
drop policy if exists "Writers add video projects" on public.video_projects;
create policy "Writers add video projects" on public.video_projects for insert to authenticated
  with check (public.is_writer() and created_by = auth.uid() and status not in ('ready', 'published'));
drop policy if exists "Writers edit video projects" on public.video_projects;
create policy "Writers edit video projects" on public.video_projects for update to authenticated
  using (public.is_writer()) with check (public.is_writer());
drop policy if exists "Owners delete video projects" on public.video_projects;
create policy "Owners delete video projects" on public.video_projects for delete to authenticated using (public.is_owner());

revoke all on public.video_projects from anon, authenticated;
grant select, delete on public.video_projects to authenticated;
grant insert (title, summary, status, story_id, guest_name, guest_verified_info, guest_links, recording_at, recording_timezone, recording_location, assigned_to, youtube_id, prep, notes)
  on public.video_projects to authenticated;
grant update (title, summary, status, guest_name, guest_verified_info, guest_links, recording_at, recording_timezone, recording_location, assigned_to, youtube_id, prep, notes)
  on public.video_projects to authenticated;

-- "Ready to publish" and "Published" are an owner's call.
create or replace function public.guard_video_project() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status in ('ready', 'published') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if auth.uid() is not null and not public.is_owner() then
      raise exception 'Only an owner can approve a video for publishing' using errcode = '42501';
    end if;
    if new.status = 'ready' then
      new.approved_by := coalesce(auth.uid(), new.approved_by);
      new.approved_at := now();
    else
      new.published_at := coalesce(new.published_at, now());
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'ready' and new.status not in ('ready', 'published') then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  if new.status = 'awaiting_approval' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.notify('video.pending', 'Video awaiting approval: ' || new.title, '/admin/video?open=' || new.id, 'owner', 'video.pending:' || new.id || ':' || extract(epoch from now())::bigint);
  end if;
  return new;
end
$$;

drop trigger if exists video_project_guard on public.video_projects;
create trigger video_project_guard before insert or update on public.video_projects
  for each row execute function public.guard_video_project();

-- Files in Supabase Storage: original recordings, rendered clips, images, logos, music.
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'media' check (bucket in ('media', 'site-images')),
  path text not null unique check (char_length(path) <= 500 and path !~ '\.\.'),
  kind text not null check (kind in ('source_video', 'clip_preview', 'clip_final', 'image', 'logo', 'music', 'intro', 'outro')),
  filename text not null default '' check (char_length(filename) <= 255),
  mime_type text not null default '',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  duration_seconds numeric(10, 2),
  width integer,
  height integer,
  status text not null default 'pending_upload' check (status in ('pending_upload', 'ready', 'failed', 'deleted')),
  project_id uuid references public.video_projects (id) on delete set null,
  youtube_id text not null default '',
  -- Where background music came from and its licence. Required before music is used.
  license_note text not null default '' check (char_length(license_note) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  delete_after timestamptz,
  deleted_at timestamptz
);

create index if not exists media_assets_kind_idx on public.media_assets (kind, created_at desc);
create index if not exists media_assets_project_idx on public.media_assets (project_id);

alter table public.media_assets enable row level security;
drop policy if exists "Team members see files" on public.media_assets;
create policy "Team members see files" on public.media_assets for select to authenticated using (public.is_staff());
drop policy if exists "Writers label files" on public.media_assets;
create policy "Writers label files" on public.media_assets for update to authenticated using (public.is_writer()) with check (public.is_writer());

-- Files are added and removed by the server, which checks type and size first.
revoke all on public.media_assets from anon, authenticated;
grant select on public.media_assets to authenticated;
grant update (filename, project_id, youtube_id, license_note) on public.media_assets to authenticated;

create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null unique references public.media_assets (id) on delete cascade,
  language text not null default '',
  text text not null default '',
  -- [{"start": s, "end": s, "text": "...", "words": [{"w": "...", "s": s, "e": s}]}]
  segments jsonb not null default '[]',
  provider text not null default '',
  model text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_by uuid references public.profiles (id) on delete set null
);

alter table public.transcripts enable row level security;
drop policy if exists "Team members see transcripts" on public.transcripts;
create policy "Team members see transcripts" on public.transcripts for select to authenticated using (public.is_staff());
drop policy if exists "Writers correct transcripts" on public.transcripts;
create policy "Writers correct transcripts" on public.transcripts for update to authenticated using (public.is_writer()) with check (public.is_writer());
revoke all on public.transcripts from anon, authenticated;
grant select on public.transcripts to authenticated;
grant update (text, segments) on public.transcripts to authenticated;

create or replace function public.track_transcript_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.edited_by := auth.uid(); end if;
  return new;
end
$$;

drop trigger if exists transcript_edited on public.transcripts;
create trigger transcript_edited before update on public.transcripts for each row execute function public.track_transcript_edit();

create table if not exists public.video_clips (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.media_assets (id) on delete cascade,
  project_id uuid references public.video_projects (id) on delete set null,
  title text not null default '' check (char_length(title) <= 200),
  -- Seconds in the source recording
  start_s numeric(10, 2) not null check (start_s >= 0),
  end_s numeric(10, 2) not null,
  -- Parts removed from the middle: [[start, end], ...] in source seconds
  cuts jsonb not null default '[]',
  category text not null default 'other' check (category in ('emotional', 'insight', 'educational', 'story', 'discussion', 'other')),
  reason text not null default '' check (char_length(reason) <= 2000),
  score integer not null default 0 check (score between 0 and 100),
  status text not null default 'suggested' check (status in ('suggested', 'editing', 'rendering', 'preview_ready', 'rendered', 'approved', 'rejected', 'sent_to_social')),
  -- {"mode": "center" | "left" | "right" | "custom" | "split", "x": 0..1, "x2": 0..1}
  crop jsonb not null default '{"mode": "center", "x": 0.5}',
  -- Subtitle cues in clip seconds: [{"start", "end", "text", "words": [{"w", "s", "e"}]}]
  subtitles jsonb not null default '[]',
  -- Look and sound: font, size, position, background, highlight, watermark, title overlay, intro/outro, volume, noise reduction, music
  style jsonb not null default '{}',
  -- AI-written titles and captions per platform, hashtags, description, suggested time
  captions jsonb not null default '{}',
  preview_asset_id uuid references public.media_assets (id) on delete set null,
  final_asset_id uuid references public.media_assets (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  rejected_by uuid references public.profiles (id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_s > start_s and end_s - start_s <= 180)
);

create index if not exists video_clips_asset_idx on public.video_clips (asset_id, start_s);
create index if not exists video_clips_status_idx on public.video_clips (status, updated_at desc);

alter table public.video_clips enable row level security;
drop policy if exists "Team members see clips" on public.video_clips;
create policy "Team members see clips" on public.video_clips for select to authenticated using (public.is_staff());
drop policy if exists "Writers add clips" on public.video_clips;
create policy "Writers add clips" on public.video_clips for insert to authenticated
  with check (public.is_writer() and status in ('suggested', 'editing'));
drop policy if exists "Writers edit clips" on public.video_clips;
create policy "Writers edit clips" on public.video_clips for update to authenticated
  using (public.is_writer() and status <> 'sent_to_social') with check (public.is_writer());
drop policy if exists "Owners delete clips" on public.video_clips;
create policy "Owners delete clips" on public.video_clips for delete to authenticated using (public.is_owner());

revoke all on public.video_clips from anon, authenticated;
grant select, delete on public.video_clips to authenticated;
grant insert (asset_id, project_id, title, start_s, end_s, cuts, category, reason, crop, subtitles, style, captions) on public.video_clips to authenticated;
grant update (title, start_s, end_s, cuts, crop, subtitles, style, captions, project_id) on public.video_clips to authenticated;

create or replace function public.guard_video_clip() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  elsif (new.start_s, new.end_s, new.cuts, new.crop, new.subtitles, new.style)
        is distinct from (old.start_s, old.end_s, old.cuts, old.crop, old.subtitles, old.style) then
    -- The video changed, so earlier renders and the approval no longer match it.
    if new.status = old.status then
      new.status := 'editing';
      new.preview_asset_id := null;
      new.final_asset_id := null;
      new.approved_by := null;
      new.approved_at := null;
    end if;
  elsif new.captions is distinct from old.captions and old.status = 'approved' and new.status = old.status then
    new.status := 'rendered';
    new.approved_by := null;
    new.approved_at := null;
  end if;
  if new.status in ('approved', 'sent_to_social') and (new.approved_by is null or new.final_asset_id is null) then
    raise exception 'A clip must be rendered and approved by an owner first' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists video_clip_guard on public.video_clips;
create trigger video_clip_guard before insert or update on public.video_clips
  for each row execute function public.guard_video_clip();

create or replace function public.approve_clip(clip_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.video_clips;
begin
  if not public.is_owner() then raise exception 'Only an owner can approve clips' using errcode = '42501'; end if;
  select * into c from public.video_clips where id = clip_id for update;
  if not found then raise exception 'No such clip' using errcode = 'P0002'; end if;
  if c.final_asset_id is null then raise exception 'Render the final video before approving it' using errcode = '22023'; end if;
  if c.status not in ('rendered', 'preview_ready', 'rejected') then raise exception 'This clip can''t be approved in its current state' using errcode = '22023'; end if;
  update public.video_clips set status = 'approved', approved_by = auth.uid(), approved_at = now(), rejected_by = null, rejected_at = null, rejection_reason = '' where id = clip_id;
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), 'clip.approved', clip_id::text);
end
$$;

create or replace function public.reject_clip(clip_id uuid, reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only an owner can reject clips' using errcode = '42501'; end if;
  update public.video_clips
    set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(), rejection_reason = left(coalesce(reason, ''), 500), approved_by = null, approved_at = null
    where id = clip_id and status <> 'sent_to_social';
  if not found then raise exception 'This clip can''t be rejected' using errcode = '22023'; end if;
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), 'clip.rejected', clip_id::text);
end
$$;

revoke all on function public.approve_clip(uuid), public.reject_clip(uuid, text) from public, anon;
grant execute on function public.approve_clip(uuid), public.reject_clip(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- News: sources, discovered stories and articles
-- ---------------------------------------------------------------------------

create table if not exists public.news_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  feed_url text not null unique check (feed_url ~ '^https://' and char_length(feed_url) <= 500),
  homepage_url text not null default '' check (homepage_url = '' or homepage_url ~ '^https://'),
  -- ISO country code of the source's focus, or 'INT' for international
  country text not null default 'INT' check (country ~ '^[A-Z]{2,3}$'),
  topics text[] not null default '{}',
  enabled boolean not null default true,
  last_fetched_at timestamptz,
  last_success_at timestamptz,
  last_error text not null default '',
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.news_sources enable row level security;
drop policy if exists "Team members see news sources" on public.news_sources;
create policy "Team members see news sources" on public.news_sources for select to authenticated using (public.is_staff());
drop policy if exists "Writers add news sources" on public.news_sources;
create policy "Writers add news sources" on public.news_sources for insert to authenticated with check (public.is_writer() and created_by = auth.uid());
drop policy if exists "Writers edit news sources" on public.news_sources;
create policy "Writers edit news sources" on public.news_sources for update to authenticated using (public.is_writer()) with check (public.is_writer());
drop policy if exists "Writers remove news sources" on public.news_sources;
create policy "Writers remove news sources" on public.news_sources for delete to authenticated using (public.is_writer());
revoke all on public.news_sources from anon, authenticated;
grant select, delete on public.news_sources to authenticated;
grant insert (name, feed_url, homepage_url, country, topics, enabled), update (name, feed_url, homepage_url, country, topics, enabled) on public.news_sources to authenticated;

create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.news_sources (id) on delete cascade,
  url text not null check (url ~ '^https?://'),
  -- The link without tracking parameters, used to spot repeats
  url_key text not null unique,
  title text not null,
  -- The feed's own short description, trimmed. Full articles are never copied.
  excerpt text not null default '' check (char_length(excerpt) <= 1000),
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  matched_topics text[] not null default '{}',
  -- Normalised title words; items with the same key are the same story from different outlets
  cluster_key text not null default '',
  duplicate_of uuid references public.news_items (id) on delete set null,
  status text not null default 'new' check (status in ('new', 'shortlisted', 'dismissed', 'drafted')),
  -- AI review: {"key_facts": [...], "flags": [...], "relevance": 0-100, "summary": "..."}
  analysis jsonb not null default '{}',
  analyzed_at timestamptz
);

create index if not exists news_items_recent_idx on public.news_items (published_at desc nulls last);
create index if not exists news_items_cluster_idx on public.news_items (cluster_key);

alter table public.news_items enable row level security;
drop policy if exists "Team members see discovered news" on public.news_items;
create policy "Team members see discovered news" on public.news_items for select to authenticated using (public.is_staff());
drop policy if exists "Writers triage discovered news" on public.news_items;
create policy "Writers triage discovered news" on public.news_items for update to authenticated using (public.is_writer()) with check (public.is_writer());
revoke all on public.news_items from anon, authenticated;
grant select on public.news_items to authenticated;
grant update (status) on public.news_items to authenticated;

create table if not exists public.news_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  dek text not null default '' check (char_length(dek) <= 400),
  -- Markdown-style text: paragraphs, ## headings, - lists, [links](https://...)
  body text not null default '' check (char_length(body) <= 60000),
  category text not null default '' check (char_length(category) <= 60),
  tags text[] not null default '{}' check (cardinality(tags) <= 15),
  author_name text not null default '' check (char_length(author_name) <= 120),
  featured_image_url text not null default '' check (featured_image_url = '' or featured_image_url ~ '^https://'),
  featured_image_alt text not null default '' check (char_length(featured_image_alt) <= 300),
  -- [{"title": "...", "url": "https://...", "publisher": "...", "published_at": "..."}]
  sources jsonb not null default '[]',
  editorial_notes text not null default '' check (char_length(editorial_notes) <= 10000),
  -- AI fact review: claims to check before publishing
  fact_flags jsonb not null default '[]',
  meta_title text not null default '' check (char_length(meta_title) <= 70),
  meta_description text not null default '' check (char_length(meta_description) <= 170),
  og_image_url text not null default '' check (og_image_url = '' or og_image_url ~ '^https://'),
  canonical_url text not null default '' check (canonical_url = '' or canonical_url ~ '^https://'),
  ai_generated boolean not null default false,
  news_item_id uuid references public.news_items (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'scheduled', 'published', 'unpublished', 'archived', 'rejected')),
  scheduled_at timestamptz,
  published_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  rejected_by uuid references public.profiles (id) on delete set null,
  rejection_reason text not null default ''
);

create index if not exists news_articles_public_idx on public.news_articles (published_at desc) where status = 'published';
create index if not exists news_articles_status_idx on public.news_articles (status, updated_at desc);

alter table public.news_articles enable row level security;

-- The public website reads published articles with the publishable key, and nothing else.
drop policy if exists "Anyone reads published articles" on public.news_articles;
create policy "Anyone reads published articles" on public.news_articles for select to anon
  using (status = 'published' and published_at <= now());
drop policy if exists "Team members see all articles" on public.news_articles;
create policy "Team members see all articles" on public.news_articles for select to authenticated using (public.is_staff());
drop policy if exists "Writers write article drafts" on public.news_articles;
create policy "Writers write article drafts" on public.news_articles for insert to authenticated
  with check (public.is_writer() and created_by = auth.uid() and status = 'draft');
drop policy if exists "Writers edit articles that aren't live" on public.news_articles;
create policy "Writers edit articles that aren't live" on public.news_articles for update to authenticated
  using (public.is_writer() and status <> 'published') with check (public.is_writer());
drop policy if exists "Owners delete articles; authors delete their drafts" on public.news_articles;
create policy "Owners delete articles; authors delete their drafts" on public.news_articles for delete to authenticated
  using (status <> 'published' and (public.is_owner() or (created_by = auth.uid() and status in ('draft', 'rejected'))));

revoke all on public.news_articles from anon, authenticated;
-- Editorial notes, fact flags and workflow details are never public.
grant select (id, slug, title, dek, body, category, tags, author_name, featured_image_url, featured_image_alt, sources,
  meta_title, meta_description, og_image_url, canonical_url, published_at, updated_at) on public.news_articles to anon;
grant select, delete on public.news_articles to authenticated;
grant insert (slug, title, dek, body, category, tags, author_name, featured_image_url, featured_image_alt, sources, editorial_notes, fact_flags,
  meta_title, meta_description, og_image_url, canonical_url, ai_generated, news_item_id) on public.news_articles to authenticated;
grant update (slug, title, dek, body, category, tags, author_name, featured_image_url, featured_image_alt, sources, editorial_notes, fact_flags,
  meta_title, meta_description, og_image_url, canonical_url) on public.news_articles to authenticated;

create or replace function public.guard_news_article() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.status in ('approved', 'scheduled') and new.status = old.status
     and (new.slug, new.title, new.dek, new.body, new.featured_image_url, new.sources, new.meta_title, new.meta_description, new.og_image_url, new.canonical_url)
         is distinct from (old.slug, old.title, old.dek, old.body, old.featured_image_url, old.sources, old.meta_title, old.meta_description, old.og_image_url, old.canonical_url) then
    new.status := 'pending_approval';
    new.approved_by := null;
    new.approved_at := null;
    new.scheduled_at := null;
  end if;
  if new.status in ('scheduled', 'published') and new.approved_by is null then
    raise exception 'An article must be approved by an owner before it can be scheduled or published' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists news_article_guard on public.news_articles;
create trigger news_article_guard before insert or update on public.news_articles
  for each row execute function public.guard_news_article();

create or replace function public.submit_article(article_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.news_articles;
begin
  if not public.is_writer() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into a from public.news_articles where id = article_id for update;
  if not found then raise exception 'No such article' using errcode = 'P0002'; end if;
  if a.status not in ('draft', 'rejected', 'unpublished') then raise exception 'Only drafts can be sent for approval' using errcode = '22023'; end if;
  if btrim(a.body) = '' then raise exception 'Write the article first' using errcode = '22023'; end if;
  update public.news_articles set status = 'pending_approval', submitted_at = now(), rejected_by = null, rejection_reason = '' where id = article_id;
  perform public.notify('article.pending', 'Article awaiting approval: ' || a.title, '/admin/news?open=' || article_id, 'owner', 'article.pending:' || article_id || ':' || extract(epoch from now())::bigint);
end
$$;

-- Approving also runs Automation B: a calendar reminder to promote it, and it becomes
-- eligible for the next newsletter draft. Social drafts are made by the server.
create or replace function public.approve_article(article_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.news_articles;
begin
  if not public.is_owner() then raise exception 'Only an owner can approve articles' using errcode = '42501'; end if;
  select * into a from public.news_articles where id = article_id for update;
  if not found then raise exception 'No such article' using errcode = 'P0002'; end if;
  if a.status not in ('draft', 'pending_approval', 'rejected', 'unpublished') then raise exception 'This article can''t be approved in its current state' using errcode = '22023'; end if;
  if btrim(a.body) = '' then raise exception 'Write the article first' using errcode = '22023'; end if;
  if jsonb_array_length(a.sources) = 0 and a.news_item_id is not null then raise exception 'Add the original source before approving' using errcode = '22023'; end if;
  update public.news_articles set status = 'approved', approved_by = auth.uid(), approved_at = now(), rejected_by = null, rejection_reason = '' where id = article_id;
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), 'article.approved', article_id::text);
  insert into public.calendar_events (title, kind, starts_at, related_type, related_id, created_by)
    select 'Promote: ' || left(a.title, 150), 'task', now() + interval '1 hour', 'article', article_id, auth.uid()
    where not exists (select 1 from public.calendar_events e where e.related_type = 'article' and e.related_id = article_id and e.kind = 'task');
end
$$;

create or replace function public.reject_article(article_id uuid, reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only an owner can reject articles' using errcode = '42501'; end if;
  update public.news_articles
    set status = 'rejected', rejected_by = auth.uid(), rejection_reason = left(coalesce(reason, ''), 500), approved_by = null, approved_at = null, scheduled_at = null
    where id = article_id and status <> 'published';
  if not found then raise exception 'This article can''t be rejected' using errcode = '22023'; end if;
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), 'article.rejected', article_id::text);
end
$$;

create or replace function public.schedule_article(article_id uuid, at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.news_articles;
begin
  if not public.is_owner() then raise exception 'Only an owner can schedule articles' using errcode = '42501'; end if;
  select * into a from public.news_articles where id = article_id for update;
  if not found then raise exception 'No such article' using errcode = 'P0002'; end if;
  if a.status not in ('approved', 'scheduled') then raise exception 'Approve the article before scheduling it' using errcode = '22023'; end if;
  if at is not null and at < now() - interval '5 minutes' then raise exception 'Choose a time in the future' using errcode = '22023'; end if;
  update public.news_articles set status = case when at is null then 'approved' else 'scheduled' end, scheduled_at = at where id = article_id;
  insert into public.audit_logs (actor_id, action, target, details) values (auth.uid(), 'article.scheduled', article_id::text, jsonb_build_object('at', at));
end
$$;

-- Publishes now (approved or scheduled), takes it off the site, or archives it.
create or replace function public.set_article_live(article_id uuid, live boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.news_articles;
begin
  if not public.is_owner() then raise exception 'Only an owner can publish or unpublish articles' using errcode = '42501'; end if;
  select * into a from public.news_articles where id = article_id for update;
  if not found then raise exception 'No such article' using errcode = 'P0002'; end if;
  if live then
    if a.status not in ('approved', 'scheduled', 'unpublished') or a.approved_by is null then raise exception 'Only approved articles can be published' using errcode = '42501'; end if;
    update public.news_articles set status = 'published', published_at = coalesce(a.published_at, now()), scheduled_at = null where id = article_id;
  else
    if a.status <> 'published' then raise exception 'This article isn''t live' using errcode = '22023'; end if;
    update public.news_articles set status = 'unpublished' where id = article_id;
  end if;
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), case when live then 'article.published' else 'article.unpublished' end, article_id::text);
end
$$;

create or replace function public.archive_article(article_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only an owner can archive articles' using errcode = '42501'; end if;
  update public.news_articles set status = 'archived', scheduled_at = null where id = article_id;
  if not found then raise exception 'No such article' using errcode = 'P0002'; end if;
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), 'article.archived', article_id::text);
end
$$;

-- For the scheduler (secret key): publishes approved articles whose time has come.
create or replace function public.publish_due_articles() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.news_articles set status = 'published', published_at = scheduled_at, scheduled_at = null
    where status = 'scheduled' and scheduled_at <= now() and approved_by is not null;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.submit_article(uuid), public.approve_article(uuid), public.reject_article(uuid, text),
  public.schedule_article(uuid, timestamptz), public.set_article_live(uuid, boolean), public.archive_article(uuid) from public, anon;
grant execute on function public.submit_article(uuid), public.approve_article(uuid), public.reject_article(uuid, text),
  public.schedule_article(uuid, timestamptz), public.set_article_live(uuid, boolean), public.archive_article(uuid) to authenticated;
revoke all on function public.publish_due_articles() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Newsletter
-- ---------------------------------------------------------------------------

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) <= 254),
  email_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'subscribed', 'unsubscribed', 'cleaned')),
  -- Exactly what the person agreed to, and when (POPIA and GDPR consent record)
  consent_text text not null default '',
  consented_at timestamptz,
  source text not null default 'website',
  unsubscribe_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  provider_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.newsletter_subscribers enable row level security;
-- Personal data: owners only. Sign-ups and unsubscribes go through the server.
drop policy if exists "Owners see subscribers" on public.newsletter_subscribers;
create policy "Owners see subscribers" on public.newsletter_subscribers for select to authenticated using (public.is_owner());
revoke all on public.newsletter_subscribers from anon, authenticated;
grant select (id, email, status, consent_text, consented_at, source, confirmed_at, unsubscribed_at, provider_synced_at, created_at) on public.newsletter_subscribers to authenticated;

drop trigger if exists newsletter_subscribers_touch on public.newsletter_subscribers;
create trigger newsletter_subscribers_touch before update on public.newsletter_subscribers for each row execute function public.touch_updated_at();

-- Counts for everyone on the team, without names or addresses.
create or replace function public.newsletter_stats()
returns table (status text, total bigint, last_30_days bigint)
language sql stable security definer set search_path = '' as $$
  select s.status, count(n.id), count(n.id) filter (where n.created_at >= now() - interval '30 days')
  from (values ('pending'), ('subscribed'), ('unsubscribed'), ('cleaned')) as s (status)
  left join public.newsletter_subscribers n on n.status = s.status
  where public.is_staff()
  group by s.status
$$;

revoke all on function public.newsletter_stats() from public, anon;
grant execute on function public.newsletter_stats() to authenticated;

create table if not exists public.newsletter_campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null default '' check (char_length(subject) <= 150),
  preheader text not null default '' check (char_length(preheader) <= 200),
  intro text not null default '' check (char_length(intro) <= 5000),
  -- [{"type": "video" | "article" | "story" | "interview" | "social" | "text", "title", "url", "text", "image"}]
  blocks jsonb not null default '[]',
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'scheduled', 'sending', 'sent', 'failed', 'rejected')),
  scheduled_at timestamptz,
  timezone text not null default 'Africa/Johannesburg',
  sent_at timestamptz,
  provider_campaign_id text not null default '',
  -- From the email provider's reports: {"opens", "open_rate", "clicks", "click_rate", "unsubscribes", "recipients"}
  stats jsonb not null default '{}',
  last_test_at timestamptz,
  ai_generated boolean not null default false,
  error_message text not null default '',
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  rejected_by uuid references public.profiles (id) on delete set null,
  rejection_reason text not null default ''
);

create index if not exists newsletter_campaigns_status_idx on public.newsletter_campaigns (status, updated_at desc);

alter table public.newsletter_campaigns enable row level security;
drop policy if exists "Team members see newsletters" on public.newsletter_campaigns;
create policy "Team members see newsletters" on public.newsletter_campaigns for select to authenticated using (public.is_staff());
drop policy if exists "Writers draft newsletters" on public.newsletter_campaigns;
create policy "Writers draft newsletters" on public.newsletter_campaigns for insert to authenticated
  with check (public.is_writer() and created_by = auth.uid() and status = 'draft');
drop policy if exists "Writers edit unsent newsletters" on public.newsletter_campaigns;
create policy "Writers edit unsent newsletters" on public.newsletter_campaigns for update to authenticated
  using (public.is_writer() and status not in ('sending', 'sent')) with check (public.is_writer());
drop policy if exists "Owners delete unsent newsletters" on public.newsletter_campaigns;
create policy "Owners delete unsent newsletters" on public.newsletter_campaigns for delete to authenticated
  using (public.is_owner() and status not in ('sending', 'sent'));

revoke all on public.newsletter_campaigns from anon, authenticated;
grant select, delete on public.newsletter_campaigns to authenticated;
grant insert (subject, preheader, intro, blocks, timezone, ai_generated) on public.newsletter_campaigns to authenticated;
grant update (subject, preheader, intro, blocks, timezone) on public.newsletter_campaigns to authenticated;

create or replace function public.guard_newsletter() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.status in ('approved', 'scheduled', 'failed') and new.status = old.status
     and (new.subject, new.preheader, new.intro, new.blocks) is distinct from (old.subject, old.preheader, old.intro, old.blocks) then
    new.status := 'pending_approval';
    new.approved_by := null;
    new.approved_at := null;
    new.scheduled_at := null;
  end if;
  if new.status in ('scheduled', 'sending', 'sent') and new.approved_by is null then
    raise exception 'A newsletter must be approved by an owner before it is scheduled or sent' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists newsletter_guard on public.newsletter_campaigns;
create trigger newsletter_guard before insert or update on public.newsletter_campaigns
  for each row execute function public.guard_newsletter();

create or replace function public.submit_newsletter(campaign_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.newsletter_campaigns;
begin
  if not public.is_writer() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into c from public.newsletter_campaigns where id = campaign_id for update;
  if not found then raise exception 'No such newsletter' using errcode = 'P0002'; end if;
  if c.status not in ('draft', 'rejected', 'failed') then raise exception 'Only drafts can be sent for approval' using errcode = '22023'; end if;
  if btrim(c.subject) = '' then raise exception 'Add a subject line first' using errcode = '22023'; end if;
  update public.newsletter_campaigns set status = 'pending_approval', rejected_by = null, rejection_reason = '' where id = campaign_id;
  perform public.notify('newsletter.pending', 'Newsletter awaiting approval: ' || c.subject, '/admin/newsletter?open=' || campaign_id, 'owner', 'newsletter.pending:' || campaign_id || ':' || extract(epoch from now())::bigint);
end
$$;

create or replace function public.approve_newsletter(campaign_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.newsletter_campaigns;
begin
  if not public.is_owner() then raise exception 'Only an owner can approve newsletters' using errcode = '42501'; end if;
  select * into c from public.newsletter_campaigns where id = campaign_id for update;
  if not found then raise exception 'No such newsletter' using errcode = 'P0002'; end if;
  if c.status not in ('draft', 'pending_approval', 'rejected', 'failed') then raise exception 'This newsletter can''t be approved in its current state' using errcode = '22023'; end if;
  if btrim(c.subject) = '' then raise exception 'Add a subject line first' using errcode = '22023'; end if;
  update public.newsletter_campaigns set status = 'approved', approved_by = auth.uid(), approved_at = now(), rejected_by = null, rejection_reason = '', error_message = '' where id = campaign_id;
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), 'newsletter.approved', campaign_id::text);
end
$$;

create or replace function public.reject_newsletter(campaign_id uuid, reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only an owner can reject newsletters' using errcode = '42501'; end if;
  update public.newsletter_campaigns
    set status = 'rejected', rejected_by = auth.uid(), rejection_reason = left(coalesce(reason, ''), 500), approved_by = null, approved_at = null, scheduled_at = null
    where id = campaign_id and status not in ('sending', 'sent');
  if not found then raise exception 'This newsletter can''t be rejected' using errcode = '22023'; end if;
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), 'newsletter.rejected', campaign_id::text);
end
$$;

create or replace function public.schedule_newsletter(campaign_id uuid, at timestamptz, tz text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.newsletter_campaigns;
begin
  if not public.is_owner() then raise exception 'Only an owner can schedule newsletters' using errcode = '42501'; end if;
  select * into c from public.newsletter_campaigns where id = campaign_id for update;
  if not found then raise exception 'No such newsletter' using errcode = 'P0002'; end if;
  if c.status not in ('approved', 'scheduled') then raise exception 'Approve the newsletter before scheduling it' using errcode = '22023'; end if;
  if at is not null and at < now() - interval '5 minutes' then raise exception 'Choose a time in the future' using errcode = '22023'; end if;
  if tz is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then raise exception 'Unknown time zone' using errcode = '22023'; end if;
  update public.newsletter_campaigns set status = case when at is null then 'approved' else 'scheduled' end, scheduled_at = at, timezone = coalesce(tz, c.timezone) where id = campaign_id;
  insert into public.audit_logs (actor_id, action, target, details) values (auth.uid(), 'newsletter.scheduled', campaign_id::text, jsonb_build_object('at', at));
end
$$;

revoke all on function public.submit_newsletter(uuid), public.approve_newsletter(uuid), public.reject_newsletter(uuid, text),
  public.schedule_newsletter(uuid, timestamptz, text) from public, anon;
grant execute on function public.submit_newsletter(uuid), public.approve_newsletter(uuid), public.reject_newsletter(uuid, text),
  public.schedule_newsletter(uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- YouTube channel videos (synced by the server) and analytics snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.youtube_videos (
  youtube_id text primary key check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null default '',
  description text not null default '',
  published_at timestamptz,
  duration_seconds integer not null default 0,
  kind text not null default 'episode' check (kind in ('episode', 'short')),
  thumbnail_url text not null default '',
  privacy text not null default 'public',
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  first_seen_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  -- When Automation A (drafts and notification for a new video) ran, so it runs once
  automation_at timestamptz
);

create index if not exists youtube_videos_published_idx on public.youtube_videos (published_at desc);

alter table public.youtube_videos enable row level security;
drop policy if exists "Team members see channel videos" on public.youtube_videos;
create policy "Team members see channel videos" on public.youtube_videos for select to authenticated using (public.is_staff());
revoke all on public.youtube_videos from anon, authenticated;
grant select on public.youtube_videos to authenticated;

-- One number per source, metric, subject and day, exactly as the service reported it.
create table if not exists public.analytics_snapshots (
  id bigint generated always as identity primary key,
  source text not null check (source in ('youtube', 'instagram', 'facebook', 'tiktok', 'x', 'website', 'newsletter', 'stories')),
  metric text not null,
  -- 'channel', a video ID, a campaign ID…
  subject text not null default 'channel',
  value numeric not null,
  captured_on date not null default current_date,
  captured_at timestamptz not null default now(),
  unique (source, metric, subject, captured_on)
);

create index if not exists analytics_snapshots_lookup_idx on public.analytics_snapshots (source, metric, captured_on);

alter table public.analytics_snapshots enable row level security;
drop policy if exists "Team members see analytics" on public.analytics_snapshots;
create policy "Team members see analytics" on public.analytics_snapshots for select to authenticated using (public.is_staff());
revoke all on public.analytics_snapshots from anon, authenticated;
grant select on public.analytics_snapshots to authenticated;

-- ---------------------------------------------------------------------------
-- Social Media Manager: media, clips, safe publishing and connection status
-- ---------------------------------------------------------------------------

alter table public.social_posts add column if not exists media_asset_id uuid references public.media_assets (id) on delete set null;
alter table public.social_posts add column if not exists clip_id uuid references public.video_clips (id) on delete set null;
alter table public.social_posts add column if not exists article_id uuid references public.news_articles (id) on delete set null;
alter table public.social_posts add column if not exists platform_post_id text not null default '';
-- Set when a publishing attempt starts. While set, the post can't be published again,
-- so a crash or timeout never causes a duplicate post.
alter table public.social_posts add column if not exists publish_started_at timestamptz;
alter table public.social_posts add column if not exists publish_attempts integer not null default 0;

alter table public.social_posts drop constraint if exists social_posts_source_type_check;
alter table public.social_posts add constraint social_posts_source_type_check check (source_type in ('manual', 'youtube', 'news', 'clip', 'article'));

grant insert (media_asset_id, clip_id, article_id) on public.social_posts to authenticated;
grant update (media_asset_id) on public.social_posts to authenticated;

-- Viewers can't write drafts.
drop policy if exists "Team members write drafts" on public.social_posts;
drop policy if exists "Writers write drafts" on public.social_posts;
create policy "Writers write drafts"
  on public.social_posts for insert to authenticated
  with check (public.is_writer() and created_by = auth.uid() and status = 'draft');

drop policy if exists "Team members edit posts that aren't published" on public.social_posts;
drop policy if exists "Writers edit posts that aren't published" on public.social_posts;
create policy "Writers edit posts that aren't published"
  on public.social_posts for update to authenticated
  using (public.is_writer() and status not in ('published') and publish_started_at is null)
  with check (public.is_writer());

create or replace function public.guard_social_post() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    -- Changing the wording or media of an approved post needs a fresh approval.
    if old.status in ('approved', 'scheduled', 'failed') and new.status = old.status
       and (new.caption, new.hashtags, new.link_url, new.media_note, new.platform, new.media_asset_id)
           is distinct from (old.caption, old.hashtags, old.link_url, old.media_note, old.platform, old.media_asset_id) then
      if old.publish_started_at is not null then
        raise exception 'This post is being published right now' using errcode = '55006';
      end if;
      new.status := 'pending_approval';
      new.approved_by := null;
      new.approved_at := null;
      new.scheduled_at := null;
    end if;
  end if;
  -- Nothing goes public without an owner's approval, whoever makes the change.
  if new.status in ('scheduled', 'published') and new.approved_by is null then
    raise exception 'A post must be approved by an owner before it can be scheduled or published' using errcode = '42501';
  end if;
  return new;
end
$$;

-- Viewers can't send posts for approval.
create or replace function public.submit_post(post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.social_posts;
begin
  if not public.is_writer() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into p from public.social_posts where id = post_id for update;
  if not found then raise exception 'No such post' using errcode = 'P0002'; end if;
  if p.status not in ('draft', 'rejected', 'failed') then raise exception 'Only drafts can be sent for approval' using errcode = '22023'; end if;
  if btrim(p.caption) = '' then raise exception 'Write a caption first' using errcode = '22023'; end if;
  update public.social_posts set status = 'pending_approval', submitted_at = now(), rejected_by = null, rejected_at = null, rejection_reason = '', error_message = '' where id = post_id;
  perform public.notify('post.pending', 'Post awaiting approval: ' || initcap(p.platform::text), '/admin/social?status=pending_approval&open=' || post_id, 'owner', 'post.pending:' || post_id || ':' || extract(epoch from now())::bigint);
end
$$;

-- For the publisher (secret key): claims an approved post for one publishing attempt.
-- Returns nothing if it isn't approved, is already being published, or was published.
create or replace function public.begin_publish(post_id uuid)
returns setof public.social_posts
language sql security definer set search_path = '' as $$
  update public.social_posts
    set publish_started_at = now(), publish_attempts = publish_attempts + 1
    where id = post_id and status in ('approved', 'scheduled') and approved_by is not null and publish_started_at is null
    returning *
$$;

-- Records the result of an attempt. Failures notify the owners (Automation F).
create or replace function public.finish_publish(post_id uuid, ok boolean, url text, platform_id text, error text)
returns void
language plpgsql security definer set search_path = '' as $$
declare p public.social_posts;
begin
  select * into p from public.social_posts where id = post_id for update;
  if not found or p.publish_started_at is null then return; end if;
  if ok then
    update public.social_posts
      set status = 'published', published_at = now(), published_url = coalesce(url, ''), platform_post_id = coalesce(platform_id, ''), error_message = '', publish_started_at = null
      where id = post_id;
    insert into public.audit_logs (action, target, details) values ('post.published', post_id::text, jsonb_build_object('platform', p.platform, 'manual', false));
  else
    update public.social_posts set status = 'failed', error_message = left(coalesce(error, 'Unknown error'), 1000), publish_started_at = null where id = post_id;
    perform public.notify('post.failed', 'Publishing failed: ' || initcap(p.platform::text) || ' post', '/admin/social?status=failed&open=' || post_id, 'owner', 'post.failed:' || post_id || ':' || p.publish_attempts);
  end if;
end
$$;

-- Attempts that never reported back are marked failed, not retried: the post may have
-- gone out, so an owner checks the platform before trying again.
create or replace function public.expire_stuck_publishing() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select id from public.social_posts where publish_started_at < now() - interval '15 minutes' loop
    perform public.finish_publish(r.id, false, '', '', 'The platform didn''t confirm in time. Check whether it was posted before retrying.');
    n := n + 1;
  end loop;
  return n;
end
$$;

-- A failed post goes back to Approved (wording unchanged, so the approval stands) for another try.
create or replace function public.retry_post(post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only an owner can retry publishing' using errcode = '42501'; end if;
  update public.social_posts set status = 'approved', scheduled_at = null, error_message = '' where id = post_id and status = 'failed' and approved_by is not null;
  if not found then raise exception 'Only failed, approved posts can be retried' using errcode = '22023'; end if;
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), 'post.retry', post_id::text);
end
$$;

revoke all on function public.begin_publish(uuid), public.finish_publish(uuid, boolean, text, text, text), public.expire_stuck_publishing() from public, anon, authenticated;
revoke all on function public.retry_post(uuid) from public, anon;
grant execute on function public.retry_post(uuid) to authenticated;

-- Automation D: an approved clip becomes posts awaiting approval, one per platform, using
-- the clip's AI captions. Nothing is published until an owner approves each post.
create or replace function public.send_clip_to_social(clip_id uuid, platforms public.social_platform[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.video_clips; p public.social_platform; caption text; n integer := 0;
begin
  if not public.is_writer() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into c from public.video_clips where id = clip_id for update;
  if not found then raise exception 'No such clip' using errcode = 'P0002'; end if;
  if c.status not in ('approved', 'sent_to_social') then raise exception 'Approve the clip first' using errcode = '22023'; end if;
  foreach p in array platforms loop
    if exists (select 1 from public.social_posts s where s.clip_id = c.id and s.platform = p) then continue; end if;
    caption := coalesce(nullif(c.captions ->> (p::text), ''), nullif(c.captions ->> 'description', ''), c.title);
    insert into public.social_posts (platform, caption, hashtags, media_asset_id, clip_id, source_type, source_ref, source_title, ai_generated, status, created_by, submitted_at)
      values (p, left(caption, 5000),
              coalesce((select array_agg(left(regexp_replace(t, '[^[:alnum:]_]', '', 'g'), 60)) from (select jsonb_array_elements_text(coalesce(c.captions -> 'hashtags', '[]')) t limit 10) h), '{}'),
              c.final_asset_id, c.id, 'clip', c.id::text, c.title, true, 'pending_approval', auth.uid(), now());
    n := n + 1;
  end loop;
  update public.video_clips set status = 'sent_to_social' where id = clip_id;
  if n > 0 then
    perform public.notify('post.pending', n || ' clip post(s) awaiting approval: ' || c.title, '/admin/social?status=pending_approval', 'owner', 'clip.sent:' || clip_id || ':' || extract(epoch from now())::bigint);
  end if;
  insert into public.audit_logs (actor_id, action, target, details) values (auth.uid(), 'clip.sent_to_social', clip_id::text, jsonb_build_object('posts', n));
  return n;
end
$$;

revoke all on function public.send_clip_to_social(uuid, public.social_platform[]) from public, anon;
grant execute on function public.send_clip_to_social(uuid, public.social_platform[]) to authenticated;

alter table public.social_accounts add column if not exists status text not null default 'not_connected'
  check (status in ('not_connected', 'connected', 'expired', 'error'));
alter table public.social_accounts add column if not exists account_name text not null default '';
alter table public.social_accounts add column if not exists expires_at timestamptz;
alter table public.social_accounts add column if not exists last_error text not null default '';
alter table public.social_accounts add column if not exists last_checked_at timestamptz;

-- Tokens for connected accounts. No dashboard account can read or change this table.
create table if not exists public.social_connections (
  platform public.social_platform primary key,
  provider text not null,
  external_account_id text not null default '',
  -- AES-256-GCM, encrypted by the server with TOKEN_ENCRYPTION_KEY
  access_token_enc text not null,
  refresh_token_enc text not null default '',
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  meta jsonb not null default '{}',
  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.social_connections enable row level security;
revoke all on public.social_connections from anon, authenticated;

-- One-time values that tie an OAuth sign-in to the owner who started it.
create table if not exists public.oauth_states (
  state text primary key,
  platform public.social_platform not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  code_verifier text not null default '',
  created_at timestamptz not null default now()
);

alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;

-- Disconnecting removes the tokens; the profile link stays.
create or replace function public.disconnect_account(target public.social_platform) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only an owner can disconnect accounts' using errcode = '42501'; end if;
  delete from public.social_connections where platform = target;
  update public.social_accounts set provider = '', status = 'not_connected', connected_at = null, expires_at = null, account_name = '', last_error = '' where platform = target;
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), 'account.disconnected', target::text);
end
$$;

revoke all on function public.disconnect_account(public.social_platform) from public, anon;
grant execute on function public.disconnect_account(public.social_platform) to authenticated;

-- ---------------------------------------------------------------------------
-- Story Inbox → interviews (Automation C)
-- ---------------------------------------------------------------------------

alter table public.story_submissions add column if not exists assigned_to uuid references public.profiles (id) on delete set null;
alter table public.story_submissions add column if not exists contacted_at timestamptz;
alter table public.story_submissions add column if not exists interview_project_id uuid references public.video_projects (id) on delete set null;

grant update (assigned_to) on public.story_submissions to authenticated;

create or replace function public.track_story_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
    if new.status = 'contacted' then new.contacted_at := coalesce(new.contacted_at, now()); end if;
    insert into public.audit_logs (actor_id, action, target, details)
      values (auth.uid(), 'story.status', old.reference, jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.audit_logs (actor_id, action, target, details)
      values (auth.uid(), 'story.assigned', old.reference, jsonb_build_object('to', new.assigned_to));
  end if;
  return new;
end
$$;

-- An approved story becomes an interview project in Video Production, once. Only the
-- name and story title are copied; contact details stay in the Story Inbox.
create or replace function public.story_to_interview() returns trigger
language plpgsql security definer set search_path = '' as $$
declare project uuid;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.interview_project_id is null then
    insert into public.video_projects (title, summary, status, story_id, guest_name, assigned_to, created_by)
      values (coalesce(nullif(left(new.story_title, 200), ''), 'Interview with ' || left(new.full_name, 150)),
              'From story ' || new.reference || '. See the Story Inbox for contact details and consent.',
              'idea', new.id, left(new.full_name, 200), new.assigned_to, auth.uid())
      on conflict do nothing
      returning id into project;
    if project is not null then
      update public.story_submissions set interview_project_id = project where id = new.id;
      perform public.notify('interview.created', 'Interview project created: ' || left(coalesce(nullif(new.story_title, ''), new.full_name), 120), '/admin/video?open=' || project, 'staff', 'interview.created:' || new.id);
    end if;
  end if;
  return null;
end
$$;

drop trigger if exists story_approved on public.story_submissions;
create trigger story_approved after update of status on public.story_submissions
  for each row execute function public.story_to_interview();

-- ---------------------------------------------------------------------------
-- Content calendar
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  kind text not null default 'task' check (kind in ('recording', 'interview', 'task', 'deadline', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null default 'Africa/Johannesburg',
  related_type text not null default '' check (related_type in ('', 'article', 'video_project', 'clip', 'newsletter', 'post', 'youtube')),
  related_id uuid,
  assigned_to uuid references public.profiles (id) on delete set null,
  notes text not null default '' check (char_length(notes) <= 2000),
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create index if not exists calendar_events_starts_idx on public.calendar_events (starts_at);

alter table public.calendar_events enable row level security;
drop policy if exists "Team members see calendar events" on public.calendar_events;
create policy "Team members see calendar events" on public.calendar_events for select to authenticated using (public.is_staff());
drop policy if exists "Writers add calendar events" on public.calendar_events;
create policy "Writers add calendar events" on public.calendar_events for insert to authenticated with check (public.is_writer() and created_by = auth.uid());
drop policy if exists "Writers edit calendar events" on public.calendar_events;
create policy "Writers edit calendar events" on public.calendar_events for update to authenticated using (public.is_writer()) with check (public.is_writer());
drop policy if exists "Owners and authors delete calendar events" on public.calendar_events;
create policy "Owners and authors delete calendar events" on public.calendar_events for delete to authenticated using (public.is_owner() or (public.is_writer() and created_by = auth.uid()));
revoke all on public.calendar_events from anon, authenticated;
grant select, delete on public.calendar_events to authenticated;
grant insert (title, kind, starts_at, ends_at, timezone, related_type, related_id, assigned_to, notes, status),
  update (title, kind, starts_at, ends_at, timezone, assigned_to, notes, status) on public.calendar_events to authenticated;

drop trigger if exists calendar_events_touch on public.calendar_events;
create trigger calendar_events_touch before update on public.calendar_events for each row execute function public.touch_updated_at();

-- Everything with a date, in one place. security_invoker: each row is only visible to
-- people who can see it in its own table.
create or replace view public.content_calendar with (security_invoker = true) as
  select 'post:' || p.id as uid, 'post' as item_type, p.id as item_id, p.platform::text as channel,
         coalesce(nullif(p.source_title, ''), left(p.caption, 80)) as title,
         coalesce(p.published_at, p.scheduled_at) as at, p.status::text as status, p.approved_by is not null as approved,
         p.created_by as person_id, '/admin/social?open=' || p.id as link
    from public.social_posts p where p.scheduled_at is not null or p.published_at is not null
  union all
  select 'article:' || a.id, 'article', a.id, 'website', a.title, coalesce(a.published_at, a.scheduled_at), a.status, a.approved_by is not null,
         a.created_by, '/admin/news?open=' || a.id
    from public.news_articles a where a.scheduled_at is not null or (a.published_at is not null and a.status = 'published')
  union all
  select 'newsletter:' || c.id, 'newsletter', c.id, 'email', coalesce(nullif(c.subject, ''), 'Newsletter'), coalesce(c.sent_at, c.scheduled_at), c.status, c.approved_by is not null,
         c.created_by, '/admin/newsletter?open=' || c.id
    from public.newsletter_campaigns c where c.scheduled_at is not null or c.sent_at is not null
  union all
  select 'recording:' || v.id, 'recording', v.id, 'studio', 'Recording: ' || v.title, v.recording_at, v.status, true,
         v.assigned_to, '/admin/video?open=' || v.id
    from public.video_projects v where v.recording_at is not null and v.status <> 'archived'
  union all
  select 'youtube:' || y.youtube_id, 'youtube', null, 'youtube', y.title, y.published_at, 'published', true, null, '/admin/youtube?open=' || y.youtube_id
    from public.youtube_videos y where y.published_at is not null
  union all
  select 'event:' || e.id, 'event', e.id, e.kind, e.title, e.starts_at, e.status, true, e.assigned_to, '/admin/calendar?open=' || e.id
    from public.calendar_events e;

revoke all on public.content_calendar from anon, authenticated;
grant select on public.content_calendar to authenticated;

-- Moves something on the calendar. Publishing dates are an owner's call and go through the
-- same checks as scheduling from each section; recordings and tasks can be moved by writers.
create or replace function public.reschedule_item(item_type text, item_id uuid, at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare tz text;
begin
  if at is null then raise exception 'Choose a time' using errcode = '22023'; end if;
  case item_type
    when 'post' then
      select timezone into tz from public.social_posts where id = item_id;
      perform public.schedule_post(item_id, at, tz);
    when 'article' then
      perform public.schedule_article(item_id, at);
    when 'newsletter' then
      select timezone into tz from public.newsletter_campaigns where id = item_id;
      perform public.schedule_newsletter(item_id, at, tz);
    when 'recording' then
      if not public.is_writer() then raise exception 'Not allowed' using errcode = '42501'; end if;
      update public.video_projects set recording_at = at where id = item_id;
    when 'event' then
      if not public.is_writer() then raise exception 'Not allowed' using errcode = '42501'; end if;
      update public.calendar_events set ends_at = case when ends_at is null then null else at + (ends_at - starts_at) end, starts_at = at where id = item_id;
    else
      raise exception 'This item can''t be moved here' using errcode = '22023';
  end case;
  if not found and item_type in ('recording', 'event') then raise exception 'Not found' using errcode = 'P0002'; end if;
end
$$;

revoke all on function public.reschedule_item(text, uuid, timestamptz) from public, anon;
grant execute on function public.reschedule_item(text, uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- File storage (Supabase Storage). Skipped where Storage isn't installed, e.g. in tests.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    -- Recordings and clips: private. Opened only through short-lived signed links.
    insert into storage.buckets (id, name, public, allowed_mime_types)
      values ('media', 'media', false, array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'image/png', 'image/jpeg', 'image/webp'])
      on conflict (id) do nothing;
    -- Article images shown on the public site.
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('site-images', 'site-images', true, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
      on conflict (id) do nothing;

    execute 'drop policy if exists "Team members open media files" on storage.objects';
    execute 'create policy "Team members open media files" on storage.objects for select to authenticated using (bucket_id = ''media'' and public.is_staff())';
    execute 'drop policy if exists "Writers upload site images" on storage.objects';
    execute 'create policy "Writers upload site images" on storage.objects for insert to authenticated with check (bucket_id = ''site-images'' and public.is_writer())';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Live updates for the new sections
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['jobs', 'video_clips', 'video_projects', 'news_articles', 'newsletter_campaigns', 'media_assets'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end
$$;
