/* store.js — the ledger itself.
   Everything except photo blobs lives here, persisted to localStorage as
   one JSON document. The whole file is written as an async API on purpose:
   when Kontour goes online, only the read()/write() pair below changes,
   and no view has to be touched. */

import { round2, todayISO, monthKey, isoOf, fyRange } from './format.js';
import { KINDS, snapshot, diff, enqueue, clearQueue, setCursor } from './outbox.js';
import './legacy.js';   // moves pre-rename storage across; must load first

const KEY = 'kontour.v1';
const DEVICE_KEY = 'kontour.device';       // never leaves this device, never exported
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/* ── Defaults ──────────────────────────────────────────────── */

// No Cash account: Banavat India's CA has asked for cash transactions
// to be kept out of the books entirely, not just discouraged. See
// purgeCashData() below for what happens to a device that already has
// one on file.
const DEFAULT_ACCOUNTS = [
  { id: 'bank', name: 'Bank', icon: 'bank', opening: 0, archived: false },
  { id: 'upi', name: 'UPI', icon: 'phone', opening: 0, archived: false },
];

/* Seeded from how Banavat's money actually moves. All of these are
   renameable / hideable in Settings, and new ones can be added. */
const DEFAULT_CATEGORIES = [
  // money in
  { id: 'c_adv', name: 'Client advance', type: 'in', icon: 'arrowIn' },
  { id: 'c_bal', name: 'Client balance', type: 'in', icon: 'arrowIn' },
  { id: 'c_oth_in', name: 'Other income', type: 'in', icon: 'sparkle' },
  // money out
  { id: 'c_sub', name: 'Subcontractor', type: 'out', icon: 'user' },
  { id: 'c_mat', name: 'Raw material', type: 'out', icon: 'box' },
  { id: 'c_wage', name: 'Wages & labour', type: 'out', icon: 'user' },
  { id: 'c_salary', name: 'Salary', type: 'out', icon: 'user' },
  { id: 'c_trans', name: 'Transport', type: 'out', icon: 'box' },
  { id: 'c_porter', name: 'Porter', type: 'out', icon: 'box' },
  { id: 'c_tools', name: 'Tools & consumables', type: 'out', icon: 'box' },
  { id: 'c_rent', name: 'Rent', type: 'out', icon: 'home' },
  { id: 'c_elec', name: 'Electricity', type: 'out', icon: 'home' },
  { id: 'c_gas', name: 'Gas', type: 'out', icon: 'home' },
  { id: 'c_util', name: 'Utilities', type: 'out', icon: 'home' },
  { id: 'c_gst', name: 'GST / tax paid', type: 'out', icon: 'note' },
  { id: 'c_comm', name: 'Commission', type: 'out', icon: 'tag' },
  { id: 'c_mkt', name: 'Marketing', type: 'out', icon: 'sparkle' },
  { id: 'c_draw', name: 'Owner drawings', type: 'out', icon: 'wallet' },
  { id: 'c_oth_out', name: 'Other', type: 'out', icon: 'note' },
];

const DEFAULT_SETTINGS = {
  pinHash: '',
  pinSalt: '',
  gstDefaultRate: 18,
  gstDefaultMode: 'excl',        // 'excl' = amount is before GST, 'incl' = GST inside
  drive: { clientId: '', folderId: '', folderName: 'Kontour', token: '', tokenExp: 0 },
  ai: { provider: 'claude', key: '', model: 'claude-opus-5', enabled: true, endpoint: '' },
  autoSync: true,
};

function blank() {
  return {
    v: 1,
    accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })),
    categories: DEFAULT_CATEGORIES.map((c, i) => ({ ...c, archived: false, order: i })),
    jobs: [],
    entries: [],
    recurring: [],
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    meta: { lastAccountId: 'bank', lastCategoryIn: 'c_adv', lastCategoryOut: 'c_mat', createdAt: Date.now() },
  };
}

/* ── Persistence ───────────────────────────────────────────── */

let state = null;
const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  } catch (e) {
    console.error('[kontour] could not read saved data', e);
    return blank();
  }
}

function migrate(s) {
  const base = blank();
  const out = { ...base, ...s };
  out.settings = { ...base.settings, ...(s.settings || {}) };
  out.settings.drive = { ...base.settings.drive, ...((s.settings || {}).drive || {}) };
  out.settings.ai = { ...base.settings.ai, ...((s.settings || {}).ai || {}) };
  out.meta = { ...base.meta, ...(s.meta || {}) };
  for (const k of ['accounts', 'categories', 'jobs', 'entries', 'recurring']) {
    if (!Array.isArray(out[k])) out[k] = base[k];
  }
  // New default categories (added after an install already existed) are
  // appended so existing devices pick them up without losing custom ones.
  const haveIds = new Set(out.categories.map((c) => c.id));
  const missing = DEFAULT_CATEGORIES.filter((c) => !haveIds.has(c.id));
  if (missing.length) {
    let order = out.categories.reduce((m, c) => Math.max(m, c.order || 0), 0);
    out.categories = out.categories.concat(
      missing.map((c) => ({ ...c, archived: false, order: ++order }))
    );
  }
  return out;
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('[kontour] could not save', e);
    emit('error', 'Storage is full — export a backup and clear old photos.');
  }
}

function emit(kind = 'change', detail = null) {
  listeners.forEach((fn) => fn(kind, detail));
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function load() {
  if (!state) {
    state = read();
    // The baseline every later commit is compared against. Taken after
    // the read so a record that migrate() filled in does not read as a
    // local edit and push itself on first launch.
    shadow = snapshot(state);
  }
  return state;
}

export function raw() {
  return load();
}

/* ── Change tracking ───────────────────────────────────────────
   The last state written, so commit() can work out what changed
   without every mutation having to say so. See js/outbox.js. */
let shadow = null;
let applyingRemote = false;

function commit() {
  const next = snapshot(state);
  if (!applyingRemote) {
    // Before write(), because diff stamps updatedAt onto the records it
    // finds changed and that stamp has to be what gets persisted.
    enqueue(diff(shadow, next, state));
  }
  shadow = next;
  write();
  emit('change');
}

/**
 * Folds rows pulled from the server into local state, newest write
 * winning per record. Nothing here re-enters the outbox: these changes
 * came from the server, and queueing them would push them straight back.
 *
 * Returns how many records actually moved, so the caller can skip a
 * redraw when a pull brought back only this device's own writes.
 */
export function applyRemote(rows) {
  if (!rows || !rows.length) return 0;
  const s = load();
  const spec = new Map(KINDS.map((k) => [k.kind, k]));
  let changed = 0;

  for (const row of rows) {
    const k = spec.get(row.kind);
    if (!k) continue;

    const list = s[k.arr];
    const i = list.findIndex((r) => String(r[k.key]) === String(row.id));
    const local = i >= 0 ? list[i] : null;
    const remoteAt = Date.parse(row.updated_at) || 0;

    // A record this device has never seen has no local stamp to beat.
    if (local && (local.updatedAt || 0) >= remoteAt) continue;

    if (row.deleted_at) {
      if (local) { list.splice(i, 1); changed++; }
      continue;
    }

    const rec = { ...row.data, updatedAt: remoteAt };
    if (local) list[i] = rec; else list.push(rec);
    changed++;
  }

  if (changed) {
    applyingRemote = true;
    try { commit(); } finally { applyingRemote = false; }
  }
  return changed;
}

/* Device-local flags: PIN skip, install hints. Deliberately outside the
   exported backup so a restore never unlocks another device. */
export const device = {
  get(k, fallback = null) {
    try {
      const d = JSON.parse(localStorage.getItem(DEVICE_KEY) || '{}');
      return k in d ? d[k] : fallback;
    } catch { return fallback; }
  },
  set(k, v) {
    let d = {};
    try { d = JSON.parse(localStorage.getItem(DEVICE_KEY) || '{}'); } catch {}
    d[k] = v;
    localStorage.setItem(DEVICE_KEY, JSON.stringify(d));
  },
};

/* ── ids ───────────────────────────────────────────────────── */

export function uid(prefix = 'e') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/* ── GST maths ─────────────────────────────────────────────── */

/**
 * Turns what was typed into the three numbers the ledger needs.
 * `total` is always the rupees that actually moved — balances use it.
 */
export function computeAmounts(entered, gst) {
  const amt = round2(Number(entered) || 0);
  if (!gst || !gst.on || !gst.rate) {
    return { base: amt, gstAmount: 0, total: amt };
  }
  const r = Number(gst.rate) || 0;
  if (gst.mode === 'incl') {
    const base = round2(amt / (1 + r / 100));
    return { base, gstAmount: round2(amt - base), total: amt };
  }
  const gstAmount = round2(amt * r / 100);
  return { base: amt, gstAmount, total: round2(amt + gstAmount) };
}

/* ── Entries ───────────────────────────────────────────────── */

export function entries() {
  return load().entries;
}

/** Newest first, by date then by when it was logged. */
export function sortedEntries(list) {
  return (list || entries()).slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

export function getEntry(id) {
  return entries().find((e) => e.id === id) || null;
}

export function addEntry(input) {
  const s = load();
  const now = Date.now();
  const gst = { on: !!(input.gst && input.gst.on), rate: (input.gst && input.gst.rate) || 0, mode: (input.gst && input.gst.mode) || 'excl' };
  const amounts = computeAmounts(input.entered, gst);

  const e = {
    id: uid('e'),
    type: input.type || 'out',
    date: input.date || todayISO(),
    entered: round2(input.entered),
    gst,
    ...amounts,
    accountId: input.accountId || s.meta.lastAccountId || 'bank',
    toAccountId: input.type === 'transfer' ? (input.toAccountId || '') : '',
    categoryId: input.type === 'transfer' ? '' : (input.categoryId || ''),
    jobCode: (input.jobCode || '').trim().toUpperCase(),
    party: (input.party || '').trim(),
    note: (input.note || '').trim(),
    photoIds: input.photoIds || [],
    recurringId: input.recurringId || '',
    createdAt: now,
    updatedAt: now,
    edited: false,
    history: [],
  };

  s.entries.push(e);
  s.meta.lastAccountId = e.accountId;
  if (e.type === 'in' && e.categoryId) s.meta.lastCategoryIn = e.categoryId;
  if (e.type === 'out' && e.categoryId) s.meta.lastCategoryOut = e.categoryId;
  if (e.jobCode) ensureJob(e.jobCode, { silent: true });
  commit();
  return e;
}

const TRACKED = ['type', 'date', 'entered', 'accountId', 'toAccountId', 'categoryId', 'jobCode', 'party', 'note'];

export function updateEntry(id, changes) {
  const s = load();
  const i = s.entries.findIndex((e) => e.id === id);
  if (i < 0) return null;
  const prev = s.entries[i];

  const next = { ...prev, ...changes };
  const gst = { on: !!(next.gst && next.gst.on), rate: (next.gst && next.gst.rate) || 0, mode: (next.gst && next.gst.mode) || 'excl' };
  next.gst = gst;
  Object.assign(next, computeAmounts(next.entered, gst));
  next.jobCode = (next.jobCode || '').trim().toUpperCase();
  next.updatedAt = Date.now();

  // Free to edit for the first 24h. After that the change leaves a trail —
  // the number in the books stops being something that quietly moves.
  if (Date.now() - (prev.createdAt || 0) > EDIT_WINDOW_MS) {
    const diff = {};
    for (const k of TRACKED) {
      if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) diff[k] = prev[k];
    }
    if (Object.keys(diff).length) {
      next.edited = true;
      next.history = (prev.history || []).concat([{ at: Date.now(), was: diff }]);
    }
  }

  s.entries[i] = next;
  if (next.jobCode) ensureJob(next.jobCode, { silent: true });
  commit();
  return next;
}

export function deleteEntry(id) {
  const s = load();
  s.entries = s.entries.filter((e) => e.id !== id);
  commit();
}

export function canEditFreely(e) {
  return Date.now() - (e.createdAt || 0) <= EDIT_WINDOW_MS;
}

/* ── Accounts ──────────────────────────────────────────────── */

export function accounts(includeArchived = false) {
  return load().accounts.filter((a) => includeArchived || !a.archived);
}

export function getAccount(id) {
  return load().accounts.find((a) => a.id === id) || null;
}

export function accountName(id) {
  const a = getAccount(id);
  return a ? a.name : '—';
}

export function addAccount({ name, icon = 'wallet', opening = 0 }) {
  const s = load();
  const a = { id: uid('a'), name: name.trim(), icon, opening: round2(opening), archived: false };
  s.accounts.push(a);
  commit();
  return a;
}

export function updateAccount(id, changes) {
  const s = load();
  const a = s.accounts.find((x) => x.id === id);
  if (!a) return null;
  Object.assign(a, changes);
  if ('opening' in changes) a.opening = round2(changes.opening);
  commit();
  return a;
}

export function deleteAccount(id) {
  const s = load();
  const used = s.entries.some((e) => e.accountId === id || e.toAccountId === id);
  if (used) {                       // never orphan an entry — hide instead
    return updateAccount(id, { archived: true });
  }
  s.accounts = s.accounts.filter((a) => a.id !== id);
  commit();
  return null;
}

/* Banavat India's CA has asked for cash transactions to be kept out
   of the books entirely. A device that already had the Cash account
   — or an entry logged against it before this ran — has that record
   deleted outright rather than hidden, on the explicit call that a
   ledger the CA is relying on should not still be carrying it archived
   in the background. Runs once per load, through the same commit()
   every other edit goes through, so a synced org has the deletion
   pushed to every other device too, not just cleared locally. */
export function purgeCashData() {
  const s = load();
  const before = s.entries.length;
  s.entries = s.entries.filter((e) => e.accountId !== 'cash' && e.toAccountId !== 'cash');
  const hadAccount = s.accounts.some((a) => a.id === 'cash');
  s.accounts = s.accounts.filter((a) => a.id !== 'cash');
  const fixedDefault = s.meta.lastAccountId === 'cash';
  if (fixedDefault) s.meta.lastAccountId = (s.accounts[0] && s.accounts[0].id) || 'bank';

  const changed = before !== s.entries.length || hadAccount || fixedDefault;
  if (changed) commit();
  return { entriesRemoved: before - s.entries.length, accountRemoved: hadAccount };
}

/** Opening balance + everything that has moved through it. */
export function balance(accountId, upto = null) {
  const s = load();
  const a = getAccount(accountId);
  if (!a) return 0;
  let bal = a.opening || 0;
  for (const e of s.entries) {
    if (upto && e.date > upto) continue;
    if (e.type === 'in' && e.accountId === accountId) bal += e.total;
    else if (e.type === 'out' && e.accountId === accountId) bal -= e.total;
    else if (e.type === 'transfer') {
      if (e.accountId === accountId) bal -= e.total;
      if (e.toAccountId === accountId) bal += e.total;
    }
  }
  return round2(bal);
}

export function totalOnHand() {
  return round2(accounts().reduce((sum, a) => sum + balance(a.id), 0));
}

/* ── Categories ────────────────────────────────────────────── */

export function categories(type = null, includeArchived = false) {
  return load().categories
    .filter((c) => (includeArchived || !c.archived) && (!type || c.type === type))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function getCategory(id) {
  return load().categories.find((c) => c.id === id) || null;
}

export function categoryName(id) {
  const c = getCategory(id);
  return c ? c.name : 'Uncategorised';
}

export function addCategory({ name, type, icon = 'note' }) {
  const s = load();
  const c = { id: uid('c'), name: name.trim(), type, icon, archived: false, order: s.categories.length };
  s.categories.push(c);
  commit();
  return c;
}

export function updateCategory(id, changes) {
  const s = load();
  const c = s.categories.find((x) => x.id === id);
  if (!c) return null;
  Object.assign(c, changes);
  commit();
  return c;
}

export function deleteCategory(id) {
  const s = load();
  const used = s.entries.some((e) => e.categoryId === id);
  if (used) return updateCategory(id, { archived: true });
  s.categories = s.categories.filter((c) => c.id !== id);
  commit();
  return null;
}

/* ── Jobs ──────────────────────────────────────────────────── */

export function jobs(includeArchived = false) {
  return load().jobs
    .filter((j) => includeArchived || !j.archived)
    .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
}

export function getJob(code) {
  const c = (code || '').trim().toUpperCase();
  return load().jobs.find((j) => j.code === c) || null;
}

/** Job codes are created just by typing them — no master to maintain. */
export function ensureJob(code, { silent = false, title = '', client = '' } = {}) {
  const c = (code || '').trim().toUpperCase();
  if (!c) return null;
  const s = load();
  let j = s.jobs.find((x) => x.code === c);
  if (!j) {
    j = { code: c, title, client, orderValue: 0, archived: false, stage: 'production', createdAt: Date.now(), lastUsed: Date.now() };
    s.jobs.push(j);
  } else {
    j.lastUsed = Date.now();
    if (title) j.title = title;
    if (client) j.client = client;
  }
  if (!silent) commit(); else write();
  return j;
}

export function updateJob(code, changes) {
  const s = load();
  const j = s.jobs.find((x) => x.code === (code || '').toUpperCase());
  if (!j) return null;
  Object.assign(j, changes);
  if ('orderValue' in changes) j.orderValue = round2(changes.orderValue);
  commit();
  return j;
}

export function deleteJob(code) {
  const s = load();
  const c = (code || '').toUpperCase();
  const used = s.entries.some((e) => e.jobCode === c);
  if (used) return updateJob(c, { archived: true });
  s.jobs = s.jobs.filter((j) => j.code !== c);
  commit();
  return null;
}

/**
 * Received / spent / outstanding for one job.
 * Outstanding only exists if an order value was entered — otherwise the
 * job simply has no target and shows none.
 */
export function jobSummary(code) {
  const c = (code || '').toUpperCase();
  const j = getJob(c);
  let received = 0, spent = 0, count = 0;
  for (const e of entries()) {
    if (e.jobCode !== c) continue;
    count++;
    if (e.type === 'in') received += e.total;
    else if (e.type === 'out') spent += e.total;
  }
  received = round2(received);
  spent = round2(spent);
  const orderValue = j ? (j.orderValue || 0) : 0;
  return {
    code: c,
    job: j,
    count,
    received,
    spent,
    margin: round2(received - spent),
    orderValue,
    outstanding: orderValue ? round2(orderValue - received) : null,
  };
}

/** Codes seen recently, so the autocomplete gets smarter as it is used. */
export function recentJobCodes(limit = 12) {
  const seen = new Map();
  for (const e of sortedEntries()) {
    if (!e.jobCode) continue;
    if (!seen.has(e.jobCode)) seen.set(e.jobCode, e.createdAt || 0);
    if (seen.size >= limit * 2) break;
  }
  const fromJobs = jobs().map((j) => j.code);
  return Array.from(new Set([...seen.keys(), ...fromJobs])).slice(0, limit);
}

/** Party names already used, for the same reason. */
export function recentParties(limit = 40) {
  const set = new Set();
  for (const e of sortedEntries()) {
    if (e.party) set.add(e.party);
    if (set.size >= limit) break;
  }
  return Array.from(set);
}

/* ── Totals ────────────────────────────────────────────────── */

export function inRange(from, to) {
  return entries().filter((e) => e.date >= from && e.date <= to);
}

export function totals(list) {
  let inSum = 0, outSum = 0, gstIn = 0, gstOut = 0;
  for (const e of list) {
    if (e.type === 'in') { inSum += e.total; gstIn += e.gstAmount || 0; }
    else if (e.type === 'out') { outSum += e.total; gstOut += e.gstAmount || 0; }
  }
  return {
    in: round2(inSum),
    out: round2(outSum),
    net: round2(inSum - outSum),
    gstIn: round2(gstIn),
    gstOut: round2(gstOut),
    gstNet: round2(gstIn - gstOut),
    count: list.length,
  };
}

export function dayTotals(iso) {
  return totals(entries().filter((e) => e.date === iso));
}

export function monthTotals(key) {
  return totals(entries().filter((e) => monthKey(e.date) === key));
}

/* The three figures the Phynance topbar wants: what the market still
   owes across every job, what Banavat India still owes its own
   vendors (not tracked yet — always null until that ledger exists),
   and money in for the current financial year as the turnover
   figure. */
export function phynanceStats() {
  const outstanding = jobs()
    .map((j) => jobSummary(j.code))
    .reduce((t, s) => t + (s.outstanding > 0 ? s.outstanding : 0), 0);
  const { from, to } = fyRange(todayISO());
  const turnover = totals(inRange(from, to)).in;
  return { outstanding: round2(outstanding), vendorPayment: null, turnover: round2(turnover) };
}

export function byCategory(list, type) {
  const map = new Map();
  for (const e of list) {
    if (e.type !== type) continue;
    const k = e.categoryId || '_none';
    map.set(k, round2((map.get(k) || 0) + e.total));
  }
  return Array.from(map.entries())
    .map(([id, amount]) => ({ id, name: id === '_none' ? 'Uncategorised' : categoryName(id), amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function monthsWithData() {
  const set = new Set(entries().map((e) => monthKey(e.date)));
  set.add(monthKey(todayISO()));
  return Array.from(set).sort().reverse();
}

/* ── Recurring ─────────────────────────────────────────────── */

export function recurring() {
  return load().recurring;
}

export function addRecurring(rec) {
  const s = load();
  const r = {
    id: uid('r'),
    label: rec.label || 'Monthly entry',
    day: Math.min(28, Math.max(1, Number(rec.day) || 1)),
    template: rec.template,
    lastDone: '',              // month key it was last logged for
    active: true,
    createdAt: Date.now(),
  };
  s.recurring.push(r);
  commit();
  return r;
}

export function updateRecurring(id, changes) {
  const s = load();
  const r = s.recurring.find((x) => x.id === id);
  if (!r) return null;
  Object.assign(r, changes);
  commit();
  return r;
}

export function deleteRecurring(id) {
  const s = load();
  s.recurring = s.recurring.filter((r) => r.id !== id);
  commit();
}

/**
 * Which recurring entries are due this month and not yet logged.
 * Nothing is ever written automatically — this only produces a prompt.
 */
export function dueRecurring(today = todayISO()) {
  const mk = monthKey(today);
  const dayNo = Number(today.slice(8, 10));
  return recurring().filter((r) => r.active && r.lastDone !== mk && dayNo >= r.day);
}

export function markRecurringDone(id, monthK) {
  return updateRecurring(id, { lastDone: monthK });
}

/* ── Settings ──────────────────────────────────────────────── */

export function settings() {
  return load().settings;
}

export function saveSettings(changes) {
  const s = load();
  s.settings = { ...s.settings, ...changes };
  if (changes.drive) s.settings.drive = { ...load().settings.drive, ...changes.drive };
  if (changes.ai) s.settings.ai = { ...load().settings.ai, ...changes.ai };
  commit();
  return s.settings;
}

/* ── Backup / restore ──────────────────────────────────────── */

export function exportAll() {
  const s = load();
  const copy = JSON.parse(JSON.stringify(s));
  // Credentials are device-side, not backup material.
  copy.settings.pinHash = '';
  copy.settings.pinSalt = '';
  copy.settings.drive.token = '';
  copy.settings.drive.tokenExp = 0;
  copy.settings.ai.key = '';
  return {
    app: 'kontour',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: copy,
  };
}

export function importAll(payload, { merge = false } = {}) {
  // 'kontour' is what backups taken before the rename say. They are
  // still this app's own files and still restore.
  const known = payload && (payload.app === 'kontour' || payload.app === 'kontour');
  if (!known || !payload.data) {
    throw new Error('That file is not a Kontour backup.');
  }
  const incoming = migrate(payload.data);
  if (!merge) {
    const keepPin = { pinHash: state.settings.pinHash, pinSalt: state.settings.pinSalt };
    state = incoming;
    state.settings.pinHash = keepPin.pinHash;
    state.settings.pinSalt = keepPin.pinSalt;
  } else {
    const have = new Set(state.entries.map((e) => e.id));
    state.entries.push(...incoming.entries.filter((e) => !have.has(e.id)));
    const haveJobs = new Set(state.jobs.map((j) => j.code));
    state.jobs.push(...incoming.jobs.filter((j) => !haveJobs.has(j.code)));
    const haveCats = new Set(state.categories.map((c) => c.id));
    state.categories.push(...incoming.categories.filter((c) => !haveCats.has(c.id)));
    const haveAcc = new Set(state.accounts.map((a) => a.id));
    state.accounts.push(...incoming.accounts.filter((a) => !haveAcc.has(a.id)));
  }
  commit();
  return state;
}

/**
 * Clears this device, and only this device.
 *
 * Deliberately not a commit(): the diff would read an emptied ledger as
 * "delete every record" and push tombstones for all of it, so clearing
 * one phone would wipe the books for everyone. The queue and the pull
 * cursor go with it, so the next sync starts from nothing and fetches
 * the org's data back down.
 */
export function wipe() {
  state = blank();
  shadow = snapshot(state);
  clearQueue();
  setCursor('');
  write();
  emit('change');
}

/* ── PIN ───────────────────────────────────────────────────── */

/* crypto.subtle only exists on a secure context (https or localhost).
   Over a plain LAN address it is absent, so there is a fallback. Either
   way this is a 4-digit PIN: it keeps a casual passer-by out of the
   ledger, it is not encryption, and it does not protect the stored data. */
async function hash(text) {
  if (globalThis.crypto && crypto.subtle && crypto.subtle.digest) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + text.charCodeAt(i) * (i + 7), 2654435761) >>> 0;
  }
  return `fb${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export function hasPin() {
  return !!settings().pinHash;
}

export async function setPin(pin) {
  const salt = uid('s');
  const pinHash = await hash(salt + ':' + pin);
  saveSettings({ pinSalt: salt, pinHash });
}

export async function checkPin(pin) {
  const s = settings();
  if (!s.pinHash) return true;
  return (await hash(s.pinSalt + ':' + pin)) === s.pinHash;
}

export function clearPin() {
  saveSettings({ pinHash: '', pinSalt: '' });
}
