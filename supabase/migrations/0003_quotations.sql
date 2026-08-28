-- ════════════════════════════════════════════════════════════
-- Kontour — quotations on the shared books
--
-- Quotations carry the most sensitive data in the app: client names,
-- phone numbers, and every price the business has ever quoted. They
-- go in the same table as the ledger on purpose. `records` already
-- answers the only question that matters — are you a member of this
-- org — and a second table would mean a second set of policies, and
-- a second chance to get that answer wrong.
--
-- So this adds two kinds, not two tables (the kinds themselves are in
-- 0002; see the note there about enum values and transactions).
-- Everything the ledger has, quotations inherit: org-scoped RLS,
-- role-gated writes, tombstones instead of deletes, last-write-wins
-- settled in the database.
--
-- What it adds on top:
--
--   * anon is stripped of every privilege on every table. RLS already
--     stops it, but the app's anon key is published in the client for
--     anyone to read, and a revoke is not a rule that has to be
--     evaluated correctly — it is an absence of permission.
--   * `records` is FORCEd, so the policies bind the table's owner too.
--   * Every write is recorded in an append-only audit log that not
--     even an owner can edit or erase.
--
-- Safe to run more than once, like 0001.
-- ════════════════════════════════════════════════════════════

-- ── Promoted columns ────────────────────────────────────────
-- Same bargain as the ledger's: the record keeps its app-shaped
-- payload, and only what the server needs to index is lifted out and
-- kept in step by a trigger — so the client never sends these and can
-- never disagree with them.

alter table public.records add column if not exists mr_no        text;
alter table public.records add column if not exists quote_status text;
alter table public.records add column if not exists client_name  text;

create index if not exists records_mr_idx on public.records (org_id, mr_no)
  where kind = 'quote' and deleted_at is null;
create index if not exists records_quote_client_idx on public.records (org_id, lower(client_name))
  where kind = 'quote' and deleted_at is null;
create index if not exists records_quote_status_idx on public.records (org_id, quote_status)
  where kind = 'quote' and deleted_at is null;

-- Replaces the 0001 version: entries behave exactly as before, and
-- quotations now promote alongside them. Both branches clear the whole
-- set first, so a row that changes kind cannot keep a stale promotion
-- from its old life.
create or replace function public.records_promote()
returns trigger
language plpgsql
as $$
begin
  new.entry_date   := null;
  new.entry_type   := null;
  new.total        := null;
  new.job_code     := null;
  new.mr_no        := null;
  new.quote_status := null;
  new.client_name  := null;

  if new.kind = 'entry' then
    new.entry_date := nullif(new.data ->> 'date', '')::date;
    new.entry_type := new.data ->> 'type';
    new.total      := coalesce((new.data ->> 'total')::numeric, 0);
    new.job_code   := nullif(new.data ->> 'jobCode', '');

  elsif new.kind = 'quote' then
    new.entry_date   := nullif(new.data ->> 'date', '')::date;
    new.mr_no        := nullif(new.data ->> 'mrNo', '');
    new.quote_status := nullif(new.data ->> 'status', '');
    new.client_name  := nullif(new.data -> 'client' ->> 'name', '');
    new.job_code     := nullif(new.data ->> 'jobCode', '');
    -- Derived here rather than trusted from the client, so no report
    -- can be moved by a device that sends a figure its own line items
    -- do not add up to.
    new.total := coalesce((
      select sum(
        case when (l ->> 'kind') = 'lump' then 1
             else coalesce((l ->> 'qty')::numeric, 0) end
        * coalesce((l ->> 'unitPrice')::numeric, 0)
      )
      from jsonb_array_elements(
        case when jsonb_typeof(new.data -> 'lines') = 'array'
             then new.data -> 'lines' else '[]'::jsonb end
      ) as l
    ), 0);
  end if;

  return new;
end;
$$;

drop trigger if exists records_promote_trg on public.records;
create trigger records_promote_trg
  before insert or update on public.records
  for each row execute function public.records_promote();

-- ── The audit log ───────────────────────────────────────────
-- Who changed which record, when, and what it held before. Append-only
-- by construction: there is no UPDATE and no DELETE policy on this
-- table and none is coming, so an owner can read the history of their
-- own org and can do nothing else to it.

create table if not exists public.record_audit (
  id          bigserial primary key,
  org_id      uuid not null references public.orgs on delete cascade,
  kind        public.record_kind not null,
  record_id   text not null,
  action      text not null check (action in ('insert', 'update', 'delete', 'restore')),
  actor       uuid references auth.users on delete set null,
  at          timestamptz not null default now(),
  -- The payload as it stood before the change: enough to see what a
  -- price was before someone moved it, without keeping a second full
  -- copy of every record forever.
  was         jsonb
);

create index if not exists record_audit_org_idx on public.record_audit (org_id, at desc);
create index if not exists record_audit_record_idx
  on public.record_audit (org_id, kind, record_id, at desc);

create or replace function public.records_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  act text;
begin
  if tg_op = 'INSERT' then
    act := 'insert';
  elsif new.deleted_at is not null and old.deleted_at is null then
    act := 'delete';
  elsif new.deleted_at is null and old.deleted_at is not null then
    act := 'restore';
  else
    act := 'update';
  end if;

  insert into public.record_audit (org_id, kind, record_id, action, actor, was)
  values (
    new.org_id, new.kind, new.id, act, auth.uid(),
    case when tg_op = 'UPDATE' then old.data else null end
  );

  return null;
end;
$$;

drop trigger if exists records_audit_trg on public.records;
create trigger records_audit_trg
  after insert or update on public.records
  for each row execute function public.records_audit();

alter table public.record_audit enable row level security;

-- Readable by the people who run the org, and by nobody else.
--
-- There is deliberately no INSERT policy. The only thing that writes
-- here is the security-definer trigger above, which runs as the
-- table's owner — and the owner is exempt from RLS precisely because
-- this table is NOT forced (see the hardening note below). So a client
-- can neither forge history nor suppress it, while the trigger can
-- still record it.
drop policy if exists record_audit_read on public.record_audit;
create policy record_audit_read on public.record_audit
  for select using (public.is_admin(org_id));

-- ── Hardening ───────────────────────────────────────────────

-- The anon key ships inside the app, so anyone who opens the site has
-- it. RLS already means it can see nothing; this means it cannot even
-- ask. Belt and braces.
revoke all on public.records       from anon;
revoke all on public.record_audit  from anon;
revoke all on public.org_settings  from anon;
revoke all on public.orgs          from anon;
revoke all on public.memberships   from anon;
revoke all on public.profiles      from anon;
revoke all on public.invites       from anon;
revoke execute on function public.push_records(jsonb) from anon;

-- Signed-in users reach these only through their policies.
grant select, insert, update on public.records      to authenticated;
grant select                 on public.record_audit to authenticated;

-- FORCE makes the policies bind the table's owner as well, not only
-- other roles. It is applied to `records` alone, and that restraint is
-- deliberate: `memberships`, `invites` and `org_settings` are written
-- by the SECURITY DEFINER triggers in 0001 — handle_new_user and
-- handle_new_org — which run as the owner and depend on the owner's
-- RLS exemption. Forcing those tables would make a new sign-up fail at
-- the moment it tries to make its creator a member, because at that
-- instant they are not one yet. `records` has no such definer writer:
-- push_records is SECURITY INVOKER on purpose, so forcing it costs
-- nothing and closes the case of a connection that happens to be the
-- owner. service_role holds BYPASSRLS and is unaffected either way.
alter table public.records force row level security;

-- ── Reading quotations ──────────────────────────────────────
-- A list of quotations without dragging every payload across the wire.
-- security_invoker means the caller's rights decide rather than the
-- view owner's, which is what makes a view safe to expose at all.

create or replace view public.quote_index
with (security_invoker = true)
as
  select
    r.org_id,
    r.id,
    r.mr_no,
    r.quote_status as status,
    r.client_name,
    r.entry_date   as quoted_on,
    r.total,
    r.job_code,
    r.updated_at,
    r.updated_by
  from public.records r
  where r.kind = 'quote' and r.deleted_at is null;

revoke all on public.quote_index from anon;
grant select on public.quote_index to authenticated;
