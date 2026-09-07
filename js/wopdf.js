/* wopdf.js — the work order as a sheet you can hand to the maker.
 *
 * Laid out to match the documents already in the Drive folder, because
 * those are what the subcontractors are used to receiving and can
 * check against: a header block with who it is for and their contact
 * details on the left, the work order number and issue date on the
 * right, then the item table —
 *
 *   Sr | MR No | Image | Name | Description | Dimensions | Qty |
 *   Delivery Date | Unit Rate | Total
 *
 * — and the total underneath.
 *
 * The photograph column is the point of the document. Every piece in
 * this business is recognised by its picture, not its description, so
 * a maker checking "is this the console you meant" needs the image
 * beside the words. The picture is the one already on file for that
 * piece (see subphoto.js), never a second copy.
 *
 * Built on the same tiny PDF writer as the quotation (js/pdf.js) — no
 * CDN, so a work order can be produced on the workshop floor with no
 * signal, which is where it is usually needed.
 */

import { createPdf, wrapText, dataUriToBytes, readJpeg, A4 } from './pdf.js';
import { settings } from './quotes.js';
import * as subs from './subs.js';
import { photoFor } from './subphoto.js';
import { dmy } from './format.js';

const M = 36;
const RIGHT = A4.w - M;
const BODY = RIGHT - M;
const FOOT_LIMIT = A4.h - 52;
const THUMB_PX = 220;

/* WinAnsi has no rupee sign, so money is spelled — and grouped the
   Indian way, 1,20,000 rather than 120,000, because that is how the
   figure gets read aloud. Same function as the quotation uses. */
function money(n) {
  const v = Math.round(Number(n) || 0);
  const s = Math.abs(v).toString();
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${v < 0 ? '-' : ''}Rs. ${grouped}`;
}

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
        resolve(readJpeg(dataUriToBytes(canvas.toDataURL('image/jpeg', 0.82))));
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = uri;
  });
}

/** Decodes each item's picture once, keyed by item id. */
async function collectPhotos(items) {
  const out = new Map();
  for (const it of items) {
    const uri = photoFor(it);
    if (!uri) continue;
    const direct = readJpeg(dataUriToBytes(uri));
    if (direct && Math.max(direct.w, direct.h) <= THUMB_PX * 2) { out.set(it.id, direct); continue; }
    const shrunk = await reencode(uri);
    if (shrunk) out.set(it.id, shrunk);
  }
  return out;
}

/* Column geometry, in the order the Drive sheets use. The image slot
   is generous because it is the column people actually look at. */
const C = {
  sr: M,
  mr: M + 22,
  img: M + 62,
  name: M + 118,
};

export async function workOrderPdfBlob(woId) {
  const wo = subs.getWorkOrder(woId);
  if (!wo) return null;
  const sub = subs.getSub(wo.subId);
  const items = subs.itemsIn(woId);
  const photos = await collectPhotos(items);
  return render(wo, sub, items, photos);
}

function render(wo, sub, items, photos) {
  const s = settings();
  const doc = createPdf();
  let y = M;

  /* ── Letterhead ── */
  doc.text(s.company.name || 'Banavat India', M, y + 12, { size: 15, bold: true, gray: 0.05 });
  doc.text('WORK ORDER', RIGHT, y + 14, { size: 20, bold: true, align: 'right', gray: 0.07 });
  y += 26;
  doc.line(M, y, RIGHT, y, { gray: 0.2, weight: 1.4 });

  /* ── Who it is for, and which order ──
     Left column is the subcontractor's block exactly as the Drive
     sheets carry it; right column is the number and the date. */
  y += 16;
  const colB = M + BODY * 0.62;

  const left = [
    ['Name', sub ? (sub.firm ? `${sub.name} (${sub.firm})` : sub.name) : ''],
    ['Contact', sub && sub.phone],
    ['Email', sub && sub.email],
  ].filter(([, v]) => v);

  const right = [
    ['Work Order No.', wo.no],
    ['Issue Date', wo.issueDate ? dmy(wo.issueDate) : ''],
  ].filter(([, v]) => v);

  left.forEach(([k, v], i) => {
    doc.text(`${k}:`, M, y + i * 15, { size: 9, gray: 0.5 });
    doc.text(v, M + 58, y + i * 15, { size: 10, bold: i === 0, gray: 0.1 });
  });
  right.forEach(([k, v], i) => {
    doc.text(`${k}:`, colB, y + i * 15, { size: 9, gray: 0.5 });
    doc.text(v, colB + 84, y + i * 15, { size: 10, bold: true, gray: 0.1 });
  });

  y += Math.max(left.length, right.length) * 15 + 2;

  if (sub && sub.address) {
    doc.text('Address:', M, y + 10, { size: 9, gray: 0.5 });
    y = doc.paragraph(sub.address, M + 58, y + 10, BODY * 0.55, { size: 9.5, leading: 1.3, gray: 0.2 }) + 6;
  }

  y += 8;

  /* ── The table ── */
  const rateRight = RIGHT - 74;
  const totalRight = RIGHT;
  const qtyRight = rateRight - 58;
  const dateRight = qtyRight - 34;
  const nameW = dateRight - 80 - C.name;

  const header = () => {
    doc.fill(M, y, BODY, 20, 0.93);
    doc.text('#', C.sr + 3, y + 13, { size: 8.5, bold: true, gray: 0.3 });
    doc.text('MR No', C.mr, y + 13, { size: 8.5, bold: true, gray: 0.3 });
    doc.text('Image', C.img + 6, y + 13, { size: 8.5, bold: true, gray: 0.3 });
    doc.text('Item, description and dimensions', C.name, y + 13, { size: 8.5, bold: true, gray: 0.3 });
    doc.text('Delivery', dateRight, y + 13, { size: 8.5, bold: true, align: 'right', gray: 0.3 });
    doc.text('Qty', qtyRight, y + 13, { size: 8.5, bold: true, align: 'right', gray: 0.3 });
    doc.text('Rate', rateRight, y + 13, { size: 8.5, bold: true, align: 'right', gray: 0.3 });
    doc.text('Total', totalRight, y + 13, { size: 8.5, bold: true, align: 'right', gray: 0.3 });
    y += 20;
  };
  header();

  if (!items.length) {
    doc.text('Nothing on this work order yet.', M + 4, y + 14, { size: 10, gray: 0.5 });
    y += 26;
  }

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const img = photos.get(it.id);

    const nameLines = wrapText(it.name || '', nameW, 10, true);
    const descLines = it.desc ? wrapText(it.desc, nameW, 8.5) : [];
    const dimLines = it.dims ? wrapText(it.dims, nameW, 8.5) : [];
    const remarkLines = it.remark ? wrapText(it.remark, nameW, 8.5) : [];

    const textH = 8 + nameLines.length * 13 + (descLines.length + dimLines.length + remarkLines.length) * 11 + 8;
    const rowH = Math.max(textH, img ? 54 : 30);

    // A row is never split across the fold: half a piece on one page
    // and half on the next is exactly the confusion the photograph
    // column exists to prevent.
    if (y + rowH > FOOT_LIMIT) {
      doc.addPage();
      y = M;
      header();
    }

    if (img) doc.image(img, C.img, y + 5, 48, rowH - 10);

    let ty = y + 14;
    doc.text(String(it.sr || i + 1), C.sr + 3, ty, { size: 9, gray: 0.45 });
    if (it.mrNo) doc.text(it.mrNo, C.mr, ty, { size: 9, bold: true, gray: 0.25 });

    for (const ln of nameLines) { doc.text(ln, C.name, ty, { size: 10, bold: true, gray: 0.1 }); ty += 13; }
    for (const ln of descLines) { doc.text(ln, C.name, ty, { size: 8.5, gray: 0.4 }); ty += 11; }
    for (const ln of dimLines) { doc.text(ln, C.name, ty, { size: 8.5, gray: 0.35 }); ty += 11; }
    for (const ln of remarkLines) { doc.text(ln, C.name, ty, { size: 8.5, gray: 0.5 }); ty += 11; }

    const my = y + 14;
    if (it.delivery) doc.text(dmy(it.delivery), dateRight, my, { size: 9, align: 'right', gray: 0.3 });
    doc.text(String(it.qty || 1), qtyRight, my, { size: 9.5, align: 'right', gray: 0.15 });

    // An unpriced piece says so rather than showing Rs. 0, which reads
    // as "free" and is never what it means — it means a rate was not
    // agreed before the work went out.
    if (it.rate > 0) {
      doc.text(money(it.rate), rateRight, my, { size: 9.5, align: 'right', gray: 0.15 });
      doc.text(money(subs.itemAmount(it)), totalRight, my, { size: 10, bold: true, align: 'right', gray: 0.05 });
    } else {
      doc.text('To be agreed', totalRight, my, { size: 8.5, align: 'right', gray: 0.45 });
    }

    y += rowH;
    doc.line(M, y, RIGHT, y, { gray: 0.86 });
  }

  /* ── Total ── */
  const total = subs.woTotal(wo.id);
  if (y + 46 > FOOT_LIMIT) { doc.addPage(); y = M; }
  y += 10;
  doc.fill(RIGHT - 220, y, 220, 28, 0.95);
  doc.text('TOTAL', RIGHT - 210, y + 18, { size: 10, bold: true, gray: 0.2 });
  doc.text(money(total), RIGHT - 8, y + 18, { size: 13, bold: true, align: 'right', gray: 0 });
  y += 40;

  const unpriced = items.filter((it) => !(it.rate > 0)).length;
  if (unpriced) {
    doc.text(`${unpriced} item${unpriced === 1 ? '' : 's'} on this work order ${unpriced === 1 ? 'has' : 'have'} no agreed rate yet.`,
      M, y + 10, { size: 8.5, gray: 0.45 });
    y += 20;
  }

  /* ── Who issued it ── */
  if (y + 70 > FOOT_LIMIT) { doc.addPage(); y = M; }
  doc.line(M, y, RIGHT, y, { gray: 0.8 });
  y += 16;
  doc.text('ISSUED BY', M, y + 8, { size: 9, bold: true, gray: 0.35 });
  const contact = [
    s.company.name, s.company.address, s.company.phone, s.company.email,
  ].filter(Boolean).join('\n');
  doc.paragraph(contact, M, y + 22, BODY / 2 - 20, { size: 9, leading: 1.3, gray: 0.3 });

  return doc.blob();
}

export function workOrderFileName(wo, sub) {
  const who = (sub && sub.name || 'sub-contractor').replace(/[^\w]+/g, '-');
  return `${wo.no}-${who}.pdf`;
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

/**
 * Opens the device's share sheet with the work order attached — on a
 * phone that is the WhatsApp sheet, which is how these actually reach
 * the people who make the furniture. Resolves to 'shared',
 * 'downloaded' or 'cancelled', because those need three different
 * things said to whoever tapped.
 */
export async function shareWorkOrder(woId) {
  const wo = subs.getWorkOrder(woId);
  if (!wo) return 'cancelled';
  const sub = subs.getSub(wo.subId);
  const name = workOrderFileName(wo, sub);
  const blob = await workOrderPdfBlob(woId);
  if (!blob) return 'cancelled';

  const file = new File([blob], name, { type: 'application/pdf' });
  const text = `Work order ${wo.no}${sub ? ` for ${sub.name}` : ''} — ${money(subs.woTotal(woId))}.`;

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: wo.no, text });
      return 'shared';
    } catch (e) {
      // A dismissed sheet is a decision, not a failure.
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  saveBlob(blob, name);
  return 'downloaded';
}

export async function downloadWorkOrder(woId) {
  const wo = subs.getWorkOrder(woId);
  if (!wo) return '';
  const sub = subs.getSub(wo.subId);
  const name = workOrderFileName(wo, sub);
  const blob = await workOrderPdfBlob(woId);
  if (blob) saveBlob(blob, name);
  return name;
}
