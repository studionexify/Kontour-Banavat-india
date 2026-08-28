/* quotes.js — the Quotation module's data.
 *
 * Kept in its own store, and its own localStorage key, rather than
 * folded into store.js. The ledger records what already happened;
 * a quotation is a proposal about what might. They have different
 * lifecycles, and a quote is edited many times before it means
 * anything, so mixing the two would put draft figures inside the
 * books.
 *
 * The one place they meet is a job code: accepting a quote opens
 * the job and sets its order value, and from that point Phynance
 * tracks payment against the figure quoted here.
 *
 * Shapes below are deliberately close to the printed format —
 * a quotation is a document before it is a record, so the fields
 * are the ones that appear on the page.
 */

import { uid, ensureJob, updateJob } from './store.js';
import { todayISO, round2 } from './format.js';

const KEY = 'kontour.quotes.v1';

/* ── Status ────────────────────────────────────────────────────
   A quote moves in one direction, except that a declined or
   expired one can be revised — which copies it to a new draft
   rather than reopening the old number. A number that has been
   sent to a client never changes meaning afterwards. */
export const STATUS = {
  draft:    { label: 'Draft',    tone: 'mut'  },
  sent:     { label: 'Sent',     tone: 'warn' },
  accepted: { label: 'Accepted', tone: 'in'   },
  declined: { label: 'Declined', tone: 'out'  },
};

export const CATEGORIES = [
  'Sofa', 'Bed', 'Wardrobe', 'Dining', 'Storage',
  'Table', 'Chair', 'Modular', 'Other',
];

/* Two ways a line is priced, and only two. Either it is a countable
   thing with a rate, or it is a scope with a negotiated figure. */
export const LINE_KINDS = {
  unit: { label: 'Per unit', hint: 'Rate × quantity' },
  lump: { label: 'Lump sum', hint: 'One figure for the scope' },
};

function blank() {
  return {
    quotes: [],
    designs: [],
    settings: {
      prefix: 'BI',          // quote numbers read BI/2026-27/014
      gstRate: 18,
      validityDays: 15,
      terms: DEFAULT_TERMS,
      seq: 0,
    },
  };
}

const DEFAULT_TERMS = [
  '50% advance along with the confirmed order, balance before dispatch.',
  'Delivery 4–6 weeks from the date of order confirmation and final drawing approval.',
  'Prices are exclusive of GST unless stated otherwise.',
  'Transport and installation charged at actuals unless included above.',
  'This quotation is valid for the period stated above.',
].join('\n');

let state = blank();
const listeners = new Set();

function emit() { listeners.forEach((fn) => fn()); }

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const base = blank();
    const s = JSON.parse(raw);
    const out = { ...base, ...s };
    out.settings = { ...base.settings, ...(s.settings || {}) };
    for (const k of ['quotes', 'designs']) {
      if (!Array.isArray(out[k])) out[k] = [];
    }
    return out;
  } catch (e) {
    console.error('[kontour] could not read quotations', e);
    return blank();
  }
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('[kontour] could not save quotations', e);
  }
}

export function load() {
  state = read();
  return state;
}

export function raw() { return state; }

export function settings() { return state.settings; }

export function updateSettings(changes) {
  state.settings = { ...state.settings, ...changes };
  write(); emit();
  return state.settings;
}

/* ── Numbering ─────────────────────────────────────────────────
   Sequential within a financial year, so BI/2026-27/014 is the
   fourteenth quote of that year and stays meaningful in a folder
   sorted by name. The counter only advances when a draft is
   actually created, so abandoned drafts do not leave holes. */
export function nextNumber(fy) {
  const s = state.settings;
  const n = String((s.seq || 0) + 1).padStart(3, '0');
  // fyOf() reads "FY 2026-27" for display; a document number wants
  // only the years, so BI/2026-27/014 rather than BI/FY 2026-27/014.
  const years = String(fy || '').replace(/^FY\s*/, '');
  return `${s.prefix}/${years}/${n}`;
}

/* ── Designs ───────────────────────────────────────────────────
   The library. A design is a thing you make more than once, so it
   carries what a quote needs to describe and price it: a code, a
   picture, its default size, the finishes it comes in, and the
   words that print underneath it. */

export function designs({ category = null, q = '' } = {}) {
  let list = state.designs.filter((d) => !d.archived);
  if (category && category !== 'All') list = list.filter((d) => d.category === category);
  const needle = q.trim().toLowerCase();
  if (needle) {
    list = list.filter((d) =>
      `${d.code} ${d.name} ${d.category} ${d.spec}`.toLowerCase().includes(needle));
  }
  return list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export function getDesign(code) {
  return state.designs.find((d) => d.code === code) || null;
}

export function addDesign(input) {
  const d = {
    id: uid('d'),
    code: (input.code || '').trim().toUpperCase(),
    name: (input.name || '').trim(),
    category: input.category || 'Other',
    photo: input.photo || '',        // data URL, downscaled on capture
    baseRate: Number(input.baseRate) || 0,
    w: Number(input.w) || 0,
    h: Number(input.h) || 0,
    d: Number(input.d) || 0,
    // A finish carries what it does to the price, not a price of its
    // own — so re-rating a design does not mean re-rating every finish.
    finishes: Array.isArray(input.finishes) ? input.finishes : [],
    spec: input.spec || '',
    archived: false,
    createdAt: Date.now(),
  };
  state.designs.push(d);
  write(); emit();
  return d;
}

export function updateDesign(code, changes) {
  const d = getDesign(code);
  if (!d) return null;
  Object.assign(d, changes, { updatedAt: Date.now() });
  write(); emit();
  return d;
}

export function deleteDesign(code) {
  state.designs = state.designs.filter((d) => d.code !== code);
  write(); emit();
}

/* The rate a design lands in a quote at, once a finish is chosen. */
export function designRate(design, finishName) {
  if (!design) return 0;
  const f = (design.finishes || []).find((x) => x.name === finishName);
  return round2(design.baseRate + (f ? Number(f.delta) || 0 : 0));
}

/* ── Quotations ────────────────────────────────────────────────── */

export function quotes({ status = null, q = '' } = {}) {
  let list = state.quotes.slice();
  if (status && status !== 'all') list = list.filter((x) => x.status === status);
  const needle = q.trim().toLowerCase();
  if (needle) {
    list = list.filter((x) =>
      `${x.number} ${x.client.name} ${x.client.company} ${x.title}`.toLowerCase().includes(needle));
  }
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
}

export function getQuote(id) {
  return state.quotes.find((x) => x.id === id) || null;
}

export function newLine(input = {}) {
  return {
    id: uid('l'),
    kind: input.kind || 'unit',
    designCode: input.designCode || '',
    title: input.title || '',
    spec: input.spec || '',
    finish: input.finish || '',
    w: Number(input.w) || 0,
    h: Number(input.h) || 0,
    d: Number(input.d) || 0,
    qty: input.qty == null ? 1 : Number(input.qty),
    rate: Number(input.rate) || 0,
    // Only a lump-sum line carries its own figure; a unit line's
    // amount is always rate × qty, so it is never stored twice.
    lump: Number(input.lump) || 0,
  };
}

export function lineFromDesign(design, finish = '') {
  return newLine({
    kind: 'unit',
    designCode: design.code,
    title: design.name || design.code,
    spec: design.spec,
    finish: finish || (design.finishes[0] && design.finishes[0].name) || '',
    w: design.w, h: design.h, d: design.d,
    qty: 1,
    rate: designRate(design, finish || (design.finishes[0] && design.finishes[0].name) || ''),
  });
}

export function lineAmount(line) {
  if (!line) return 0;
  return round2(line.kind === 'lump' ? line.lump : (line.qty || 0) * (line.rate || 0));
}

/* The figures that print at the foot of the page. Discount comes
   off before GST, because that is how the tax is actually owed. */
export function quoteTotals(quote) {
  if (!quote) return { sub: 0, discount: 0, taxable: 0, gst: 0, total: 0 };
  const sub = round2((quote.lines || []).reduce((t, l) => t + lineAmount(l), 0));
  const discount = round2(Number(quote.discount) || 0);
  const taxable = round2(Math.max(0, sub - discount));
  const gst = round2(taxable * (Number(quote.gstRate) || 0) / 100);
  return { sub, discount, taxable, gst, total: round2(taxable + gst) };
}

export function addQuote(input = {}) {
  const s = state.settings;
  const date = input.date || todayISO();
  const q = {
    id: uid('q'),
    number: input.number || nextNumber(input.fy || ''),
    date,
    validUntil: input.validUntil || '',
    title: input.title || '',
    client: {
      name: '', company: '', address: '', phone: '', email: '', gstin: '',
      ...(input.client || {}),
    },
    lines: Array.isArray(input.lines) ? input.lines : [],
    gstRate: input.gstRate == null ? s.gstRate : Number(input.gstRate),
    discount: Number(input.discount) || 0,
    terms: input.terms == null ? s.terms : input.terms,
    notes: input.notes || '',
    status: 'draft',
    jobCode: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.quotes.push(q);
  state.settings.seq = (state.settings.seq || 0) + 1;
  write(); emit();
  return q;
}

export function updateQuote(id, changes) {
  const q = getQuote(id);
  if (!q) return null;
  Object.assign(q, changes, { updatedAt: Date.now() });
  write(); emit();
  return q;
}

export function deleteQuote(id) {
  state.quotes = state.quotes.filter((x) => x.id !== id);
  write(); emit();
}

/* A revision is a new number, not an edit. The client has seen the
   old one, so it stays exactly as it was sent. */
export function reviseQuote(id, fy) {
  const old = getQuote(id);
  if (!old) return null;
  return addQuote({
    ...old,
    fy,
    number: nextNumber(fy),
    date: todayISO(),
    lines: (old.lines || []).map((l) => ({ ...l, id: uid('l') })),
    status: 'draft',
  });
}

/* ── The one link into Phynance ────────────────────────────────
   Accepting is the moment a proposal becomes money owed, so it is
   also the moment the job should exist. The job's order value is
   the quoted total, which is what makes the Jobs screen's
   Total / Paid / Remaining line up with what the client agreed to.

   Called with no job code it derives one from the quote number's
   tail, which is the habit already in use — B121, B109. */
export function acceptQuote(id, jobCode = '') {
  const q = getQuote(id);
  if (!q) return null;
  const code = (jobCode || q.jobCode || '').trim().toUpperCase();
  if (code) {
    ensureJob(code, { silent: true, title: q.title, client: q.client.name || q.client.company });
    updateJob(code, { orderValue: quoteTotals(q).total });
    q.jobCode = code;
  }
  q.status = 'accepted';
  q.updatedAt = Date.now();
  write(); emit();
  return q;
}

export function setStatus(id, status) {
  if (!STATUS[status]) return null;
  if (status === 'accepted') return acceptQuote(id);
  return updateQuote(id, { status });
}

/* ── Dashboard figures ─────────────────────────────────────────
   What is still out with a client and undecided — the number the
   Dashboard leads with, because it is the one that is worth
   chasing this week. */
export function openQuotes() {
  return quotes({ status: 'sent' });
}

export function pipelineValue() {
  return round2(openQuotes().reduce((t, q) => t + quoteTotals(q).total, 0));
}

export function recentQuotes(limit = 5) {
  return state.quotes
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}
