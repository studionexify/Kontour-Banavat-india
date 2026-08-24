-- ════════════════════════════════════════════════════════════
-- Phynance — shared books for one business
--
-- The shape here follows what the app already is: an offline-first
-- ledger whose records are small JSON documents. Rather than mirror
-- twenty columns per kind and re-migrate every time a field is added,
-- each record keeps its app-shaped payload in `data`, and only the
-- columns sync and reporting actually need are promoted alongside it.
--
-- Three ideas carry the whole file:
--
--   1. An org owns everything. Every row carries org_id, and every
--      policy asks one question: are you a member of that org.
--   2. Last write wins, by updated_at. A device that was offline for
--      a week pushes what it has; older writes lose. Deletes are
--      tombstones, never DELETEs, or an offline device would simply
--      re-create the row on its next push.
--   3. Nothing device-local ever lands here. The PIN, the Drive OAuth
--      token and any API key stay on the device that set them —
--      see org_settings below.
-- ════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── Identity ────────────────────────────────────────────────

create table public.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users on delete set null
);

-- Mirrors auth.users so the app can show who logged an entry without
-- reaching into the auth schema.
create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  full_name   text,
  created_at  timestamptz not null default now()
);

create type public.member_role as enum ('owner', 'admin', 'staff', 'viewer');

create table public.memberships (
  org_id      uuid not null references public.orgs on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  role        public.member_role not null default 'staff',
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index memberships_user_idx on public.memberships (user_id);

-- An owner names an email before that person has an account. On their
-- first sign-in the trigger below turns any matching invite into a
-- membership, so nobody has to be online at the same time.
create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs on delete cascade,
  email       text not null,
  role        public.member_role not null default 'staff',
  invited_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  unique (org_id, email)
);

create index invites_email_idx on public.invites (lower(email)) where accepted_at is null;

-- ── The ledger ──────────────────────────────────────────────

create type public.record_kind as enum ('account', 'category', 'job', 'entry', 'recurring');

create table public.records (
  org_id      uuid not null references public.orgs on delete cascade,
  kind        public.record_kind not null,
  -- The app's own id ('cash', 'c_mat', 'e_lz4k2ab'). Ids are unique
  -- within an org, not across them: every org has a 'cash' account.
  id          text not null,
  data        jsonb not null,
  -- Promoted out of `data` so the server can index and report without
  -- owning the record's shape. Kept in step by the trigger below, so
  -- the app never has to send them and can never disagree with them.
  entry_date  date,
  entry_type  text,
  total       numeric(14,2),
  job_code    text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users on delete set null,
  deleted_at  timestamptz,
  primary key (org_id, kind, id)
);

-- The sync cursor: "everything that changed since I last pulled".
create index records_sync_idx on public.records (org_id, updated_at);
create index records_entry_date_idx on public.records (org_id, entry_date)
  where kind = 'entry' and deleted_at is null;
create index records_job_idx on public.records (org_id, job_code)
  where kind = 'entry' and deleted_at is null;

create or replace function public.records_promote()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'entry' then
    -- to_jsonb(...) #>> '{}' unwraps a JSON string without the quotes a
    -- ->> on a nested value would leave behind.
    new.entry_date := nullif(new.data ->> 'date', '')::date;
    new.entry_type := new.data ->> 'type';
    new.total      := coalesce((new.data ->> 'total')::numeric, 0);
    new.job_code   := nullif(new.data ->> 'jobCode', '');
  else
    new.entry_date := null;
    new.entry_type := null;
    new.total      := null;
    new.job_code   := null;
  end if;
  return new;
end;
$$;

create trigger records_promote_trg
  before insert or update on public.records
  for each row execute function public.records_promote();

-- ── Shared settings ─────────────────────────────────────────
-- GST defaults, the Drive folder, category ordering — things that
-- should look the same to everyone. Deliberately NOT here: pinHash,
-- pinSalt, any Drive OAuth token, any API key. Those stay on the
-- device that set them; see js/cloud.js SHARED_SETTINGS.
create table public.org_settings (
  org_id      uuid primary key references public.orgs on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users on delete set null
);

-- ── Membership helpers ──────────────────────────────────────
-- security definer, so a policy on memberships can ask about
-- memberships without recursing into its own policy.

create or replace function public.is_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_write(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'staff')
  );
$$;

create or replace function public.is_admin(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

-- ── Row level security ──────────────────────────────────────

alter table public.orgs         enable row level security;
alter table public.profiles     enable row level security;
alter table public.memberships  enable row level security;
alter table public.invites      enable row level security;
alter table public.records      enable row level security;
alter table public.org_settings enable row level security;

-- orgs
create policy orgs_read on public.orgs
  for select using (public.is_member(id));
create policy orgs_update on public.orgs
  for update using (public.is_admin(id)) with check (public.is_admin(id));
-- Creating an org is allowed to any signed-in user; the trigger below
-- immediately makes them its owner, so it cannot be created ownerless.
create policy orgs_insert on public.orgs
  for insert with check (auth.uid() is not null and created_by = auth.uid());

-- profiles: your own, plus anyone you share an org with
create policy profiles_read_self on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from public.memberships mine
      join public.memberships theirs on theirs.org_id = mine.org_id
      where mine.user_id = auth.uid() and theirs.user_id = public.profiles.id
    )
  );
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- memberships
create policy memberships_read on public.memberships
  for select using (public.is_member(org_id));
create policy memberships_write on public.memberships
  for all using (public.is_admin(org_id)) with check (public.is_admin(org_id));

-- invites
create policy invites_admin on public.invites
  for all using (public.is_admin(org_id)) with check (public.is_admin(org_id));

-- records: members read, staff and up write
create policy records_read on public.records
  for select using (public.is_member(org_id));
create policy records_insert on public.records
  for insert with check (public.can_write(org_id));
create policy records_update on public.records
  for update using (public.can_write(org_id)) with check (public.can_write(org_id));
-- No delete policy, on purpose. Rows are tombstoned by setting
-- deleted_at; a real DELETE would let an offline device resurrect the
-- row on its next push, because it would have nothing to sync against.

-- org_settings
create policy org_settings_read on public.org_settings
  for select using (public.is_member(org_id));
create policy org_settings_write on public.org_settings
  for all using (public.can_write(org_id)) with check (public.can_write(org_id));

-- ── Sign-up wiring ──────────────────────────────────────────

-- A new auth user gets a profile, and any invite waiting on their
-- email becomes a membership.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.memberships (org_id, user_id, role)
  select i.org_id, new.id, i.role
  from public.invites i
  where lower(i.email) = lower(new.email) and i.accepted_at is null
  on conflict (org_id, user_id) do nothing;

  update public.invites
  set accepted_at = now()
  where lower(email) = lower(new.email) and accepted_at is null;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The mirror image: someone invited who ALREADY has an account. The
-- signup trigger above fired long ago and will never fire again, so
-- without this an invite to an existing user silently does nothing.
create or replace function public.handle_new_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing uuid;
begin
  select id into existing
  from auth.users
  where lower(email) = lower(new.email)
  limit 1;

  if existing is not null then
    insert into public.memberships (org_id, user_id, role)
    values (new.org_id, existing, new.role)
    on conflict (org_id, user_id) do update set role = excluded.role;

    update public.invites set accepted_at = now() where id = new.id;
  end if;

  return new;
end;
$$;

create trigger on_invite_created
  after insert on public.invites
  for each row execute function public.handle_new_invite();

-- Whoever creates an org owns it.
create or replace function public.handle_new_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.memberships (org_id, user_id, role)
  values (new.id, coalesce(new.created_by, auth.uid()), 'owner')
  on conflict (org_id, user_id) do nothing;

  insert into public.org_settings (org_id, data)
  values (new.id, '{}'::jsonb)
  on conflict (org_id) do nothing;

  return new;
end;
$$;

create trigger on_org_created
  after insert on public.orgs
  for each row execute function public.handle_new_org();

-- ── Push ────────────────────────────────────────────────────
-- One round trip for a batch of local changes, with last-write-wins
-- applied per row in the database rather than in the client, so two
-- devices pushing at once cannot interleave into a lost update.
--
-- Returns the rows that were actually applied. Anything missing from
-- the result lost to a newer server copy, which is how the client
-- knows to take the server's version instead.
create or replace function public.push_records(changes jsonb)
returns table (kind public.record_kind, id text, updated_at timestamptz)
language plpgsql
security invoker           -- RLS still applies; this is convenience, not escalation
as $$
-- The RETURNS TABLE names (kind, id, updated_at) are also column names
-- on public.records. Without this, `on conflict (org_id, kind, id)`
-- reads as a reference to the output parameter and the function will
-- not even parse.
#variable_conflict use_column
begin
  if jsonb_typeof(changes) <> 'array' then
    raise exception 'changes must be a JSON array';
  end if;

  return query
  with incoming as (
    select
      (c ->> 'org_id')::uuid                as org_id,
      (c ->> 'kind')::public.record_kind    as kind,
       c ->> 'id'                           as id,
       c -> 'data'                          as data,
      to_timestamp((c ->> 'updated_at')::numeric / 1000.0) as updated_at,
      case when (c ->> 'deleted_at') is null then null
           else to_timestamp((c ->> 'deleted_at')::numeric / 1000.0) end as deleted_at
    from jsonb_array_elements(changes) as c
  ),
  -- Two edits to the same row inside one batch: keep only the newest,
  -- or the upsert would raise "cannot affect row a second time".
  deduped as (
    select distinct on (org_id, kind, id) *
    from incoming
    order by org_id, kind, id, updated_at desc
  ),
  applied as (
    insert into public.records as r
      (org_id, kind, id, data, updated_at, updated_by, deleted_at)
    select d.org_id, d.kind, d.id, d.data, d.updated_at, auth.uid(), d.deleted_at
    from deduped d
    on conflict (org_id, kind, id) do update
      set data       = excluded.data,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by,
          deleted_at = excluded.deleted_at
      where excluded.updated_at > r.updated_at
    returning r.kind, r.id, r.updated_at
  )
  select * from applied;
end;
$$;

grant execute on function public.push_records(jsonb) to authenticated;
