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
 * Partners and their entries ride the shared books the same way the
 * ledger and the quotations do — two record kinds on the same table,
 * last write wins per row. See js/shopsync.js for the pump.
 */

import { round2, todayISO } from './format.js';

const KEY = 'kontour.commissions.v1';

function uid(prefix = 'p') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function blank() {
  // `purged` is ids only, keyed "kind:id" and stamped — no amount, no
  // project, no partner. It is what tells the other devices that a
  // record is gone, and it is deliberately empty of anything that was
  // on the record itself.
  return { partners: [], entries: [], purged: {}, orgId: '' };
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
      purged: (s.purged && typeof s.purged === 'object') ? s.purged : {},
      orgId: typeof s.orgId === 'string' ? s.orgId : '',
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
    // As in orders.js: the seed passes its own id so the same partner
    // seeded on two devices is one row on the shared books.
    id: input.id || uid('cp'),
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
   the fact must not leave a stale total sitting next to it.

   The rate is a share *of* baseAmount, not a cut added on top of it:
   at 10% on a ₹1,18,000 order the commission is not simply 10% of
   that figure (₹11,800, which would make the two payouts — to the
   partner and out of the order — add up to more than the order was
   ever worth). It is the amount already sitting inside that ₹1,18,000
   which, once paid out, is 10% of the whole: commission = base × pct
   ÷ (100 + pct) ≈ ₹10,727, leaving ₹1,07,273 as the order's own net.
   See commissionOf(). */

export function newEntry(input = {}) {
  return {
    id: input.id || uid('ce'),
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
  const pct = Number(entry.pct) || 0;
  return round2((entry.baseAmount || 0) * pct / (100 + pct));
}

/** What the order is actually worth once the commission inside it is
    taken out — the figure Banavat India itself nets from it. */
export function netOf(entry) {
  return round2((entry.baseAmount || 0) - commissionOf(entry));
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

/* Banavat India's CA has asked for cash transactions to be kept out
   of the books entirely — on the explicit call that an entry
   recorded as paid in cash is removed outright rather than soft-
   deleted, so it does not linger in storage under a different
   commission's history. Runs once per load; harmless once there is
   nothing left tagged this way. */
export function purgeCashCommissions() {
  const before = state.entries.length;
  const isCash = (e) => String(e.mode || '').trim().toLowerCase() === 'cash';

  // Removed outright, and recorded as gone. The record itself is not
  // kept in any form — only its id, stamped, so the deletion reaches
  // the other devices instead of one of them pushing the entry
  // straight back onto the books at the next sync.
  for (const e of state.entries.filter(isCash)) {
    const k = `commission:${e.id}`;
    if (!state.purged[k]) state.purged[k] = Date.now();
  }
  state.entries = state.entries.filter((e) => !isCash(e));

  const removed = before - state.entries.length;
  if (removed) { write(); emit(); }
  return { removed };
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
/* Stable across devices, for the reason orders.js gives at seedId(). */
function slug(text) {
  return String(text || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

export function seedKnownPartners() {
  // Any partner at all, tombstones included — a device holding only
  // deletions must not seed them back onto the shared books.
  if (state.partners.length) return { added: 0 };
  const seed = [
    {
      name: 'Shreemay Associate',
      defaultPct: 10,
      // pct is 10 on every one of these per the sheet's own "Comm. (%)"
      // column, but the commission figure it actually lists does not
      // always come to exactly 10% of the amount next to it — so the
      // real figure is kept as commissionOverride rather than trusting
      // the formula to reproduce it. See newEntry()'s own note.
      // Four entries the sheet recorded as paid in cash (Cloud 9,
      // Samasta C202, Shamnu Flat, Mr. Niraj Chandrani) are left out
      // of this seed entirely, per the CA's call to keep cash out of
      // the books rather than carry them relabelled.
      entries: [
        { project: 'Bed and nightstand drawing', jobCode: '', baseAmount: 3300, pct: 10, commissionOverride: 300, date: '2026-06-27', mode: 'UPI', status: 'pending' },
        { project: 'Gulabchand Jewellers (Mandvi)', jobCode: 'C115', baseAmount: 83000, pct: 10, commissionOverride: 7545, date: '2026-08-18', mode: 'Bank', status: 'pending', notes: 'Engineer: Parimal' },
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
    const partner = addPartner({
      id: `cp_seed_${slug(p.name)}`,
      name: p.name, defaultPct: p.defaultPct, notes: p.notes || '',
    });
    for (const e of p.entries) {
      addEntry({ ...e, id: `ce_seed_${slug(p.name)}_${slug(e.project)}`, partnerId: partner.id });
      added += 1;
    }
  }
  return { added };
}

/* ── The shared books ──────────────────────────────────────────
   Two kinds, because a partner and one of their entries are edited
   independently and a whole-object push would let one device's stale
   partner list undo another's new entry. Every mutation above already
   stamps updatedAt and deletes softly, which is what a tombstone
   needs, so nothing here is tracked by hand. */

export const SYNC_KINDS = [
  { kind: 'partner', arr: 'partners', key: 'id' },
  { kind: 'commission', arr: 'entries', key: 'id' },
];

export function syncRecords() {
  const out = [];
  for (const { kind, arr } of SYNC_KINDS) {
    for (const rec of state[arr] || []) {
      if (!rec.id) continue;
      out.push({
        kind,
        id: String(rec.id),
        data: rec,
        updatedAt: rec.updatedAt || rec.createdAt || Date.now(),
        deletedAt: rec.deletedAt || null,
      });
    }
  }

  // A record removed outright rather than soft-deleted — a cash entry —
  // still has to be removed everywhere else. It rides as a tombstone
  // carrying its id and nothing else.
  for (const [k, at] of Object.entries(state.purged)) {
    const cut = k.indexOf(':');
    if (cut < 1) continue;
    const kind = k.slice(0, cut);
    const id = k.slice(cut + 1);
    if (!SYNC_KINDS.some((x) => x.kind === kind)) continue;
    out.push({ kind, id, data: { id }, updatedAt: at, deletedAt: at });
  }
  return out;
}

export function applyRemote(rows) {
  let changed = 0;

  for (const row of rows || []) {
    const spec = SYNC_KINDS.find((k) => k.kind === row.kind);
    if (!spec) continue;

    const list = state[spec.arr];
    const id = String(row.id);
    const at = Date.parse(row.updated_at) || 0;
    const i = list.findIndex((r) => String(r.id) === id);
    const mine = i >= 0 ? list[i] : null;
    const gone = `${row.kind}:${id}`;
    const mineAt = mine ? (mine.updatedAt || mine.createdAt || 0) : (state.purged[gone] || -1);

    if (mineAt >= at) continue;

    // A deletion is applied as a deletion: the row goes, and only its
    // id stays behind. Nothing of a removed record is written back into
    // storage, and a tombstone for something this device never had adds
    // nothing at all.
    if (row.deleted_at) {
      state.purged[gone] = Date.parse(row.deleted_at) || at;
      if (mine) { list.splice(i, 1); changed += 1; }
      continue;
    }

    const next = { ...(row.data || {}), id, updatedAt: at };
    delete next.deletedAt;
    delete state.purged[gone];

    if (mine) list[i] = next; else list.push(next);
    changed += 1;
  }

  if (changed) { write(); emit(); }
  return changed;
}

/* See orders.js — same bargain, same reason. */
export function claimFor(orgId) {
  const want = String(orgId || '');
  if (!want) return false;
  if (!state.orgId) { state.orgId = want; write(); return false; }
  if (state.orgId === want) return false;

  state.partners = [];
  state.entries = [];
  state.purged = {};
  state.orgId = want;
  write(); emit();
  return true;
}

export function ownerOrg() { return state.orgId; }

export function wipe() {
  state = blank();
  write(); emit();
}
