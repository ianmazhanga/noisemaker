-- Social Media Manager: post drafts, the approval workflow and connected accounts.
--
-- Workflow (enforced here, not just in the dashboard):
--   draft → pending_approval → approved → scheduled → published
--                           ↘ rejected            ↘ failed
--   * Anyone with a role writes drafts and submits them for approval.
--   * Only owners approve, reject or schedule (approve_post / reject_post / schedule_post).
--   * Editing the wording of an approved or scheduled post sends it back for approval.
--   * A post can only become published if an owner approved it. Publishing services
--     use the secret key, which bypasses RLS, so this check lives in a trigger.
--   * Access tokens for social networks are never stored in these tables.

create type public.social_platform as enum ('instagram', 'facebook', 'tiktok', 'youtube', 'x');
create type public.post_status as enum ('draft', 'pending_approval', 'approved', 'scheduled', 'published', 'failed', 'rejected');

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  platform public.social_platform not null,
  caption text not null default '' check (char_length(caption) <= 5000),
  hashtags text[] not null default '{}' check (cardinality(hashtags) <= 30),
  link_url text not null default '' check (link_url = '' or link_url ~ '^https://'),
  media_note text not null default '' check (char_length(media_note) <= 1000),

  -- Where the idea came from: a YouTube video, a news story or written by hand
  source_type text not null default 'manual' check (source_type in ('manual', 'youtube', 'news')),
  source_ref text not null default '',
  source_title text not null default '',
  ai_generated boolean not null default false,

  status public.post_status not null default 'draft',
  scheduled_at timestamptz,
  -- IANA time zone the post was scheduled in, e.g. Africa/Johannesburg
  timezone text not null default 'Africa/Johannesburg',

  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  rejected_by uuid references public.profiles (id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text not null default '',
  published_at timestamptz,
  published_url text not null default '',
  error_message text not null default ''
);

create index social_posts_status_idx on public.social_posts (status, created_at desc);
create index social_posts_scheduled_idx on public.social_posts (scheduled_at) where scheduled_at is not null;
create index social_posts_source_idx on public.social_posts (source_type, source_ref);

alter table public.social_posts enable row level security;

create policy "Team members see posts"
  on public.social_posts for select to authenticated
  using (public.is_staff());

create policy "Team members write drafts"
  on public.social_posts for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid() and status = 'draft');

create policy "Team members edit posts that aren't published"
  on public.social_posts for update to authenticated
  using (public.is_staff() and status not in ('published'))
  with check (public.is_staff());

create policy "Authors delete their drafts; owners delete any unpublished post"
  on public.social_posts for delete to authenticated
  using (status <> 'published' and (public.is_owner() or (created_by = auth.uid() and status in ('draft', 'rejected'))));

-- Wording only. Status, approval and publishing fields change through the functions below.
revoke all on public.social_posts from anon, authenticated;
grant select, delete on public.social_posts to authenticated;
grant insert (platform, caption, hashtags, link_url, media_note, source_type, source_ref, source_title, ai_generated, timezone) on public.social_posts to authenticated;
grant update (platform, caption, hashtags, link_url, media_note, timezone) on public.social_posts to authenticated;

create function public.guard_social_post() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    -- Changing the wording of an approved post needs a fresh approval.
    if old.status in ('approved', 'scheduled') and new.status = old.status
       and (new.caption, new.hashtags, new.link_url, new.media_note, new.platform)
           is distinct from (old.caption, old.hashtags, old.link_url, old.media_note, old.platform) then
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

create trigger social_post_guard
  before insert or update on public.social_posts
  for each row execute function public.guard_social_post();

-- ---------------------------------------------------------------------------
-- Workflow functions
-- ---------------------------------------------------------------------------

create function public.submit_post(post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.social_posts;
begin
  if not public.is_staff() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into p from public.social_posts where id = post_id for update;
  if not found then raise exception 'No such post' using errcode = 'P0002'; end if;
  if p.status not in ('draft', 'rejected', 'failed') then raise exception 'Only drafts can be sent for approval' using errcode = '22023'; end if;
  if btrim(p.caption) = '' then raise exception 'Write a caption first' using errcode = '22023'; end if;
  update public.social_posts set status = 'pending_approval', submitted_at = now(), rejected_by = null, rejected_at = null, rejection_reason = '', error_message = '' where id = post_id;
  insert into public.notifications (kind, title, link, audience)
    values ('post.pending', 'Post awaiting approval: ' || initcap(p.platform::text), '/admin/social?status=pending_approval&open=' || post_id, 'owner');
end
$$;

create function public.approve_post(post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.social_posts;
begin
  if not public.is_owner() then raise exception 'Only an owner can approve posts' using errcode = '42501'; end if;
  select * into p from public.social_posts where id = post_id for update;
  if not found then raise exception 'No such post' using errcode = 'P0002'; end if;
  if p.status not in ('pending_approval', 'draft', 'rejected') then raise exception 'This post can''t be approved in its current state' using errcode = '22023'; end if;
  if btrim(p.caption) = '' then raise exception 'Write a caption first' using errcode = '22023'; end if;
  update public.social_posts set status = 'approved', approved_by = auth.uid(), approved_at = now(), rejected_by = null, rejected_at = null, rejection_reason = '' where id = post_id;
  insert into public.audit_logs (actor_id, action, target, details) values (auth.uid(), 'post.approved', post_id::text, jsonb_build_object('platform', p.platform));
end
$$;

create function public.reject_post(post_id uuid, reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.social_posts;
begin
  if not public.is_owner() then raise exception 'Only an owner can reject posts' using errcode = '42501'; end if;
  select * into p from public.social_posts where id = post_id for update;
  if not found then raise exception 'No such post' using errcode = 'P0002'; end if;
  if p.status = 'published' then raise exception 'Published posts can''t be rejected' using errcode = '22023'; end if;
  update public.social_posts
    set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(), rejection_reason = left(coalesce(reason, ''), 500),
        approved_by = null, approved_at = null, scheduled_at = null
    where id = post_id;
  insert into public.audit_logs (actor_id, action, target, details) values (auth.uid(), 'post.rejected', post_id::text, jsonb_build_object('platform', p.platform));
end
$$;

-- Schedules an approved post, or moves an already scheduled one. Null unschedules it.
create function public.schedule_post(post_id uuid, at timestamptz, tz text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.social_posts;
begin
  if not public.is_owner() then raise exception 'Only an owner can schedule posts' using errcode = '42501'; end if;
  select * into p from public.social_posts where id = post_id for update;
  if not found then raise exception 'No such post' using errcode = 'P0002'; end if;
  if p.status not in ('approved', 'scheduled') then raise exception 'Approve the post before scheduling it' using errcode = '22023'; end if;
  if at is not null and at < now() - interval '5 minutes' then raise exception 'Choose a time in the future' using errcode = '22023'; end if;
  if tz is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then raise exception 'Unknown time zone' using errcode = '22023'; end if;
  update public.social_posts
    set status = case when at is null then 'approved'::public.post_status else 'scheduled'::public.post_status end,
        scheduled_at = at, timezone = coalesce(tz, p.timezone)
    where id = post_id;
  insert into public.audit_logs (actor_id, action, target, details)
    values (auth.uid(), case when at is null then 'post.unscheduled' else 'post.scheduled' end, post_id::text, jsonb_build_object('platform', p.platform, 'at', at));
end
$$;

-- For posts an owner publishes by hand (copying the caption into the app), until accounts are connected.
create function public.mark_post_published(post_id uuid, url text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.social_posts;
begin
  if not public.is_owner() then raise exception 'Only an owner can mark posts as published' using errcode = '42501'; end if;
  select * into p from public.social_posts where id = post_id for update;
  if not found then raise exception 'No such post' using errcode = 'P0002'; end if;
  if p.status not in ('approved', 'scheduled', 'failed') or p.approved_by is null then raise exception 'Only approved posts can be published' using errcode = '42501'; end if;
  if coalesce(url, '') <> '' and url !~ '^https://' then raise exception 'The link must start with https://' using errcode = '22023'; end if;
  update public.social_posts set status = 'published', published_at = now(), published_url = coalesce(url, ''), error_message = '' where id = post_id;
  insert into public.audit_logs (actor_id, action, target, details) values (auth.uid(), 'post.published', post_id::text, jsonb_build_object('platform', p.platform, 'manual', true));
end
$$;

revoke all on function public.submit_post(uuid), public.approve_post(uuid), public.reject_post(uuid, text),
  public.schedule_post(uuid, timestamptz, text), public.mark_post_published(uuid, text) from public, anon;
grant execute on function public.submit_post(uuid), public.approve_post(uuid), public.reject_post(uuid, text),
  public.schedule_post(uuid, timestamptz, text), public.mark_post_published(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Connected accounts: what's connected, never the access tokens themselves
-- ---------------------------------------------------------------------------

create table public.social_accounts (
  platform public.social_platform primary key,
  display_name text not null default '',
  profile_url text not null default '' check (profile_url = '' or profile_url ~ '^https://'),
  -- How posts get there once connected, e.g. 'buffer' or 'meta'. Empty = not connected.
  provider text not null default '',
  connected_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.social_accounts (platform) values ('instagram'), ('facebook'), ('tiktok'), ('youtube'), ('x');

alter table public.social_accounts enable row level security;

create policy "Team members see account status"
  on public.social_accounts for select to authenticated
  using (public.is_staff());

create policy "Owners record profile links"
  on public.social_accounts for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

revoke all on public.social_accounts from anon, authenticated;
grant select on public.social_accounts to authenticated;
-- The provider and connection time are set only by the server when a real connection is made.
grant update (display_name, profile_url) on public.social_accounts to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.social_posts;
  end if;
end
$$;
