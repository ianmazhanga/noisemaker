-- Episode categories chosen in the dashboard (YouTube Manager → Categories).
--
-- An admin's choice beats the hand-written topic in src/data/episodes.ts and the automatic
-- suggestion, and it survives every YouTube sync because it's stored here, keyed by the
-- video's YouTube ID. The public website reads this table with the publishable key so a
-- change shows straight away.
--
-- Safe to run more than once. Only adds things; nothing existing is changed.

create table if not exists public.episode_categories (
  youtube_id text primary key check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  -- A topic slug from src/data/topics.ts. The website ignores slugs it doesn't know.
  topic text not null check (topic ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(topic) <= 40),
  updated_by uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.episode_categories enable row level security;

-- Categories are public information (they're on the website already).
drop policy if exists "Anyone reads episode categories" on public.episode_categories;
create policy "Anyone reads episode categories" on public.episode_categories for select to anon, authenticated using (true);

drop policy if exists "Writers set episode categories" on public.episode_categories;
create policy "Writers set episode categories" on public.episode_categories for insert to authenticated with check (public.is_writer());

drop policy if exists "Writers change episode categories" on public.episode_categories;
create policy "Writers change episode categories" on public.episode_categories for update to authenticated using (public.is_writer()) with check (public.is_writer());

drop policy if exists "Writers clear episode categories" on public.episode_categories;
create policy "Writers clear episode categories" on public.episode_categories for delete to authenticated using (public.is_writer());

revoke all on public.episode_categories from anon, authenticated;
grant select (youtube_id, topic, updated_at) on public.episode_categories to anon;
grant select, delete on public.episode_categories to authenticated;
grant insert (youtube_id, topic), update (topic) on public.episode_categories to authenticated;

create or replace function public.track_episode_category() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  insert into public.audit_logs (actor_id, action, target, details)
    values (auth.uid(), 'episode.category', new.youtube_id, jsonb_build_object('topic', new.topic, 'from', case when tg_op = 'UPDATE' then old.topic end));
  return new;
end
$$;

drop trigger if exists episode_category_changed on public.episode_categories;
create trigger episode_category_changed before insert or update on public.episode_categories
  for each row execute function public.track_episode_category();
