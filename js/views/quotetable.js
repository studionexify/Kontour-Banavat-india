/* views/quotetable.js — one quotation list, drawn as columns.
 *
 * Two screens list quotations — the working list and the archive's
 * decided half — and at a desk both read better as columns than as
 * cards: the headings do the sorting, and a tick in the first column
 * is how you act on a dozen of them at once rather than opening
 * twelve sheets.
 *
 * Only the table lives here. Each screen keeps drawing its own cards
 * for a narrow screen, because what belongs on one line differs
 * between a quotation that is still out and one that is decided —
 * but the sort and the selection behind both are this module's, so
 * the two views of the same list can never disagree.
 *
 * Every list gets its own instance: the archive remembering what was
 * ticked on the working list is a bulk action waiting to happen to
 * the wrong records.
 */

import { icon } from '../icons.js';
import { on, esc, haptic } from '../ui.js';
import { quoteTotals, jobValueFor, STATUS } from '../quotes.js';
import { inr, dmy } from '../format.js';

/* "C101" < "C119" < "C129-1" < "C129-2" — a plain string compare
   would put "C119" after "C19" and a revision suffix after nothing
   at all. Split into the letter, the number, and the revision (if
   any) and compare those in turn instead. */
function mrParts(mrNo) {
  const m = String(mrNo || '').match(/^([A-Za-z]*)(\d+)(?:[-\s(]+(\d+))?/);
  return m ? [m[1] || '', Number(m[2]) || 0, Number(m[3]) || 0] : [String(mrNo || ''), 0, 0];
}

export function compareMr(a, b) {
  const pa = mrParts(a); const pb = mrParts(b);
  if (pa[0] !== pb[0]) return pa[0] < pb[0] ? -1 : 1;
  if (pa[1] !== pb[1]) return pa[1] - pb[1];
  return pa[2] - pb[2];
}

export function clientOf(q) {
  return ((q.client && q.client.name) || 'Unnamed client').trim().toLowerCase();
}

/* The figure the client saw, or — once one is agreed — the figure
   they actually agreed to. */
export function valueOf(q) {
  return q.status === 'accepted' ? jobValueFor(q) : quoteTotals(q).total;
}

/* Status sorts by where a quotation stands in the conversation, not
   by the alphabet: a draft has not gone out, a sent one is waiting. */
const STATUS_ORDER = ['draft', 'sent', 'accepted', 'declined', 'superseded'];
function statusRank(q) {
  const i = STATUS_ORDER.indexOf(q.status);
  return i < 0 ? STATUS_ORDER.length : i;
}

const SORTS = {
  mrNo:   { label: 'MR number', head: 'Quotation', cmp: (a, b) => compareMr(a.head.mrNo, b.head.mrNo) },
  client: { label: 'Client',    head: 'Client',    cmp: (a, b) => clientOf(a.head).localeCompare(clientOf(b.head)) },
  date:   { label: 'Date',      head: 'Issued',    cmp: (a, b) => (a.head.date || '').localeCompare(b.head.date || '') },
  value:  { label: 'Value',     head: 'Amount',    cmp: (a, b) => valueOf(a.head) - valueOf(b.head) },
  status: { label: 'Status',    head: 'Status',    cmp: (a, b) => statusRank(a.head) - statusRank(b.head) },
};
const COLS = ['mrNo', 'client', 'date', 'value', 'status'];
const CELL_CLASS = { date: 'qt-date', value: 'qt-amt num', status: 'qt-st' };

/* One list's table: its own sort, its own selection.
 *
 *   bulk    the actions the bar offers, as [key, icon, label] — and
 *           `danger: true` on the one that cannot be undone.
 *   run     what to do with them: run(key, ids, ctx). Clearing the
 *           selection is handled here; everything else is the
 *           screen's own business, since only it knows what its
 *           quotations are allowed to do.
 *   sortKey the column the list opens sorted by.
 */
export function createQuoteTable({ bulk = [], run = null, sortKey = 'mrNo', sortDir = 'desc' } = {}) {
  const selected = new Set();
  let key = sortKey;
  let dir = sortDir;

  function sortList(list) {
    const d = dir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => d * SORTS[key].cmp(a, b));
  }

  function sortMark(k) {
    if (k !== key) return `<span class="qt-sortmark">${icon('swap', 11)}</span>`;
    return `<span class="qt-sortmark on">${icon(dir === 'desc' ? 'chevD' : 'chevU', 11)}</span>`;
  }

  /* The chip row a narrow screen sorts by — the same handler as the
     column headings, because it is the same decision. */
  function sortControl() {
    return `
      <div class="sortbar only-narrow">
        ${COLS.map((k) => `
          <button class="sortbtn ${k === key ? 'on' : ''}" data-sort="${k}">
            ${esc(SORTS[k].label)}${k === key ? icon(dir === 'desc' ? 'chevD' : 'chevU', 12) : ''}
          </button>`).join('')}
      </div>`;
  }

  function checkbox(id, label) {
    return `
      <label class="ckbox">
        <input type="checkbox" data-sel="${esc(id)}" aria-label="${esc(label)}">
        <span class="ckbox-box">${icon('check', 12)}</span>
      </label>`;
  }

  function table(list, { rowActions = defaultActions } = {}) {
    return `
      <div class="qtable-wrap">
        <table class="qtable">
          <thead>
            <tr>
              <th class="qt-check">
                <label class="ckbox">
                  <input type="checkbox" data-selall aria-label="Select every quotation shown">
                  <span class="ckbox-box">${icon('check', 12)}</span>
                </label>
              </th>
              ${COLS.map((k) => `
                <th class="${CELL_CLASS[k] || ''}">
                  <button class="qt-sort ${k === key ? 'on' : ''}" data-sort="${k}">
                    ${esc(SORTS[k].head)}${sortMark(k)}
                  </button>
                </th>`).join('')}
              <th class="qt-acts"></th>
            </tr>
          </thead>
          <tbody>${list.map((f) => trow(f, rowActions)).join('')}</tbody>
        </table>
      </div>`;
  }

  function trow({ head: q, revisions = 1 }, rowActions) {
    const st = STATUS[q.status] || STATUS.draft;
    const lines = (q.lines || []).length;
    return `
      <tr class="qt-row" data-open="${esc(q.id)}" tabindex="0">
        <td class="qt-check">${checkbox(q.id, `Select ${q.mrNo}`)}</td>
        <td>
          <div class="qt-no">${esc(q.mrNo)}</div>
          <div class="qt-sub">${lines} item${lines === 1 ? '' : 's'}${revisions > 1 ? ` · rev ${revisions}` : ''}${q.title ? ` · ${esc(q.title)}` : ''}</div>
        </td>
        <td class="qt-client">${esc((q.client && q.client.name) || 'Unnamed client')}</td>
        <td class="qt-date">${esc(dmy(q.date))}</td>
        <td class="qt-amt num">${inr(valueOf(q))}</td>
        <td class="qt-st"><span class="pill ${st.tone}">${esc(st.label)}</span></td>
        <td class="qt-acts">${rowActions(q)}</td>
      </tr>`;
  }

  function defaultActions(q) {
    return `<button class="icon-btn plain sm" data-more="${esc(q.id)}" aria-label="More actions for ${esc(q.mrNo)}">${icon('menu', 16)}</button>`;
  }

  /* The bar is in the page from the start and simply hidden while
     nothing is ticked: ticking a box then has nothing to re-render,
     so the list does not jump under the finger that ticked it. */
  function bulkBar() {
    if (!bulk.length) return '';
    return `
      <div class="bulkbar" data-bulkbar hidden>
        <span class="bulkbar-n" data-bulkcount>0 selected</span>
        <div class="bulkbar-acts">
          ${bulk.map(({ key: k, icon: ico, label, danger }) => `
            <button class="bulkbtn ${danger ? 'danger' : ''}" data-bulk="${esc(k)}">
              ${icon(ico, 15)}<span>${esc(label)}</span>
            </button>`).join('')}
          <button class="bulkbtn ghost" data-bulk="clear" aria-label="Clear the selection">${icon('close', 15)}</button>
        </div>
      </div>`;
  }

  /* One place decides how a tick looks, so the table row, the card
     and the "select all" box can never disagree about what is
     selected. */
  function paint(root, list) {
    const n = selected.size;
    for (const el of root.querySelectorAll('[data-sel]')) {
      const isOn = selected.has(el.dataset.sel);
      el.checked = isOn;
      const holder = el.closest('.qt-row, .qrow2, .ocard');
      if (holder) holder.classList.toggle('picked', isOn);
    }
    const all = root.querySelector('[data-selall]');
    if (all) {
      all.checked = n > 0 && n === list.length;
      all.indeterminate = n > 0 && n < list.length;
    }
    const bar = root.querySelector('[data-bulkbar]');
    if (bar) {
      bar.hidden = n === 0;
      const label = bar.querySelector('[data-bulkcount]');
      if (label) label.textContent = `${n} selected`;
    }
  }

  /* Called once per render, with the list as it ended up on screen. */
  function wire(root, ctx, list) {
    // A tick that scrolled off the list — filtered or searched away —
    // is not something a bulk action should quietly act on.
    const live = new Set(list.map((f) => f.head.id));
    for (const id of [...selected]) if (!live.has(id)) selected.delete(id);

    on(root, '[data-sort]', (e, b) => {
      // Tapping the sort already active flips its direction; picking
      // a new one starts descending — "newest / largest first" is
      // what every one of these fields means the first time you
      // reach for it.
      if (b.dataset.sort === key) dir = dir === 'desc' ? 'asc' : 'desc';
      else { key = b.dataset.sort; dir = 'desc'; }
      ctx.refresh();
    });

    // The same quotation appears twice in the DOM — once as a table
    // row for a wide screen, once as a card for a narrow one, only
    // ever one of them visible. The tick lives in the Set, not in
    // either input, so both are repainted from it rather than from
    // each other.
    on(root, '[data-sel]', (e, b) => {
      e.stopPropagation();
      if (b.checked) selected.add(b.dataset.sel); else selected.delete(b.dataset.sel);
      paint(root, list);
    }, 'change');

    on(root, '[data-selall]', (e, b) => {
      e.stopPropagation();
      if (b.checked) for (const f of list) selected.add(f.head.id);
      else selected.clear();
      paint(root, list);
    }, 'change');

    on(root, '[data-bulk]', async (e, b) => {
      const act = b.dataset.bulk;
      if (act === 'clear') { selected.clear(); return ctx.refresh(); }
      if (!selected.size || !run) return;
      haptic();
      await run(act, [...selected], ctx);
    });

    paint(root, list);
  }

  return {
    selected, sortList, sortControl, table, checkbox, bulkBar, paint, wire,
    clear: () => selected.clear(),
  };
}
