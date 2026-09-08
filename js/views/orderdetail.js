/* views/orderdetail.js — one order, opened from any station.
 *
 * In production, QC, Shipping and Archive are four views of one
 * thing, so they open one sheet rather than four that drift apart.
 * What changes between them is which orders they list, never what
 * an order looks like once you are inside it.
 *
 * Everything here writes straight through to the store on change.
 * A piece's stage is moved on the floor, often with one hand and a
 * phone balanced on a workbench, and a Save button at the bottom of
 * a seven-piece list is a Save button that gets missed.
 */

import { icon } from '../icons.js';
import { on, esc, openSheet, toast, confirmSheet, field } from '../ui.js';
import {
  orderGroups, stageLabel, addLine, updateLine, deleteLine,
} from '../orders.js';
import { dmy, todayISO, inr } from '../format.js';
import * as subs from '../subs.js';
import { openItemBoard, stateChip } from './piecework.js';
import { lineThumb } from './thumbs.js';
import { nextButton, wireNext } from './nextstep.js';
import { openQuickAssign } from './quickassign.js';
import { toneOf } from './viewkit.js';

const TRADES = ['drawings', 'metal', 'wood', 'upholstery', 'marble', 'hardware', 'package'];

/**
 * Every piece under one MR number, each with its stage and the
 * sub-contractors named against it.
 * @param {string} mrNo
 * @param {() => void} onChanged  re-render whatever opened this
 */
export function openOrder(mrNo, onChanged = () => {}) {
  const find = () => orderGroups({}).find((x) => x.mrNo === mrNo);
  const g = find();
  if (!g) return;

  const h = openSheet({
    title: `${g.client || mrNo} · ${mrNo}`,
    full: true,
    wide: true,
    body: `
      <div class="sheet-body">
        <div class="odetail-head">
          <div class="odetail-dates">
            <div><dt>Order received</dt><dd>${g.orderReceived ? esc(dmy(g.orderReceived)) : '—'}</dd></div>
            <div><dt>Delivery date</dt><dd>${g.deliveryDate ? esc(dmy(g.deliveryDate)) : '—'}</dd></div>
            <div><dt>Pieces</dt><dd>${g.lines.length}</dd></div>
          </div>
        </div>
        <div data-pieces>${g.lines.map(pieceHTML).join('')}</div>
        <button class="btn sec sm" data-addpiece>${icon('plus', 15)} Add a piece to this order</button>
      </div>`,
    onMount(root, handle) {
      const repaint = () => {
        const fresh = find();
        if (!fresh) { handle.close(); onChanged(); return; }
        root.querySelector('[data-pieces]').innerHTML = fresh.lines.map(pieceHTML).join('');
        onChanged();
      };

      // Delegated, so the markup can be replaced under them freely.
      // The one thing that happens next to a piece, from its corner.
      wireNext(root, repaint);

      // Adding a maker never replaces one: a piece commonly carries
      // three, and each is its own commissioning.
      on(root, '[data-assignpiece]', (e, b) => {
        const line = (find() || { lines: [] }).lines.find((l) => l.id === b.dataset.assignpiece);
        if (line) openQuickAssign(line, repaint);
      });

      on(root, '[data-delpiece]', async (e, b) => {
        const ok = await confirmSheet({
          title: 'Remove this piece?',
          message: 'It is dropped from this order. Nothing else under this MR number is touched.',
          confirmLabel: 'Remove', danger: true,
        });
        if (!ok) return;
        deleteLine(b.dataset.delpiece);
        toast('Removed');
        repaint();
      });

      on(root, '[data-openwo]', async (e, b) => {
        const { openWorkOrder } = await import('./workorder.js');
        openWorkOrder(b.dataset.openwo, { onDone: repaint });
      });

      /* A commissioning opens the piece board rather than the work
         order: the question asked standing in front of a piece is
         how it is going, not what the paperwork says. The work
         order is one tap away on the sub-contractor's own screen. */
      on(root, '[data-openitem]', (e, b) => openItemBoard(b.dataset.openitem, repaint));

      on(root, '[data-addpiece]', () => {
        openPieceSheet({
          mrNo,
          client: g.client,
          orderReceived: g.orderReceived,
          deliveryDate: g.deliveryDate,
        }, repaint);
      });
    },
  });
  return h;
}

/* A piece card carries what somebody standing in front of the piece
   needs, and nothing else: what it is, what it is made of, who is
   making it, and the one thing that happens to it next.

   The stage used to be a dropdown of seven options, six of which
   were wrong. It is a pill now — a statement of where the piece is
   — and the button in the bottom right corner is the only way it
   moves. See views/nextstep.js for what that button does at each
   stage.

   The seven free-text vendor boxes are gone with it. Who is making
   a piece is a real record now: a person, a trade, a work order, a
   rate. One piece can carry several, because it usually does —
   metal to one man, upholstery to another, packing to a third — so
   the list grows and "Add sub-contractor" never replaces what is
   already there. Names typed into the old boxes are still shown,
   as a line of text, so nothing off the original sheets is lost. */
function pieceHTML(l) {
  const specs = [
    l.dims && ['Dimensions', l.dims],
    l.upholstery && ['Upholstery', [l.upholstery.name, l.upholstery.length].filter(Boolean).join(' · ')],
    l.metal && ['Metal', [l.metal.type, l.metal.finish].filter(Boolean).join(' · ')],
    l.wood && ['Wood', [l.wood.type, l.wood.finish].filter(Boolean).join(' · ')],
    l.others && ['Other', [l.others.type, l.others.finish].filter(Boolean).join(' · ')],
  ].filter((x) => x && x[1]);

  const tone = toneOf(l.stage);

  return `
    <section class="piece t-${tone}">
      <div class="piece-top">
        ${lineThumb(l)}
        <div class="piece-id">
          <div class="piece-n">${esc(l.name)}</div>
          ${l.specs ? `<p class="piece-spec">${esc(l.specs)}</p>` : ''}
        </div>
        <div class="piece-mark">
          <span class="pill sm ${l.stage === 'delivered' ? 'in' : 'mut'}">${esc(stageLabel(l.stage))}</span>
          <span class="prow-qty">×${l.qty || 1}</span>
        </div>
      </div>

      ${specs.length ? `
        <dl class="piece-specs">
          ${specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
        </dl>` : ''}

      ${makersHTML(l)}

      <div class="piece-foot">
        <button class="mini danger-txt" data-delpiece="${esc(l.id)}">${icon('trash', 13)} Remove piece</button>
        ${nextButton(l)}
      </div>
    </section>`;
}

/* Who is making it. Every assignment is a row — the person, what
   they are doing, how their part is going and what it is worth —
   and tapping one opens that piece's board, where the rate is set
   and the photographs of their work live.

   A piece nobody has been given yet says so plainly rather than
   showing an empty list. */
function makersHTML(l) {
  const items = subs.itemsForOrderLine(l.id);
  const named = TRADES
    .map((t) => [t, cleanVendor(l.vendors && l.vendors[t])])
    .filter(([t, v]) => v && !items.some((it) => it.trade === t));

  return `
    <div class="makers">
      <div class="makers-h">
        <span class="makers-t">Sub-contractors</span>
        <button class="mini" data-assignpiece="${esc(l.id)}">${icon('plus', 13)} Add sub-contractor</button>
      </div>

      ${items.length ? `
        <div class="makers-list">
          ${items.map((it) => {
            const wo = subs.getWorkOrder(it.woId);
            const person = wo && subs.getSub(wo.subId);
            if (!wo || !person) return '';
            return `
              <button class="maker" data-openitem="${esc(it.id)}">
                <span class="maker-n">${esc(person.name)}</span>
                <span class="maker-tr">${esc(subs.TRADE_LABELS[it.trade] || it.trade || 'Trade not set')}</span>
                <span class="maker-st">${stateChip(it)}</span>
                <span class="maker-v num">${it.rate > 0 ? esc(inr(subs.itemAmount(it))) : 'rate to agree'}</span>
              </button>`;
          }).join('')}
        </div>` : `
        <p class="makers-none">Nobody assigned yet</p>`}

      ${named.length ? `
        <p class="makers-old">On the original sheet: ${named
          .map(([t, v]) => `${esc(subs.TRADE_LABELS[t] || t)} — ${esc(v)}`).join(' · ')}</p>` : ''}
    </div>`;
}

/* "NA" is what the sheet wrote in a column that did not apply. It
   is not a supplier's name, so it does not belong in a field that
   is asking for one. */
function cleanVendor(v) {
  const s = String(v || '').trim();
  return s.toUpperCase() === 'NA' ? '' : s;
}

/* ── Adding a piece ────────────────────────────────────────────
   Opened either from inside an order (which fills in the number,
   the client and the dates) or cold from the floating button. */
export function openPieceSheet(prefill = {}, onSaved = () => {}) {
  const h = openSheet({
    title: prefill.mrNo ? `New piece · ${prefill.mrNo}` : 'New piece',
    body: `
      <div class="sheet-body">
        ${field('MR number', `<input class="control" data-f="mrNo" value="${esc(prefill.mrNo || '')}" autocapitalize="characters" placeholder="C129-1">`,
          'The manufacturing record this piece is made under. Reuse an existing number to add to that order.')}
        ${field('Client', `<input class="control" data-f="client" value="${esc(prefill.client || '')}" placeholder="Niraj Chandrani">`)}
        <div class="qb-grid">
          ${field('Order received', `<input class="control" type="date" data-f="orderReceived" value="${esc(prefill.orderReceived || todayISO())}">`)}
          ${field('Delivery date', `<input class="control" type="date" data-f="deliveryDate" value="${esc(prefill.deliveryDate || '')}">`)}
        </div>
        ${field('Name', `<input class="control" data-f="name" placeholder="Center table">`)}
        ${field('Specifications', `<textarea class="control" data-f="specs" rows="3" placeholder="Solid teak wood structure, brass element"></textarea>`)}
        <div class="qb-grid">
          ${field('Dimensions', `<input class="control" data-f="dims" placeholder="As per dimensions">`)}
          ${field('Qty', `<input class="control num" data-f="qty" type="number" inputmode="numeric" min="1" value="1">`)}
        </div>
        <button class="btn" data-save>Add piece</button>
      </div>`,
    onMount(root) {
      const get = (k) => root.querySelector(`[data-f="${k}"]`).value;
      on(root, '[data-save]', () => {
        const mrNo = get('mrNo').trim();
        if (!mrNo) return toast('An MR number is needed', 'warn');
        if (!get('name').trim()) return toast('Give the piece a name', 'warn');
        addLine({
          mrNo,
          client: get('client').trim(),
          orderReceived: get('orderReceived'),
          deliveryDate: get('deliveryDate'),
          name: get('name').trim(),
          specs: get('specs').trim(),
          dims: get('dims').trim(),
          qty: Number(get('qty')) || 1,
        });
        toast('Added');
        h.close();
        onSaved();
      });
    },
  });
  return h;
}
