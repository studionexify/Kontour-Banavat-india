/* subs.js — the people who actually make it, and what they are owed.
 *
 * Banavat India does not make everything in one shed. Metal goes to
 * Dinesh, wood to Vikas or Parth, upholstery to Arif or Hari Ram,
 * drawings to Bansari, laser cutting to Unique. Until now that was
 * eleven Google Sheets in a Drive folder, one per person, each with
 * the same two-part shape:
 *
 *   Sheet 1 — Payment Status: Total / Paid / Remaining, then one row
 *             per payment (date, remarks, amount, mode, note).
 *   Sheet 2+ — one per work order: a header block (name, contact,
 *             address, WO number, issue date) and the line items
 *             commissioned on it, each with its MR No, dimensions,
 *             quantity, delivery date and the rate that person quoted.
 *
 * That shape is kept exactly, because it is the shape the business
 * already thinks in:
 *
 *   subcontractor → work orders → items,  payments at the person.
 *
 * Payments sit on the person rather than on a work order because that
 * is how they were actually made: "₹20,000 advance, ₹20,500 remaining,
 * to Firozbhai" against no particular sheet. So a person carries one
 * running balance — everything ordered from them, less everything paid
 * to them — and a payment may *name* a work order without being
 * confined to one. See balanceOf().
 *
 * What is owed is never typed in. It is the sum of the item rates, the
 * same way a job's outstanding figure is the sum of its ledger entries,
 * so the two can never drift apart. Every one of the eleven imported
 * histories reconciles to the Total/Paid/Remaining its own sheet
 * carried, which is the check that the reading was right.
 *
 * Money moves in one direction only. Assigning an item and agreeing a
 * rate is a *commitment* — it lives here and nowhere else. It becomes
 * a ledger entry when it is actually paid, and only then. See
 * addPayment(), which is the single place the two meet.
 *
 * Subcontractors, work orders, items and payments ride the shared
 * books the same way the ledger, the orders and the quotations do —
 * four record kinds on one table, last write wins per row. See
 * js/shopsync.js for the pump.
 */

import { round2, todayISO } from './format.js';

const KEY = 'kontour.subs.v1';

/* The trades a piece can be sent out for. Same list as orders.js uses
   on a line's `vendors` map, so a name on an order line and a name
   here mean the same thing. */
export const TRADES = ['drawings', 'metal', 'wood', 'upholstery', 'marble', 'hardware', 'package'];

export const TRADE_LABELS = {
  drawings: 'Drawings',
  metal: 'Metal',
  wood: 'Wood',
  upholstery: 'Upholstery',
  marble: 'Marble',
  hardware: 'Hardware',
  package: 'Packaging',
};

/* Active is the only state that can be given new work. Blacklisted is
   a decision about the person — they stay fully visible, their history
   and their balance intact, because a blacklisted subcontractor may
   still be owed money and that debt does not disappear with the
   grudge. Archived is about the record, not the person: someone no
   longer worked with, kept out of the way but never destroyed. */
export const STATUS = {
  active: { label: 'Active', tone: 'ok' },
  blacklisted: { label: 'Blacklisted', tone: 'bad' },
  archived: { label: 'Archived', tone: 'mut' },
};

export const PAY_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque'];

function uid(prefix = 's') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function blank() {
  // `purged` is ids only, keyed "kind:id" and stamped — no name, no
  // amount. It is what tells the other devices a record is gone, and
  // it deliberately holds nothing that was on the record itself.
  return { subs: [], workOrders: [], items: [], payments: [], purged: {}, orgId: '' };
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
    const arr = (v) => (Array.isArray(v) ? v : []);
    return {
      subs: arr(s.subs),
      workOrders: arr(s.workOrders),
      items: arr(s.items),
      payments: arr(s.payments),
      purged: (s.purged && typeof s.purged === 'object') ? s.purged : {},
      orgId: typeof s.orgId === 'string' ? s.orgId : '',
    };
  } catch (e) {
    console.error('[kontour] could not read sub-contractors', e);
    return blank();
  }
}

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.error('[kontour] could not save sub-contractors', e); }
}

export function load() { state = read(); return state; }
export function raw() { return state; }

/* ── Sub-contractors ───────────────────────────────────────────
   One record per person. `aliases` is what makes the merge work: the
   order sheet has been calling Vikas Jangid "Vikas Bhai" and Arif
   Malek "Arif bhai" since long before this screen existed, and those
   spellings are still sitting on live order lines. Rather than rewrite
   that history, the short name is carried on the person it belongs to,
   so a line saying "Vikas Bhai" and a work order saying "Vikas Jangid"
   resolve to one subcontractor with one balance. */

export function subs({ status = null, q = '', includeArchived = false } = {}) {
  const needle = q.trim().toLowerCase();
  return state.subs
    .filter((s) => !s.deletedAt)
    .filter((s) => (status ? s.status === status : (includeArchived || s.status !== 'archived')))
    .filter((s) => !needle
      || s.name.toLowerCase().includes(needle)
      || (s.firm || '').toLowerCase().includes(needle)
      || (s.phone || '').includes(needle)
      || (s.aliases || []).some((a) => a.toLowerCase().includes(needle))
      || (s.trades || []).some((t) => t.includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getSub(id) {
  return state.subs.find((s) => s.id === id && !s.deletedAt) || null;
}

/** Resolves a name written anywhere — an order line's `vendors` map, a
    work order header — to the one subcontractor it means, matching the
    full name first and then any alias. Case and spacing are ignored
    because "Arif bhai", "Arifbhai" and "Arif Bhai" are one person. */
export function findByName(name) {
  const want = norm(name);
  if (!want) return null;
  return state.subs.find((s) => !s.deletedAt && norm(s.name) === want)
    || state.subs.find((s) => !s.deletedAt && (s.aliases || []).some((a) => norm(a) === want))
    || null;
}

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function addSub(input = {}) {
  const s = {
    // As in orders.js: the seed passes its own id, derived from the
    // person, so the same subcontractor seeded on two devices is one
    // row on the shared books rather than two copies of it.
    id: input.id || uid('sc'),
    name: String(input.name || '').trim(),
    firm: String(input.firm || '').trim(),
    aliases: (input.aliases || []).map((a) => String(a).trim()).filter(Boolean),
    trades: (input.trades || []).filter((t) => TRADES.includes(t)),
    phone: String(input.phone || '').trim(),
    email: String(input.email || '').trim(),
    address: String(input.address || '').trim(),
    status: STATUS[input.status] ? input.status : 'active',
    blacklistReason: input.blacklistReason || '',
    blacklistDate: input.blacklistDate || '',
    notes: input.notes || '',
    // Anything the import could not state cleanly — a header carrying
    // the wrong person's contact details, a rate cell that disagrees
    // with its own line total. Kept on the record and shown on the
    // person's screen, because a silent guess is worse than a note.
    dataNote: input.dataNote || '',
    createdAt: input.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  state.subs.push(s);
  write(); emit();
  return s;
}

export function updateSub(id, changes) {
  const s = getSub(id);
  if (!s) return null;
  Object.assign(s, changes, { updatedAt: Date.now() });
  write(); emit();
  return s;
}

/** Flags someone as not to be given new work. The reason and the date
    are required by the caller, not by this function, because a
    blacklisting nobody wrote a reason for is one nobody can argue
    with later. Their history and balance are untouched. */
export function blacklist(id, reason, date = todayISO()) {
  return updateSub(id, { status: 'blacklisted', blacklistReason: String(reason || '').trim(), blacklistDate: date });
}

export function unBlacklist(id) {
  return updateSub(id, { status: 'active', blacklistReason: '', blacklistDate: '' });
}

export function archive(id) { return updateSub(id, { status: 'archived' }); }
export function unarchive(id) { return updateSub(id, { status: 'active' }); }

/** What a delete would destroy. The screen asks this before offering
    one, so nobody is shown a Delete button that would quietly take
    three work orders and ₹3 lakh of payment history with it. */
export function historyOf(id) {
  const wos = workOrdersOf(id);
  const its = itemsOf(id);
  const pays = paymentsOf(id);
  return {
    workOrders: wos.length,
    items: its.length,
    payments: pays.length,
    paid: pays.reduce((n, p) => n + p.amount, 0),
    empty: !wos.length && !its.length && !pays.length,
  };
}

/**
 * Deletes a subcontractor outright — permitted only when they have no
 * work orders, no items and no payments on file. Anyone with history
 * gets archived instead: their balance is a real number somebody may
 * have to settle, and a tidy list is not worth losing it. Returns
 * false when it refused, so the caller can offer Archive.
 */
export function deleteSub(id) {
  const s = getSub(id);
  if (!s) return false;
  if (!historyOf(id).empty) return false;
  s.deletedAt = Date.now();
  s.updatedAt = Date.now();
  write(); emit();
  return true;
}

/* ── Work orders ───────────────────────────────────────────────
   A work order is one commissioning event: these pieces, to this
   person, on this date, at these rates. It is what gets printed and
   handed over, and it is numbered the way the Drive folder numbers
   them — WO- plus the person's initials plus a running count. */

/** "Dinesh Chaudhary" → "DC"; "Unique Laser Cutting" → "UL". */
export function initialsOf(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'XX';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** The next number for this person: WO-DC-001, then -002, and so on.
    Counts from the highest number already on file rather than from how
    many there are, so deleting a work order never re-issues a number
    that has been printed and handed to somebody. */
export function nextWoNo(subId) {
  const s = getSub(subId);
  if (!s) return '';
  const ini = initialsOf(s.name);
  const used = workOrdersOf(subId)
    .map((w) => {
      const m = /-(\d+)$/.exec(w.no || '');
      return m ? Number(m[1]) : 0;
    });
  const next = Math.max(0, ...used) + 1;
  return `WO-${ini}-${String(next).padStart(3, '0')}`;
}

export function workOrdersOf(subId) {
  return state.workOrders
    .filter((w) => w.subId === subId && !w.deletedAt)
    .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || (b.createdAt - a.createdAt));
}

export function getWorkOrder(id) {
  return state.workOrders.find((w) => w.id === id && !w.deletedAt) || null;
}

export function addWorkOrder(input = {}) {
  const w = {
    id: input.id || uid('wo'),
    subId: input.subId || '',
    no: String(input.no || '').trim() || nextWoNo(input.subId),
    issueDate: input.issueDate || todayISO(),
    note: input.note || '',
    createdAt: input.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  state.workOrders.push(w);
  write(); emit();
  return w;
}

export function updateWorkOrder(id, changes) {
  const w = getWorkOrder(id);
  if (!w) return null;
  Object.assign(w, changes, { updatedAt: Date.now() });
  write(); emit();
  return w;
}

/** Removes a work order and everything commissioned on it — the items
    are the work order, so leaving them behind would leave a balance
    with nothing to explain it. Payments are never touched: money that
    moved, moved. */
export function deleteWorkOrder(id) {
  const w = getWorkOrder(id);
  if (!w) return;
  const now = Date.now();
  for (const it of state.items) {
    if (it.woId === id && !it.deletedAt) { it.deletedAt = now; it.updatedAt = now; }
  }
  w.deletedAt = now;
  w.updatedAt = now;
  write(); emit();
}

/* ── Items ─────────────────────────────────────────────────────
   One line of a work order: a piece, and what this person quoted for
   their part in making it.

   `orderLineId` and `mrNo` are the thread back to the order it came
   from. When work is commissioned out of a live order the line's own
   id is carried, which is what lets the piece show the same photo the
   order line shows rather than a second copy of it. The imported
   history has no such id — those sheets predate the order screen — so
   it carries the MR No alone and is matched by that. */

export function itemsOf(subId) {
  const woIds = new Set(workOrdersOf(subId).map((w) => w.id));
  return state.items
    .filter((it) => !it.deletedAt && woIds.has(it.woId))
    .sort((a, b) => (a.sr || 0) - (b.sr || 0));
}

export function itemsIn(woId) {
  return state.items
    .filter((it) => it.woId === woId && !it.deletedAt)
    .sort((a, b) => (a.sr || 0) - (b.sr || 0));
}

export function getItem(id) {
  return state.items.find((it) => it.id === id && !it.deletedAt) || null;
}

/** Every subcontractor an order line has been given to, so the order
    screen can say who holds a piece and for how much. */
export function itemsForOrderLine(orderLineId) {
  return state.items.filter((it) => !it.deletedAt && it.orderLineId === orderLineId);
}

/** Everything commissioned against one MR number, across all
    subcontractors — what the whole of a job has cost to have made. */
export function itemsForMrNo(mrNo) {
  const want = String(mrNo || '').trim().toUpperCase();
  if (!want) return [];
  return state.items.filter((it) => !it.deletedAt && String(it.mrNo || '').toUpperCase() === want);
}

export function addItem(input = {}) {
  const it = {
    id: input.id || uid('si'),
    woId: input.woId || '',
    sr: Number(input.sr) || (itemsIn(input.woId).length + 1),
    orderLineId: input.orderLineId || '',
    mrNo: String(input.mrNo || '').trim().toUpperCase(),
    name: String(input.name || '').trim(),
    desc: input.desc || '',
    dims: input.dims || '',
    qty: Number(input.qty) || 1,
    delivery: input.delivery || '',
    // What this person quoted for their work on this piece — not what
    // the piece sells for. Zero is a real and common value: an item
    // sent out before a price was agreed, or one priced together with
    // the line above it.
    rate: round2(Number(input.rate) || 0),
    remark: input.remark || '',
    // A photo taken specifically for this commissioning. Normally
    // empty: the piece is shown by the photo already on file for its
    // MR No, so there is one photo per piece rather than two.
    photo: input.photo || '',
    createdAt: input.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  state.items.push(it);
  write(); emit();
  return it;
}

export function updateItem(id, changes) {
  const it = getItem(id);
  if (!it) return null;
  Object.assign(it, changes, { updatedAt: Date.now() });
  if (changes.rate !== undefined) it.rate = round2(Number(changes.rate) || 0);
  write(); emit();
  return it;
}

export function deleteItem(id) {
  const it = getItem(id);
  if (!it) return;
  it.deletedAt = Date.now();
  it.updatedAt = Date.now();
  write(); emit();
}

/** qty × rate, the same arithmetic the Drive sheets do in their Total
    column. Never stored, so a rate corrected after the fact cannot
    leave a stale total sitting beside it. */
export function itemAmount(it) {
  return round2((Number(it.qty) || 0) * (Number(it.rate) || 0));
}

/* ── Payments ──────────────────────────────────────────────────
   Money that actually left, against a person. `remarks` is what the
   Drive sheets put there — "B109 - Veer - Advance", "Remaining
   payment" — and `note` is who physically took it, which is often not
   the subcontractor themselves: Firozbhai's son, Uttam bhai, Kamlesh.
   Both are kept because both are how these payments get recognised
   months later.

   `woId` is optional. A payment may name the work order it was for
   without being confined to it — the balance is the person's. */

export function paymentsOf(subId) {
  return state.payments
    .filter((p) => p.subId === subId && !p.deletedAt)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt - a.createdAt));
}

export function getPayment(id) {
  return state.payments.find((p) => p.id === id && !p.deletedAt) || null;
}

export function newPayment(input = {}) {
  return {
    id: input.id || uid('sp'),
    subId: input.subId || '',
    woId: input.woId || '',
    date: input.date || todayISO(),
    amount: round2(Number(input.amount) || 0),
    remarks: input.remarks || '',
    mode: input.mode || 'Cash',
    note: input.note || '',
    // The ledger entry this payment created, when it created one. The
    // link is kept so editing or deleting the payment can keep the two
    // in step rather than leaving an orphan in the day book.
    entryId: input.entryId || '',
    // Which job the money was booked against, for the ledger entry.
    jobCode: String(input.jobCode || '').trim().toUpperCase(),
    photoIds: input.photoIds || [],
    createdAt: input.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Records a payment. This is the one place the sub-contractor book and
 * the day book meet: commissioning work and agreeing a rate never
 * touches the ledger, because no rupee has moved — but a payment has,
 * so it becomes a real money-out entry, against the job if one is
 * named, with the bill photo if one was taken.
 *
 * `postToLedger` is how the import opts out. Seeding two years of
 * historical payments would otherwise invent hundreds of ledger
 * entries for money that was recorded elsewhere at the time, and
 * double every figure the ledger already shows.
 */
export function addPayment(input = {}, { postToLedger = true, ledger = null } = {}) {
  const p = newPayment(input);

  if (postToLedger && ledger && p.amount > 0) {
    const s = getSub(p.subId);
    const w = p.woId ? getWorkOrder(p.woId) : null;
    const bits = [w && w.no, p.remarks].filter(Boolean).join(' — ');
    const entry = ledger.addEntry({
      type: 'out',
      date: p.date,
      entered: p.amount,
      jobCode: p.jobCode,
      party: (s && (s.firm || s.name)) || '',
      note: bits || `Sub-contractor payment${s ? ` to ${s.name}` : ''}`,
      photoIds: p.photoIds,
      categoryId: input.categoryId || '',
      accountId: input.accountId || '',
    });
    if (entry) p.entryId = entry.id;
  }

  state.payments.push(p);
  write(); emit();
  return p;
}

export function updatePayment(id, changes) {
  const p = getPayment(id);
  if (!p) return null;
  Object.assign(p, changes, { updatedAt: Date.now() });
  if (changes.amount !== undefined) p.amount = round2(Number(changes.amount) || 0);
  write(); emit();
  return p;
}

export function deletePayment(id) {
  const p = getPayment(id);
  if (!p) return;
  p.deletedAt = Date.now();
  p.updatedAt = Date.now();
  write(); emit();
}

/* ── The balance ───────────────────────────────────────────────
   The figure the whole screen exists for, and the one the Drive
   sheets put at the top of every Payment Status tab:

     ordered  — every item rate × quantity, across every work order
     paid     — every payment recorded against the person
     due      — the difference

   Nothing here is stored. Correct a rate or delete a payment and this
   moves with it, which is the only way it can stay true. */

export function balanceOf(subId) {
  const ordered = itemsOf(subId).reduce((n, it) => n + itemAmount(it), 0);
  const paid = paymentsOf(subId).reduce((n, p) => n + p.amount, 0);
  return { ordered: round2(ordered), paid: round2(paid), due: round2(ordered - paid) };
}

/** The same three figures for one work order on its own — what the
    printed document is worth. Paid is deliberately absent: payments
    belong to the person, not the sheet, so a per-work-order "paid"
    would be a number nobody could reconcile. */
export function woTotal(woId) {
  return round2(itemsIn(woId).reduce((n, it) => n + itemAmount(it), 0));
}

/** Everything, for the top of the screen. */
export function stats() {
  const live = subs({});
  let ordered = 0, paid = 0, owed = 0;
  for (const s of live) {
    const b = balanceOf(s.id);
    ordered += b.ordered;
    paid += b.paid;
    if (b.due > 0) owed += b.due;
  }
  return {
    people: live.length,
    blacklisted: state.subs.filter((s) => !s.deletedAt && s.status === 'blacklisted').length,
    ordered: round2(ordered),
    paid: round2(paid),
    owed: round2(owed),
    owing: live.filter((s) => balanceOf(s.id).due > 0).length,
  };
}

/* ── The shared books ──────────────────────────────────────────
   Four kinds on the same records table the ledger, the orders and the
   quotations use, keyed by each record's own id, last write wins per
   row. Every mutation above stamps updatedAt and deletes softly, which
   is exactly what a tombstone needs, so nothing here is tracked by
   hand. See js/shopsync.js. */

export const SYNC_KINDS = [
  { kind: 'sub', arr: 'subs', key: 'id' },
  { kind: 'subwo', arr: 'workOrders', key: 'id' },
  { kind: 'subitem', arr: 'items', key: 'id' },
  { kind: 'subpay', arr: 'payments', key: 'id' },
];

const ARR_OF = { sub: 'subs', subwo: 'workOrders', subitem: 'items', subpay: 'payments' };

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
  return out;
}

export function applyRemote(rows) {
  let changed = 0;

  for (const row of rows || []) {
    const arrName = ARR_OF[row.kind];
    if (!arrName) continue;

    const id = String(row.id || '');
    if (!id) continue;

    const list = state[arrName];
    const i = list.findIndex((r) => String(r.id) === id);
    const mine = i !== -1;
    const at = Date.parse(row.updated_at || row.updatedAt) || Date.now();

    if (mine && (list[i].updatedAt || 0) > at) continue;

    const gone = `${row.kind}:${id}`;

    // A tombstone: the row is removed here and only its id stays
    // behind. Nothing of a removed record is written back into
    // storage, and a tombstone for something this device never had
    // adds nothing at all.
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

  state = { ...blank(), orgId: want };
  write(); emit();
  return true;
}

export function ownerOrg() { return state.orgId; }

export function reclaim(orgId) {
  const want = String(orgId || '');
  if (!want || state.orgId === want) return false;
  state.orgId = want;
  write();
  return true;
}

export function wipe() {
  state = blank();
  write(); emit();
}

/* ── The seed ──────────────────────────────────────────────────
   The eleven histories out of the Drive folder, in data/subcontractors.json.
   Ids are derived from the person and from position within their own
   sheets rather than made up, so two devices seeding the same history
   land on the same rows instead of two copies of it — the same bargain
   orders.js and commissions.js make.

   Payments are seeded with postToLedger off. Every one of them was
   real money that left at the time and was recorded wherever it was
   recorded then; re-posting 58 of them into the day book now would
   double figures the ledger already carries. From here on a payment
   entered through the app does post, which is the point.
*/

function seedId(kind, ...parts) {
  const slug = parts.map((p) => String(p).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).join('-');
  return `${kind}_${slug}`;
}

export function seeded() {
  return state.subs.some((s) => !s.deletedAt);
}

/**
 * Fills an empty sub-contractor book from the shipped history. A no-op
 * once anything is on file, so it can be called on every boot and
 * never overwrites work done since.
 */
export async function seedFromFile() {
  if (seeded()) return { seeded: 0 };

  let data;
  try {
    const res = await fetch('/data/subcontractors.json');
    if (!res.ok) return { seeded: 0 };
    data = await res.json();
  } catch (e) {
    return { seeded: 0 };
  }

  const people = (data && data.subcontractors) || [];
  if (!people.length) return { seeded: 0 };

  for (const p of people) {
    const subId = seedId('sc', p.name);
    addSub({
      id: subId,
      name: p.name,
      firm: p.firm,
      aliases: p.aliases,
      trades: p.trades,
      phone: p.phone,
      email: p.email,
      address: p.address,
      status: p.blacklisted ? 'blacklisted' : 'active',
      blacklistReason: p.blacklistReason || '',
      blacklistDate: p.blacklistDate || '',
      dataNote: p.dataNote || '',
    });

    for (const wo of p.workOrders || []) {
      const woId = seedId('wo', p.name, wo.no, wo.issueDate);
      addWorkOrder({ id: woId, subId, no: wo.no, issueDate: wo.issueDate });
      for (const it of wo.items || []) {
        addItem({
          id: seedId('si', p.name, wo.no, wo.issueDate, String(it.sr)),
          woId,
          sr: it.sr,
          mrNo: it.mrNo,
          name: it.name,
          desc: it.desc,
          dims: it.dims,
          qty: it.qty,
          delivery: it.delivery,
          rate: it.rate,
          remark: it.remark || '',
        });
      }
    }

    for (const pay of p.payments || []) {
      addPayment({
        id: seedId('sp', p.name, String(pay.sr), pay.date, String(pay.amount)),
        subId,
        date: pay.date,
        amount: pay.amount,
        remarks: pay.remarks,
        mode: pay.mode,
        note: pay.note,
      }, { postToLedger: false });
    }
  }

  return { seeded: people.length };
}

/* ── Corrections to the imported history ───────────────────────
 * The Drive sheets had gaps the import could not fill on its own —
 * a work order header carrying the wrong person's contact details,
 * most of all. When one of those is answered afterwards, the answer
 * has to reach the devices that seeded before it was known, and
 * seedFromFile() will not run again on those: it is a no-op the
 * moment anything is on file.
 *
 * So each correction is applied once, by seed id, and only ever to a
 * field that is still empty. A number typed on the phone in the
 * meantime is the better record and is never overwritten by this.
 */

const REPAIRS = [
  {
    // Hari Ram's sheet was copied from Arif Malek's and the header
    // never updated, so the import deliberately left his contact
    // details blank rather than attribute Arif's to him. The number
    // below was given by the owner.
    id: seedId('sc', 'Hari Ram'),
    fill: { phone: '9925033107' },
    note: {
      // Replaced only while it is still the note the import wrote —
      // an edited one is somebody's own words and is left alone.
      from: 'The work-order sheet header still shows',
      to: "Phone number confirmed by the owner. The work-order sheet header still carries "
        + "Arif Malek's name and address (the template was not updated when it was copied) — "
        + 'only the payments identify this work as Hari Ram’s.',
    },
  },
];

/** Applies any correction that has not landed on this device yet.
    Returns how many records it touched, so a boot that had nothing
    to do does not repaint a screen someone is reading. */
export function applyRepairs() {
  let changed = 0;

  for (const r of REPAIRS) {
    const s = getSub(r.id);
    if (!s) continue;

    const patch = {};
    for (const [k, v] of Object.entries(r.fill || {})) {
      if (!String(s[k] || '').trim()) patch[k] = v;
    }
    if (r.note && String(s.dataNote || '').startsWith(r.note.from)) {
      patch.dataNote = r.note.to;
    }

    if (Object.keys(patch).length) { updateSub(r.id, patch); changed += 1; }
  }

  return changed;
}
