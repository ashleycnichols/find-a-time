-- Find a time: database setup.
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- It's safe to run more than once, and running it again keeps existing polls and answers.

create extension if not exists pgcrypto with schema extensions;

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

-- Secrets live in a private schema the website can't read.
create schema if not exists private;
revoke all on schema private from anon, authenticated;

-- Each poll's manage key (saved in its creator's browser), stored hashed.
create table if not exists private.poll_keys (
  poll_id  text primary key references public.polls(id) on delete cascade,
  key_hash text not null
);

-- One admin password that can edit or delete any poll. Set it with
-- supabase-admin-password.sql.
create table if not exists private.admin (
  id            int primary key default 1 check (id = 1),
  password_hash text not null
);

-- Access rules. The site uses the public key, so this is what keeps things safe.
-- Anyone with a poll link can read it and add, edit or remove answers, like When2meet.
-- Polls can only be created, edited or deleted through the functions below.
alter table public.polls     enable row level security;
alter table public.responses enable row level security;

revoke insert, update, delete on public.polls from anon, authenticated;
grant select                         on public.polls     to anon, authenticated;
grant select, insert, update, delete on public.responses to anon, authenticated;

drop policy if exists "read polls"       on public.polls;
drop policy if exists "create polls"     on public.polls;
drop policy if exists "read responses"   on public.responses;
drop policy if exists "add responses"    on public.responses;
drop policy if exists "edit responses"   on public.responses;
drop policy if exists "remove responses" on public.responses;

create policy "read polls"       on public.polls     for select to anon, authenticated using (true);
create policy "read responses"   on public.responses for select to anon, authenticated using (true);
create policy "add responses"    on public.responses for insert to anon, authenticated with check (true);
create policy "edit responses"   on public.responses for update to anon, authenticated using (true) with check (true);
create policy "remove responses" on public.responses for delete to anon, authenticated using (true);

-- True if the key is this poll's manage key or the admin password.
create or replace function public.can_manage_poll(p_id text, p_key text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(char_length(p_key) between 1 and 200, false) and (
    exists (select 1 from private.poll_keys k
            where k.poll_id = p_id and k.key_hash = extensions.crypt(p_key, k.key_hash))
    or exists (select 1 from private.admin a
               where a.password_hash = extensions.crypt(p_key, a.password_hash)
                 -- ignore the admin password if the placeholder was never changed
                 and a.password_hash <> extensions.crypt('PUT-YOUR-PASSWORD-HERE', a.password_hash))
  );
$$;

create or replace function public.create_poll(
  p_id text, p_title text, p_tz text, p_dates text[],
  p_start int, p_end int, p_step int, p_slots bigint[], p_key text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_key is null or char_length(p_key) < 20 then
    raise exception 'A manage key is needed to create a poll';
  end if;
  insert into public.polls (id, title, tz, dates, start_min, end_min, step, slots)
  values (p_id, p_title, p_tz, p_dates, p_start, p_end, p_step, p_slots);
  insert into private.poll_keys (poll_id, key_hash)
  values (p_id, extensions.crypt(p_key, extensions.gen_salt('bf')));
end;
$$;

create or replace function public.update_poll(
  p_id text, p_title text, p_tz text, p_dates text[],
  p_start int, p_end int, p_step int, p_slots bigint[], p_key text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_manage_poll(p_id, p_key) then
    raise exception 'That password or manage key does not work for this poll';
  end if;
  update public.polls
     set title = p_title, tz = p_tz, dates = p_dates, start_min = p_start,
         end_min = p_end, step = p_step, slots = p_slots
   where id = p_id;
end;
$$;

create or replace function public.delete_poll(p_id text, p_key text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_manage_poll(p_id, p_key) then
    raise exception 'That password or manage key does not work for this poll';
  end if;
  delete from public.polls where id = p_id;
end;
$$;

revoke all on function public.can_manage_poll(text, text) from public;
revoke all on function public.create_poll(text, text, text, text[], int, int, int, bigint[], text) from public;
revoke all on function public.update_poll(text, text, text, text[], int, int, int, bigint[], text) from public;
revoke all on function public.delete_poll(text, text) from public;
grant execute on function public.can_manage_poll(text, text) to anon, authenticated;
grant execute on function public.create_poll(text, text, text, text[], int, int, int, bigint[], text) to anon, authenticated;
grant execute on function public.update_poll(text, text, text, text[], int, int, int, bigint[], text) to anon, authenticated;
grant execute on function public.delete_poll(text, text) to anon, authenticated;
