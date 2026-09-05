/* commissions.js — the people paid a cut, not a wage.
 *
 * Some work comes in through someone who is neither staff nor a
 * one-off subcontractor: an associate who refers a client and is
 * owed a percentage of what that job billed, or a maker like
 * Shapemaker who is both a client of some jobs and a commission
 * partner on others. Neither fits the Jobs screen — a job there is
 * money owed *to* Banavat India for work done, and this is money
 * owed *by* it, calculated off someone else's figure.
 *
 * A partner's own running total is never typed in — it is the sum
 * of their entries, the same way a job's outstanding figure is the
 * sum of its ledger entries, so the two can never drift apart.
 *
 * This module is local to the device for now, the way the whole app
 * was before Phynance and Quotation grew their own sync — see
 * quotesync.js if this needs to follow the same path later.
 */

import { round2, todayISO } from './format.js';

const KEY = 'kontour.commissions.v1';

function uid(prefix = 'p') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function blank() {
  return { partners: [], entries: [] };
}

let state = blank();
const listeners = new Set();
function emit() { listeners.forEach((fn) => fn()); }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const s = JSON.parse(raw);
    return {
      partners: Array.isArray(s.partners) ? s.partners : [],
      entries: Array.isArray(s.entries) ? s.entries : [],
    };
  } catch (e) {
    console.error('[kontour] could not read commissions', e);
    return blank();
  }
}

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.error('[kontour] could not save commissions', e); }
}

export function load() { state = read(); return state; }

/* ── Partners ──────────────────────────────────────────────────
   A partner is just a name and a default rate — the rate on any one
   entry can still differ, the way a referral might be quoted at 10%
   generally but agreed at a different cut for one particular job. */

export function partners() {
  return state.partners.filter((p) => !p.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getPartner(id) {
  return state.partners.find((p) => p.id === id && !p.deletedAt) || null;
}

export function addPartner(input = {}) {
  const p = {
    id: uid('cp'),
    name: String(input.name || '').trim(),
    phone: input.phone || '',
    // undefined (not passed at all) means "no opinion yet, use 10";
    // an explicit null means "genuinely varies, don't suggest one" —
    // distinct enough that seeding Shapemaker with no single rate on
    // file does not quietly turn into a 10% default nobody chose.
    defaultPct: input.defaultPct === undefined ? 10 : (input.defaultPct === null ? null : Number(input.defaultPct)),
    // A partner who is also a client (Shapemaker orders furniture and
    // also earns commission referring it) gets no special handling
    // here — the two relationships are tracked separately, on
    // purpose, since one is money in and the other money out.
    notes: input.notes || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.partners.push(p);
  write(); emit();
  return p;
}

export function updatePartner(id, changes) {
  const p = getPartner(id);
  if (!p) return null;
  Object.assign(p, changes, { updatedAt: Date.now() });
  write(); emit();
  return p;
}

/** Soft-deleted, the way a quotation is — a partner with entries
    against them should not vanish out from under their own history. */
export function deletePartner(id) {
  const p = getPartner(id);
  if (!p) return;
  p.deletedAt = Date.now();
  write(); emit();
}

/* ── Entries ───────────────────────────────────────────────────
   One project, one figure it was calculated off, one rate, and what
   of the resulting commission has actually been paid. Commission is
   computed rather than typed, the same reason a line item's amount
   is qty × rate rather than its own field — a rate corrected after
   the fact must not leave a stale total sitting next to it. */

export function newEntry(input = {}) {
  return {
    id: uid('ce'),
    partnerId: input.partnerId || '',
    project: input.project || '',
    jobCode: (input.jobCode || '').trim().toUpperCase(),
    baseAmount: Number(input.baseAmount) || 0,
    pct: input.pct == null ? 10 : Number(input.pct),
    // Almost always left null, so the commission is base × pct and
    // the two can never drift apart — see commissionOf(). Set only
    // when a real figure is on record that the clean formula does
    // not reproduce (a rate applied to a pre-tax amount rather than
    // the billed one, a rounding the office made by hand, a rate
    // renegotiated after the fact): the actual figure is kept as the
    // fact, rather than silently overwritten by a recomputed one
    // that would misstate what was actually agreed or paid.
    commissionOverride: input.commissionOverride == null ? null : Number(input.commissionOverride),
    paid: Number(input.paid) || 0,
    date: input.date || todayISO(),
    mode: input.mode || '',
    status: input.status || 'pending',   // pending | paid
    notes: input.notes || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function commissionOf(entry) {
  if (entry.commissionOverride != null) return round2(entry.commissionOverride);
  return round2((entry.baseAmount || 0) * (Number(entry.pct) || 0) / 100);
}

export function entriesFor(partnerId) {
  return state.entries
    .filter((e) => e.partnerId === partnerId && !e.deletedAt)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
}

export function getEntry(id) {
  return state.entries.find((e) => e.id === id && !e.deletedAt) || null;
}

export function addEntry(input = {}) {
  const e = newEntry(input);
  state.entries.push(e);
  write(); emit();
  return e;
}

export function updateEntry(id, changes) {
  const e = getEntry(id);
  if (!e) return null;
  Object.assign(e, changes, { updatedAt: Date.now() });
  write(); emit();
  return e;
}

export function deleteEntry(id) {
  const e = getEntry(id);
  if (!e) return;
  e.deletedAt = Date.now();
  write(); emit();
}

/** What one partner is owed, in total and outstanding. */
export function partnerSummary(partnerId) {
  const list = entriesFor(partnerId);
  let commission = 0, paid = 0;
  for (const e of list) {
    commission += commissionOf(e);
    paid += Number(e.paid) || 0;
  }
  commission = round2(commission);
  paid = round2(Math.min(paid, commission) || paid);
  return {
    count: list.length,
    commission,
    paid: round2(paid),
    remaining: round2(commission - paid),
  };
}

/** Across every partner — the figure the Commission tab opens with. */
export function totalSummary() {
  let commission = 0, paid = 0, remaining = 0;
  for (const p of partners()) {
    const s = partnerSummary(p.id);
    commission += s.commission; paid += s.paid; remaining += s.remaining;
  }
  return { commission: round2(commission), paid: round2(paid), remaining: round2(remaining) };
}

/* ── Seeding ───────────────────────────────────────────────────
   The two commission partners Banavat India already works with,
   brought in once from the Phynance sheet rather than left for
   someone to retype. Runs once — a partner already on file (matched
   by name) is left alone, so this never overwrites an edit made
   since. */
export function seedKnownPartners() {
  if (state.partners.some((p) => !p.deletedAt)) return { added: 0 };
  const seed = [
    {
      name: 'Shreemay Associate',
      defaultPct: 10,
      // pct is 10 on every one of these per the sheet's own "Comm. (%)"
      // column, but the commission figure it actually lists does not
      // always come to exactly 10% of the amount next to it — so the
      // real figure is kept as commissionOverride rather than trusting
      // the formula to reproduce it. See newEntry()'s own note.
      entries: [
        { project: 'Cloud 9 basin leg and structure', jobCode: 'C108', baseAmount: 7500, pct: 10, commissionOverride: 750, date: '2026-07-15', mode: 'Cash', status: 'pending', notes: 'Engineer: Abbas' },
        { project: 'Samasta C202', jobCode: 'C114', baseAmount: 16000, pct: 10, commissionOverride: 1455, date: '2026-07-16', mode: 'Cash', status: 'pending', notes: 'Engineer: Natwar Bhai' },
        { project: 'Bed and nightstand drawing', jobCode: '', baseAmount: 3300, pct: 10, commissionOverride: 300, date: '2026-06-27', mode: 'UPI', status: 'pending' },
        { project: 'Gulabchand Jewellers (Mandvi)', jobCode: 'C115', baseAmount: 83000, pct: 10, commissionOverride: 7545, date: '2026-08-18', mode: 'Bank', status: 'pending', notes: 'Engineer: Parimal' },
        { project: 'Shamnu Flat', jobCode: 'C113', baseAmount: 11000, pct: 10, commissionOverride: 1000, date: '2026-07-16', mode: 'Cash', status: 'pending', notes: 'Engineer: Chaitanya bhai' },
        { project: 'Mr. Niraj Chandrani', jobCode: 'C129-1', baseAmount: 110000, pct: 10, commissionOverride: 10000, date: '', mode: 'Cash', status: 'pending' },
      ],
    },
    {
      name: 'Shapemaker',
      defaultPct: null,        // no single rate on file — see the note below
      notes: 'Also a client — see Jobs for what Shapemaker owes Banavat India separately from what it is owed here.',
      entries: [
        // Only the aggregate is on the sheet, not itemised by project —
        // entered as one running line rather than guessed apart.
        // commissionOverride carries the figure directly since there
        // is no per-project base amount or rate to compute it from.
        { project: 'Running total, per the Phynance sheet', jobCode: '', baseAmount: 0, pct: 0, commissionOverride: 26000, paid: 26000, date: '', status: 'paid', notes: 'Aggregate only — the source sheet does not itemise this by project.' },
      ],
    },
  ];

  let added = 0;
  for (const p of seed) {
    const partner = addPartner({ name: p.name, defaultPct: p.defaultPct, notes: p.notes || '' });
    for (const e of p.entries) { addEntry({ ...e, partnerId: partner.id }); added += 1; }
  }
  return { added };
}
