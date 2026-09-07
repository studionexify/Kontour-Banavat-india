/* subphoto.js — the picture of the piece, found rather than stored.
 *
 * Every project and every line item in this business is recognised by
 * its photograph, not by its description: "the console" means nothing
 * until you see which console. So a work order without pictures is a
 * work order nobody can check.
 *
 * The pictures already exist. They were scanned out of the original
 * PDF quotations into data/imported-photos.json and attached to the
 * quotation lines they belong to (see quotes.attachImportedPhotos),
 * and newer pieces carry a photo shot on the phone. What this file
 * does is find the one that belongs to a sub-contractor item, so the
 * same piece is the same picture everywhere in the app and there is
 * never a second copy to keep in step.
 *
 * Five places are tried, nearest first:
 *
 *   1. a photo taken for this commissioning specifically — rare, and
 *      only ever set by hand;
 *   2. the order line the item was commissioned from, when it was
 *      pulled off a live order and so carries that line's id;
 *   3. the quotation line with the same MR No whose name matches;
 *   4. failing a name match, the first photographed line under that
 *      MR No — better a picture of the right project than none;
 *   5. the scanned archive itself (data/imported-photos.json), for
 *      the case where the quotation is not on this device.
 *
 * That last one is deliberately cautious. The archive is keyed by MR
 * number and row position within the original quotation, and a
 * sub-contractor's row 3 is not the quotation's row 3 — so guessing by
 * position would put the wrong piece on a work order, which is worse
 * than putting none. It is therefore used only where the MR number has
 * exactly one photograph on file and there is nothing to confuse.
 *
 * Returns '' when nothing is found, which the caller shows as an empty
 * frame rather than a broken image.
 */

import * as quotes from './quotes.js';
import * as orders from './orders.js';

/** Loosened for comparison: case, punctuation and runs of spaces all
    stop mattering, so "Dining chair 01  Meeting & Add" matches
    "Dining Chair 01 - Meeting and Add". */
function key(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* Both sides of a comparison, cheap enough to redo per row but not
   per keystroke — the map is rebuilt only when the quotations change. */
let cache = null;
try { quotes.onChange(() => { cache = null; }); } catch (e) { /* not loaded yet */ }
try { orders.onChange(() => { cache = null; }); } catch (e) { /* not loaded yet */ }

/** MR No → [{ name, photo }], every photographed line on file. */
function index() {
  if (cache) return cache;
  const map = new Map();

  const push = (mrNo, name, photo) => {
    if (!photo) return;
    const k = String(mrNo || '').trim().toUpperCase();
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ name: key(name), photo });
  };

  try {
    for (const q of quotes.quotes({})) {
      for (const line of q.lines || []) push(q.mrNo, line.name, line.photo);
    }
  } catch (e) { /* quotations not loaded */ }

  try {
    for (const l of orders.lines()) push(l.mrNo, l.name, l.image);
  } catch (e) { /* orders not loaded */ }

  cache = map;
  return map;
}

/**
 * The photo for one sub-contractor item.
 * @param {object} item — a row from subs.itemsIn()/itemsOf()
 */
export function photoFor(item) {
  if (!item) return '';
  if (item.photo) return item.photo;

  // The order line it was commissioned from, when there is one. This
  // is the exact-match case: same piece, same row, same picture.
  if (item.orderLineId) {
    try {
      const line = orders.lines().find((l) => l.id === item.orderLineId);
      if (line && line.image) return line.image;
    } catch (e) { /* orders not loaded */ }
  }

  // The imported history has no order-line id — those sheets predate
  // the order screen — so it is matched on MR No and name.
  const mr = String(item.mrNo || '').trim().toUpperCase();
  const rows = index().get(mr);
  if (!rows || !rows.length) {
    // Nothing on file here — fall back to the scanned archive, which
    // only ever answers for an MR number carrying a single photograph.
    return (archive && archive.get(mr)) || '';
  }

  const want = key(item.name);
  if (want) {
    const exact = rows.find((r) => r.name === want);
    if (exact) return exact.photo;
    // "Sofa 01 - Veer bedroom" against "Sofa 01 Veer Bedroom Fabric":
    // one containing the other is a match, longest name first so the
    // most specific line wins rather than whichever came first.
    const near = rows
      .filter((r) => r.name && (r.name.includes(want) || want.includes(r.name)))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (near) return near.photo;
  }

  return rows[0].photo;
}

/* ── The scanned archive ───────────────────────────────────────
   Fetched once, lazily, and only consulted when everything nearer has
   failed. Kept as MR number → the single photograph, dropping any MR
   with more than one, because only the unambiguous ones are safe to
   use without a name to match against. */

let archive = null;

export async function loadArchive() {
  if (archive) return archive;
  archive = new Map();
  try {
    const res = await fetch('/data/imported-photos.json');
    if (!res.ok) return archive;
    const byMrNo = await res.json();
    for (const [mrNo, entries] of Object.entries(byMrNo)) {
      const all = [];
      for (const e of entries || []) all.push(...Object.values((e && e.rows) || {}));
      if (all.length === 1) archive.set(String(mrNo).toUpperCase(), all[0]);
    }
  } catch (e) { /* offline, or the archive is not shipped */ }
  return archive;
}

/** True when anything under this MR No has a picture on file — used to
    decide whether a work order can be printed with an image column at
    all, rather than printing a page of empty boxes. */
export function hasPhotos(items) {
  return (items || []).some((it) => photoFor(it));
}
