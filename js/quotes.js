/* quotes.js — the Quotation module's data.
 *
 * The shapes here are taken from Banavat India's actual quotation,
 * not invented. A quotation is a document before it is a record, so
 * the fields are the ones that appear on the page, in the order the
 * page prints them:
 *
 *   QUOTATION
 *   Client Name / Contact Number / Shipping Address
 *   Quoted Date / MR # / Valid till
 *   Sr.No | Image | Name | Description | Dimensions | Unit Price | Qty | Total
 *   Payment Terms
 *   Sub-Total → GST(18%) → Sub Total A
 *   Shipping rows → Sub Total B
 *   Sub Total A + Sub Total B = Total
 *   Banking details · Contact details · Terms & Conditions · Note
 *
 * Three things the real document taught us, each of which the first
 * draft of this file got wrong:
 *
 * 1. The MR number is the quotation's identity. There is no separate
 *    quote number — C128 *is* the quotation, and it is the same code
 *    the ledger already files jobs under. A revision appends a suffix
 *    (C129-1), so the original a client has seen keeps its meaning.
 *
 * 2. Dimensions are prose, not three numbers. Real entries read
 *    `38 x 1 x 58"`, `Dia 8 inch`, `(8'8" + 20'7.5" + 8'8") x 36" (Ht)`
 *    and `Small: 550 x 550 x 440 mm  Large: 890 x 890 x 340 mm`. No
 *    W/D/H triple survives contact with that, so the field is text.
 *
 * 3. Shipping is its own short table below the tax, not a line item
 *    and not a discount. Goods are taxed (Sub Total A); shipping is
 *    added after (Sub Total B); the two are summed for the Total.
 */

import { uid, ensureJob, updateJob } from './store.js';
import { todayISO, round2 } from './format.js';

const KEY = 'kontour.quotes.v2';

export const STATUS = {
  draft:    { label: 'Draft',    tone: 'mut'  },
  sent:     { label: 'Sent',     tone: 'warn' },
  accepted: { label: 'Accepted', tone: 'in'   },
  declined: { label: 'Declined', tone: 'out'  },
};

export const CATEGORIES = [
  'Seating', 'Table', 'Bed', 'Storage', 'Lighting',
  'Mirror', 'Metalwork', 'Decor', 'Modular', 'Other',
];

/* Every printed line is Unit Price × Quantity — that is the only
   arithmetic the document does. A negotiated scope is expressed as
   a single unit at that figure, so it prints identically while the
   builder can still label it for what it is. */
export const LINE_KINDS = {
  unit: { label: 'Per unit', hint: 'Unit price × quantity' },
  lump: { label: 'Lump sum', hint: 'One figure for the whole scope' },
};

/* ── The boilerplate ───────────────────────────────────────────
   Everything below prints on every quotation and is typed on none
   of them. It lives in settings so a change to the lead time or a
   bank detail happens once. Taken verbatim from the current PDFs. */

const COMPANY = {
  name: 'Banavat India',
  gstin: '24ABCFB9356M1Z3',
  address: 'Tarsali, Vadodara - 390009',
  email: 'banavat.furniture.homedecor@gmail.com',
  phone: '+91 78598 80461 / +91-9773048267',
  website: 'www.banavat-india.com',
};

const BANK = {
  bank: 'HDFC Bank Ltd.',
  name: 'Banavat India',
  account: '50200098923230',
  ifsc: 'HDFC0001711',
  branch: 'Waghodia',
};

/* Payment terms vary between quotations — 50% on most, 70% on some —
   so this is only the default a new quotation starts from. */
const PAYMENT_TERMS = [
  '50% advance payment is required at the time of placing the order.',
  'The remaining balance must be paid prior to the dispatch of the products.',
].join('\n');

const TERMS = [
  'Photographs of the products will be shared for confirmation before shipping.',
  'The quoted prices include fabrics valued up to ₹800 per meter (if applicable), and additional charges will be added if actual price is increased.',
  'All products come with a 1.5-year warranty covering manufacturing defects and non-accidental damages.',
  'Unloading and installation will require coordination with the client. Local labor assistance and lift access may be necessary.',
  'Custom, made-to-order pieces are subject to a tolerance of ±2 inches.',
  'Lead time for delivery is 25–30 business days.*',
  'Please ensure that passage dimensions are compatible with product sizes before placing an order.',
].join('\n');

const NOTE = `We genuinely do our best to deliver your furniture as quickly and smoothly as possible, and we're committed to making your experience enjoyable and stress-free.

That said, we kindly request that you avoid planning important personal or professional events—such as move-ins, weddings, muhurats, guest visits, photoshoots, board exams, or project handovers—around our delivery timeline. While we provide an estimated delivery window, it is only indicative and may vary due to production or logistical factors. We are unable to promise an exact delivery date or expedite orders to meet specific event deadlines.

We understand delays can be inconvenient, but we are not able to take responsibility for any financial loss or emotional impact caused by unforeseen delays.

Thank you for your understanding and for trusting us with your space.`;

function blank() {
  return {
    quotes: [],
    designs: [],
    settings: {
      mrPrefix: 'C',
      gstRate: 18,
      // Every quotation seen runs two months from the quoted date.
      validityDays: 61,
      defaultCity: 'Vadodara',
      paymentTerms: PAYMENT_TERMS,
      terms: TERMS,
      note: NOTE,
      company: { ...COMPANY },
      bank: { ...BANK },
      seq: 0,
    },
  };
}

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
    out.settings.company = { ...base.settings.company, ...((s.settings || {}).company || {}) };
    out.settings.bank = { ...base.settings.bank, ...((s.settings || {}).bank || {}) };
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

export function load() { state = read(); return state; }
export function raw() { return state; }
export function settings() { return state.settings; }

export function updateSettings(changes) {
  state.settings = { ...state.settings, ...changes };
  write(); emit();
  return state.settings;
}

/* ── MR numbers ────────────────────────────────────────────────
   C126, C127, C128 — a running series, not restarted per year, and
   the same code the ledger files the job under. */
export function nextMrNo() {
  const s = state.settings;
  return `${s.mrPrefix}${(s.seq || 0) + 1}`;
}

/* A revision keeps the parent's number and adds a suffix, exactly
   as the current filing does: C129 then C129-1. */
function nextRevisionOf(mrNo) {
  const base = String(mrNo).split('-')[0];
  const used = state.quotes
    .filter((q) => String(q.mrNo).split('-')[0] === base)
    .map((q) => Number(String(q.mrNo).split('-')[1]) || 0);
  return `${base}-${Math.max(0, ...used) + 1}`;
}

/* ── Designs ─────────────────────────────────────────────────── */

export function designs({ category = null, q = '' } = {}) {
  let list = state.designs.filter((d) => !d.archived);
  if (category && category !== 'All') list = list.filter((d) => d.category === category);
  const needle = q.trim().toLowerCase();
  if (needle) {
    list = list.filter((d) =>
      `${d.code} ${d.name} ${d.category} ${d.description}`.toLowerCase().includes(needle));
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
    photo: input.photo || '',
    unitPrice: Number(input.unitPrice) || 0,
    // Prose, because the real ones are prose. See the header note.
    dims: input.dims || '',
    // A finish carries what it does to the price, not a price of its
    // own — so re-rating a design does not mean re-rating every finish.
    finishes: Array.isArray(input.finishes) ? input.finishes : [],
    description: input.description || '',
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

export function designPrice(design, finishName) {
  if (!design) return 0;
  const f = (design.finishes || []).find((x) => x.name === finishName);
  return round2(design.unitPrice + (f ? Number(f.delta) || 0 : 0));
}

/* ── Quotations ──────────────────────────────────────────────── */

export function quotes({ status = null, q = '' } = {}) {
  let list = state.quotes.slice();
  if (status && status !== 'all') list = list.filter((x) => x.status === status);
  const needle = q.trim().toLowerCase();
  if (needle) {
    list = list.filter((x) =>
      `${x.mrNo} ${x.client.name} ${x.title}`.toLowerCase().includes(needle));
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
    name: input.name || '',
    description: input.description || '',
    dims: input.dims || '',
    finish: input.finish || '',
    photo: input.photo || '',
    qty: input.qty == null ? 1 : Number(input.qty),
    unitPrice: Number(input.unitPrice) || 0,
  };
}

export function lineFromDesign(design, finish = '') {
  const chosen = finish || (design.finishes[0] && design.finishes[0].name) || '';
  return newLine({
    designCode: design.code,
    name: design.name || design.code,
    description: design.description,
    dims: design.dims,
    finish: chosen,
    photo: design.photo,
    qty: 1,
    unitPrice: designPrice(design, chosen),
  });
}

/* A lump-sum line is one unit at the negotiated figure, so it prints
   through the same Unit Price × Quantity column as everything else. */
export function lineAmount(line) {
  if (!line) return 0;
  const qty = line.kind === 'lump' ? 1 : (line.qty || 0);
  return round2(qty * (line.unitPrice || 0));
}

export function newShipping(input = {}) {
  return {
    id: uid('s'),
    label: input.label || '',
    amount: Number(input.amount) || 0,
  };
}

/* The totals ladder, exactly as the document prints it: goods are
   taxed, shipping is added after tax, and the two subtotals are
   summed. Shipping is deliberately outside the GST base — that is
   how these quotations have always been written. */
export function quoteTotals(quote) {
  if (!quote) return { sub: 0, gst: 0, subA: 0, subB: 0, total: 0 };
  const sub = round2((quote.lines || []).reduce((t, l) => t + lineAmount(l), 0));
  const gst = round2(sub * (Number(quote.gstRate) || 0) / 100);
  const subA = round2(sub + gst);
  const subB = round2((quote.shipping || []).reduce((t, s) => t + (Number(s.amount) || 0), 0));
  return { sub, gst, subA, subB, total: round2(subA + subB) };
}

export function addQuote(input = {}) {
  const s = state.settings;
  const date = input.date || todayISO();
  const isRevision = Boolean(input.revisionOf);
  const q = {
    id: uid('q'),
    mrNo: input.mrNo || (isRevision ? nextRevisionOf(input.revisionOf) : nextMrNo()),
    date,
    validUntil: input.validUntil || '',
    // The internal name for the job. Not printed — the document
    // identifies itself by MR number and client.
    title: input.title || '',
    client: { name: '', phone: '', shippingAddress: s.defaultCity, ...(input.client || {}) },
    lines: Array.isArray(input.lines) ? input.lines : [],
    shipping: Array.isArray(input.shipping) ? input.shipping
      : [newShipping({ label: `Delivery City - ${s.defaultCity}`, amount: 0 })],
    gstRate: input.gstRate == null ? s.gstRate : Number(input.gstRate),
    paymentTerms: input.paymentTerms == null ? s.paymentTerms : input.paymentTerms,
    notes: input.notes || '',
    status: 'draft',
    jobCode: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.quotes.push(q);
  // A revision reuses the parent's number, so it must not burn one.
  if (!isRevision && !input.mrNo) state.settings.seq = (state.settings.seq || 0) + 1;
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

export function reviseQuote(id) {
  const old = getQuote(id);
  if (!old) return null;
  return addQuote({
    ...old,
    revisionOf: old.mrNo,
    mrNo: '',
    date: todayISO(),
    lines: (old.lines || []).map((l) => ({ ...l, id: uid('l') })),
    shipping: (old.shipping || []).map((s) => ({ ...s, id: uid('s') })),
    status: 'draft',
  });
}

/* ── The link into Phynance ────────────────────────────────────
   The MR number is already the job code — the ledger has filed
   entries under B121 and C123 since before this module existed. So
   accepting does not invent a code, it simply opens the job that
   the quotation has been named after all along and sets its order
   value to the quoted total. */
export function acceptQuote(id, jobCode = '') {
  const q = getQuote(id);
  if (!q) return null;
  const code = (jobCode || q.jobCode || q.mrNo || '').trim().toUpperCase();
  if (code) {
    ensureJob(code, { silent: true, title: q.title, client: q.client.name });
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

/* ── Dashboard figures ───────────────────────────────────────── */

export function openQuotes() { return quotes({ status: 'sent' }); }

export function pipelineValue() {
  return round2(openQuotes().reduce((t, q) => t + quoteTotals(q).total, 0));
}

export function recentQuotes(limit = 5) {
  return state.quotes.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}
