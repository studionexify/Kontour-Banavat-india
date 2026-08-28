-- ════════════════════════════════════════════════════════════
-- Kontour — two more record kinds
--
-- This file does one thing and nothing else, and that is the point.
-- Postgres will not let a newly added enum value be *used* in the
-- same transaction that added it, and Supabase runs each migration
-- file in a transaction. So the values are added here, alone, and
-- everything that refers to them lives in 0003.
--
-- Splitting it also means the failure mode is legible: if this file
-- runs and the next does not, the enum has two unused labels, which
-- is harmless and re-runnable.
--
-- 'quote'  — one quotation, revisions included; the MR number is its
--            name and lives inside data.
-- 'design' — the library a quotation is built from.
-- ════════════════════════════════════════════════════════════

alter type public.record_kind add value if not exists 'quote';
alter type public.record_kind add value if not exists 'design';
