/* views/workorder.js — one work order, on screen.
 *
 * The same document that gets printed, but live: every piece with its
 * photograph and the rate this person quoted, each of which can be
 * corrected in place. A rate typed wrong is the most likely mistake on
 * this whole screen and the one that quietly moves a balance, so
 * fixing it is one tap from where it is displayed rather than
 * somewhere in a settings tree.
 *
 * Pieces can be added to an existing work order — more of the same
 * order sent to the same person a week later belongs on the sheet
 * already issued, not on a second one — and removed from it.
 */

import { esc, on, openSheet, confirmSheet, toast, field } from '../ui.js';
import { inr, dmy, round2 } from '../format.js';
import * as subs from '../subs.js';
import { photoFor } from '../subphoto.js';
import { shareWorkOrder } from '../wopdf.js';

export function openWorkOrder(woId, { onDone } = {}) {
  const wo = subs.getWorkOrder(woId);
  if (!wo) return;
  const sub = subs.getSub(wo.subId);

  const draw = (sheet, handle) => {
    const items = subs.itemsIn(woId);
    const total = subs.woTotal(woId);
    const unpriced = items.filter((it) => !(it.rate > 0)).length;

    sheet.querySelector('.sheet-body').innerHTML = `
      <div class="kpis" style="margin-bottom:14px">
        <div class="kpi">
          <div class="kpi-l">WORK ORDER TOTAL</div>
          <div class="kpi-v num">${esc(inr(total))}</div>
          <div class="kpi-s">${items.length} piece${items.length === 1 ? '' : 's'}</div>
        </div>
        <div class="kpi">
          <div class="kpi-l">ISSUED</div>
          <div class="kpi-v" style="font-size:15px">${esc(dmy(wo.issueDate))}</div>
          <div class="kpi-s">${esc(sub ? sub.name : '')}</div>
        </div>
      </div>

      ${unpriced ? `<p class="hint" style="margin-bottom:12px">${unpriced} piece${unpriced === 1 ? ' has' : 's have'} no agreed rate yet — tap to set one.</p>` : ''}

      <p class="tray-lbl">Pieces</p>
      <div class="plist">
        ${items.length ? items.map((it) => {
          const img = photoFor(it);
          return `
            <button class="prow" data-item="${esc(it.id)}">
              <span class="thumb">${img ? `<img src="${esc(img)}" alt="">` : ''}</span>
              <span class="prow-txt">
                <span class="prow-t">${esc(it.name || 'Untitled piece')}</span>
                <span class="prow-s">${esc([it.mrNo, it.dims, it.qty > 1 ? `Qty ${it.qty}` : '', it.delivery ? `due ${dmy(it.delivery)}` : ''].filter(Boolean).join(' · '))}</span>
                ${it.remark ? `<span class="prow-s">${esc(it.remark)}</span>` : ''}
              </span>
              <span class="prow-qty num">${it.rate > 0
                ? esc(inr(subs.itemAmount(it)))
                : '<span class="pill warn sm">NO RATE</span>'}</span>
            </button>`;
        }).join('') : '<p class="hint">Nothing on this work order.</p>'}
      </div>

      <p class="tray-lbl sp">This work order</p>
      <button class="btn" data-share>Share as PDF</button>
      <button class="btn sec sm" data-add>Add a piece</button>
      <button class="btn sec sm" data-edit>Edit number and date</button>
      <button class="btn danger sm" data-del>Delete work order</button>`;

    on(sheet, '[data-item]', (e, b) => openItem(b.dataset.item, () => draw(sheet, handle)));

    on(sheet, '[data-share]', async () => {
      const how = await shareWorkOrder(woId);
      if (how === 'shared') toast('Sent');
      else if (how === 'downloaded') toast('Work order saved');
    });

    on(sheet, '[data-add]', async () => {
      const { openAssign } = await import('./assignwork.js');
      handle.close();
      // Adding to an existing work order means picking pieces for the
      // same person again; the assign flow already does exactly that.
      openAssign({ subId: wo.subId, onDone });
    });

    on(sheet, '[data-edit]', () => openWoEditor(woId, () => draw(sheet, handle)));

    on(sheet, '[data-del]', async () => {
      const ok = await confirmSheet({
        title: `Delete ${wo.no}?`,
        message: `The ${subs.itemsIn(woId).length} piece${subs.itemsIn(woId).length === 1 ? '' : 's'} on it and ${inr(subs.woTotal(woId))} of what ${sub ? sub.name : 'they'} are owed go with it. Payments already made are not touched.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (ok) {
        subs.deleteWorkOrder(woId);
        toast('Work order deleted');
        handle.close();
        if (onDone) onDone();
      }
    });
  };

  openSheet({
    title: `${wo.no}${sub ? ` · ${sub.name}` : ''}`,
    full: true,
    wide: true,
    body: '<div class="sheet-body"></div>',
    onClose() { if (onDone) onDone(); },
    onMount(sheet, handle) { draw(sheet, handle); },
  });
}

/* ── One piece ─────────────────────────────────────────────────
   The rate is first because it is what gets corrected. Everything
   else is here so a piece added by hand — one that never came off an
   order line — can still be described properly. */

function openItem(itemId, refresh) {
  const it = subs.getItem(itemId);
  if (!it) return;
  const img = photoFor(it);

  openSheet({
    title: it.name || 'Piece',
    body: `
      <div class="sheet-body">
        ${img ? `<div class="photo-wide"><img src="${esc(img)}" alt=""></div>` : ''}

        ${field('Rate', `<input class="inp num" data-f="rate" inputmode="decimal" value="${it.rate || ''}" placeholder="0">`,
          'What this sub-contractor quoted for their work on this piece. Leave blank if no rate has been agreed.')}
        ${field('Quantity', `<input class="inp num" data-f="qty" inputmode="numeric" value="${it.qty || 1}">`)}

        <div class="kpi" style="margin:4px 0 14px">
          <div class="kpi-l">LINE TOTAL</div>
          <div class="kpi-v num" data-line>${esc(inr(subs.itemAmount(it)))}</div>
        </div>

        ${field('Name', `<input class="inp" data-f="name" value="${esc(it.name)}" autocomplete="off">`)}
        ${field('MR No', `<input class="inp" data-f="mrNo" value="${esc(it.mrNo)}" autocomplete="off">`, 'Ties the piece to its order — and to its photograph')}
        ${field('Description', `<textarea class="inp" data-f="desc" rows="3">${esc(it.desc)}</textarea>`)}
        ${field('Dimensions', `<input class="inp" data-f="dims" value="${esc(it.dims)}" autocomplete="off">`)}
        ${field('Delivery date', `<input class="inp" type="date" data-f="delivery" value="${esc(it.delivery || '')}">`)}
        ${field('Remark', `<input class="inp" data-f="remark" value="${esc(it.remark || '')}" autocomplete="off">`)}

        <button class="btn" data-save>Save</button>
        <button class="btn danger sm" data-del>Remove from work order</button>
      </div>`,
    onMount(sheet, handle) {
      const live = () => {
        const rate = Number(sheet.querySelector('[data-f="rate"]').value) || 0;
        const qty = Number(sheet.querySelector('[data-f="qty"]').value) || 0;
        sheet.querySelector('[data-line]').textContent = inr(round2(rate * qty));
      };
      sheet.querySelector('[data-f="rate"]').addEventListener('input', live);
      sheet.querySelector('[data-f="qty"]').addEventListener('input', live);

      on(sheet, '[data-save]', () => {
        const get = (f) => (sheet.querySelector(`[data-f="${f}"]`).value || '').trim();
        subs.updateItem(itemId, {
          rate: Number(get('rate')) || 0,
          qty: Number(get('qty')) || 1,
          name: get('name'),
          mrNo: get('mrNo').toUpperCase(),
          desc: get('desc'),
          dims: get('dims'),
          delivery: get('delivery'),
          remark: get('remark'),
        });
        toast('Saved');
        handle.close();
        if (refresh) refresh();
      });

      on(sheet, '[data-del]', async () => {
        const ok = await confirmSheet({
          title: 'Remove this piece?',
          message: `${inr(subs.itemAmount(it))} comes off what they are owed.`,
          confirmLabel: 'Remove',
          danger: true,
        });
        if (ok) { subs.deleteItem(itemId); toast('Removed'); handle.close(); if (refresh) refresh(); }
      });
    },
  });
}

function openWoEditor(woId, refresh) {
  const wo = subs.getWorkOrder(woId);
  if (!wo) return;

  openSheet({
    title: 'Work order details',
    body: `
      <div class="sheet-body">
        ${field('Number', `<input class="inp" data-f="no" value="${esc(wo.no)}" autocomplete="off">`,
          'Numbered from the sub-contractor’s initials. Change it only to match a sheet already handed over.')}
        ${field('Issue date', `<input class="inp" type="date" data-f="issueDate" value="${esc(wo.issueDate || '')}">`)}
        ${field('Note', `<textarea class="inp" data-f="note" rows="2">${esc(wo.note || '')}</textarea>`)}
        <button class="btn" data-save>Save</button>
      </div>`,
    onMount(sheet, handle) {
      on(sheet, '[data-save]', () => {
        const get = (f) => (sheet.querySelector(`[data-f="${f}"]`).value || '').trim();
        const no = get('no');
        if (!no) { toast('A number is needed', 'bad'); return; }
        subs.updateWorkOrder(woId, { no, issueDate: get('issueDate'), note: get('note') });
        toast('Saved');
        handle.close();
        if (refresh) refresh();
      });
    },
  });
}
