-- Noisemakers owner dashboard: accounts, roles, Story Inbox, notifications and audit log.
--
-- Security model
--   * Every person signs in with their own Supabase account.
--   * A new account has NO access (profiles.role is null) until the owner grants a role,
--     so turning off public sign-ups is a second line of defence, not the only one.
--   * Row Level Security decides what each account can read and change. The website's
--     buttons only mirror these rules.
--   * Story submissions are only ever inserted by the server function (netlify/functions/stories.ts)
--     using the secret key. The public key can neither read nor write them.

create type public.staff_role as enum ('owner', 'content_manager');
create type public.story_status as enum ('new', 'under_review', 'contacted', 'approved', 'declined');

-- ---------------------------------------------------------------------------
-- Profiles: one per account
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text not null default '' check (char_length(full_name) <= 100),
  -- null = signed up or invited, but no access yet
  role public.staff_role,
  -- Content managers see the Story Inbox only when the owner allows it. Owners always do.
  can_view_stories boolean not null default false,
  created_at timestamptz not null default now()
);

-- Helpers used by the policies below. SECURITY DEFINER so they can read profiles
-- without the profiles policies calling themselves.
create function public.my_role() returns public.staff_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false)
$$;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role is not null from public.profiles where id = auth.uid()), false)
$$;

create function public.can_read_stories() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select role = 'owner' or (role = 'content_manager' and can_view_stories)
    from public.profiles where id = auth.uid()
  ), false)
$$;

-- Every new account gets a profile with no role.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy "Read own profile; the owner reads all"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_owner());

create policy "Edit own name"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- People may change only their own name. Roles change through set_member_access() below.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Audit log: who changed what. Written only by the functions and triggers here.
-- ---------------------------------------------------------------------------

create table public.audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target text not null default '',
  details jsonb not null default '{}'
);

create index audit_logs_at_idx on public.audit_logs (at desc);

alter table public.audit_logs enable row level security;

create policy "The owner reads the audit log"
  on public.audit_logs for select to authenticated
  using (public.is_owner());

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;

-- ---------------------------------------------------------------------------
-- Team management (owner only)
-- ---------------------------------------------------------------------------

create function public.set_member_access(member_id uuid, new_role public.staff_role, stories boolean)
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
    set role = new_role, can_view_stories = coalesce(stories, false)
    where id = member_id;
  if not found then
    raise exception 'No such team member' using errcode = 'P0002';
  end if;
  insert into public.audit_logs (actor_id, action, target, details)
    values (auth.uid(), 'member.access', member_id::text, jsonb_build_object('role', new_role, 'can_view_stories', coalesce(stories, false)));
end
$$;

revoke all on function public.set_member_access(uuid, public.staff_role, boolean) from public, anon;
grant execute on function public.set_member_access(uuid, public.staff_role, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Story submissions
-- Column names match the "Tell your story" form (FIELD_NAMES in src/lib/storyForm.ts).
-- ---------------------------------------------------------------------------

create table public.story_submissions (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^NM-[0-9]{6}-[A-Z0-9]{4}$'),
  -- Hash of email + title + story, to catch the same story being sent twice
  fingerprint text not null,
  received_at timestamptz not null default now(),
  status public.story_status not null default 'new',
  status_changed_at timestamptz,
  status_changed_by uuid references public.profiles (id) on delete set null,

  request_type text not null default '',
  full_name text not null default '',
  email text not null default '',
  phone text not null default '',
  preferred_contact text not null default '',
  profile_link text not null default '',
  story_title text not null default '',
  story_summary text not null default '',
  why_share text not null default '',
  topics text not null default '',
  interview_format text not null default '',
  availability text not null default '',
  additional_info text not null default '',
  consents text not null default ''
);

create index story_submissions_received_idx on public.story_submissions (received_at desc);
create index story_submissions_status_idx on public.story_submissions (status);
create index story_submissions_fingerprint_idx on public.story_submissions (fingerprint, received_at desc);

alter table public.story_submissions enable row level security;

create policy "Story readers see submissions"
  on public.story_submissions for select to authenticated
  using (public.can_read_stories());

create policy "Story readers change the status"
  on public.story_submissions for update to authenticated
  using (public.can_read_stories()) with check (public.can_read_stories());

create policy "The owner deletes submissions"
  on public.story_submissions for delete to authenticated
  using (public.is_owner());

-- The public key gets nothing. Signed-in staff may change only the status.
revoke all on public.story_submissions from anon, authenticated;
grant select, delete on public.story_submissions to authenticated;
grant update (status) on public.story_submissions to authenticated;

create function public.track_story_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
    insert into public.audit_logs (actor_id, action, target, details)
      values (auth.uid(), 'story.status', old.reference, jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end
$$;

create trigger story_status_changed
  before update on public.story_submissions
  for each row execute function public.track_story_status();

create function public.log_story_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs (actor_id, action, target) values (auth.uid(), 'story.deleted', old.reference);
  return old;
end
$$;

create trigger story_deleted
  after delete on public.story_submissions
  for each row execute function public.log_story_deleted();

-- Private notes on a submission, visible to everyone who can read stories.
create table public.story_notes (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.story_submissions (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index story_notes_submission_idx on public.story_notes (submission_id, created_at);

alter table public.story_notes enable row level security;

create policy "Story readers see notes"
  on public.story_notes for select to authenticated
  using (public.can_read_stories());

create policy "Story readers add their own notes"
  on public.story_notes for insert to authenticated
  with check (public.can_read_stories() and author_id = auth.uid());

create policy "Authors delete their own notes"
  on public.story_notes for delete to authenticated
  using (author_id = auth.uid() and public.can_read_stories());

revoke all on public.story_notes from anon, authenticated;
grant select, insert (submission_id, body), delete on public.story_notes to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  title text not null,
  link text not null default '/admin',
  -- Who sees it: 'owner', 'stories' (everyone who can read stories) or 'staff' (everyone with a role)
  audience text not null check (audience in ('owner', 'stories', 'staff'))
);

create index notifications_created_idx on public.notifications (created_at desc);

create table public.notification_reads (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create function public.can_see_notification(audience text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case audience
    when 'owner' then public.is_owner()
    when 'stories' then public.can_read_stories()
    when 'staff' then public.is_staff()
    else false
  end
$$;

alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

create policy "See notifications meant for you"
  on public.notifications for select to authenticated
  using (public.can_see_notification(audience));

create policy "See your own read marks"
  on public.notification_reads for select to authenticated
  using (user_id = auth.uid());

create policy "Mark notifications you can see as read"
  on public.notification_reads for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.notifications n where n.id = notification_id and public.can_see_notification(n.audience))
  );

revoke all on public.notifications, public.notification_reads from anon, authenticated;
grant select on public.notifications to authenticated;
grant select, insert (notification_id) on public.notification_reads to authenticated;

-- A new story creates a notification for everyone who can read stories.
create function public.notify_new_story() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (kind, title, link, audience)
    values (
      'story.new',
      case when new.request_type like 'Request an introductory call%' then 'New call request' else 'New story' end
        || coalesce(': ' || nullif(left(new.story_title, 80), ''), ''),
      '/admin/stories?open=' || new.id,
      'stories'
    );
  return new;
end
$$;

create trigger story_received
  after insert on public.story_submissions
  for each row execute function public.notify_new_story();

-- ---------------------------------------------------------------------------
-- Live updates for the dashboard counters (Supabase Realtime). Realtime applies
-- the same Row Level Security, so people only receive rows they may read.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.story_submissions, public.notifications;
  end if;
end
$$;
