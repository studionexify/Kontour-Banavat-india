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
import { lines as orderLines, addLine as addOrderLine } from './orders.js';
import { todayISO, round2, fyStartYear } from './format.js';
import { DEFAULT_LOGO } from './default-logo.js';

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

/* The name a quotation goes by everywhere it is listed: the number
   that identifies the document, and the client it was written for.
   The base document reads "C101 Rahi Construction" — no separator
   between the number and the name, the way the business already
   says it out loud. A revision's own suffix gets its dash back
   *before* the client, so the number that changed stays legible:
   "C101 - 1 Rahi Construction" is revision 1 of that same job. */
export function quoteName(q) {
  if (!q) return '';
  const client = (q.client && q.client.name || '').trim() || 'Unnamed client';
  const mrNo = String(q.mrNo || '');
  const dash = mrNo.indexOf('-');
  if (dash === -1) return `${mrNo} ${client}`;
  return `${mrNo.slice(0, dash)} - ${mrNo.slice(dash + 1)} ${client}`;
}

/* Two ways of printing the same tax. "Total" foots the whole
   quotation once, the way a builder normally quotes. "Line item"
   carries the rate down onto every row instead, for the client who
   is comparing pieces and wants to see what each one costs including
   tax before the figures are added up. Neither one changes what is
   owed — quoteTotals() is the same call either way. */
/* ── The quality check ─────────────────────────────────────────
   The starting lists, taken from what these pieces actually get
   sent back for. They are only defaults: Settings → The floor
   writes over them, and Restore puts these back. */

export const DEFAULT_QC_CHECKS = [
  'Finish & polish',
  'Dimensions as per drawing',
  'Joinery & structure',
  'Hardware & fittings',
  'Upholstery & fabric',
  'Moving parts & mechanism',
  'Glass, mirror & stone',
  'Cleaned',
  'Packed & corners protected',
];

/* Why a piece went back. One reason, chosen — not typed — so the
   same fault reads the same way every time it happens. */
export const DEFAULT_QC_REASONS = [
  'Finish not acceptable',
  'Wrong dimensions',
  'Poor joinery or weak structure',
  'Hardware faulty or missing',
  'Wrong material, fabric or colour',
  'Damaged in handling',
  'Incomplete — work still to do',
  'Something else',
];

/* An emptied list would leave QC with no way to record anything, so
   an empty one reads as "not set" and the default stands. Deleting
   every line and saving is how you ask for the defaults back. */
function listOr(saved, fallback) {
  const list = Array.isArray(saved) ? saved.map((x) => String(x).trim()).filter(Boolean) : [];
  return list.length ? list : [...fallback];
}

export function qcChecks() { return listOr(state.settings.qcChecks, DEFAULT_QC_CHECKS); }
export function qcReasons() { return listOr(state.settings.qcReasons, DEFAULT_QC_REASONS); }

export const GST_MODES = {
  total:    { label: 'Total',     hint: 'One GST line under the sub-total' },
  lineitem: { label: 'Line item', hint: 'GST shown against every item' },
};

/** What one line owes in GST, on its own — only meaningful once the
    quotation is taxed at all. */
export function lineGst(line, quote) {
  if (!quote || quote.gstApplicable === false) return 0;
  return round2(lineAmount(line) * (Number(quote.gstRate) || 0) / 100);
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
      // The number side of leadTime — a builder types "15" and the
      // document prints the same 5-day range every quotation has used.
      // leadTime itself stays the source of truth for printing (it
      // survives a quote where the days were typed over by hand), this
      // is only what a new quotation starts from.
      leadTimeDays: 15,
      paymentTerms: PAYMENT_TERMS,
      terms: TERMS,
      note: NOTE,
      company: { ...COMPANY },
      // The Banavat mark, as an uploaded image. Held here rather than
      // shipped as a repo asset so it travels in a backup, works with
      // no network, and can be changed without a deploy. Everything
      // that shows the brand — the document, the rail, the lock
      // screen — reads this one value. Defaults to the Banavat India
      // logo so it appears out of the box; uploading a different logo
      // in Settings overrides this default.
      logo: DEFAULT_LOGO,
      bank: { ...BANK },
      // What QC looks at, and what a piece can be sent back for. Held
      // in the shared settings rather than in the screen so the same
      // words are used on every device and every round can be read
      // back as data. Editable in Settings → The floor; see
      // DEFAULT_QC_CHECKS.
      qcChecks: [...DEFAULT_QC_CHECKS],
      qcReasons: [...DEFAULT_QC_REASONS],
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

    /* Quotations decided before the archive existed have no stamp, so
       they would sit in the working list forever. Backdating to the
       last edit puts them where they belong without inventing a date:
       the decision is when the record last moved. Deliberately not
       written back here — read() is also how a sync-pulled state is
       normalised, and a save on every read would touch every record.

       A quotation pulled back out of the archive stores a 0 rather
       than losing the field, so this only ever fires on records
       written before the archive existed — never on a restore. */
    for (const q of out.quotes) {
      if (q.archivedAt === undefined && (q.status === 'accepted' || q.status === 'declined')) {
        q.archivedAt = q.updatedAt || q.createdAt || Date.now();
      }
      // Records written before these existed get the values addQuote
      // would have given them, so every caller can read them without
      // an `|| default` at every use.
      if (!GST_MODES[q.gstMode]) q.gstMode = 'total';
      if (q.approvedTotal === undefined) q.approvedTotal = null;
      if (q.jobExcludesGst === undefined) q.jobExcludesGst = false;
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

/* A handful of quotations came in through importHistory() before the
   clash-suffix moved off "#" onto "(2)" — see addLine's own note by
   the generator. Rewriting mrNo alone, without a fresh updatedAt,
   would never leave this device: quotesync's push() only sends a
   record whose updatedAt has actually moved, so a silent field edit
   here would fix the number locally and nowhere else. Runs once per
   boot; a no-op once no live quote still carries the old mark. */
export function fixHashtagNumbers() {
  let changed = 0;
  for (const q of state.quotes) {
    if (!q.mrNo || !q.mrNo.includes('#')) continue;
    q.mrNo = q.mrNo.replace(/#(\d+)/, ' ($1)');
    q.updatedAt = Date.now();
    changed++;
  }
  if (changed) { write(); emit(); }
  return { changed };
}

/* One-time import: photos scanned out of the original PDF quotations
   (data/imported-photos.json, built from the client's shared Drive
   folder) get attached to the matching live line item by row position.
   Only fills a blank photo, so a photo re-shot or replaced by hand is
   never clobbered on a later boot. Fire-and-forget from app start —
   the fetch is lazy so a client with nothing left to fill pays only a
   304, and write()/emit() happen the same way any other edit does so
   the update reaches quotesync's outbox. */
export async function attachImportedPhotos() {
  let byMrNo;
  try {
    const res = await fetch('/data/imported-photos.json');
    if (!res.ok) return { changed: 0 };
    byMrNo = await res.json();
  } catch (e) {
    return { changed: 0 };
  }

  let changed = 0;
  for (const q of state.quotes) {
    const entries = byMrNo[baseNo(q.mrNo)];
    if (!entries || !entries.length) continue;
    let entry = entries[0];
    if (entries.length > 1) {
      const client = ((q.client && q.client.name) || '').trim().toLowerCase();
      entry = entries.find((e) => e.hint && client.includes(e.hint.toLowerCase()))
        || entries.find((e) => e.hint && e.hint.toLowerCase().includes(client))
        || entry;
    }
    let touched = false;
    (q.lines || []).forEach((line, i) => {
      if (line.photo) return;
      const photo = entry.rows[String(i + 1)];
      if (!photo) return;
      line.photo = photo;
      touched = true;
    });
    if (touched) { q.updatedAt = Date.now(); changed++; }
  }
  if (changed) { write(); emit(); }
  return { changed };
}

export function raw() { return state; }
export function settings() { return state.settings; }

export function updateSettings(changes) {
  state.settings = { ...state.settings, ...changes };
  write(); emit();
  return state.settings;
}

/** "15" -> "15–20 business days" — the range every quotation on file
    actually uses, a fixed 5 days on from whatever number was typed. */
export function leadTimeRangeText(days, span = 5) {
  const n = Number(days);
  if (!n) return '';
  return `${n}–${n + span} business days`;
}

/* What this quotation fills into its standing terms. */
function termFills(quote) {
  const s = state.settings;
  const rate = Number(quote && quote.fabricRate != null ? quote.fabricRate : s.fabricRate) || 0;
  const lead = (quote && quote.leadTime) || s.leadTime || '';
  return [
    ['{{fabricRate}}', `₹${rate.toLocaleString('en-IN')}`],
    ['{{leadTime}}', lead],
  ];
}

/* Fills {{fabricRate}} and {{leadTime}} in the standing terms from
   whatever this particular quotation says. */
export function renderTerms(quote) {
  let out = String(state.settings.terms || '');
  for (const [token, value] of termFills(quote)) out = out.split(token).join(value);
  return out;
}

/**
 * The same terms, but as the document sets them: one array of
 * `{ text, bold }` pieces per clause, with the values this quotation
 * filled in marked bold. The lead time is the reason — it is the one
 * number a client comes back to, and every issued quotation has set
 * it in bold inside its sentence.
 */
export function termRuns(quote) {
  const fills = termFills(quote);
  return String(state.settings.terms || '')
    .split('\n').map((c) => c.trim()).filter(Boolean)
    .map((clause) => {
      let runs = [{ text: clause, bold: false }];
      for (const [token, value] of fills) {
        runs = runs.flatMap((run) => {
          if (run.bold || !run.text.includes(token)) return [run];
          const out = [];
          run.text.split(token).forEach((part, i) => {
            if (i) out.push({ text: value, bold: true });
            if (part) out.push({ text: part, bold: false });
          });
          return out;
        });
      }
      return runs.filter((r) => r.text);
    });
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

/* ── Client history ────────────────────────────────────────────
   Not a separate list to keep in step — every quotation already
   carries a full client, so the address book is just the newest
   entry for each name, read out of the quotations themselves. */

export function clientBook() {
  const seen = new Map();
  for (const q of state.quotes) {
    if (q.deletedAt) continue;
    const name = ((q.client || {}).name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const at = q.updatedAt || q.createdAt || 0;
    const prev = seen.get(key);
    if (!prev || at > prev.at) {
      seen.set(key, {
        name, phone: q.client.phone || '', shippingAddress: q.client.shippingAddress || '', at,
      });
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.at - a.at);
}

export function findClient(name) {
  const q = (name || '').trim().toLowerCase();
  if (!q) return null;
  return clientBook().find((c) => c.name.toLowerCase() === q) || null;
}

/** Up to 8 names starting with, or containing, what's been typed. */
export function clientSuggestions(query) {
  const q = (query || '').trim().toLowerCase();
  const book = clientBook();
  if (!q) return book.slice(0, 8);
  const starts = [];
  const contains = [];
  for (const c of book) {
    const name = c.name.toLowerCase();
    if (name === q) continue;
    if (name.startsWith(q)) starts.push(c);
    else if (name.includes(q)) contains.push(c);
  }
  return [...starts, ...contains].slice(0, 8);
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
export function quoteFamilies({ status = null, q = '', archived = false } = {}) {
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
    // A job is filed away when its live revision is — the earlier
    // rounds fold under it either way, so they do not get a say.
    if (archived !== null && isArchived(head) !== Boolean(archived)) continue;
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
   discounted, then taxed, and shipping is added after tax — the two
   subtotals are summed. Shipping is deliberately outside the GST
   base — that is how these quotations have always been written.
   A discount comes off before GST, because GST is owed on what the
   client actually pays: it is a flag alongside an amount, the same
   shape as gstApplicable, so "no discount" and "a ₹0 discount" are
   not the same document. */
export function quoteTotals(quote) {
  if (!quote) return { sub: 0, discount: 0, afterDiscount: 0, gst: 0, subA: 0, subB: 0, total: 0, taxed: false };
  const sub = round2((quote.lines || []).reduce((t, l) => t + lineAmount(l), 0));
  const discount = quote.discountEnabled ? round2(Number(quote.discountAmount) || 0) : 0;
  const afterDiscount = round2(sub - discount);
  const taxed = quote.gstApplicable !== false;
  const gst = taxed ? round2(afterDiscount * (Number(quote.gstRate) || 0) / 100) : 0;
  const subA = round2(afterDiscount + gst);
  const subB = round2((quote.shipping || []).reduce((t, s) => t + (Number(s.amount) || 0), 0));
  return { sub, discount, afterDiscount, gst, subA, subB, total: round2(subA + subB), taxed };
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
    // How the same tax is printed — see GST_MODES. Purely a document
    // choice; it never changes what quoteTotals() comes to.
    gstMode: GST_MODES[input.gstMode] ? input.gstMode : 'total',
    paymentTerms: input.paymentTerms == null ? s.paymentTerms : input.paymentTerms,
    fabricRate: input.fabricRate == null ? s.fabricRate : Number(input.fabricRate),
    leadTime: input.leadTime == null ? s.leadTime : input.leadTime,
    leadTimeDays: input.leadTimeDays == null ? s.leadTimeDays : Number(input.leadTimeDays),
    // A flat amount off the goods total, before GST — see quoteTotals().
    discountEnabled: Boolean(input.discountEnabled),
    discountAmount: Number(input.discountAmount) || 0,
    notes: input.notes || '',
    status: 'draft',
    jobCode: '',
    // Set only by acceptQuote, when the figure sent to Phynance is not
    // simply this document's own total — see acceptQuote's own note.
    approvedTotal: null,
    jobExcludesGst: false,
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
    gstMode: old.gstMode,
    paymentTerms: old.paymentTerms,
    fabricRate: old.fabricRate,
    leadTime: old.leadTime,
    leadTimeDays: old.leadTimeDays,
    discountEnabled: old.discountEnabled,
    discountAmount: old.discountAmount,
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
   the quotation has been named after all along.

   The figure that job opens with is not always this document's own
   total, in three ways staff actually approve a quotation:

     - as quoted — the job takes quoteTotals(q).total, same as before.
     - at a different figure — a client negotiates the number down
       (or up) from what was quoted. That agreed figure is not this
       document any more, so a sub-quotation is written under the
       next revision number carrying it, and *that* is what gets
       accepted and opened — the original stays exactly what was
       sent, superseded rather than silently rewritten.
     - excluding GST — some jobs are booked on the pre-tax figure,
       with the tax collected and accounted separately. The document
       is unchanged; only what Phynance is told to expect is smaller,
       and the quotation carries a flag so that is visible wherever
       it is shown, not just in the job. */

/** What the job should be opened at, given how this quote was approved. */
export function jobValueFor(quote) {
  const t = quoteTotals(quote);
  if (quote.approvedTotal != null) return quote.approvedTotal;
  return quote.jobExcludesGst ? t.sub : t.total;
}

/* ── Accepting opens the floor's copy ──────────────────────────
   A quotation is a promise; an order line is the thing being made.
   Until now the two were only joined by a number, and every accepted
   quotation had to be re-typed piece by piece on the production
   screen. It doesn't any more: approving writes one production line
   item per quoted piece, under the job's own MR number.

   Shipping rows are not pieces and never come across. Nothing is
   ever written twice — a line already carrying this quotation line's
   id is left exactly as the floor has since edited it — so accepting
   a second time, or accepting a revision of a job already running,
   adds only what is genuinely new.

   `qty` is deliberately kept as one line with a quantity rather than
   split into four identical pieces: the floor tracks a set of four
   dining chairs as one commissioning, one delivery, one check. */
export function materialiseQuote(quote, { deliveryDate = '' } = {}) {
  if (!quote) return [];
  const mrNo = baseNo(quote.mrNo);
  if (!mrNo) return [];
  const existing = orderLines().filter((l) => l.mrNo === mrNo);
  const made = [];

  for (const line of quote.lines || []) {
    if (line.kind === 'lump' && !line.name) continue;
    const already = existing.some((l) => l.quoteLineId && l.quoteLineId === line.id);
    if (already) continue;
    made.push(addOrderLine({
      mrNo,
      client: (quote.client && quote.client.name) || '',
      orderReceived: todayISO(),
      deliveryDate,
      name: line.name || 'Untitled piece',
      specs: [line.description, line.finish && `Finish: ${line.finish}`]
        .filter(Boolean).join(' '),
      dims: line.dims || '',
      qty: line.kind === 'lump' ? 1 : (Number(line.qty) || 1),
      image: line.photo || '',
      stage: 'pending',
      quoteId: quote.id,
      quoteLineId: line.id,
    }));
  }
  return made;
}

export function acceptQuote(id, { jobCode = '', approvedTotal = null, excludeGst = false, deliveryDate = '', toProduction = true } = {}) {
  let q = getQuote(id);
  if (!q) return null;
  const t = quoteTotals(q);

  // A figure that is not (within rounding of) the document's own
  // total is a different quotation, not an edit to this one.
  const differs = approvedTotal != null && Math.abs(approvedTotal - t.total) > 0.5;
  if (differs) {
    q = addQuote({
      ...q,
      revisionOf: q.mrNo,
      mrNo: '',
      lines: (q.lines || []).map((l) => ({ ...l, id: uid('l') })),
      shipping: (q.shipping || []).map((s) => ({ ...s, id: uid('s') })),
      status: 'draft',
    });
  }

  // The revision suffix belongs to the quotation, not the job — all
  // three rounds of C129 are quoting the same job, so the ledger must
  // not end up with C129, C129-1 and C129-2 as separate jobs.
  const code = (jobCode || q.jobCode || baseNo(q.mrNo) || '').trim().toUpperCase();
  q.approvedTotal = differs ? approvedTotal : null;
  q.jobExcludesGst = Boolean(excludeGst);
  if (code) {
    ensureJob(code, { silent: true, title: q.title, client: q.client.name });
    updateJob(code, { orderValue: jobValueFor(q), orderExcludesGst: q.jobExcludesGst });
    q.jobCode = code;
  }
  q.status = 'accepted';
  // The floor's copy of the work, made before the record is written
  // so that an accepted quotation is never sitting there approved
  // with nothing to make.
  if (toProduction) materialiseQuote(q, { deliveryDate });
  // Agreed work is tracked as a job from here on, so the quotation
  // files itself away rather than sitting in the working list.
  q.archivedAt = Date.now();
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
  // Declining is the end of the conversation, so it files itself away
  // for the same reason accepting does — the working list is what is
  // still in play, and neither of these is.
  if (status === 'declined') return updateQuote(id, { status, archivedAt: Date.now() });
  return updateQuote(id, { status });
}

/* ── Archive ──────────────────────────────────────────────────
   Decided quotations leave the working list without leaving the
   books. Nothing here changes a status: an accepted quotation that
   is un-archived is still accepted, and the job it opened is
   untouched either way. */

export function archiveQuote(id) {
  return updateQuote(id, { archivedAt: Date.now() });
}

export function unarchiveQuote(id) {
  return updateQuote(id, { archivedAt: 0 });
}

export function isArchived(quote) {
  return Boolean(quote && quote.archivedAt);
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
    String(q.mrNo || '').toUpperCase().replace(/\s*\(\d+\)$/, ''),
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
      while (numbers.has(`${mrNo} (${n})`)) n += 1;
      useNo = `${mrNo} (${n})`;
    }

    // Everything in the sheet went out to a client; what came back of
    // it usually is not recorded there, so a row arrives awaiting a
    // reply by default. A caller that cross-referenced its own record
    // of what was actually ordered — a production sheet, a payments
    // ledger — can say otherwise: status/jobCode/archivedAt carry that
    // decision across exactly the way accepting a quotation by hand
    // would leave it, without this file needing to know where the
    // caller's evidence came from.
    const status = ['draft', 'sent', 'accepted', 'declined', 'superseded'].includes(row.status)
      ? row.status : 'sent';
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
      gstMode: GST_MODES[row.gstMode] ? row.gstMode : 'total',
      paymentTerms: row.paymentTerms || state.settings.paymentTerms,
      fabricRate: state.settings.fabricRate,
      leadTime: state.settings.leadTime,
      notes: '',
      status,
      jobCode: status === 'accepted' ? (row.jobCode || baseNo(useNo)).toUpperCase() : (row.jobCode || ''),
      approvedTotal: row.approvedTotal == null ? null : Number(row.approvedTotal),
      jobExcludesGst: Boolean(row.jobExcludesGst),
      imported: true,
      numberClash: Boolean(row.numberClash) && useNo !== mrNo,
      // A row the caller has already marked decided is filed away like
      // any other decided quotation, so it does not sit in the working
      // list next to the ones genuinely still awaiting a reply.
      archivedAt: (status === 'accepted' || status === 'declined') ? Date.now() : 0,
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

/* The three figures the Quotations topbar and the Dashboard both
   want: confirmed jobs still in hand, what they are worth, and how
   many are still waiting on a client's word. One pass over every
   family, live or archived, since an accepted job is archived the
   moment it is decided. */
export function quotationStats() {
  const families = quoteFamilies({ archived: null });
  let activeCount = 0, activeValue = 0, openCount = 0;
  for (const { head } of families) {
    if (head.status === 'accepted') {
      activeCount++;
      activeValue += jobValueFor(head);
    } else if (head.status === 'draft' || head.status === 'sent') {
      openCount++;
    }
  }
  return { activeCount, activeValue: round2(activeValue), openCount };
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
  'mrPrefix', 'gstRate', 'defaultCity', 'fabricRate', 'leadTime', 'leadTimeDays',
  'paymentTerms', 'terms', 'note', 'company', 'bank', 'logo',
  'qcChecks', 'qcReasons',
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

/**
 * Points this device's copy at different books without clearing it.
 *
 * Only for the case where the rows really did change hands: two sets of
 * books merged into one, so what is on this device now belongs to the
 * org that absorbed the other. claimFor() would see a different id and
 * clear — right when the two are genuinely unrelated, wrong here, and
 * it would take any work that had not been pushed yet with it.
 */
export function reclaim(orgId) {
  const want = String(orgId || '');
  if (!want || state.orgId === want) return false;
  state.orgId = want;
  write();
  return true;
}


/** Everything this device holds, cleared along with its org claim.
    Used on sign-out: nothing is deleted on the books, and signing back
    in fetches them again from the beginning. */
export function wipe() {
  state = blank();
  write(); emit();
}
