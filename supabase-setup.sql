-- Find a time: database setup.
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- It's safe to run more than once.

create table if not exists public.polls (
  id         text primary key check (char_length(id) between 6 and 32),
  title      text not null check (char_length(title) between 1 and 100),
  tz         text not null check (char_length(tz) <= 64),
  dates      text[] not null,
  start_min  int not null,
  end_min    int not null,
  step       int not null check (step in (15, 30, 60)),
  slots      bigint[] not null check (cardinality(slots) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.responses (
  poll_id    text not null references public.polls(id) on delete cascade,
  id         text not null check (char_length(id) <= 70),
  name       text not null check (char_length(name) between 1 and 60),
  tz         text check (char_length(tz) <= 64),
  slots      bigint[] not null default '{}' check (cardinality(slots) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (poll_id, id)
);

-- The site uses the public (anon) key, so access is controlled here.
-- Anyone with a poll link can read it and add, edit or remove answers, like When2meet.
-- Polls can be created but never edited or deleted from the site.
alter table public.polls     enable row level security;
alter table public.responses enable row level security;

grant select, insert                 on public.polls     to anon, authenticated;
grant select, insert, update, delete on public.responses to anon, authenticated;

drop policy if exists "read polls"         on public.polls;
drop policy if exists "create polls"       on public.polls;
drop policy if exists "read responses"     on public.responses;
drop policy if exists "add responses"      on public.responses;
drop policy if exists "edit responses"     on public.responses;
drop policy if exists "remove responses"   on public.responses;

create policy "read polls"       on public.polls     for select to anon, authenticated using (true);
create policy "create polls"     on public.polls     for insert to anon, authenticated with check (true);
create policy "read responses"   on public.responses for select to anon, authenticated using (true);
create policy "add responses"    on public.responses for insert to anon, authenticated with check (true);
create policy "edit responses"   on public.responses for update to anon, authenticated using (true) with check (true);
create policy "remove responses" on public.responses for delete to anon, authenticated using (true);
