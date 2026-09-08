/* views/shipping.js — what has left, and what is waiting to.
 *
 * A piece that has passed QC is packed and out of the workshop's
 * hands but not yet the client's, and that gap is the only thing
 * this screen is about.
 *
 * The unit here is the piece, not the order. A finished mirror goes
 * out on Tuesday whether or not the sofa quoted under the same
 * number is still being made, and the client who collects two side
 * tables from the office has not collected the dining table. So
 * every piece carries its own despatch — how it left, with what
 * reference, and what the delivery cost — and its own delivered
 * stamp. Pieces are grouped under their order because that is how
 * they are read, not because they move together.
 *
 * Several pieces leaving on one trip are still one trip: the
 * despatch sheet offers the order's other waiting pieces, and what
 * you tick shares one record and one ledger entry.
 */

import { icon } from '../icons.js';
import { on, esc, toast, haptic, openSheet, field, confirmSheet } from '../ui.js';
import {
  linesAt, groupsAt, updateLine, linesByMr, getLine,
  DESPATCH_MODES, despatchOf, setDespatch,
} from '../orders.js';
import { dmy, dayLabel, todayISO, inr } from '../format.js';
import { addEntry } from '../store.js';
import { pageHead, statCards, searchBar, nothingHere, sectionHead } from './chrome.js';
import { wire } from './production.js';
import { viewToggle, wireViewToggle, cardGrid, bigCard } from './viewkit.js';
import { lineThumb, coverStrip } from './thumbs.js';
import { nextButton, wireNext } from './nextstep.js';

let query = '';

/* Shipping is read one order at a time — is this client's lot all
   out, and on what — so the card is the default here and the flat
   list is the alternative rather than the other way round. */
let view = 'cards';

const VIEWS = [
  { key: 'cards', label: 'Cards', icon: 'grid' },
  { key: 'list', label: 'List', icon: 'rows' },
];

export function render(root, ctx) {
  const pieces = linesAt('shipping');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? pieces.filter((l) => `${l.name} ${l.mrNo} ${l.client}`.toLowerCase().includes(needle))
    : pieces;
  const allGroups = groupsAt('shipping', {});
  const waiting = pieces.filter((l) => !l.despatch).length;
  const late = pieces.filter((l) => l.deliveryDate && l.deliveryDate < todayISO()).length;

  // Grouped for reading, not for acting: every button below is on a
  // piece. Order of groups follows the piece list, so whatever is
  // most recently ready is nearest the top.
  const byMr = new Map();
  for (const l of shown) {
    if (!byMr.has(l.mrNo)) byMr.set(l.mrNo, []);
    byMr.get(l.mrNo).push(l);
  }

  root.innerHTML = `
    <div class="floor">
      ${pageHead({
        title: 'Shipping',
        sub: `${pieces.length} piece${pieces.length === 1 ? '' : 's'} packed and on their way`,
      })}

      ${statCards([
        { label: 'To despatch', value: waiting, tone: waiting ? 'ship' : '', hint: 'no details yet' },
        { label: 'Pieces out', value: pieces.length, hint: `across ${allGroups.length || byMr.size} order${(allGroups.length || byMr.size) === 1 ? '' : 's'}` },
        { label: 'Past due date', value: late, tone: late ? 'sub' : '' },
      ])}

      ${searchBar(query, 'Search piece, client, MR number')}

      ${sectionHead('Out of the workshop', viewToggle(VIEWS, view))}

      ${byMr.size ? (view === 'cards'
        ? cardGrid([...byMr.entries()].map(([mrNo, group]) => orderShipCard(mrNo, group)))
        : [...byMr.entries()].map(([mrNo, group]) => `
          ${sectionHead(`${mrNo}${group[0].client ? ` · ${group[0].client}` : ''}`,
            `<span class="sec-link">${group.length} piece${group.length === 1 ? '' : 's'} ready</span>`)}
          <div class="plist" style="margin-bottom:20px">${group.map(pieceRow).join('')}</div>`).join(''))
        : nothingHere('truck', query ? 'Nothing matches' : 'Nothing shipping right now',
            query ? 'Try another search' : 'Pieces arrive here once they pass QC')}
    </div>`;

  wire(root, ctx, { onSearch: (v) => { query = v; } });
  wireViewToggle(root, (v) => { view = v; ctx.refresh(); });
  wireNext(root, ctx.refresh);

  on(root, '[data-delivered]', async (e, b) => {
    e.stopPropagation();
    const l = getLine(b.dataset.delivered);
    if (!l) return;
    if (!l.despatch) {
      const ok = await confirmSheet({
        title: 'No despatch details',
        message: `Nothing is recorded about how ${l.name || 'this piece'} left. Mark it delivered anyway?`,
        confirmLabel: 'Mark delivered',
      });
      if (!ok) return;
    }
    updateLine(l.id, { stage: 'delivered' });
    haptic(10);
    toast('Marked delivered');
    ctx.refresh();
  });

  on(root, '[data-despatch]', (e, b) => {
    e.stopPropagation();
    openDespatch(b.dataset.despatch, ctx.refresh);
  });
}

/* ── One order, as a card ──────────────────────────────────────
   Everything of one number that is standing at Shipping: how many
   pieces, how many still have no despatch against them, and the
   pieces themselves with their own colour — green once they have a
   despatch record, amber while they do not, red once the date they
   were wanted has passed. The two buttons stay on the piece, on the
   card as in the list, because despatching is per piece.

   The card body opens the order; its buttons do not, which is why
   wire() checks where the tap landed. */
function orderShipCard(mrNo, group) {
  const today = todayISO();
  const waiting = group.filter((l) => !l.despatch).length;
  const late = group.filter((l) => l.deliveryDate && l.deliveryDate < today).length;
  const due = group.map((l) => l.deliveryDate).filter(Boolean).sort()[0] || '';

  return bigCard({
    id: mrNo,
    mrNo,
    title: group[0].client || 'Unnamed client',
    tone: late ? 'sub' : waiting ? 'ship' : 'done',
    pill: waiting ? `${waiting} to despatch` : 'All despatched',
    pillTone: waiting ? 'warn' : 'in',
    // The pieces themselves, so the card is recognisable across the
    // room the way the order is on the floor.
    media: coverStrip({ lines: group }),
    stats: [
      { label: 'Pieces', value: group.length },
      { label: 'Despatched', value: group.length - waiting },
      { label: due ? 'Due' : 'No date', value: due ? dayLabel(due) : '—' },
    ],
    lines: group.map((l) => {
      const d = l.despatch;
      const mode = d && DESPATCH_MODES[d.mode] ? DESPATCH_MODES[d.mode].label : '';
      const overdue = l.deliveryDate && l.deliveryDate < today;
      return {
        text: `${l.name || 'Untitled piece'}${l.qty > 1 ? ` ×${l.qty}` : ''}`,
        right: d ? [mode, d.ref].filter(Boolean).join(' · ') : 'awaiting despatch',
        tone: d ? 'done' : overdue ? 'sub' : 'ship',
      };
    }),
    foot: group.map((l) => `
      <span class="bigcard-act">
        <span class="bigcard-act-n">${esc(shortName(l))}</span>
        ${pieceActs(l)}
      </span>`).join(''),
  });
}

/* The one thing that happens to this piece next, in the corner, with
   the exception beside it. A piece with no despatch on file is asked
   for one; a piece that has one is asked whether the client has it.
   Marking a piece delivered with nothing recorded about how it left
   is still possible — it is just no longer the obvious button. */
function pieceActs(l) {
  return `
    ${l.despatch
      ? `<button class="mini" data-despatch="${esc(l.id)}">${icon('truck', 13)} Details</button>`
      : `<button class="mini" data-delivered="${esc(l.id)}">${icon('check', 13)} Delivered</button>`}
    ${nextButton(l, 'sm')}`;
}

function shortName(l) {
  const n = l.name || 'piece';
  return n.length > 18 ? `${n.slice(0, 17)}…` : n;
}

function pieceRow(l) {
  const d = l.despatch;
  const mode = d && DESPATCH_MODES[d.mode] ? DESPATCH_MODES[d.mode].label : '';
  const bits = [
    l.qty > 1 ? `Qty ${l.qty}` : '',
    l.deliveryDate ? `due ${dmy(l.deliveryDate)}` : '',
    d ? [mode, d.ref].filter(Boolean).join(' · ') : 'No despatch details yet',
  ].filter(Boolean);
  return `
    <article class="prow shiprow" data-open="${esc(l.mrNo)}" tabindex="0" role="button">
      ${lineThumb(l, 'sm')}
      <span class="prow-txt">
        <span class="prow-t">${esc(l.name || 'Untitled piece')}</span>
        <span class="prow-s">${esc(bits.join(' · '))}</span>
      </span>
      <span class="qcrow-acts">${pieceActs(l)}</span>
    </article>`;
}

/* ── How a piece actually left ────────────────────────────────
   Not everything is couriered: some clients collect from the
   office, some jobs go out on a Porter, some we install ourselves.
   The mode is picked first because it decides what the second field
   is even called, and the cost — when there is one — is posted to
   the job in Phynance from right here, so a Porter trip is never a
   payment somebody has to remember to enter twice.

   Client pickup is the one mode with no cost field. Nothing left
   our hands to pay for.

   The other pieces of the same order that are also waiting are
   offered underneath, unticked. Tick the ones on the same trip and
   they share this record — and its single ledger entry — rather
   than each being typed again. */

/* Exported for the next-process button: despatching a piece is one
   flow wherever it is started from. */
export function openDespatch(lineId, onDone) {
  const line = getLine(lineId);
  if (!line) return;
  const current = despatchOf(lineId) || {};
  let mode = current.mode || 'courier';

  const CATEGORY = { courier: 'c_trans', local: 'c_porter', install: 'c_trans', pickup: '' };

  // Everything else under this number still standing at Shipping.
  // Pieces already despatched are left out: they left on their own
  // trip, and a second record would double the cost.
  const alsoWaiting = linesByMr(line.mrNo)
    .filter((l) => l.id !== lineId && l.stage === 'shipped' && !l.despatch);

  openSheet({
    title: `Despatch · ${line.name || line.mrNo}`,
    body: `
      <div class="sheet-body">
        <p class="sheet-lede">${esc(line.name || 'This piece')} · ${esc(line.mrNo)}${line.client ? ` · ${esc(line.client)}` : ''}</p>

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
            'Posted once as an expense against this job in Phynance, however many pieces go on the trip. Leave blank if there is nothing to pay.')}
        </div>

        ${field('Note', `<input class="control" data-f="note" value="${esc(current.note || '')}" placeholder="Anything worth remembering" autocomplete="off">`)}

        ${alsoWaiting.length ? `
          <p class="tray-lbl sp">Going on the same trip?</p>
          <p class="hint" style="margin-bottom:8px">Other pieces of ${esc(line.mrNo)} still waiting. Tick any leaving with this one.</p>
          <div class="plist">
            ${alsoWaiting.map((l) => `
              <label class="prow tickrow" data-also="${esc(l.id)}">
                <span class="prow-txt">
                  <span class="prow-t">${esc(l.name || 'Untitled piece')}</span>
                  <span class="prow-s">${esc(l.qty > 1 ? `Qty ${l.qty}` : 'Qty 1')}</span>
                </span>
                <input type="checkbox" class="box" data-alsobox="${esc(l.id)}">
              </label>`).join('')}
          </div>` : ''}

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
        const also = [...sheet.querySelectorAll('[data-alsobox]')]
          .filter((x) => x.checked).map((x) => x.dataset.alsobox);
        const ids = [lineId, ...also];

        const record = {
          mode,
          date,
          ref: get('ref').trim(),
          party: get('party').trim(),
          note: get('note').trim(),
          cost,
          pieces: ids.length,
          // The ledger entry this despatch already wrote, so saving
          // the record twice does not charge the job twice.
          entryId: current.entryId || '',
        };

        if (cost > 0 && !record.entryId) {
          const entry = addEntry({
            type: 'out',
            date,
            entered: cost,
            jobCode: line.mrNo,
            categoryId: CATEGORY[mode] || 'c_trans',
            party: record.party,
            note: `Delivery — ${DESPATCH_MODES[mode].label}${record.ref ? ` (${record.ref})` : ''}`
              + (ids.length > 1 ? ` · ${ids.length} pieces` : ''),
          });
          if (entry) record.entryId = entry.id;
        }

        setDespatch(ids, record);
        toast(record.entryId && cost > 0
          ? `Despatch saved · ${inr(cost)} booked to ${line.mrNo}`
          : `Despatch saved${ids.length > 1 ? ` for ${ids.length} pieces` : ''}`);
        handle.close();
        if (onDone) onDone();
      });
    },
  });
}
