/* views/piecework.js — one commissioned piece, on the floor.
 *
 * The board a piece is looked at on: its photograph, who is making
 * it and at what rate, and the running log of everything said about
 * it. It is opened from the sub-contractor's In production tab and
 * from QC's rework queue, because both are the same act — somebody
 * looking at one piece and deciding whether it can move on.
 *
 * Four verdicts, in the order they are actually used:
 *
 *   Approve — their part is finished. When every sub-contractor on
 *             the piece has approved, the piece moves to assembly
 *             and appears on QC (see subs.syncLineStage).
 *   Improve — the shape is right, the finish is not. Stays with them.
 *   Reject  — make it again. Stays with them.
 *   Note    — no verdict, just something worth remembering.
 *
 * Every one of the four can carry photographs, and each is stamped
 * and kept for good. Nothing in the log can be edited, because the
 * value of the log is that it is what was said at the time.
 *
 * Photographs go to IndexedDB with the rest of Kontour's pictures,
 * tagged with the piece they belong to. They carry status 'shot' so
 * the bill uploader, which sweeps up anything still local, leaves
 * them alone.
 */

import { icon } from '../icons.js';
import { esc, on, openSheet, toast, haptic, field } from '../ui.js';
import { inr, dmy, ago } from '../format.js';
import * as subs from '../subs.js';
import { pickImage, shrink } from '../photos.js';
import { photos, blobURL } from '../db.js';
import { uid } from '../store.js';
import { photoFor } from '../subphoto.js';

export const PHOTO_TAG = (orderLineId, mrNo) => `piece:${orderLineId || mrNo || 'loose'}`;

/** Shoots (or picks) photographs and files them against a piece. */
export async function capturePhotos(it, { camera = true } = {}) {
  const files = await pickImage({ camera, multiple: true });
  if (!files.length) return [];
  const ids = [];
  for (const f of files) {
    const { blob, w, h } = await shrink(f);
    const rec = {
      id: uid('p'),
      entryId: PHOTO_TAG(it.orderLineId, it.mrNo),
      mrNo: it.mrNo || '',
      blob,
      mime: 'image/jpeg',
      name: f.name || 'piece.jpg',
      w, h,
      bytes: blob.size,
      // Not 'local': that is the bill uploader's queue, and these are
      // not bills.
      status: 'shot',
      driveId: '', driveLink: '', extracted: null, error: '',
      createdAt: Date.now(),
    };
    await photos.put(rec);
    ids.push(rec.id);
  }
  return ids;
}

/** Reads back the pictures logged against a piece, newest last. */
export async function photosFor(ids) {
  const out = [];
  for (const id of ids) {
    const rec = await photos.get(id);
    if (rec) out.push(rec);
  }
  return out;
}

export function stateChip(it) {
  const st = subs.ITEM_STATES[it.state || 'working'] || subs.ITEM_STATES.working;
  return `<span class="pill ${esc(st.tone === 'ok' ? 'in' : st.tone === 'bad' ? 'out' : st.tone)}">${esc(st.label)}</span>`;
}

/* ── The board ─────────────────────────────────────────────────── */

export function openItemBoard(itemId, onDone) {
  const it = subs.getItem(itemId);
  if (!it) return;
  const person = subs.subOfItem(it);
  const wo = it.woId ? subs.getWorkOrder(it.woId) : null;

  const draw = async (sheet) => {
    const cur = subs.getItem(itemId) || it;
    const img = photoFor({ orderLineId: cur.orderLineId, mrNo: cur.mrNo, name: cur.name })
      || cur.photo || '';
    const log = [...(cur.log || [])].reverse();

    sheet.querySelector('.sheet-body').innerHTML = `
      <div class="piece-head">
        ${img ? `<img class="piece-img" src="${esc(img)}" alt="">`
              : `<span class="piece-img ph">${icon('box', 26)}</span>`}
        <div class="piece-meta">
          <div class="piece-t">${esc(cur.name || 'Untitled piece')}</div>
          <div class="piece-s">${esc(cur.mrNo)}${cur.dims ? ` · ${esc(cur.dims)}` : ''} · Qty ${esc(String(cur.qty || 1))}</div>
          <div class="piece-s">${esc(person ? person.name : 'Unassigned')}${cur.trade ? ` · ${esc(subs.TRADE_LABELS[cur.trade] || cur.trade)}` : ''}${wo ? ` · ${esc(wo.no)}` : ''} · ${esc(inr(cur.rate))}</div>
          <div style="margin-top:6px">${stateChip(cur)}</div>
        </div>
      </div>

      ${cur.desc ? `<p class="hint" style="margin:12px 0">${esc(cur.desc)}</p>` : ''}

      <p class="tray-lbl sp">Verdict</p>
      <div class="verdicts">
        <button class="btn ok sm" data-v="approved">${icon('check', 15)} Approve</button>
        <button class="btn sec sm" data-v="improve">${icon('repeat', 15)} Improve</button>
        <button class="btn danger sm" data-v="rejected">${icon('close', 15)} Reject</button>
        <button class="btn sec sm" data-v="note">${icon('note', 15)} Note only</button>
      </div>
      <p class="hint" style="margin-top:8px">Approving is this person's part only. The piece goes to QC once everyone commissioned on it has approved.</p>

      <p class="tray-lbl sp">History</p>
      ${log.length ? `<div class="logfeed">${log.map(logRow).join('')}</div>`
        : '<p class="hint">Nothing logged yet.</p>'}`;

    // Pictures are read out of IndexedDB, so they arrive after the
    // markup does and are dropped into place rather than awaited.
    for (const row of log) {
      if (!(row.photoIds || []).length) continue;
      const host = sheet.querySelector(`[data-shots="${row.id}"]`);
      if (!host) continue;
      const recs = await photosFor(row.photoIds);
      host.innerHTML = recs.map((r) => `<img class="logshot" src="${esc(blobURL(r))}" alt="">`).join('');
    }
  };

  openSheet({
    // The piece names itself in the head, with its photograph — so
    // the bar carries where it is from and who has it instead.
    title: [it.mrNo, person && person.name].filter(Boolean).join(' · ') || 'Piece',
    full: true,
    wide: true,
    body: '<div class="sheet-body"></div>',
    onMount(sheet) {
      draw(sheet);
      on(sheet, '[data-v]', async (e, b) => {
        const v = b.dataset.v;
        const done = await openVerdict(subs.getItem(itemId), v);
        if (!done) return;
        haptic(10);
        draw(sheet);
        if (onDone) onDone();
      });
    },
  });
}

function logRow(r) {
  const st = r.state ? subs.ITEM_STATES[r.state] : null;
  return `
    <article class="logrow">
      <span class="logrow-h">
        <span class="logrow-t">${st ? esc(st.label) : 'Note'}</span>
        <span class="logrow-s">${esc(ago(r.at))}</span>
      </span>
      ${r.text ? `<p class="logrow-x">${esc(r.text)}</p>` : ''}
      <span class="logshots" data-shots="${esc(r.id)}"></span>
    </article>`;
}

/* ── Recording one verdict ─────────────────────────────────────
   The note and the photographs are on the same form as the verdict
   itself, because a rejection without a reason and a picture is the
   thing everybody argues about a week later. */

function openVerdict(it, verdict) {
  if (!it) return Promise.resolve(false);
  const isNote = verdict === 'note';
  const st = subs.ITEM_STATES[verdict];

  return new Promise((resolve) => {
    let shots = [];
    let settled = false;

    openSheet({
      title: isNote ? 'Add a note' : st.label,
      body: `
        <div class="sheet-body">
          <p class="sheet-lede">${esc(it.name || 'This piece')}${isNote ? '' : ` — ${esc(st.hint.toLowerCase())}.`}</p>
          ${field(isNote ? 'Note' : 'What to tell them',
            `<textarea class="control" data-text rows="3" placeholder="${esc(verdict === 'improve' ? 'Polish the joint, the left arm is uneven' : verdict === 'rejected' ? 'Wrong section used, remake' : '')}"></textarea>`,
            verdict === 'approved' ? 'Optional.' : '')}
          <button class="btn sec sm" data-shoot>${icon('camera', 15)} Add photographs</button>
          <div class="shotstrip" data-strip></div>
          <button class="btn" data-save>${isNote ? 'Save note' : `Mark ${esc(st.label.toLowerCase())}`}</button>
        </div>`,
      onMount(sheet, handle) {
        on(sheet, '[data-shoot]', async () => {
          const ids = await capturePhotos(it);
          if (!ids.length) return;
          shots = [...shots, ...ids];
          const recs = await photosFor(shots);
          sheet.querySelector('[data-strip]').innerHTML = recs
            .map((r) => `<img class="logshot" src="${esc(blobURL(r))}" alt="">`).join('');
          toast(`${ids.length} photograph${ids.length === 1 ? '' : 's'} added`);
        });

        on(sheet, '[data-save]', () => {
          const text = sheet.querySelector('[data-text]').value.trim();
          if (isNote) {
            if (!text && !shots.length) { toast('Nothing to save', 'bad'); return; }
            subs.addItemLog(it.id, { kind: 'note', text, photoIds: shots });
            toast('Noted');
          } else {
            subs.setItemState(it.id, verdict, { text, photoIds: shots });
            toast(verdict === 'approved'
              ? 'Approved'
              : `Sent back — ${st.label.toLowerCase()}`);
          }
          settled = true;
          handle.close();
          resolve(true);
        });
      },
      onClose() { if (!settled) resolve(false); },
    });
  });
}
