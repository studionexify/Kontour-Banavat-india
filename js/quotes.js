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
import { todayISO, round2, fyStartYear } from './format.js';

const KEY = 'kontour.quotes.v2';

export const STATUS = {
  draft:      { label: 'Draft',      tone: 'mut'  },
  sent:       { label: 'Sent',       tone: 'warn' },
  accepted:   { label: 'Accepted',   tone: 'in'   },
  declined:   { label: 'Declined',   tone: 'out'  },
  // Not a decision anyone makes by hand. When one revision of a job
  // is finalised the rest of that family close as superseded, so a
  // job never has two live figures and the open-value figure on the
  // Dashboard cannot count the same work twice.
  superseded: { label: 'Superseded', tone: 'mut'  },
};

/* A quotation's family is everything sharing its base MR number:
   C129, C129-1, C129-2 are one job quoted three times. */
export function baseNo(mrNo) {
  return String(mrNo || '').split('-')[0];
}

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
  'The quoted prices include fabrics valued up to {{fabricRate}} per meter (if applicable), and additional charges will be added if actual price is increased.',
  'All products come with a 1.5-year warranty covering manufacturing defects and non-accidental damages.',
  'Unloading and installation will require coordination with the client. Local labor assistance and lift access may be necessary.',
  'Custom, made-to-order pieces are subject to a tolerance of ±2 inches.',
  'Lead time for delivery is {{leadTime}}.*',
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
      // Both of these print inside a standing term but change from one
      // quotation to the next — 25–30 business days on one, 15–20 on
      // another — so the term holds a placeholder and the quotation
      // holds the value. These are only the defaults a new one starts
      // from.
      fabricRate: 800,
      leadTime: '25–30 business days',
      paymentTerms: PAYMENT_TERMS,
      terms: TERMS,
      note: NOTE,
      company: { ...COMPANY },
      // The Banavat mark, as an uploaded image. Held here rather than
      // shipped as a repo asset so it travels in a backup, works with
      // no network, and can be changed without a deploy. Everything
      // that shows the brand — the document, the rail, the lock
      // screen — reads this one value.
      logo: '',
      bank: { ...BANK },
      seq: 0,
    },
    // Which books these quotations belong to. Empty on a device that
    // has never signed in. See claimFor() — this is what stops one
    // org's quotations being pushed into another's after a sign-out
    // and a sign-in as somebody else.
    orgId: '',
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
    out.orgId = typeof s.orgId === 'string' ? s.orgId : '';
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

/* Fills {{fabricRate}} and {{leadTime}} in the standing terms from
   whatever this particular quotation says. */
export function renderTerms(quote) {
  const s = state.settings;
  const rate = Number(quote && quote.fabricRate != null ? quote.fabricRate : s.fabricRate) || 0;
  const lead = (quote && quote.leadTime) || s.leadTime || '';
  return String(s.terms || '')
    .replace(/\{\{fabricRate\}\}/g, `₹${rate.toLocaleString('en-IN')}`)
    .replace(/\{\{leadTime\}\}/g, lead);
}

/* Two calendar months from the quoted date, which is what every
   issued quotation has used — not a fixed number of days. */
export function defaultValidUntil(fromISO) {
  const d = new Date(`${fromISO}T00:00:00`);
  const day = d.getDate();
  d.setMonth(d.getMonth() + 2);
  // Guard the month-end roll: 31 Dec + 2 months must not become 3 Mar.
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

/* ── MR numbers ────────────────────────────────────────────────
   The letter is the financial year and the number runs on within it:
   B is 2025-26, C is 2026-27, D will be 2027-28. So the series does
   not restart in April — it changes letter, which is what makes an
   old number still readable years later.

   The number continues from the highest already filed under that
   letter rather than a stored counter, so importing history or
   typing a number over by hand cannot leave the sequence behind. */
export function fyLetter(iso = todayISO()) {
  const offset = fyStartYear(iso) - 2025;
  return String.fromCharCode('B'.charCodeAt(0) + Math.max(0, offset));
}

export function nextMrNo(iso = todayISO()) {
  const letter = fyLetter(iso);
  const used = state.quotes
    .filter((q) => !q.deletedAt)
    .map((q) => String(q.mrNo || ''))
    .filter((n) => n.startsWith(letter))
    .map((n) => Number(baseNo(n).slice(letter.length)))
    .filter((n) => Number.isFinite(n));
  const highest = used.length ? Math.max(...used) : 0;
  // A fresh book still starts where the stored counter says, so a
  // copy with no history behaves as it always did.
  return `${letter}${Math.max(highest, state.settings.seq || 0) + 1}`;
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
  let list = state.designs.filter((d) => !d.archived && !d.deletedAt);
  if (category && category !== 'All') list = list.filter((d) => d.category === category);
  const needle = q.trim().toLowerCase();
  if (needle) {
    list = list.filter((d) =>
      `${d.code} ${d.name} ${d.category} ${d.description}`.toLowerCase().includes(needle));
  }
  return list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export function getDesign(code) {
  return state.designs.find((d) => d.code === code && !d.deletedAt) || null;
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
  const d = getDesign(code);
  if (!d) return;
  // Tombstoned, not spliced. A row removed outright has nothing left to
  // sync against, so an offline device would push it back on its next
  // connection and the deletion would quietly undo itself.
  d.deletedAt = Date.now();
  d.updatedAt = Date.now();
  write(); emit();
}

export function designPrice(design, finishName) {
  if (!design) return 0;
  const f = (design.finishes || []).find((x) => x.name === finishName);
  return round2(design.unitPrice + (f ? Number(f.delta) || 0 : 0));
}

/* ── Quotations ──────────────────────────────────────────────── */

export function quotes({ status = null, q = '' } = {}) {
  let list = state.quotes.filter((x) => !x.deletedAt);
  if (status && status !== 'all') list = list.filter((x) => x.status === status);
  const needle = q.trim().toLowerCase();
  if (needle) {
    list = list.filter((x) =>
      `${x.mrNo} ${x.client.name} ${x.title}`.toLowerCase().includes(needle));
  }
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
}

export function getQuote(id) {
  return state.quotes.find((x) => x.id === id && !x.deletedAt) || null;
}

/* Every revision of one job, newest first. */
export function familyOf(mrNo) {
  const base = baseNo(mrNo);
  return state.quotes
    .filter((x) => !x.deletedAt && baseNo(x.mrNo) === base)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/* The list groups by family and shows the current revision, so it
   stays as long as the job count rather than the revision count.
   "Current" is the one that was decided if any was, otherwise the
   most recent — which is what you would hand a client today. */
export function quoteFamilies({ status = null, q = '' } = {}) {
  const seen = new Set();
  const out = [];
  for (const quote of quotes({ q })) {
    const base = baseNo(quote.mrNo);
    if (seen.has(base)) continue;
    seen.add(base);
    const family = familyOf(base);
    const head = family.find((x) => x.status === 'accepted')
      || family.find((x) => x.status !== 'superseded')
      || family[0];
    if (status && status !== 'all' && head.status !== status) continue;
    out.push({ base, head, family, revisions: family.length });
  }
  return out;
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
    photo: input.photo || input.image || '',
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

/* The picture that prints in the Image column. A line usually carries
   its own — taken from the library design it came from, or added by
   hand — but an imported line has none, because the sheet's images do
   not survive being read as text. Where such a line names a design
   that is in the library, the library's photograph stands in, so
   filling the library retrofits pictures onto the history rather than
   leaving 98 quotations with an empty column forever. */
export function linePhoto(line) {
  if (!line) return '';
  if (line.photo) return line.photo;
  const d = line.designCode ? getDesign(line.designCode)
    // An imported line has no code — the sheet named the piece, it did
    // not reference the library — so fall back to the name. Matching at
    // render time rather than at import means a design photographed
    // next month still shows on a quotation filed last year.
    : matchByName(line.name);
  return (d && d.photo) || '';
}

function matchByName(name) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) return null;
  return state.designs.find((d) => !d.deletedAt && !d.archived
    && (d.name || '').trim().toLowerCase() === needle) || null;
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
  if (!quote) return { sub: 0, gst: 0, subA: 0, subB: 0, total: 0, taxed: false };
  const sub = round2((quote.lines || []).reduce((t, l) => t + lineAmount(l), 0));
  const taxed = quote.gstApplicable !== false;
  const gst = taxed ? round2(sub * (Number(quote.gstRate) || 0) / 100) : 0;
  const subA = round2(sub + gst);
  const subB = round2((quote.shipping || []).reduce((t, s) => t + (Number(s.amount) || 0), 0));
  return { sub, gst, subA, subB, total: round2(subA + subB), taxed };
}

export function addQuote(input = {}) {
  const s = state.settings;
  const date = input.date || todayISO();
  const isRevision = Boolean(input.revisionOf);
  const q = {
    id: uid('q'),
    mrNo: input.mrNo || (isRevision ? nextRevisionOf(input.revisionOf) : nextMrNo(date)),
    date,
    validUntil: input.validUntil || '',
    // The internal name for the job. Not printed — the document
    // identifies itself by MR number and client.
    title: input.title || '',
    client: {
      name: '', email: '', phone: '',
      // City only — that is all the printed document carries.
      shippingAddress: s.defaultCity,
      ...(input.client || {}),
    },
    lines: Array.isArray(input.lines) ? input.lines : [],
    shipping: Array.isArray(input.shipping) ? input.shipping
      : [newShipping({ label: `Delivery City - ${s.defaultCity}`, amount: 0 })],
    gstRate: input.gstRate == null ? s.gstRate : Number(input.gstRate),
    // Some quotations are written without tax. That is not the same as
    // 18% of nothing, so it is a flag rather than a zero rate — and the
    // document drops the row entirely rather than printing a ₹0.
    gstApplicable: input.gstApplicable == null ? true : Boolean(input.gstApplicable),
    paymentTerms: input.paymentTerms == null ? s.paymentTerms : input.paymentTerms,
    fabricRate: input.fabricRate == null ? s.fabricRate : Number(input.fabricRate),
    leadTime: input.leadTime == null ? s.leadTime : input.leadTime,
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

/* The number is offered as previous + 1 but can be typed over, so a
   collision has to be caught — two quotations sharing a number would
   silently merge into one revision family. */
export function mrNoTaken(mrNo, exceptId = '') {
  const want = String(mrNo || '').trim().toUpperCase();
  return state.quotes.some((x) => !x.deletedAt && x.id !== exceptId
    && String(x.mrNo).toUpperCase() === want);
}

export function updateQuote(id, changes) {
  const q = getQuote(id);
  if (!q) return null;
  Object.assign(q, changes, { updatedAt: Date.now() });
  write(); emit();
  return q;
}

export function deleteQuote(id) {
  const q = getQuote(id);
  if (!q) return;
  q.deletedAt = Date.now();
  q.updatedAt = Date.now();
  write(); emit();
}

/* Recreating an old quotation for a different client. Unlike a
   revision this is a new job with a new MR number, and the client,
   dates and job code are deliberately left blank so nothing stale
   goes out under someone else's name. */
export function duplicateQuote(id) {
  const old = getQuote(id);
  if (!old) return null;
  const s = state.settings;
  const valid = new Date();
  valid.setDate(valid.getDate() + (s.validityDays || 61));
  return addQuote({
    date: todayISO(),
    validUntil: valid.toISOString().slice(0, 10),
    title: old.title,
    client: { name: '', phone: '', shippingAddress: s.defaultCity },
    lines: (old.lines || []).map((l) => ({ ...l, id: uid('l') })),
    shipping: (old.shipping || []).map((x) => ({ ...x, id: uid('s') })),
    gstRate: old.gstRate,
    gstApplicable: old.gstApplicable,
    paymentTerms: old.paymentTerms,
    fabricRate: old.fabricRate,
    leadTime: old.leadTime,
  });
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
  // The revision suffix belongs to the quotation, not the job — all
  // three rounds of C129 are quoting the same job, so the ledger must
  // not end up with C129, C129-1 and C129-2 as separate jobs.
  const code = (jobCode || q.jobCode || baseNo(q.mrNo) || '').trim().toUpperCase();
  if (code) {
    ensureJob(code, { silent: true, title: q.title, client: q.client.name });
    updateJob(code, { orderValue: quoteTotals(q).total });
    q.jobCode = code;
  }
  q.status = 'accepted';
  q.updatedAt = Date.now();
  // Finalising one revision closes every other revision of the same
  // job, whichever direction it sits in — an older C129 and a newer
  // C129-2 both stop being live the moment C129-1 is agreed.
  for (const other of familyOf(q.mrNo)) {
    if (other.id === q.id) continue;
    if (other.status === 'accepted') continue;
    other.status = 'superseded';
    other.updatedAt = Date.now();
  }
  write(); emit();
  return q;
}

export function setStatus(id, status) {
  if (!STATUS[status]) return null;
  if (status === 'accepted') return acceptQuote(id);
  return updateQuote(id, { status });
}

/* ── Importing the history ────────────────────────────────────
   The quotations that lived in the spreadsheet, brought in as
   records rather than retyped. Matching is by MR number, so running
   it twice adds nothing the second time and a quotation edited here
   is never overwritten by the file.

   It takes the parsed rows, or a URL to fetch them from. It is
   deliberately not wired to a file shipped with the app: this is
   real client names, phone numbers and prices, and anything served
   alongside the app is readable by anyone who visits it. The file
   is chosen from the device instead, so the data never leaves it.

   Numbers the sheet reused for different clients come in flagged
   rather than merged or dropped — the data is real either way, and
   only you can say which one should keep the number. */
/* The bundled history, decrypted here rather than on a server.
   The ciphertext ships with the app because ciphertext is safe to
   publish; the passphrase never does. AES-256-GCM authenticates as
   well as encrypts, so a tampered blob fails to open rather than
   opening to something someone else chose. */
export async function decryptHistory(passphrase, onProgress, url = 'data/quotations.enc.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not read the history file (${res.status})`);
  const blob = await res.json();

  const b64 = (s2) => Uint8Array.from(atob(s2), (c) => c.charCodeAt(0));
  const salt = b64(blob.kdf.salt);
  const iv = b64(blob.iv);
  const data = b64(blob.data);
  const pass = new TextEncoder().encode(passphrase);

  let plain;
  if (globalThis.crypto && crypto.subtle && crypto.subtle.importKey) {
    const base = await crypto.subtle.importKey(
      'raw', pass, 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: blob.kdf.iterations, hash: blob.kdf.hash },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    try {
      plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data));
    } catch (e) {
      // GCM refuses on a wrong key and on a tampered blob alike, and
      // cannot tell you which — so neither can this message.
      throw new Error('That passphrase does not open the file');
    }
  } else {
    // No crypto.subtle: the app is being read over plain http, or from
    // a frame with an opaque origin. Do it the slow way rather than
    // leave the history shut. Takes a few seconds.
    const { pbkdf2, gcmDecrypt } = await import('./softcrypto.js');
    const key = pbkdf2(pass, salt, blob.kdf.iterations, 32, onProgress);
    plain = gcmDecrypt(key, iv, data);
    if (!plain) throw new Error('That passphrase does not open the file');
  }

  return JSON.parse(new TextDecoder().decode(plain));
}

export async function importHistory(rows) {
  if (typeof rows === 'string') {
    const res = await fetch(rows, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not read that file (${res.status})`);
    rows = await res.json();
  }
  if (!Array.isArray(rows)) throw new Error('That file is not a list of quotations');

  const numbers = new Set(state.quotes.map((q) => String(q.mrNo).toUpperCase()));
  /* Identity is the number plus who and when, not the number alone.
     The sheet reused some numbers for different clients, so the
     number by itself cannot say whether a row is already here — and
     matching on it alone made a second run import every clashing
     record again under a fresh suffix. */
  const worth = (ls) => (ls || []).reduce((t, l) => t + (l.unitPrice || 0) * (l.qty || 0), 0);
  const identity = (q) => [
    String(q.mrNo || '').toUpperCase().split('#')[0],
    q.date || '',
    String((q.client || {}).name || '').trim().toLowerCase(),
    // The sheet holds two different C131s for one client on one day.
    // Without the figures in the key they would collapse into one and
    // a real quotation would be lost.
    (q.lines || []).length,
    Math.round(worth(q.lines)),
  ].join('|');
  const seen = new Set(state.quotes.map(identity));

  let added = 0;
  let skipped = 0;

  for (const row of rows) {
    const mrNo = String(row.mrNo || '').trim().toUpperCase();
    if (!mrNo) { skipped += 1; continue; }

    const key = identity(row);
    if (seen.has(key)) { skipped += 1; continue; }

    // A number the sheet reused for a different client comes in under
    // a suffix so both survive; the flag is what tells you to settle it.
    let useNo = mrNo;
    if (numbers.has(useNo)) {
      let n = 2;
      while (numbers.has(`${mrNo}#${n}`)) n += 1;
      useNo = `${mrNo}#${n}`;
    }

    state.quotes.push({
      id: uid('q'),
      mrNo: useNo,
      date: row.date || '',
      validUntil: row.validUntil || '',
      title: '',
      client: { name: '', email: '', phone: '', shippingAddress: '', ...(row.client || {}) },
      lines: (row.lines || []).map((l) => newLine(l)),
      shipping: (row.shipping || []).map((x) => newShipping(x)),
      gstRate: state.settings.gstRate,
      gstApplicable: row.gstApplicable !== false,
      paymentTerms: row.paymentTerms || state.settings.paymentTerms,
      fabricRate: state.settings.fabricRate,
      leadTime: state.settings.leadTime,
      notes: '',
      // Everything in the sheet went out to a client; what came back is
      // not recorded there, so they arrive awaiting a reply.
      status: 'sent',
      jobCode: '',
      imported: true,
      numberClash: Boolean(row.numberClash) && useNo !== mrNo,
      createdAt: Date.parse(`${row.date}T00:00:00`) || Date.now(),
      updatedAt: Date.now(),
    });
    numbers.add(useNo);
    seen.add(key);
    added += 1;
  }

  if (added) { write(); emit(); }
  return { added, skipped, total: rows.length };
}

/* ── Dashboard figures ───────────────────────────────────────── */

export function openQuotes() { return quotes({ status: 'sent' }); }

export function pipelineValue() {
  return round2(openQuotes().reduce((t, q) => t + quoteTotals(q).total, 0));
}

export function recentQuotes(limit = 5) {
  return state.quotes.filter((x) => !x.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}


/* ── The sync surface ──────────────────────────────────────────
   Everything js/quotesync.js needs and nothing more. Quotations keep
   their own store and their own outbox rather than joining the
   ledger's, because they are a different kind of thing on a different
   rhythm — a quotation is edited for days before it means anything,
   an entry is written once and is true.

   The identity sent to the server is the app's own: a quotation by
   its id, a design by its code. */

export const SYNC_KINDS = [
  { kind: 'quote', arr: 'quotes', key: 'id' },
  { kind: 'design', arr: 'designs', key: 'code' },
];

/** Every record, tombstones included, as the server wants them. */
export function syncRecords() {
  const out = [];
  for (const { kind, arr, key } of SYNC_KINDS) {
    for (const rec of state[arr] || []) {
      const id = rec[key];
      if (id == null || id === '') continue;
      out.push({
        kind,
        id: String(id),
        data: rec,
        updatedAt: rec.updatedAt || rec.createdAt || Date.now(),
        deletedAt: rec.deletedAt || null,
      });
    }
  }
  return out;
}

/**
 * Rows the server sent, folded in by last-write-wins per record.
 * Returns how many actually moved, so a sync that found nothing does
 * not repaint the screen someone is reading.
 */
export function applyRemote(rows) {
  let changed = 0;

  for (const row of rows || []) {
    const spec = SYNC_KINDS.find((k) => k.kind === row.kind);
    if (!spec) continue;                       // a kind this build does not know

    const list = state[spec.arr];
    const at = Date.parse(row.updated_at) || 0;
    const i = list.findIndex((r) => String(r[spec.key]) === String(row.id));
    const mine = i >= 0 ? list[i] : null;
    const mineAt = mine ? (mine.updatedAt || mine.createdAt || 0) : -1;

    // The server's copy only wins if it is genuinely newer. A tie goes
    // to the device, which is what stops a pull from undoing an edit
    // made in the same second it arrived.
    if (mine && mineAt >= at) continue;

    const next = { ...(row.data || {}), updatedAt: at };
    if (row.deleted_at) next.deletedAt = Date.parse(row.deleted_at) || at;
    else delete next.deletedAt;
    next[spec.key] = row.id;

    if (mine) list[i] = next;
    else list.push(next);
    changed += 1;
  }

  if (changed) { write(); emit(); }
  return changed;
}

/** Shared settings for the module — the boilerplate every quotation
    prints. The logo is included: it belongs to the business, not to
    the device that happened to upload it. */
export const SHARED_QUOTE_SETTINGS = [
  'mrPrefix', 'gstRate', 'defaultCity', 'fabricRate', 'leadTime',
  'paymentTerms', 'terms', 'note', 'company', 'bank', 'logo',
];

export function sharedSettings() {
  const out = {};
  for (const k of SHARED_QUOTE_SETTINGS) out[k] = state.settings[k];
  return out;
}


/* ── Whose books are these ─────────────────────────────────────
   Signing out and signing in as a different org must not carry the
   previous org's quotations across. Local data with no org yet is
   claimed by the first one that signs in — that is the ordinary case
   of a device that was working offline. Local data belonging to a
   different org is cleared, because it is not this org's to hold and
   certainly not this org's to be sent.

   Returns true when it had to clear, so the caller can reset its
   cursor and pull the new org's books from the beginning. */
export function claimFor(orgId) {
  const want = String(orgId || '');
  if (!want) return false;

  if (!state.orgId) {
    state.orgId = want;
    write();
    return false;
  }
  if (state.orgId === want) return false;

  state.quotes = [];
  state.designs = [];
  state.orgId = want;
  write(); emit();
  return true;
}

export function ownerOrg() { return state.orgId; }
