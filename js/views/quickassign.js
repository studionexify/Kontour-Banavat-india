/* views/quickassign.js — hand one piece to one person.
 *
 * The full commissioning flow (views/assignwork.js) is for the other
 * shape of the same job: sitting down with an order, ticking five
 * pieces, agreeing five rates, issuing a numbered work order. That is
 * the right flow at a desk and the wrong one standing at a bench,
 * where the decision is already made and the only question is who.
 *
 * So this asks two things — who, and for what trade — and gets out of
 * the way. A work order is created against that person if they have no
 * open one, the piece is added to it at no rate, and the piece moves to
 * Commission, because a piece somebody is holding is a piece that has
 * been commissioned.
 *
 * The rate follows later, from the Sub-Contractor screen or by tapping
 * the assignment on the piece. Nothing here touches the day book: an
 * agreement is not a payment.
 *
 * One piece can be handed to several people — metal to one, upholstery
 * to another, packing to a third — so this never replaces an existing
 * assignment. It adds one.
 */

import { icon } from '../icons.js';
import { esc, on, openSheet, toast, haptic } from '../ui.js';
import { todayISO } from '../format.js';
import * as subs from '../subs.js';
import * as orders from '../orders.js';
import { lineImage } from './thumbs.js';

/**
 * @param {object} line — the order line being handed out
 * @param {function} onDone — redraw whatever was showing
 * @param {string} [trade] — pre-picked, when the caller knows it
 */
export function openQuickAssign(line, onDone = () => {}, trade = '') {
  if (!line) return;
  subs.load();

  let subId = '';
  let pick = trade;
  let query = '';

  const people = () => subs.subs({ q: query })
    .filter((s) => s.status !== 'blacklisted');

  const img = lineImage(line);

  const handle = openSheet({
    title: 'Who is making it',
    body: `
      <div class="sheet-body">
        <div class="qa-piece">
          ${img ? `<img class="qa-img" src="${esc(img)}" alt="">`
                : `<span class="qa-img ph">${icon('box', 22)}</span>`}
          <div>
            <div class="qa-name">${esc(line.name || 'This piece')}</div>
            <div class="qa-sub">${esc([line.mrNo, line.client, line.qty > 1 ? `Qty ${line.qty}` : ''].filter(Boolean).join(' · '))}</div>
          </div>
        </div>

        <p class="tray-lbl">Trade</p>
        <div class="chipbar" data-trades>
          ${subs.TRADES.map((t) => `
            <button type="button" class="chip ${t === pick ? 'on' : ''}" data-trade="${esc(t)}">
              ${esc(subs.TRADE_LABELS[t] || t)}
            </button>`).join('')}
        </div>

        <p class="tray-lbl sp">Sub-contractor</p>
        <div class="searchbar">
          <span class="searchbar-ico">${icon('search', 17)}</span>
          <input class="control" type="search" data-q placeholder="Search a name, a firm or a trade" aria-label="Search sub-contractors">
        </div>
        <div class="plist" data-people></div>

        <button class="btn" data-assign disabled>Assign</button>
        <p class="hint">No rate needed now — it can be agreed later, on the
          Sub-Contractor screen or by tapping this assignment on the piece.</p>
      </div>`,

    onMount(sheet) {
      const list = sheet.querySelector('[data-people]');
      const btn = sheet.querySelector('[data-assign]');

      /* Whoever already works in the chosen trade comes first: the
         person you want is nearly always one of two or three. */
      const paint = () => {
        const rows = [...people()].sort((a, b) => {
          const at = (a.trades || []).includes(pick) ? 0 : 1;
          const bt = (b.trades || []).includes(pick) ? 0 : 1;
          return at - bt || a.name.localeCompare(b.name);
        });
        list.innerHTML = rows.length ? rows.map((s) => {
          const open = subs.itemsInState(['working', 'improve', 'rejected'], { subId: s.id }).length;
          const does = (s.trades || []).map((t) => subs.TRADE_LABELS[t] || t).join(' · ');
          return `
            <button class="prow qa-row ${s.id === subId ? 'on' : ''}" data-pick="${esc(s.id)}">
              <span class="vcard-ini">${esc(subs.initialsOf(s.name))}</span>
              <span class="prow-txt">
                <span class="prow-t">${esc(s.name)}</span>
                <span class="prow-s">${esc([does, open ? `${open} piece${open === 1 ? '' : 's'} in hand` : ''].filter(Boolean).join(' · ') || 'No trade recorded')}</span>
              </span>
              ${s.id === subId ? `<span class="qa-tick">${icon('check', 15)}</span>` : ''}
            </button>`;
        }).join('') : '<p class="hint" style="padding:8px 2px">Nobody matches that.</p>';

        btn.disabled = !(subId && pick);
        btn.textContent = subId && pick
          ? `Assign to ${(subs.getSub(subId) || {}).name || 'them'}`
          : (pick ? 'Choose a sub-contractor' : 'Choose a trade');
      };
      paint();

      on(sheet, '[data-trade]', (e, b) => {
        pick = b.dataset.trade;
        sheet.querySelectorAll('[data-trade]').forEach((x) => x.classList.toggle('on', x === b));
        haptic();
        paint();
      });

      on(sheet, '[data-pick]', (e, b) => {
        subId = subId === b.dataset.pick ? '' : b.dataset.pick;
        haptic();
        paint();
      });

      const q = sheet.querySelector('[data-q]');
      q.addEventListener('input', () => { query = q.value; paint(); });

      on(sheet, '[data-assign]', () => {
        if (!subId || !pick) return;
        assign(line, subId, pick);
        handle.close();
        onDone();
      });
    },
  });

  return handle;
}

/* The record this makes, in one place so the card and the board
   cannot make two different shapes of it.
 *
 * A person's newest work order is reused while it is still open —
 * nothing on it approved yet — so handing somebody three pieces over
 * an afternoon is one work order and not three. */
function assign(line, subId, trade) {
  const person = subs.getSub(subId);
  if (!person) return null;

  const open = subs.workOrdersOf(subId)
    .filter((w) => subs.itemsIn(w.id).some((it) => it.state !== 'approved'))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

  const wo = open || subs.addWorkOrder({ subId, issueDate: todayISO() });

  subs.addItem({
    woId: wo.id,
    orderLineId: line.id,
    mrNo: line.mrNo,
    name: line.name,
    desc: line.specs || '',
    dims: line.dims || '',
    qty: line.qty || 1,
    delivery: line.deliveryDate || '',
    rate: 0,
    trade,
  });

  // The floor has always read who-has-what off the order line itself,
  // so the name goes there too and every screen that reads it keeps
  // working without knowing this sheet exists.
  const vendors = { ...(line.vendors || {}), [trade]: person.name };
  const changes = { vendors };
  // A piece somebody is holding is commissioned. Later stages are
  // left alone: assigning a second trade to a piece already in
  // production must not walk it backwards.
  if (['pending', 'drawings'].includes(line.stage)) changes.stage = 'commission';
  orders.updateLine(line.id, changes);

  toast(`${line.name || 'Piece'} → ${person.name} · ${subs.TRADE_LABELS[trade] || trade} (${wo.no})`);
  return wo;
}
