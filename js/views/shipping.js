/* views/shipping.js — what has left, and what is waiting to.
 *
 * A piece that has passed QC is packed and out of the workshop's
 * hands but not yet the client's, and that gap is the only thing
 * this screen is about. Marking it delivered files the order into
 * Archive, which is the last move a piece makes.
 *
 * The despatch details — courier, docket number, vehicle, who
 * signed for it — are still being specified, so for now the screen
 * carries the queue and the one action that actually closes a job.
 */

import { icon } from '../icons.js';
import { on, esc, toast, haptic, openSheet, field, confirmSheet } from '../ui.js';
import {
  linesAt, groupsAt, updateLine, isOverdue, linesByMr,
  DESPATCH_MODES, despatchOf, setDespatch,
} from '../orders.js';
import { dmy, todayISO, inr } from '../format.js';
import { addEntry } from '../store.js';
import { pageHead, statCards, searchBar, orderCard, nothingHere, sectionHead } from './chrome.js';
import { wire } from './production.js';

let query = '';

export function render(root, ctx) {
  const pieces = linesAt('shipping');
  const groups = groupsAt('shipping', { q: query });
  const allGroups = groupsAt('shipping', {});
  const late = allGroups.filter(isOverdue).length;

  root.innerHTML = `
    <div class="floor">
      ${pageHead({
        title: 'Shipping',
        sub: `${pieces.length} piece${pieces.length === 1 ? '' : 's'} packed and on their way`,
      })}

      ${statCards([
        { label: 'Ready to ship', value: allGroups.length, tone: 'ship', hint: 'orders' },
        { label: 'Pieces out', value: pieces.length, hint: 'passed QC' },
        { label: 'Past due date', value: late, tone: late ? 'sub' : '' },
      ])}

      ${searchBar(query, 'Search client, MR number')}

      ${sectionHead('Out for delivery')}
      ${groups.length ? `<div class="olist">${groups.map(card).join('')}</div>`
        : nothingHere('truck', query ? 'Nothing matches' : 'Nothing shipping right now',
            query ? 'Try another search' : 'Pieces arrive here once they pass QC')}

      ${pieces.length ? `
        ${sectionHead('Piece by piece')}
        <div class="plist">${pieces.map(pieceRow).join('')}</div>` : ''}
    </div>`;

  wire(root, ctx, { onSearch: (v) => { query = v; } });

  on(root, '[data-delivered]', (e, b) => {
    e.stopPropagation();
    updateLine(b.dataset.delivered, { stage: 'delivered' });
    haptic(10);
    toast('Marked delivered');
    ctx.refresh();
  });

  on(root, '[data-despatch]', (e, b) => {
    e.stopPropagation();
    openDespatch(b.dataset.despatch, ctx.refresh);
  });

  on(root, '[data-close-order]', async (e, b) => {
    e.stopPropagation();
    const mrNo = b.dataset.closeOrder;
    const ok = await confirmSheet({
      title: `Close ${mrNo}?`,
      message: 'Every piece is marked delivered and the order moves to Archive. Nothing is deleted.',
      confirmLabel: 'Mark delivered',
    });
    if (!ok) return;
    for (const l of linesByMr(mrNo)) {
      if (l.stage === 'shipped') updateLine(l.id, { stage: 'delivered' });
    }
    haptic(10);
    toast(`${mrNo} delivered`);
    ctx.refresh();
  });
}

function card(g) {
  const d = g.despatch;
  const meta = [`${g.lines.length} piece${g.lines.length === 1 ? '' : 's'}`];
  if (g.deliveryDate) meta.push(`due ${dmy(g.deliveryDate)}`);
  if (d) meta.push(DESPATCH_MODES[d.mode] ? DESPATCH_MODES[d.mode].label : d.mode);
  const late = isOverdue(g);
  return `
    <div class="shipcard">
      ${orderCard({
        id: g.mrNo, mrNo: g.mrNo, client: g.client, meta,
        tint: late ? 'sub' : 'ship',
        pill: late ? 'Past due' : (d ? 'Despatched' : 'To despatch'),
        pillTone: late ? 'out' : (d ? 'in' : 'warn'),
      })}
      <div class="shipacts">
        <button class="mini" data-despatch="${esc(g.mrNo)}">${icon('truck', 13)} ${d ? 'Despatch details' : 'How it leaves'}</button>
        <button class="mini ok" data-close-order="${esc(g.mrNo)}">${icon('check', 13)} Delivered</button>
      </div>
    </div>`;
}

/* ── How an order actually left ────────────────────────────────
   Not everything is couriered: some clients collect from the
   office, some jobs go out on a Porter, some we install ourselves.
   The mode is picked first because it decides what the second field
   is even called, and the cost — when there is one — is posted to
   the job in Phynance from right here, so a Porter trip is never a
   payment somebody has to remember to enter twice.

   Client pickup is the one mode with no cost field. Nothing left our
   hands to pay for. */

function openDespatch(mrNo, onDone) {
  const current = despatchOf(mrNo) || {};
  let mode = current.mode || 'courier';

  const CATEGORY = { courier: 'c_trans', local: 'c_porter', install: 'c_trans', pickup: '' };

  openSheet({
    title: `Despatch · ${mrNo}`,
    body: `
      <div class="sheet-body">
        <p class="sheet-lede">How this order leaves the workshop. Recorded on every piece in it.</p>

        ${field('How it leaves', `
          <div class="chipbar" data-modes>
            ${Object.entries(DESPATCH_MODES).map(([k, v]) => `
              <button type="button" class="chip ${k === mode ? 'on' : ''}" data-mode="${k}">${esc(v.label)}</button>`).join('')}
          </div>`)}

        ${field('Date', `<input class="control" type="date" data-f="date" value="${esc(current.date || todayISO())}">`)}

        <div class="field">
          <label data-detail-label>Docket or LR number</label>
          <input class="control" data-f="ref" value="${esc(current.ref || '')}" autocomplete="off">
        </div>

        ${field('Who has it', `<input class="control" data-f="party" value="${esc(current.party || '')}" placeholder="Courier, driver or the person collecting" autocomplete="off">`)}

        <div data-cost-wrap>
          ${field('Delivery cost',
            `<input class="control num" data-f="cost" type="number" inputmode="decimal" value="${esc(String(current.cost || ''))}" placeholder="0">`,
            'Posted as an expense against this job in Phynance. Leave blank if there is nothing to pay.')}
        </div>

        ${field('Note', `<input class="control" data-f="note" value="${esc(current.note || '')}" placeholder="Anything worth remembering" autocomplete="off">`)}

        <button class="btn" data-save>Save despatch</button>
      </div>`,
    onMount(sheet, handle) {
      const paint = () => {
        sheet.querySelector('[data-detail-label]').textContent = DESPATCH_MODES[mode].detail;
        sheet.querySelector('[data-cost-wrap]').style.display = mode === 'pickup' ? 'none' : '';
      };
      paint();

      on(sheet, '[data-mode]', (e, b) => {
        sheet.querySelectorAll('[data-mode]').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        mode = b.dataset.mode;
        haptic();
        paint();
      });

      on(sheet, '[data-save]', () => {
        const get = (f) => (sheet.querySelector(`[data-f="${f}"]`) || {}).value || '';
        const cost = mode === 'pickup' ? 0 : Number(get('cost')) || 0;
        const date = get('date') || todayISO();

        const record = {
          mode,
          date,
          ref: get('ref').trim(),
          party: get('party').trim(),
          note: get('note').trim(),
          cost,
          // The ledger entry this despatch already wrote, so saving
          // the record twice does not charge the job twice.
          entryId: current.entryId || '',
        };

        if (cost > 0 && !record.entryId) {
          const entry = addEntry({
            type: 'out',
            date,
            entered: cost,
            jobCode: mrNo,
            categoryId: CATEGORY[mode] || 'c_trans',
            party: record.party,
            note: `Delivery — ${DESPATCH_MODES[mode].label}${record.ref ? ` (${record.ref})` : ''}`,
          });
          if (entry) record.entryId = entry.id;
        }

        setDespatch(mrNo, record);
        toast(record.entryId && cost > 0
          ? `Despatch saved · ${inr(cost)} booked to ${mrNo}`
          : 'Despatch saved');
        handle.close();
        if (onDone) onDone();
      });
    },
  });
}

function pieceRow(l) {
  return `
    <article class="prow" data-open="${esc(l.mrNo)}" tabindex="0" role="button">
      <span class="prow-txt">
        <span class="prow-t">${esc(l.name)}</span>
        <span class="prow-s">${esc(l.mrNo)}${l.client ? ` · ${esc(l.client)}` : ''}</span>
      </span>
      <button class="mini ok" data-delivered="${esc(l.id)}">${icon('check', 13)} Delivered</button>
    </article>`;
}
