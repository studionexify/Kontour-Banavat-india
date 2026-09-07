-- ════════════════════════════════════════════════════════════
-- Kontour — the sub-contractor station, shared
--
-- The Sub-Contractor screen keeps four record kinds: the people
-- themselves, the work orders issued to them, the pieces on each
-- work order, and the payments made against a person. Until this
-- ran they were device-local: work commissioned on the office
-- laptop was invisible on the workshop phone, and a phone opening
-- the screen for the first time saw nothing at all.
--
-- They need no tables of their own — public.records already carries
-- org_id, the row level security that guards the ledger, and the
-- last-write-wins push_records function. They need only names.
--
-- Postgres will not let a newly added enum value be *used* in the
-- same transaction that added it, and Supabase runs each migration
-- file in a transaction — so, exactly as 0002 and 0004 did, this
-- file adds the labels and nothing else. Nothing later refers to
-- them: the app is what uses them, and by then the transaction is
-- long committed.
--
-- 'sub'     — one sub-contractor: name, trades, contact, and whether
--             they are active, blacklisted or archived.
-- 'subwo'   — one work order issued to them, numbered WO-XX-NNN.
-- 'subitem' — one piece on a work order, at the rate they quoted.
--             This is what the balance is summed from.
-- 'subpay'  — one payment made to them. The balance is the person's,
--             so a payment may name a work order without belonging
--             to one.
--
-- Until this migration is applied the app degrades rather than
-- breaks: js/shopsync.js marks these four kinds optional, drops them
-- from the push and the pull when the database rejects the labels,
-- and keeps the ledger, the orders and the quotations syncing as
-- normal. The sub-contractor book simply stays device-local, seeded
-- on each device from data/subcontractors.json, until this runs.
-- ════════════════════════════════════════════════════════════

alter type public.record_kind add value if not exists 'sub';
alter type public.record_kind add value if not exists 'subwo';
alter type public.record_kind add value if not exists 'subitem';
alter type public.record_kind add value if not exists 'subpay';
