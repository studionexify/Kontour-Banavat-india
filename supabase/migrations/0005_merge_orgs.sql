-- ════════════════════════════════════════════════════════════
-- Kontour — two sets of books folded into one
--
-- Setting up twice left this project with two orgs. They are sealed
-- worlds: every policy asks which org a row belongs to, so a device
-- signed into one could not see a single row of the other, however
-- well sync worked. This merges them.
--
-- The older org is kept — it is the one the books were started in, and
-- keeping it means the devices already pointing at it need no change.
-- Everything belonging to the younger one is moved across and the
-- younger org is then removed.
--
-- Where the same record exists in both (the same kind and the same id,
-- which is what a device that logged the same work twice produces),
-- the newer copy wins, by the same updated_at comparison push_records
-- uses. Nothing is silently dropped in favour of an older version.
--
-- Written to be run once, and to refuse rather than guess: if there
-- are not exactly two orgs it raises and changes nothing. Re-running
-- it after a successful merge raises for the same reason, which is the
-- behaviour you want from a one-way change to live data.
--
-- TAKE A BACKUP FIRST. Supabase → Database → Backups.
-- ════════════════════════════════════════════════════════════

do $$
declare
  keeper      uuid;
  loser       uuid;
  keeper_name text;
  loser_name  text;
  org_count   int;
  moved       int;
  overwritten int;
  dropped     int;
begin
  select count(*) into org_count from public.orgs;
  if org_count <> 2 then
    raise exception
      'Expected exactly two sets of books, found %. Nothing has been changed — look at public.orgs and say which to keep.',
      org_count;
  end if;

  select id, name into keeper, keeper_name from public.orgs order by created_at asc  limit 1;
  select id, name into loser,  loser_name  from public.orgs order by created_at desc limit 1;

  raise notice 'Keeping % (%), merging in % (%)', keeper_name, keeper, loser_name, loser;

  -- ── Records ──────────────────────────────────────────────
  -- Where both sides hold the same record, the newer copy wins.
  update public.records k
     set data       = l.data,
         updated_at = l.updated_at,
         updated_by = l.updated_by,
         deleted_at = l.deleted_at
    from public.records l
   where k.org_id = keeper
     and l.org_id = loser
     and l.kind   = k.kind
     and l.id     = k.id
     and l.updated_at > k.updated_at;
  get diagnostics overwritten = row_count;

  -- The losing side of those pairs has now been folded in and can go.
  delete from public.records l
   where l.org_id = loser
     and exists (select 1 from public.records k
                  where k.org_id = keeper and k.kind = l.kind and k.id = l.id);
  get diagnostics dropped = row_count;

  -- Everything with no counterpart simply changes hands.
  update public.records set org_id = keeper where org_id = loser;
  get diagnostics moved = row_count;

  raise notice 'Records: % moved, % updated in place, % duplicates folded in', moved, overwritten, dropped;

  -- ── People ───────────────────────────────────────────────
  -- Somebody who is in both keeps the stronger of the two roles. The
  -- member_role enum is declared strongest first, so least() is it.
  insert into public.memberships (org_id, user_id, role, created_at)
  select keeper, m.user_id, m.role, m.created_at
    from public.memberships m
   where m.org_id = loser
  on conflict (org_id, user_id) do update
    set role = least(public.memberships.role, excluded.role);

  delete from public.memberships where org_id = loser;

  -- ── Invites ──────────────────────────────────────────────
  delete from public.invites l
   where l.org_id = loser
     and exists (select 1 from public.invites k
                  where k.org_id = keeper and lower(k.email) = lower(l.email));
  update public.invites set org_id = keeper where org_id = loser;

  -- ── History ──────────────────────────────────────────────
  -- Only present once 0003_quotations.sql has run. Absent on a project
  -- that has not, in which case there is no audit history to carry.
  if to_regclass('public.record_audit') is not null then
    update public.record_audit set org_id = keeper where org_id = loser;
  end if;

  -- ── Shared settings ──────────────────────────────────────
  -- The kept books' own settings stand. The younger row is only used
  -- if the older one never had any, which would mean the settings were
  -- only ever typed on the second device.
  insert into public.org_settings (org_id, data, updated_at, updated_by)
  select keeper, s.data, s.updated_at, s.updated_by
    from public.org_settings s
   where s.org_id = loser
  on conflict (org_id) do nothing;

  delete from public.org_settings where org_id = loser;

  -- ── The empty shell ──────────────────────────────────────
  delete from public.orgs where id = loser;

  raise notice 'Done. One set of books remains: % (%)', keeper_name, keeper;
end $$;
