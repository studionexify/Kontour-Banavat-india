/* quotepdf.js — the quotation as a file you can hand to a client.
 *
 * Laid out in the same order as the printed document and the on-screen
 * one: who it is for, what is being supplied, what it comes to, then
 * the boilerplate. The figures come from quoteTotals, the same call the
 * other two use, so the three can never disagree.
 *
 * Sharing goes through the Web Share API where the device has it —
 * which on a phone is the WhatsApp sheet, the thing this is actually
 * for. Everywhere else it falls back to a download, and the caller is
 * told which happened so it can say so.
 */

import { createPdf, wrapText, dataUriToBytes, readJpeg, A4 } from './pdf.js';
import { quoteTotals, lineAmount, lineGst, jobValueFor, settings, renderTerms } from './quotes.js';
import { dmy } from './format.js';

const M = 42;                       // page margin
const RIGHT = A4.w - M;
const BODY = RIGHT - M;
const FOOT_LIMIT = A4.h - 58;       // where a page has to break

/* WinAnsi has no ₹, so money is spelled. Grouping stays Indian —
   1,20,000 not 120,000 — because that is how the figure is read. */
function money(n) {
  const v = Math.round(Number(n) || 0);
  const s = Math.abs(v).toString();
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${v < 0 ? '-' : ''}Rs. ${grouped}`;
}

/* ── Photographs ────────────────────────────────────────────────
   Item photographs are captured through photos.js, which already
   shrinks everything to a JPEG — so the common path is simply reading
   the bytes out of the data URI and handing them to the writer
   untouched. Anything else, or anything far larger than the slot it
   will occupy, goes through a canvas first: a 3000px photograph in a
   40pt box is several megabytes nobody can WhatsApp.

   THUMB_PX is the longest edge kept, generous against the ~46pt slot
   so the image still holds up if the PDF is printed or zoomed. */
const THUMB_PX = 220;
/* The mark is small and square in the letterhead, so a much smaller
   target than a line photo is plenty and keeps the file light. */
const LOGO_PX = 120;

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

/** Reads the uploaded mark as-is, if it already is a JPEG small
    enough to place directly — the same fast path a line photo gets,
    and for the same reason: it costs no await. */
function readLogoDirect() {
  const uri = settings().logo;
  if (!uri) return null;
  const direct = readJpeg(dataUriToBytes(uri));
  return (direct && Math.max(direct.w, direct.h) <= LOGO_PX * 2) ? direct : null;
}

/** The uploaded mark, ready to place — re-encoded through a canvas
    when it is not already a small JPEG, since settings().logo can in
    principle be any format a browser can decode. */
async function prepareLogo() {
  const uri = settings().logo;
  if (!uri) return null;
  return readLogoDirect() || reencode(uri, LOGO_PX);
}

export function quoteFileName(q) {
  const client = String(q.client?.name || 'client').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
  return `MR-${q.mrNo}${client ? `-${client}` : ''}.pdf`;
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

/* Banavat India's own blue, wherever the company name prints. */
const BRAND_BLUE = [0.122, 0.247, 0.561];

/** The document itself, drawn from a quote and its prepared photos. */
function render(quote, photos, logo = null) {
  const s = settings();
  const t = quoteTotals(quote);
  const lines = quote.lines || [];
  const ship = (quote.shipping || []).filter((x) => Number(x.amount) > 0 || x.label);
  const doc = createPdf();
  let y = M;

  /* ── Letterhead: mark + name in blue on the left, QUOTATION big on
     the right, one row and a rule under it — how it actually prints,
     not the fuller boxed layout the early mockups used. ── */
  let nameX = M;
  if (logo) {
    const box = doc.image(logo, M, y - 4, 24, 24);
    if (box) nameX = M + 24 + 8;
  }
  doc.text(s.company.name || 'Banavat India', nameX, y + 12, { size: 15, bold: true, rgb: BRAND_BLUE });
  doc.text('QUOTATION', RIGHT, y + 14, { size: 20, bold: true, align: 'right', gray: 0.07 });
  y += 30;
  doc.line(M, y, RIGHT, y, { gray: 0.2, weight: 1.4 });
  y += 16;
  doc.text(`MR # ${quote.mrNo}`, RIGHT, y + 2, { size: 10, align: 'right', gray: 0.35 });
  y += 14;

  /* ── Who and when, two columns ── */
  const colB = M + BODY / 2 + 10;
  const pairs = [
    ['Client', quote.client?.name || '-'],
    ['Contact', quote.client?.phone || '-'],
    ...(quote.client?.email ? [['Email', quote.client.email]] : []),
    ['Delivery', quote.client?.shippingAddress || '-'],
  ];
  const dates = [
    ['Quoted', quote.date ? dmy(quote.date) : '-'],
    ['Valid till', quote.validUntil ? dmy(quote.validUntil) : '-'],
    ['GST', t.taxed ? `${quote.gstRate}%` : 'Not applicable'],
  ];
  const metaTop = y;
  pairs.forEach(([k, v], i) => {
    doc.text(`${k}`, M, metaTop + i * 15, { size: 9, gray: 0.5 });
    doc.text(v, M + 62, metaTop + i * 15, { size: 10, bold: k === 'Client', gray: 0.1 });
  });
  dates.forEach(([k, v], i) => {
    doc.text(`${k}`, colB, metaTop + i * 15, { size: 9, gray: 0.5 });
    doc.text(v, colB + 62, metaTop + i * 15, { size: 10, gray: 0.1 });
  });
  y = metaTop + Math.max(pairs.length, dates.length) * 15 + 12;

  // A quotation approved at a different figure, or with GST kept out
  // of the job value, is worth saying on the document that goes out —
  // it is the record of what was actually agreed, not just what was
  // originally offered.
  if (quote.status === 'accepted' && (quote.approvedTotal != null || quote.jobExcludesGst)) {
    const note = quote.approvedTotal != null
      ? `Approved at ${money(jobValueFor(quote))} (quoted at ${money(t.total)})${quote.jobExcludesGst ? ', excluding GST' : ''}.`
      : 'Approved excluding GST.';
    doc.text(note, M, y + 8, { size: 9, bold: true, gray: 0.15 });
    y += 20;
  }

  /* ── Items ──
     Photograph, name + spec, dimensions, rate, qty, and either one
     amount column or three — amount, GST, line total — when the
     quotation is set to show tax per line rather than as one figure
     under the sub-total. The image column only takes its width when
     something on the quotation actually has a photograph, so a
     quotation of plain lines prints across the full page.

     The description wraps, so a row's height is whatever its tallest
     cell needs, and a row that would cross the foot moves to a new
     page whole rather than splitting mid-description. */
  const anyPhoto = lines.some((l) => photos.has(l.id));
  const lineItemGst = quote.gstMode === 'lineitem' && t.taxed;
  const imgW = anyPhoto ? 58 : 0;

  // Right-aligned columns, positioned by their right edge and laid
  // out from RIGHT leftward: each step reserves that column's own
  // width before leaving a gap for the next one — skipping the
  // column's own width here is what let AMOUNT and QTY print on top
  // of each other the first time this was written. Rate and Qty
  // always sit just before the Amount; GST and Line Total exist only
  // when the quotation is set to show tax per line, and sit after it.
  const GAP = 8;
  const W = { rate: 54, qty: 28, amt: 60, gst: 52, lineTotal: 62 };
  let edge = RIGHT;
  const lineTotalRight = edge;
  if (lineItemGst) edge -= W.lineTotal + GAP;
  const gstRight = edge;
  if (lineItemGst) edge -= W.gst + GAP;
  const amtRight = edge;
  edge -= W.amt + GAP;
  const qtyRight = edge;
  edge -= W.qty + GAP;
  const rateRight = edge;
  edge -= W.rate + GAP;

  // Five numeric columns and a photograph leave too little of a
  // portrait page for a *sixth* text column: Dimensions folds into
  // the item's own column, as one more wrapped line under the
  // description, rather than being squeezed into a sliver that
  // collides with the numbers next to it.
  const foldDims = lineItemGst;

  const C = {
    sr: M,
    img: M + 20,
    name: M + 20 + imgW + (anyPhoto ? 8 : 0),
  };
  C.dim = foldDims ? 0 : C.name + (anyPhoto ? 132 : 176);
  const nameW = (foldDims ? edge : C.dim) - C.name - 8;
  const dimW = foldDims ? 0 : edge - C.dim - 8;

  const header = () => {
    doc.fill(M, y, BODY, 20, 0.93);
    doc.text('#', C.sr + 4, y + 14, { size: 9, bold: true, gray: 0.3 });
    doc.text(foldDims ? 'ITEM (WITH DIMENSIONS)' : 'ITEM', C.name, y + 14, { size: 9, bold: true, gray: 0.3 });
    if (!foldDims) doc.text('DIMENSIONS', C.dim, y + 14, { size: 9, bold: true, gray: 0.3 });
    doc.text('RATE', rateRight, y + 14, { size: 9, bold: true, align: 'right', gray: 0.3 });
    doc.text('QTY', qtyRight, y + 14, { size: 9, bold: true, align: 'right', gray: 0.3 });
    doc.text(lineItemGst ? 'SUB-TOTAL' : 'TOTAL', amtRight, y + 14, { size: 9, bold: true, align: 'right', gray: 0.3 });
    if (lineItemGst) {
      doc.text(`GST`, gstRight, y + 14, { size: 9, bold: true, align: 'right', gray: 0.3 });
      doc.text('TOTAL', lineTotalRight, y + 14, { size: 9, bold: true, align: 'right', gray: 0.3 });
    }
    y += 20;
  };
  header();

  if (!lines.length) {
    doc.text('No items on this quotation yet.', M + 4, y + 14, { size: 10, gray: 0.5 });
    y += 26;
  }

  lines.forEach((l, i) => {
    const photo = photos.get(l.id);
    const nameLines = wrapText(l.name || 'Item', nameW, 10, true);
    const descLines = l.description ? wrapText(l.description, nameW, 9) : [];
    // Folded in, a dimension string prints as "Dim: 38 x 1 x 58"" so
    // it still reads as its own fact rather than a second description.
    const foldedDimLines = foldDims && l.dims ? wrapText(`Dim: ${l.dims}`, nameW, 9) : [];
    const dimLines = foldDims ? [] : (l.dims ? wrapText(l.dims, dimW, 9) : []);
    const rowH = Math.max(
      nameLines.length * 13 + descLines.length * 11 + foldedDimLines.length * 11 + (l.finish ? 11 : 0),
      dimLines.length * 11,
      photo ? imgW : 18,
    ) + 12;

    if (y + rowH > FOOT_LIMIT) { doc.addPage(); y = M; header(); }

    // A fixed square, never stretched to the row's own height — a
    // row with more description text is taller, but every photograph
    // down the column still reads at the same size as the rest.
    if (photo) doc.image(photo, C.img, y + 5, imgW, imgW);

    let ty = y + 12;
    doc.text(String(i + 1), C.sr + 4, ty, { size: 9, gray: 0.45 });
    for (const ln of nameLines) { doc.text(ln, C.name, ty, { size: 10, bold: true, gray: 0.1 }); ty += 13; }
    if (l.finish) { doc.text(l.finish, C.name, ty, { size: 9, gray: 0.45 }); ty += 11; }
    for (const ln of descLines) { doc.text(ln, C.name, ty, { size: 9, gray: 0.4 }); ty += 11; }
    for (const ln of foldedDimLines) { doc.text(ln, C.name, ty, { size: 9, gray: 0.4 }); ty += 11; }

    let dy = y + 12;
    for (const ln of dimLines) { doc.text(ln, C.dim, dy, { size: 9, gray: 0.35 }); dy += 11; }

    const amt = lineAmount(l);
    doc.text(money(l.unitPrice), rateRight, y + 12, { size: 10, align: 'right', gray: 0.15 });
    doc.text(String(l.kind === 'lump' ? 1 : l.qty), qtyRight, y + 12, { size: 10, align: 'right', gray: 0.15 });
    doc.text(money(amt), amtRight, y + 12, { size: 10, bold: !lineItemGst, align: 'right', gray: lineItemGst ? 0.15 : 0.05 });
    if (lineItemGst) {
      const gst = lineGst(l, quote);
      doc.text(money(gst), gstRight, y + 12, { size: 10, align: 'right', gray: 0.15 });
      doc.text(money(amt + gst), lineTotalRight, y + 12, { size: 10, bold: true, align: 'right', gray: 0.05 });
    }

    y += rowH;
    doc.line(M, y, RIGHT, y, { gray: 0.86 });
  });

  /* ── The ladder, in the order it prints: tax inside Sub Total A,
        shipping added after it as Sub Total B. ── */
  const ladder = [
    [t.discount ? 'Total' : 'Sub - Total', money(t.sub), false],
    ...(t.discount ? [
      ['Discount', `-${money(t.discount)}`, false],
      ['Sub-Total', money(t.afterDiscount), false],
    ] : []),
    ...(t.taxed ? [[`GST (${quote.gstRate}%)${lineItemGst ? ' — as above' : ''}`, money(t.gst), false]] : []),
    ['Sub Total A', money(t.subA), false],
    ...ship.map((x) => [x.label || 'Shipping', money(x.amount), false]),
    ['Sub Total B', money(t.subB), false],
  ];
  const ladderH = ladder.length * 15 + 34;
  if (y + ladderH > FOOT_LIMIT) { doc.addPage(); y = M; }
  y += 14;

  const sumX = RIGHT - 210;
  ladder.forEach(([k, v]) => {
    doc.text(k, sumX, y + 10, { size: 9.5, gray: 0.4 });
    doc.text(v, RIGHT, y + 10, { size: 9.5, align: 'right', gray: 0.15 });
    y += 15;
  });
  y += 4;
  doc.fill(sumX - 12, y, RIGHT - sumX + 12, 26, 0.93);
  doc.text('TOTAL', sumX, y + 17, { size: 10, bold: true, gray: 0.2 });
  doc.text(money(t.total), RIGHT - 6, y + 17, { size: 12, bold: true, align: 'right', gray: 0 });
  y += 38;

  /* ── Boilerplate ── */
  /* Clauses break one at a time rather than the block moving whole:
     eight terms that do not fit in the remaining third of a page used
     to leave that third blank and start again overleaf. A clause is
     never split across pages, and a heading never ends one. */
  const block = (title, body) => {
    if (!body || !String(body).trim()) return;
    const clauses = String(body).split('\n').map((x) => x.trim()).filter(Boolean);
    if (!clauses.length) return;

    const firstH = wrapText(clauses[0].replace(/^[-–•]\s*/, ''), BODY - 12, 9).length * 11 + 3;
    if (y + 18 + firstH > FOOT_LIMIT) { doc.addPage(); y = M; }
    doc.text(title.toUpperCase(), M, y + 10, { size: 9, bold: true, gray: 0.35 });
    y += 18;

    for (const ln of clauses) {
      const wrapped = wrapText(ln.replace(/^[-–•]\s*/, ''), BODY - 12, 9);
      const h = wrapped.length * 11 + 3;
      if (y + h > FOOT_LIMIT) { doc.addPage(); y = M; }
      doc.text('-', M, y + 8, { size: 9, gray: 0.5 });
      wrapped.forEach((w, i) => { doc.text(w, M + 12, y + 8 + i * 11, { size: 9, gray: 0.25 }); });
      y += h;
    }
    y += 10;
  };

  block('Payment terms', quote.paymentTerms);
  block('Terms & conditions', renderTerms(quote));
  // The asterisk belongs to the clauses above it, so it sits with
  // them — at the end of the document it either collided with the
  // note or cost a whole page to itself.
  doc.text('*Terms and conditions apply.', M, y - 2, { size: 8, gray: 0.5 });
  y += 10;

  const bankText = [
    `Bank: ${s.bank.bank}`, `A/C Name: ${s.bank.name}`,
    `A/C Number: ${s.bank.account}`, `IFSC: ${s.bank.ifsc}`, `Branch: ${s.bank.branch}`,
  ].filter((x) => !/:\s*$/.test(x)).join('\n');
  const contactText = [
    s.company.name, s.company.gstin ? `GSTIN: ${s.company.gstin}` : '',
    s.company.address, s.company.email, s.company.phone, s.company.website,
  ].filter(Boolean).join('\n');

  if (y + 96 > FOOT_LIMIT) { doc.addPage(); y = M; }
  doc.line(M, y, RIGHT, y, { gray: 0.8 });
  y += 16;
  doc.text('BANKING DETAILS', M, y + 8, { size: 9, bold: true, gray: 0.35 });
  doc.text('CONTACT', colB, y + 8, { size: 9, bold: true, gray: 0.35 });
  y += 18;
  const bankEnd = doc.paragraph(bankText, M, y + 8, BODY / 2 - 20, { size: 9, leading: 1.3, gray: 0.3 });
  const contactEnd = doc.paragraph(contactText, colB, y + 8, BODY / 2 - 20, { size: 9, leading: 1.3, gray: 0.3 });
  y = Math.max(bankEnd, contactEnd) + 6;

  if (s.note) {
    if (y + 60 > FOOT_LIMIT) { doc.addPage(); y = M; }
    doc.text('NOTE', M, y + 8, { size: 9, bold: true, gray: 0.35 });
    y = doc.paragraph(String(s.note).replace(/\n{2,}/g, '\n'), M, y + 22, BODY, { size: 9, gray: 0.3 }) + 4;
  }

  return doc.blob();
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
  const logo = settings().logo ? readLogoDirect() : undefined;   // undefined: no logo at all, nothing to wait on
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
