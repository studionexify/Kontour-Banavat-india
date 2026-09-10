/* quotepdf.js — the quotation as a file you can hand to a client.
 *
 * This is a redraw of the document the business has always issued —
 * the one built by hand in a spreadsheet — down to its grid: Letter
 * paper, a 0.7in margin on all four sides, Montserrat throughout, and
 * eight columns that every table on the page snaps to. Boxed client
 * and date panels under the letterhead, a black-banded item table,
 * payment terms beside the sub-total ladder, shipping, then the three
 * grand-total cells, the bank and contact blocks, and the standing
 * terms. The note to the client always begins a fresh page, because
 * it always has.
 *
 * The grid is the whole trick. GRID holds the eight column edges as
 * fractions of the text width, measured off the issued document, and
 * every table is drawn between two of them — which is why the client
 * panel, the Dimensions column, the payment box and the Sub Total A
 * cell all line up down the page.
 *
 * The figures come from quoteTotals, the same call the on-screen
 * document and the totals bar use, so the three can never disagree.
 *
 * Sharing goes through the Web Share API where the device has it —
 * which on a phone is the WhatsApp sheet, the thing this is actually
 * for. Everywhere else it falls back to a download, and the caller is
 * told which happened so it can say so.
 */

import { createPdf, dataUriToBytes, readJpeg, LETTER } from './pdf.js';
import MONTSERRAT_REGULAR from './fonts/montserrat-regular.js';
import MONTSERRAT_BOLD from './fonts/montserrat-bold.js';
import { quoteTotals, lineAmount, lineGst, jobValueFor, settings, termRuns } from './quotes.js';
import { docMark } from './brand.js';
import { dmyLong, inrWhole as money } from './format.js';

/* ── The page ───────────────────────────────────────────────── */

const PAGE = LETTER;
const M = 50.4;                     // 0.7in, and the same on all four sides
const RIGHT = PAGE.w - M;
const BODY = RIGHT - M;
const TOP = 54;
const FOOT = PAGE.h - M;            // where a page has to break

/* The eight columns, as fractions of the text width. Every rule and
   every cell edge on the page is one of these, which is what keeps
   the panels, the item columns and the totals in one grid. */
const GRID = [0, 0.067795, 0.167796, 0.297115, 0.515856, 0.665385, 0.763059, 0.878356, 1]
  .map((f) => M + f * BODY);

// Named for what sits in them, so the drawing code reads as the table.
const SR = 0, IMG = 1, NAME = 2, DESC = 3, DIM = 4, RATE = 5, QTY = 6, TOTAL = 7, END = 8;

const x = (col) => GRID[col];
const span = (a, b) => GRID[b] - GRID[a];

/* ── Type ───────────────────────────────────────────────────────
   Montserrat's own ascender and descender, so a line of text can be
   placed by its top edge — which is how a cell centres its contents
   — rather than by a baseline nobody can see. */
const SIZE = 6.4;                   // the document's body size
const TITLE = 23;
const GRAND_LABEL = 7.7;
const GRAND_TOTAL = 9;
const ASCENT = 0.968;
const LINE = 1.219;

const lineH = (size = SIZE) => size * LINE;
const baseline = (top, size = SIZE) => top + size * ASCENT;
/** The top edge that centres a block of `h` inside a row of `rowH`. */
const centred = (top, rowH, h) => top + (rowH - h) / 2;

const PAD = 1.8;                    // the gap between a cell's rule and its text

/* ── Ink ────────────────────────────────────────────────────────
   Four greys, each with a job: the letterhead rule and the payment
   box; the hairlines round the client panel and the shipping rows;
   the heavier edge on the totals; and the band behind a shaded row. */
const RULE = 0.263;
const HAIR = 0.718;
const EDGE = 0.4;
const BAND = 0.937;

const HAIRLINE = 0.5;
const EDGELINE = 1;

/* ── Rows ───────────────────────────────────────────────────── */

const PANEL_ROW = 10.33;            // one row of the client and date panels
const HEAD_ROW = 10.82;             // the black band over the items
const ITEM_MIN = 80.7;              // an item row is never shorter than this
const ITEM_PAD = 8;
const SHIP_HEAD = 11.32;
const SHIP_ROW = 13.53;
const GRAND_HEAD = 12.3;
const GRAND_ROW = 25.09;

/* Money is inrWhole from format.js, imported as money above — the
   one the preview uses too, so the two documents can never print
   different figures. ₹ is in the embedded subset, so it prints as
   itself rather than being spelled "Rs." the way the work order,
   set in Helvetica, still has to. */

/* ── Photographs ────────────────────────────────────────────────
   Item photographs are captured through photos.js, which already
   shrinks everything to a JPEG — so the common path is simply reading
   the bytes out of the data URI and handing them to the writer
   untouched. Anything else, or anything far larger than the slot it
   will occupy, goes through a canvas first: a 3000px photograph in a
   51pt box is several megabytes nobody can WhatsApp.

   THUMB_PX is the longest edge kept, generous against the ~51pt slot
   so the image still holds up if the PDF is printed or zoomed. */
const THUMB_PX = 220;
/* The mark prints in a 44pt square, so 400px is around 650dpi — and
   it is also exactly what js/doc-mark.js ships, which means the
   ordinary document places it without touching a canvas at all. */
const LOGO_PX = 200;

function reencode(uri, maxPx = THUMB_PX) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        // JPEG has no transparency; without this a PNG's clear pixels
        // come out black rather than as the paper behind them.
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(readJpeg(dataUriToBytes(canvas.toDataURL('image/jpeg', 0.72))));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = uri;
  });
}

/* Sorted into what can be placed as it stands and what has to go
   through the browser first. The split matters beyond tidiness:
   navigator.share() only works while the tap that called it is still
   the current activation, and Safari drops that across an await. So
   when nothing needs re-encoding — which is the ordinary case, since
   photos.js already writes small JPEGs — sharing builds the whole
   file synchronously and stays inside the gesture. */
function collectPhotos(lines) {
  const ready = new Map();
  const needs = [];
  for (const l of lines) {
    if (!l.photo) continue;
    const direct = readJpeg(dataUriToBytes(l.photo));
    if (direct && Math.max(direct.w, direct.h) <= THUMB_PX * 2) ready.set(l.id, direct);
    else needs.push(l);
  }
  return { ready, needs };
}

/** Every line's photograph, ready to place, keyed by line id. */
async function prepareImages(lines) {
  const { ready, needs } = collectPhotos(lines);
  for (const l of needs) {
    // A photograph that cannot be read is not worth failing the whole
    // document over — the line simply prints without one.
    const img = await reencode(l.photo);
    if (img) ready.set(l.id, img);
  }
  return ready;
}

/** The letterhead mark, if it is already a JPEG small enough to place
    directly — which the shipped one is, so the ordinary document
    costs no await here. */
function readLogoDirect() {
  const uri = docMark();
  if (!uri) return null;
  const direct = readJpeg(dataUriToBytes(uri));
  return (direct && Math.max(direct.w, direct.h) <= LOGO_PX * 2) ? direct : null;
}

/** The letterhead mark, ready to place — re-encoded through a canvas
    when it is not already a small JPEG, since an uploaded logo can in
    principle be any format a browser can decode. */
async function prepareLogo() {
  if (!docMark()) return null;
  return readLogoDirect() || reencode(docMark(), LOGO_PX);
}

/** What the client's copy is called. Named the way these have always
    been named: "Quotation - C142 VS Studio.pdf". */
export function quoteFileName(q) {
  const client = String((q.client && q.client.name) || '')
    .replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `Quotation - ${q.mrNo}${client ? ` ${client}` : ''}.pdf`;
}

/** The whole quotation as a PDF blob. Async only because a photograph
    that needs re-encoding has to be decoded by the browser first. */
export async function quotePdfBlob(quote) {
  const [photos, logo] = await Promise.all([
    prepareImages(quote.lines || []),
    prepareLogo(),
  ]);
  return render(quote, photos, logo);
}

/** The document itself, drawn from a quote and its prepared photos. */
function render(quote, photos, logo = null) {
  const s = settings();
  const t = quoteTotals(quote);
  const lines = quote.lines || [];
  const ship = (quote.shipping || []).filter((sx) => Number(sx.amount) > 0 || sx.label);
  const doc = createPdf({ size: PAGE, fonts: { regular: MONTSERRAT_REGULAR, bold: MONTSERRAT_BOLD } });
  let y = TOP;

  /* ── Drawing, in the terms the document is described in ────── */

  const turnPage = () => { doc.addPage(); y = TOP; };
  /* Turns the page for something that will not fit on what is left
     of this one — unless this one is already empty, in which case
     nothing taller than a page ever would fit and a blank sheet in
     front of it helps nobody. */
  const needRoom = (need) => {
    if (y + need <= FOOT || y <= TOP) return false;
    turnPage();
    return true;
  };

  /** A line of text placed inside a column, by the column's rules. */
  const cell = (str, a, b, top, { align = 'left', bold = false, size = SIZE, gray = 0 } = {}) => {
    if (str == null || str === '') return;
    if (align === 'center') {
      doc.text(str, x(a), baseline(top, size), { size, bold, gray, align: 'center', width: span(a, b) });
    } else if (align === 'right') {
      doc.text(str, x(b) - PAD, baseline(top, size), { size, bold, gray, align: 'right' });
    } else {
      doc.text(str, x(a) + PAD, baseline(top, size), { size, bold, gray });
    }
  };

  const hline = (a, b, at, gray, weight) => doc.line(x(a), at, x(b), at, { gray, weight });
  const vline = (col, top, bottom, gray, weight) => doc.line(x(col), top, x(col), bottom, { gray, weight });

  /** The rules of a table: every row edge across, every column edge down. */
  const gridOf = (cols, rows, gray, weight) => {
    for (const at of rows) hline(cols[0], cols[cols.length - 1], at, gray, weight);
    for (const col of cols) vline(col, rows[0], rows[rows.length - 1], gray, weight);
  };

  /* ── Letterhead ──
     QUOTATION set large on the left, the mark square on the right,
     and a heavy rule under both. */
  if (logo) doc.image(logo, RIGHT - 44.3, y, 44.3, 44.3);
  doc.text('QUOTATION', M + PAD, baseline(y + 1, TITLE), { size: TITLE, bold: true });
  y += 45;
  doc.line(M, y, RIGHT, y, { gray: RULE, weight: 1.5 });
  y += PANEL_ROW;

  /* ── Who it is for, and when ──
     Two boxed panels on one row: the client on the left across four
     columns, the dates on the right across the last three. */
  const who = [
    ['Client Name:', quote.client?.name || '-'],
    ['Contact Number:', quote.client?.phone || '-'],
    ...(quote.client?.email ? [['Email:', quote.client.email]] : []),
  ];
  const when = [
    ['Quoted Date:', quote.date ? dmyLong(quote.date) : '-'],
    ['MR #:', quote.mrNo],
    ['Valid till:', quote.validUntil ? dmyLong(quote.validUntil) : '-'],
  ];

  // The address is the one field that runs long, so its cell is three
  // rows deep whatever it holds and grows past that if it has to.
  const addressLines = doc.wrap(quote.client?.shippingAddress || '-', span(NAME, DIM) - PAD * 2, SIZE);
  const addressH = Math.max(PANEL_ROW * 3, 2.53 + addressLines.length * lineH());

  const panelTop = y;
  let row = panelTop;
  for (const [label, value] of who) {
    cell(label, SR, NAME, centred(row, PANEL_ROW, lineH()), { bold: true });
    cell(value, NAME, DIM, centred(row, PANEL_ROW, lineH()));
    row += PANEL_ROW;
  }
  cell('Shipping Address:', SR, NAME, row + 1.35, { bold: true });
  addressLines.forEach((ln, i) => cell(ln, NAME, DIM, row + 1.35 + i * lineH()));
  const whoRows = [panelTop];
  for (let i = 0; i < who.length; i += 1) whoRows.push(panelTop + (i + 1) * PANEL_ROW);
  whoRows.push(row + addressH);
  gridOf([SR, NAME, DIM], whoRows, HAIR, HAIRLINE);

  when.forEach(([label, value], i) => {
    const top = centred(panelTop + i * PANEL_ROW, PANEL_ROW, lineH());
    cell(label, RATE, TOTAL, top, { bold: true, align: 'right' });
    cell(value, TOTAL, END, top, { align: 'right' });
  });
  gridOf([RATE, TOTAL, END], when.map((_, i) => panelTop + i * PANEL_ROW).concat(panelTop + when.length * PANEL_ROW),
    HAIR, HAIRLINE);

  y = Math.max(row + addressH, panelTop + when.length * PANEL_ROW);

  // A quotation approved at a different figure, or with GST kept out
  // of the job value, is worth saying on the document that goes out —
  // it is the record of what was actually agreed, not just what was
  // originally offered.
  if (quote.status === 'accepted' && (quote.approvedTotal != null || quote.jobExcludesGst)) {
    const note = quote.approvedTotal != null
      ? `Approved at ${money(jobValueFor(quote))} (quoted at ${money(t.total)})${quote.jobExcludesGst ? ', excluding GST' : ''}.`
      : 'Approved excluding GST.';
    y += 6;
    cell(note, SR, END, y, { bold: true });
    y += lineH();
  }

  y += 10.1;

  /* ── The items ──
     One black band of column titles and then the rows, with no rules
     between them: the photograph, the name and the description carry
     the eye down the page on their own. */
  const itemsHead = () => {
    doc.fill(M, y, BODY, HEAD_ROW, 0);
    const top = centred(y, HEAD_ROW, lineH());
    const white = { bold: true, gray: 1 };
    cell('Sr. No.', SR, IMG, top, white);
    cell('Image', IMG, NAME, top, { ...white, align: 'center' });
    cell('Name', NAME, DESC, top, white);
    cell('Description', DESC, DIM, top, white);
    cell('Dimensions', DIM, RATE, top, { ...white, align: 'center' });
    cell('Unit Price', RATE, QTY, top, { ...white, align: 'center' });
    cell('Quantity', QTY, TOTAL, top, { ...white, align: 'center' });
    cell('Total', TOTAL, END, top, { ...white, align: 'right' });
    y += HEAD_ROW;
  };
  itemsHead();

  if (!lines.length) {
    cell('No items on this quotation yet.', SR, END, y + ITEM_PAD, { gray: 0.45 });
    y += ITEM_PAD * 2 + lineH();
  }

  /* Per-line GST is a setting on the quotation, not a shape the
     printed document has ever had — so the tax still prints once, in
     the ladder, and the line only notes its own share under the
     amount. The figures are the same either way: quoteTotals does
     not branch on it. */
  const perLineGst = quote.gstMode === 'lineitem' && t.taxed;

  lines.forEach((l, i) => {
    const photo = photos.get(l.id);
    const nameLines = doc.wrap(l.name || 'Item', span(NAME, DESC) - PAD * 2, SIZE);
    const descLines = doc.wrap(
      [l.description || '', l.finish ? `- Finish: ${l.finish}` : ''].filter(Boolean).join('\n'),
      span(DESC, DIM) - PAD * 2, SIZE,
    );
    const dimLines = doc.wrap(l.dims || '', span(DIM, RATE) - PAD * 2, SIZE, true);
    // The photograph fits a square the width of its column, so every
    // one down the page reads at the same scale whatever shape it is.
    const slot = span(IMG, NAME);
    const photoH = photo ? photo.h * slot / Math.max(photo.w, photo.h) : 0;

    const tall = Math.max(
      photoH,
      nameLines.length * lineH(),
      descLines.length * lineH(),
      dimLines.length * lineH(),
    );
    const rowH = Math.max(ITEM_MIN, tall + ITEM_PAD * 2);

    if (needRoom(rowH)) itemsHead();

    if (photo) doc.image(photo, x(IMG), centred(y, rowH, photoH), slot, photoH);

    const one = centred(y, rowH, lineH());
    cell(String(i + 1), SR, IMG, one, { align: 'center' });
    nameLines.forEach((ln, n) => cell(ln, NAME, DESC, centred(y, rowH, nameLines.length * lineH()) + n * lineH()));
    descLines.forEach((ln, n) => cell(ln, DESC, DIM, centred(y, rowH, descLines.length * lineH()) + n * lineH()));
    dimLines.forEach((ln, n) => cell(ln, DIM, RATE, centred(y, rowH, dimLines.length * lineH()) + n * lineH(), { align: 'center', bold: true }));
    cell(money(l.unitPrice), RATE, QTY, one, { align: 'right' });
    cell(String(l.kind === 'lump' ? 1 : l.qty), QTY, TOTAL, one, { align: 'center' });
    cell(money(lineAmount(l)), TOTAL, END, one, { align: 'right' });
    if (perLineGst) {
      cell(`+ ${money(lineGst(l, quote))} GST`, TOTAL, END, one + lineH(), { align: 'right', gray: 0.45 });
    }

    y += rowH;
  });

  /* ── Payment terms, and the ladder beside them ──
     One row across the page: the terms boxed top and bottom on the
     left, the sub-totals on the right, both ending at the same rule. */
  const payClauses = String(quote.paymentTerms || '')
    .split('\n').map((c) => c.trim()).filter(Boolean)
    .flatMap((c) => hang(doc, c, span(SR, RATE) - PAD * 2));
  const ladder = [
    [t.discount ? 'Total' : 'Sub - Total', money(t.sub), false],
    ...(t.discount ? [
      ['Discount', `-${money(t.discount)}`, false],
      ['Sub-Total', money(t.afterDiscount), false],
    ] : []),
    ...(t.taxed ? [[`GST (${quote.gstRate}%)`, money(t.gst), false]] : []),
    ['Sub Total A', money(t.subA), true],
  ];

  const payH = payClauses.length ? 4.2 + (payClauses.length + 1) * lineH() + 4.9 : 0;
  const ladderH = ladder.length * HEAD_ROW;
  needRoom(Math.max(payH, ladderH));

  if (payClauses.length) {
    hline(SR, RATE, y, RULE, HAIRLINE);
    cell('Payment Terms', SR, RATE, y + 4.2, { bold: true });
    payClauses.forEach((piece, i) => {
      doc.runs(piece.runs, x(SR) + PAD + piece.indent, baseline(y + 4.2 + (i + 1) * lineH()), { size: SIZE });
    });
    hline(SR, RATE, y + payH, RULE, HAIRLINE);
  }

  ladder.forEach(([label, value, strong], i) => {
    const top = y + i * HEAD_ROW;
    if (strong) doc.fill(x(RATE), top, span(RATE, END), HEAD_ROW, BAND);
    const line = centred(top, HEAD_ROW, lineH());
    cell(label, RATE, TOTAL, line, { bold: strong });
    cell(value, TOTAL, END, line, { align: 'right', bold: strong });
  });
  gridOf([RATE, TOTAL, END], ladder.map((_, i) => y + i * HEAD_ROW).concat(y + ladderH), EDGE, EDGELINE);

  y += Math.max(payH, ladderH) + 20.2;

  /* ── Shipping ──
     Its own small table, because Sub Total B is quoted apart from the
     goods and is the one figure a client asks about twice. */
  const shipRows = ship.length ? ship : [{ label: '—', amount: 0 }];
  needRoom(SHIP_HEAD + SHIP_ROW);
  doc.fill(M, y, BODY, SHIP_HEAD, BAND);
  const shipHeadTop = centred(y, SHIP_HEAD, lineH());
  cell('Sr. No.', SR, IMG, shipHeadTop, { bold: true });
  cell('Shipping', IMG, RATE, shipHeadTop, { bold: true, align: 'center' });
  cell('Sub Total B', RATE, END, shipHeadTop, { bold: true, align: 'center' });
  gridOf([SR, IMG, RATE, END], [y, y + SHIP_HEAD], EDGE, EDGELINE);
  y += SHIP_HEAD;

  shipRows.forEach((sx, i) => {
    needRoom(SHIP_ROW);
    const top = centred(y, SHIP_ROW, lineH());
    cell(String(i + 1), SR, IMG, top, { align: 'center' });
    cell(sx.label || 'Shipping', IMG, RATE, top, { align: 'center' });
    cell(money(sx.amount), RATE, END, top, { align: 'center' });
    gridOf([SR, IMG, RATE, END], [y, y + SHIP_ROW], HAIR, HAIRLINE);
    y += SHIP_ROW;
  });

  y += 20.4;

  /* ── What it comes to ── */
  needRoom(GRAND_HEAD + GRAND_ROW);
  doc.fill(M, y, BODY, GRAND_HEAD, 0);
  const grandHeadTop = centred(y, GRAND_HEAD, lineH(GRAND_LABEL));
  cell('Sub Total A', SR, DESC, grandHeadTop, { bold: true, gray: 1, align: 'center', size: GRAND_LABEL });
  cell('Sub Total B', DESC, RATE, grandHeadTop, { bold: true, gray: 1, align: 'center', size: GRAND_LABEL });
  cell('Total', RATE, END, grandHeadTop, { bold: true, gray: 1, align: 'center', size: GRAND_LABEL });

  const grandBody = y + GRAND_HEAD;
  cell(money(t.subA), SR, DESC, centred(grandBody, GRAND_ROW, lineH()), { align: 'center' });
  cell(money(t.subB), DESC, RATE, centred(grandBody, GRAND_ROW, lineH()), { align: 'center' });
  cell(money(t.total), RATE, END, centred(grandBody, GRAND_ROW, lineH(GRAND_TOTAL)),
    { align: 'center', bold: true, size: GRAND_TOTAL });
  gridOf([SR, DESC, RATE, END], [y, grandBody, grandBody + GRAND_ROW], 0, EDGELINE);
  y = grandBody + GRAND_ROW + 53.1;

  /* ── Where to pay, and who to ask ── */
  const bank = [
    `Bank: ${s.bank.bank}`, `A/C Name: ${s.bank.name}`, `A/C Number: ${s.bank.account}`,
    `IFSC: ${s.bank.ifsc}`, `Branch: ${s.bank.branch}`,
  ].filter((v) => !/:\s*$/.test(v));
  /* No GSTIN and no company name here, because the issued document
     has neither: the client's copy carries where to write, where to
     mail and where to call, and the registration lives on the
     invoice that follows it. */
  const contact = [
    s.company.address ? `Address: ${s.company.address}` : '',
    s.company.email ? `Email: ${s.company.email}` : '',
    s.company.phone ? `Phone: ${s.company.phone}` : '',
    s.company.website ? `Website: ${s.company.website}` : '',
  ].filter(Boolean);

  const detailsH = (Math.max(bank.length, contact.length) + 2) * lineH();
  needRoom(detailsH);
  cell('Banking Details', SR, DIM, y, { bold: true });
  cell('Contact Details', RATE, END, y, { bold: true });
  bank.forEach((ln, i) => cell(ln, SR, DIM, y + (i + 2) * lineH()));
  contact.forEach((ln, i) => cell(ln, RATE, END, y + (i + 2) * lineH()));
  y += detailsH + 25.7;

  /* ── The standing terms ──
     Kept whole: a page that cannot hold all of them starts them
     overleaf rather than splitting the block in two. */
  const clauses = termRuns(quote).flatMap((runs) => hangRuns(doc, runs, span(SR, END) - PAD * 2));
  if (clauses.length) {
    const termsH = 10.4 + (clauses.length + 1) * lineH();
    if (termsH <= FOOT - TOP) needRoom(termsH);
    cell('Terms & Conditions', SR, END, y, { bold: true });
    y += 10.4;
    for (const piece of clauses) {
      needRoom(lineH());
      doc.runs(piece.runs, x(SR) + PAD + piece.indent, baseline(y), { size: SIZE });
      y += lineH();
    }
    y += lineH();
    cell('*Terms and conditions apply.', SR, END, y);
  }

  /* ── The note ──
     Always overleaf. It is the last thing the client reads, and it
     has never shared a page with the figures. */
  if (s.note) {
    turnPage();
    cell('Note Please', SR, END, y + 1.1, { bold: true });
    y += 1.1 + 10;
    for (const para of String(s.note).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
      const wrapped = doc.wrap(para, BODY - PAD * 2, SIZE);
      needRoom(wrapped.length * lineH());
      wrapped.forEach((ln, i) => cell(ln, SR, END, y + i * lineH()));
      y += (wrapped.length + 1) * lineH();
    }
  }

  return doc.blob();
}

/* Word wrap that keeps its weights. Runs are broken into words first,
   each remembering which run it came from, so a bold value that
   straddles a line break stays bold on both halves — and so the lead
   time can print bold inside a sentence that wraps around it. */
function wrapRuns(doc, runs, width, size = SIZE) {
  const words = [];
  let gap = false;
  for (const run of runs) {
    for (const part of String(run.text || '').split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { gap = true; continue; }
      words.push({ text: part, bold: Boolean(run.bold), gap });
      gap = false;
    }
  }

  const lines = [];
  let line = [];
  let used = 0;
  for (const word of words) {
    const lead = line.length && word.gap ? doc.width(' ', size, word.bold) : 0;
    const w = doc.width(word.text, size, word.bold);
    if (line.length && used + lead + w > width) {
      lines.push(line);
      line = [{ ...word, gap: false }];
      used = w;
    } else {
      line.push(line.length ? word : { ...word, gap: false });
      used += lead + w;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

/* A clause set as "- text", with anything that wraps aligned under
   the text rather than under the dash. Returns one entry per printed
   line: the weighted pieces on it, and the indent it hangs at. */
function hangRuns(doc, runs, width) {
  const dash = '- ';
  const indent = doc.width(dash, SIZE);
  const body = runs.map((r, i) => (i === 0
    ? { ...r, text: String(r.text || '').replace(/^[-–•]\s*/, '') }
    : r));
  return wrapRuns(doc, body, width - indent).map((line, i) => ({
    indent: i === 0 ? 0 : indent,
    runs: (i === 0 ? [{ text: dash, bold: false }] : [])
      .concat(line.map((w) => ({ text: (w.gap ? ' ' : '') + w.text, bold: w.bold }))),
  }));
}

/** The same, for a clause that is all one weight. */
function hang(doc, clause, width) {
  return hangRuns(doc, [{ text: clause, bold: false }], width);
}

/** The one-line message that rides along with a shared quotation. */
export function quoteShareText(quote) {
  const t = quoteTotals(quote);
  const who = quote.client?.name ? ` for ${quote.client.name}` : '';
  return `Quotation MR # ${quote.mrNo}${who} — ${money(t.total)}. ${settings().company.name || ''}`.trim();
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Downloads the quotation. Returns the file name so callers can say it. */
export async function downloadQuotePdf(quote) {
  const name = quoteFileName(quote);
  saveBlob(await quotePdfBlob(quote), name);
  return name;
}

/**
 * Opens the device's share sheet with the PDF attached.
 * Resolves to 'shared', 'downloaded' or 'cancelled', because those
 * need three different things said to the person who tapped.
 */
export async function shareQuotePdf(quote) {
  const name = quoteFileName(quote);
  const { ready, needs } = collectPhotos(quote.lines || []);
  const logo = docMark() ? readLogoDirect() : undefined;   // undefined: no mark at all, nothing to wait on
  // Nothing to decode means nothing to await, so the share sheet is
  // still opening on the same tap that asked for it.
  const blob = (needs.length || logo === null) ? await quotePdfBlob(quote) : render(quote, ready, logo);
  const file = new File([blob], name, { type: 'application/pdf' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `MR # ${quote.mrNo}`, text: quoteShareText(quote) });
      return 'shared';
    } catch (e) {
      // A dismissed sheet is a decision, not a failure — only a real
      // error should fall through to saving a file nobody asked for.
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  saveBlob(blob, name);
  return 'downloaded';
}
