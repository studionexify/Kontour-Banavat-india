-- ════════════════════════════════════════════════════════════
-- Kontour — the production line and the commission book, shared
--
-- Until this ran, three stores were device-local: the shop floor's
-- own record (orders.js), the commission partners and their entries
-- (commissions.js). A piece moved to Assembly on the workshop phone
-- was invisible on the office laptop, and signing in on a new device
-- showed an empty production line however much work was on file.
--
-- They need no tables of their own — public.records already carries
-- org_id, the row level security that guards the ledger, and the
-- last-write-wins push_records function. They need only names.
--
-- Postgres will not let a newly added enum value be *used* in the
-- same transaction that added it, and Supabase runs each migration
-- file in a transaction — so, exactly as 0002 did for the quotation
-- kinds, this file adds the labels and nothing else. Nothing later
-- refers to them: the app is what uses them, and by then the
-- transaction is long committed.
--
-- 'order'      — one physical piece being made, keyed by its own id
--                and grouped by the MR number inside data.
-- 'partner'    — someone paid a cut rather than a wage.
-- 'commission' — one project's cut, against one partner.
-- ════════════════════════════════════════════════════════════

alter type public.record_kind add value if not exists 'order';
alter type public.record_kind add value if not exists 'partner';
alter type public.record_kind add value if not exists 'commission';
