/* views/assignwork.js — commissioning work, the way it is actually done.
 *
 * Somebody pulls up the order that is running, looks down the list of
 * pieces, decides these three go to the metal man and those two to the
 * upholsterer, and writes against each one what that person quoted.
 * That is the whole job, and this is that job in three steps:
 *
 *   1. pick the order
 *   2. tick the line items
 *   3. choose who, and type what they quoted for each
 *
 * What comes out is a numbered work order — WO-DC-004, following on
 * from whatever that person's last one was — holding those pieces at
 * those rates. It is immediately what they are owed, and it is what
 * prints (views/workorder.js).
 *
 * Two things this deliberately does not do. It does not touch the day
 * book: a rate agreed is a promise, not a payment, and the ledger is a
 * record of rupees that moved. And it does not offer anyone who is
 * blacklisted — that is what the flag is for.
 *
 * Assigning also writes the person's name onto the order line's own
 * `vendors` map for the trade in question, so the production floor,
 * which has always read who-has-what out of that map, keeps working
 * exactly as it did.
 */

import { esc, on, openSheet, toast, field, haptic } from '../ui.js';
import { inr, dmy, todayISO, round2 } from '../format.js';
import * as subs from '../subs.js';
import * as orders from '../orders.js';
import { photoFor } from '../subphoto.js';
import { openWorkOrder } from './workorder.js';

/**
 * @param {object}  opts
 * @param {string}  [opts.subId]  — skip step 3's picker, this person is chosen
 * @param {string}  [opts.mrNo]   — skip step 1, this order is chosen
 * @param {function}[opts.onDone] — called once a work order is created
 */
export function openAssign({ subId = '', mrNo = '', onDone } = {}) {
  if (mrNo) return pickLines(mrNo, subId, onDone);
  pickOrder(subId, onDone);
}

/* ── 1. Which order ────────────────────────────────────────────
   Delivered work is left out. Commissioning a piece that has already
   gone to the client is almost always a mis-tap, and the few genuine
   cases (a remake, a repair) are better started from the order
   itself. */

function pickOrder(subId, onDone) {
  let q = '';

  const groups = () => orders.orderGroups({ q })
    .filter((g) => g.stage !== 'delivered');

  openSheet({
    title: 'Commission work',
    full: true,
    wide: true,
    body: '<div class="sheet-body"></div>',
    onMount(sheet, handle) {
      const draw = () => {
        const list = groups();
        sheet.querySelector('.sheet-body').innerHTML = `
          <p class="hint" style="margin-bottom:12px">Pick the order the work comes out of.</p>
          <input class="inp" data-q value="${esc(q)}" placeholder="Search an order, a client or a piece" autocomplete="off">
          <div class="plist" style="margin-top:12px">
            ${list.length ? list.map((g) => `
              <button class="prow" data-mr="${esc(g.mrNo)}">
                <span class="prow-txt">
                  <span class="prow-t">${esc(g.mrNo)}${g.client ? ` · ${esc(g.client)}` : ''}</span>
                  <span class="prow-s">${g.lines.length} piece${g.lines.length === 1 ? '' : 's'}${g.deliveryDate ? ` · due ${esc(dmy(g.deliveryDate))}` : ''}</span>
                </span>
                <span class="pill ${g.stage === 'delivered' ? 'mut' : 'warn'}">${esc(orders.stageLabel(g.stage))}</span>
              </button>`).join('')
              : '<p class="hint">No orders running.</p>'}
          </div>`;

        const input = sheet.querySelector('[data-q]');
        input.addEventListener('input', () => {
          q = input.value;
          const at = input.selectionStart;
          draw();
          const next = sheet.querySelector('[data-q]');
          next.focus();
          next.setSelectionRange(at, at);
        });

        on(sheet, '[data-mr]', (e, b) => {
          handle.close();
          pickLines(b.dataset.mr, subId, onDone);
        });
      };
      draw();
    },
  });
}

/* ── 2. Which pieces ───────────────────────────────────────────
   Each row shows the photo, because that is how a piece is recognised
   here, and says who already holds it — a piece can genuinely go to
   two people (the wood man builds it, the upholsterer covers it), so
   an existing assignment is shown rather than blocked. */

function pickLines(mrNo, subId, onDone) {
  const group = orders.orderGroups({}).find((g) => g.mrNo === mrNo);
  if (!group) { toast('That order is gone', 'bad'); return; }

  const chosen = new Set();

  openSheet({
    title: `${mrNo}${group.client ? ` · ${group.client}` : ''}`,
    full: true,
    wide: true,
    body: `
      <div class="sheet-body">
        <p class="hint" style="margin-bottom:12px">Tick the pieces to send out.</p>
        <div class="plist" data-lines>
          ${group.lines.map((l) => {
            const held = subs.itemsForOrderLine(l.id);
            const img = photoFor({ orderLineId: l.id, mrNo: l.mrNo, name: l.name });
            return `
              <button class="prow pick" data-line="${esc(l.id)}">
                <span class="thumb">${img ? `<img src="${esc(img)}" alt="">` : ''}</span>
                <span class="prow-txt">
                  <span class="prow-t">${esc(l.name || 'Untitled piece')}</span>
                  <span class="prow-s">${esc([l.dims, l.qty > 1 ? `Qty ${l.qty}` : '', l.deliveryDate ? `due ${dmy(l.deliveryDate)}` : ''].filter(Boolean).join(' · '))}</span>
                  ${held.length ? `<span class="prow-s">Already with ${esc(held.map(heldName).filter(Boolean).join(', '))}</span>` : ''}
                </span>
                <span class="tick"></span>
              </button>`;
          }).join('')}
        </div>
        <button class="btn" data-next disabled>Choose who makes them</button>
      </div>`,
    onMount(sheet, handle) {
      const btn = sheet.querySelector('[data-next]');
      const sync = () => {
        btn.disabled = chosen.size === 0;
        btn.textContent = chosen.size
          ? `Choose who makes ${chosen.size} piece${chosen.size === 1 ? '' : 's'}`
          : 'Choose who makes them';
      };

      on(sheet, '[data-line]', (e, b) => {
        const id = b.dataset.line;
        if (chosen.has(id)) { chosen.delete(id); b.classList.remove('on'); }
        else { chosen.add(id); b.classList.add('on'); }
        haptic();
        sync();
      });

      on(sheet, '[data-next]', () => {
        const picked = group.lines.filter((l) => chosen.has(l.id));
        if (!picked.length) return;
        handle.close();
        if (subId) rates(subId, picked, group, onDone);
        else pickSub(picked, group, onDone);
      });
    },
  });
}

function heldName(item) {
  const wo = subs.getWorkOrder(item.woId);
  const s = wo && subs.getSub(wo.subId);
  return s ? s.name : '';
}

/* ── 3a. Who ───────────────────────────────────────────────────
   Blacklisted and archived people are not offered. Blacklisted ones
   are shown greyed with the reason, rather than hidden altogether, so
   the answer to "why isn't Keyur in this list" is on the screen. */

function pickSub(lines, group, onDone) {
  const active = subs.subs({});
  const blocked = subs.subs({ status: 'blacklisted' });

  openSheet({
    title: 'Who makes it',
    full: true,
    wide: true,
    body: `
      <div class="sheet-body">
        <div class="plist">
          ${active.length ? active.map((s) => {
            const bal = subs.balanceOf(s.id);
            const trades = (s.trades || []).map((t) => subs.TRADE_LABELS[t] || t).join(' · ');
            return `
              <button class="prow" data-sub="${esc(s.id)}">
                <span class="prow-txt">
                  <span class="prow-t">${esc(s.name)}</span>
                  <span class="prow-s">${esc([s.firm !== s.name ? s.firm : '', trades].filter(Boolean).join(' · ') || 'No trade recorded')}</span>
                </span>
                <span class="prow-qty num">${bal.due > 0 ? esc(inr(bal.due)) : ''}</span>
              </button>`;
          }).join('') : '<p class="hint">Nobody on the books yet.</p>'}
        </div>

        ${blocked.length ? `
          <p class="tray-lbl sp">Blacklisted — cannot be given work</p>
          <div class="plist">
            ${blocked.map((s) => `
              <div class="prow" style="opacity:.55">
                <span class="prow-txt">
                  <span class="prow-t">${esc(s.name)}</span>
                  <span class="prow-s">${esc(s.blacklistReason || 'Blacklisted')}</span>
                </span>
                <span class="pill out sm">BLACKLISTED</span>
              </div>`).join('')}
          </div>` : ''}
      </div>`,
    onMount(sheet, handle) {
      on(sheet, '[data-sub]', (e, b) => {
        handle.close();
        rates(b.dataset.sub, lines, group, onDone);
      });
    },
  });
}

/* ── 3b. What they quoted ──────────────────────────────────────
   One rate per piece, which is the number the whole balance is built
   out of. A rate may be left at zero — a piece sent out before a price
   was agreed is a real thing, and several rows in the imported history
   are exactly that — so it is allowed, and shown as unpriced rather
   than as free. */

function rates(subId, lines, group, onDone) {
  const s = subs.getSub(subId);
  if (!s) return;
  if (s.status === 'blacklisted') { toast(`${s.name} is blacklisted`, 'bad'); return; }

  const woNo = subs.nextWoNo(subId);

  openSheet({
    title: `${s.name} · ${woNo}`,
    full: true,
    wide: true,
    body: `
      <div class="sheet-body">
        <p class="hint" style="margin-bottom:12px">
          What ${esc(s.name)} quoted for their work on each piece — not what the piece sells for.
        </p>

        ${field('Trade', `
          <div class="chipbar" data-trades>
            ${subs.TRADES.map((t) => `
              <button type="button" class="chip ${(s.trades || [])[0] === t ? 'on' : ''}" data-trade="${t}">${esc(subs.TRADE_LABELS[t])}</button>`).join('')}
          </div>`, 'Written against each piece on the order sheet, so the production floor shows who has it')}

        ${field('Issue date', `<input class="inp" type="date" data-f="issued" value="${todayISO()}">`)}

        <p class="tray-lbl sp">Rates</p>
        <div class="plist" data-rows>
          ${lines.map((l) => {
            const img = photoFor({ orderLineId: l.id, mrNo: l.mrNo, name: l.name });
            return `
              <div class="prow rate-row">
                <span class="thumb">${img ? `<img src="${esc(img)}" alt="">` : ''}</span>
                <span class="prow-txt">
                  <span class="prow-t">${esc(l.name || 'Untitled piece')}</span>
                  <span class="prow-s">${esc([l.dims, `Qty ${l.qty || 1}`].filter(Boolean).join(' · '))}</span>
                </span>
                <input class="inp num rate" data-rate="${esc(l.id)}" inputmode="decimal" placeholder="0" style="max-width:104px">
              </div>`;
          }).join('')}
        </div>

        <div class="kpi" style="margin:14px 0">
          <div class="kpi-l">WORK ORDER TOTAL</div>
          <div class="kpi-v num" data-total>₹0</div>
        </div>

        <p class="hint">This is what they will be owed. Nothing is logged in the day book until you pay them.</p>
        <button class="btn" data-issue-wo>Create ${esc(woNo)}</button>
      </div>`,
    onMount(sheet, handle) {
      let trade = (s.trades || [])[0] || '';

      on(sheet, '[data-trade]', (e, b) => {
        sheet.querySelectorAll('[data-trade]').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        trade = b.dataset.trade;
        haptic();
      });

      const total = () => lines.reduce((n, l) => {
        const inp = sheet.querySelector(`[data-rate="${l.id}"]`);
        return n + (Number(inp.value) || 0) * (Number(l.qty) || 1);
      }, 0);

      const retotal = () => {
        sheet.querySelector('[data-total]').textContent = inr(round2(total()));
      };
      sheet.querySelectorAll('.rate').forEach((i) => i.addEventListener('input', retotal));

      on(sheet, '[data-issue-wo]', () => {
        const issued = sheet.querySelector('[data-f="issued"]').value || todayISO();

        const wo = subs.addWorkOrder({ subId, no: woNo, issueDate: issued });

        lines.forEach((l, i) => {
          const rate = Number(sheet.querySelector(`[data-rate="${l.id}"]`).value) || 0;
          subs.addItem({
            woId: wo.id,
            sr: i + 1,
            orderLineId: l.id,
            mrNo: l.mrNo,
            name: l.name,
            desc: l.specs || '',
            dims: l.dims || '',
            qty: l.qty || 1,
            delivery: l.deliveryDate || '',
            rate,
          });

          // The production floor has always read who-has-what out of
          // the order line itself, so the name goes there too and that
          // screen keeps working without knowing this one exists.
          if (trade) {
            const vendors = { ...(l.vendors || {}), [trade]: s.name };
            orders.updateLine(l.id, { vendors });
          }
        });

        toast(`${wo.no} issued to ${s.name} · ${inr(subs.woTotal(wo.id))}`);
        handle.close();
        if (onDone) onDone();
        openWorkOrder(wo.id, { onDone });
      });
    },
  });
}
