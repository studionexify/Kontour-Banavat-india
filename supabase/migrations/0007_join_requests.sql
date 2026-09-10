-- ════════════════════════════════════════════════════════════
-- Kontour — one owner, one set of books, and a door in between
--
-- Signing up used to mean one of two things: land in an org you were
-- invited into, or — if you were not — get offered "Create books" and
-- walk straight in as the owner of a brand new, empty org. That second
-- path is what produced the two-orgs mess 0005 had to clean up by
-- hand. It is closed here, not patched around:
--
--   * orgs_insert now only allows the very first org ever created.
--     Once one exists — and one always will, from here on — nobody
--     can spin up a second one through the app. (A dashboard session
--     using the postgres role can still do it deliberately; that is
--     a decision for whoever holds that access, not something the
--     app's own client should ever offer by accident again.)
--
--   * Anyone who signs up without an invite waiting for their email
--     no longer has nowhere to go. They ask to join instead, and an
--     owner or admin approves or declines from Settings → People.
--     Nothing about their access exists until that decision is made.
--
-- Safe to run more than once, like 0001.
-- ════════════════════════════════════════════════════════════

-- ── Is there an org at all? ─────────────────────────────────
-- Needed because orgs_read only shows a person the orgs they already
-- belong to — a signed-in stranger asking "does any org exist?" would
-- get an empty answer from a plain query and the lockdown below would
-- never actually hold. security definer sidesteps that the same way
-- is_member() already does for membership checks.
create or replace function public.any_org_exists()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.orgs);
$$;

drop policy if exists orgs_insert on public.orgs;
create policy orgs_insert on public.orgs
  for insert with check (auth.uid() is not null and not public.any_org_exists());

-- ── The waiting room ────────────────────────────────────────

create table if not exists public.join_requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs on delete cascade,
  -- One row per account, ever. A declined request is not retried by
  -- signing up again — the same email already has an account — so an
  -- owner reconsidering is the only way back in, not a second ask.
  user_id      uuid not null references auth.users on delete cascade unique,
  email        text not null,
  full_name    text,
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  -- Who decided and when, stamped by the trigger below rather than
  -- trusted from the client — the same reasoning as stamp_org_creator.
  decided_at   timestamptz,
  decided_by   uuid references auth.users on delete set null
);

create index if not exists join_requests_pending_idx
  on public.join_requests (org_id) where status = 'pending';

alter table public.join_requests enable row level security;

-- Read your own request, or every request if you administer the org.
drop policy if exists join_requests_read on public.join_requests;
create policy join_requests_read on public.join_requests
  for select using (user_id = auth.uid() or public.is_admin(org_id));

-- Only an admin decides. No insert or delete policy at all: the row
-- is created solely through request_to_join() below, and a decision
-- is a status change, never a deletion — this is a small audit trail
-- of who asked and who answered, same spirit as record_audit.
drop policy if exists join_requests_decide on public.join_requests;
create policy join_requests_decide on public.join_requests
  for update using (public.is_admin(org_id)) with check (public.is_admin(org_id));

create or replace function public.stamp_join_decision()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status and new.status <> 'pending' then
    new.decided_at := now();
    new.decided_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_join_decision_trg on public.join_requests;
create trigger stamp_join_decision_trg
  before update on public.join_requests
  for each row execute function public.stamp_join_decision();

-- The one way in. Security definer because a stranger with no
-- membership cannot read public.orgs to find the org id themselves —
-- this looks it up on their behalf and nothing else. Idempotent: a
-- second call from a device that already asked just hands back the
-- existing row rather than raising, so a retry after a dropped
-- connection cannot fail confusingly.
create or replace function public.request_to_join(p_full_name text default null)
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  me         uuid := auth.uid();
  target_org uuid;
  my_email   text;
  req        public.join_requests;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  if exists (select 1 from public.memberships where user_id = me) then
    raise exception 'Already on a set of books';
  end if;

  select id into target_org from public.orgs order by created_at asc limit 1;
  if target_org is null then
    raise exception 'No books exist yet — the first sign-up creates them, this is not that';
  end if;

  select email into my_email from auth.users where id = me;

  insert into public.join_requests (org_id, user_id, email, full_name)
  values (target_org, me, my_email, nullif(trim(p_full_name), ''))
  on conflict (user_id) do nothing;

  select * into req from public.join_requests where user_id = me;
  return req;
end;
$$;

grant execute on function public.request_to_join(text) to authenticated;
