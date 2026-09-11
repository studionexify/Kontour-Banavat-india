-- 0007_single_owner.sql — one owner, and accounts made on their behalf.
--
-- Until now anybody who could reach the app could sign up, find no
-- books, and be handed a brand new empty set of their own. That is
-- exactly what "I opened Kontour on another device and nothing was
-- there" looks like: the records were online the whole time, in the
-- books the first device made, while the second device was looking at
-- books of its own.
--
-- So: only the owner address may bring books into being. Everyone else
-- gets an account made for them by the owner (api/admin/users.js, with
-- the service role) and is put on the owner's books as they are made —
-- there is nothing for them to create and nothing to accept.
--
-- The service role bypasses row level security entirely, so none of
-- this stands in the way of that route; it only closes the door that a
-- browser can reach.

-- Keep the address in one place so a rename is one update, not a hunt
-- through policies.
create or replace function public.owner_email()
returns text
language sql
immutable
as $$ select 'furniture@banavat-india.com'::text $$;

create or replace function public.is_owner_account()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and lower(email) = public.owner_email()
  );
$$;

-- Creating books: the owner, and nobody else. A staff account that
-- somehow arrives with no membership now sees "ask the owner" rather
-- than quietly starting a second business.
drop policy if exists orgs_insert on public.orgs;
create policy orgs_insert on public.orgs
  for insert with check (public.is_owner_account());

-- Invites are gone from the app — an account is made outright rather
-- than offered. The table stays for the history already in it, but
-- nothing new can be written from a browser.
drop policy if exists invites_admin on public.invites;
drop policy if exists invites_read on public.invites;
create policy invites_read on public.invites
  for select using (public.is_admin(org_id));

-- Memberships were writable by any admin; with accounts now made
-- server-side, the only thing a browser still does here is change what
-- someone may do, and that is the owner's call alone.
drop policy if exists memberships_write on public.memberships;
create policy memberships_write on public.memberships
  for all using (public.is_admin(org_id) and public.is_owner_account())
  with check (public.is_admin(org_id) and public.is_owner_account());
