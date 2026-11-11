-- Set (or change) the admin password that can edit or delete any poll.
-- 1. Paste this into Supabase > SQL Editor > New query.
-- 2. Replace the placeholder below with your own password. Keep the quotes.
-- 3. Click Run.
-- Don't save your real password back into this file, since the repo is public.

insert into private.admin (id, password_hash)
values (1, extensions.crypt('PUT-YOUR-PASSWORD-HERE', extensions.gen_salt('bf')))
on conflict (id) do update set password_hash = excluded.password_hash;
