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
import { on, esc, openSheet, toast, confirmSheet, field, haptic } from '../ui.js';
import {
  orderGroups, STAGES, stationOf, addLine, updateLine, deleteLine,
} from '../orders.js';
import { dmy, todayISO, inr } from '../format.js';
import * as subs from '../subs.js';
import { openItemBoard, stateChip } from './piecework.js';
import { lineThumb } from './thumbs.js';

const TRADES = ['drawings', 'metal', 'wood', 'upholstery', 'marble', 'hardware', 'package'];

const TINT = {
  inproduction: 'prod', qc: 'qc', shipping: 'ship', archive: 'done',
};

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
      on(root, '[data-stage]', (e, b) => {
        updateLine(b.dataset.stage, { stage: b.value });
        haptic(8);
        toast('Moved to ' + b.options[b.selectedIndex].text);
        repaint();
      });

      root.addEventListener('change', (e) => {
        const t = e.target;
        if (!t.dataset || !t.dataset.vendor) return;
        const [id, trade] = t.dataset.vendor.split('|');
        const line = find().lines.find((l) => l.id === id);
        if (!line) return;
        updateLine(id, { vendors: { ...(line.vendors || {}), [trade]: t.value.trim() } });
        onChanged();
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

      on(root, '[data-sendout]', async (e, b) => {
        const { openAssign } = await import('./assignwork.js');
        openAssign({ mrNo, onDone: repaint });
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

/* A piece carries three kinds of fact, and they are not equally
   busy: what it is (read, rarely), where it has got to (changed
   often), and who is making it (changed once, checked often). So
   the stage sits open at the top and the rest folds away. */
function pieceHTML(l) {
  const tint = TINT[stationOf(l.stage)] || 'prod';
  const specs = [
    l.dims && ['Dimensions', l.dims],
    l.upholstery && ['Upholstery', [l.upholstery.name, l.upholstery.length].filter(Boolean).join(' · ')],
    l.metal && ['Metal', [l.metal.type, l.metal.finish].filter(Boolean).join(' · ')],
    l.wood && ['Wood', [l.wood.type, l.wood.finish].filter(Boolean).join(' · ')],
    l.others && ['Other', [l.others.type, l.others.finish].filter(Boolean).join(' · ')],
  ].filter((x) => x && x[1]);

  return `
    <section class="piece t-${tint}">
      <div class="piece-top">
        ${lineThumb(l)}
        <div class="piece-id">
          <div class="piece-n">${esc(l.name)}</div>
          ${l.specs ? `<p class="piece-spec">${esc(l.specs)}</p>` : ''}
        </div>
        <span class="prow-qty">×${l.qty || 1}</span>
      </div>

      <label class="piece-stage">
        <span>Stage</span>
        <select class="control flush" data-stage="${esc(l.id)}">
          <option value="pending" ${l.stage === 'pending' ? 'selected' : ''}>Pending</option>
          ${STAGES.map((s) => `<option value="${s.key}" ${l.stage === s.key ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
      </label>

      ${specs.length ? `
        <details class="qdisc tight">
          <summary>${icon('chevR', 15)}<span class="qdisc-t">Specification</span></summary>
          <dl class="piece-specs">
            ${specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
          </dl>
        </details>` : ''}

      <details class="qdisc tight">
        <summary>${icon('chevR', 15)}<span class="qdisc-t">Sub-contractors</span>
          <span class="qdisc-v">${namedCount(l)}</span></summary>
        <div class="piece-vendors">
          ${TRADES.map((t) => `
            <label class="qpair">
              <span class="qpair-l">${t[0].toUpperCase()}${t.slice(1)}</span>
              <input class="control flush" data-vendor="${esc(l.id)}|${t}"
                     value="${esc(cleanVendor(l.vendors && l.vendors[t]))}" placeholder="—">
            </label>`).join('')}
        </div>
        ${commissionedHTML(l)}
        <button class="mini" data-sendout="${esc(l.id)}">${icon('plus', 13)} Commission this piece</button>
      </details>

      <button class="mini danger-txt" data-delpiece="${esc(l.id)}">${icon('trash', 13)} Remove piece</button>
    </section>`;
}

/* "NA" is what the sheet wrote in a column that did not apply. It
   is not a supplier's name, so it does not belong in a field that
   is asking for one. */
function cleanVendor(v) {
  const s = String(v || '').trim();
  return s.toUpperCase() === 'NA' ? '' : s;
}

/* What has actually been commissioned against this piece, and for how
   much. The names above are free text — who is meant to make it — and
   this is the money side: a numbered work order at an agreed rate.
   Kept beside them because the two answer the same question at
   different levels of commitment. */
function commissionedHTML(l) {
  const items = subs.itemsForOrderLine(l.id);
  if (!items.length) return '';
  return `
    <div class="piece-commissioned">
      ${items.map((it) => {
        const wo = subs.getWorkOrder(it.woId);
        const s = wo && subs.getSub(wo.subId);
        if (!wo || !s) return '';
        return `
          <button class="qpair as-row" data-openitem="${esc(it.id)}">
            <span class="qpair-l">${esc(s.name)}${it.trade ? ` · ${esc(subs.TRADE_LABELS[it.trade] || it.trade)}` : ''}</span>
            <span class="qpair-v">${stateChip(it)} ${esc(wo.no)} · ${it.rate > 0 ? esc(inr(subs.itemAmount(it))) : 'no rate'}</span>
          </button>`;
      }).join('')}
    </div>`;
}

function namedCount(l) {
  const n = TRADES.filter((t) => cleanVendor(l.vendors && l.vendors[t])).length;
  return n ? `${n} named` : 'none yet';
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
