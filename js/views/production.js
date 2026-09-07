/* views/production.js — In production.
 *
 * Everything approved and not yet finished: the floor's working
 * queue. Grouped by MR number, ordered by what is due soonest,
 * because the only question this screen is ever asked is "what is
 * late and what is next".
 *
 * A piece moves to QC the moment it reaches assembly, and off this
 * screen with it — the stations partition the line between them
 * (see STATION in orders.js), so nothing is in two places and
 * nothing is in none.
 */

import { icon } from '../icons.js';
import { on } from '../ui.js';
import {
  groupsAt, isOverdue, stageLabel,
} from '../orders.js';
import { dmy, todayISO } from '../format.js';
import { pageHead, statCards, searchBar, orderCard, nothingHere, sectionHead } from './chrome.js';
import { openOrder, openPieceSheet } from './orderdetail.js';

let query = '';

export function render(root, ctx) {
  const groups = groupsAt('inproduction', { q: query });
  const all = groupsAt('inproduction', {});
  const overdue = all.filter(isOverdue);
  const pieces = all.reduce((n, g) => n + g.lines.length, 0);
  const soon = all.filter((g) => !isOverdue(g) && withinDays(g.deliveryDate, 14)).length;

  root.innerHTML = `
    <div class="floor">
      ${pageHead({
        title: 'In production',
        sub: `${all.length} order${all.length === 1 ? '' : 's'} on the floor · ${pieces} piece${pieces === 1 ? '' : 's'}`,
        actions: `<button class="pill-btn" data-new>${icon('plus', 16)} New piece</button>`,
      })}

      ${statCards([
        { label: 'On the floor', value: all.length, tone: 'prod', hint: `${pieces} pieces` },
        { label: 'Overdue', value: overdue.length, tone: overdue.length ? 'sub' : '', hint: overdue.length ? 'past delivery date' : 'nothing late' },
        { label: 'Due in 14 days', value: soon, hint: 'coming up' },
      ])}

      ${searchBar(query, 'Search client, MR number, piece')}

      ${overdue.length ? `
        ${sectionHead('Running late')}
        <div class="olist">${overdue.map((g) => card(g, true)).join('')}</div>
      ` : ''}

      ${sectionHead(overdue.length ? 'Everything else' : 'On the floor')}
      ${groups.length ? `<div class="olist">${groups
          .filter((g) => !(overdue.length && isOverdue(g)))
          .map((g) => card(g, false)).join('')}</div>`
        : nothingHere('anvil', query ? 'No order matches' : 'Nothing in production',
            query ? 'Try another search' : 'Approved quotations arrive here')}
    </div>`;

  wire(root, ctx, { onSearch: (v) => { query = v; } });
}

/* Shared by every station screen: the same three bindings, because
   they all list orders, search them, and open them. The search term
   is handed back rather than kept here — each station remembers its
   own, so switching between them does not carry a filter along. */
export function wire(root, ctx, { onNew, onSearch } = {}) {
  /* A row opens its order, but a row can carry its own buttons (the
     Delivered action on Shipping, say). Both handlers hang off this
     same root, so stopping propagation on the inner one does not
     stop this one — it has to check where the tap actually landed. */
  on(root, '[data-open]', (e, b) => {
    if (e.target.closest('button')) return;
    openOrder(b.dataset.open, ctx.refresh);
  });
  on(root, '[data-new]', () => (onNew ? onNew() : openPieceSheet({}, ctx.refresh)));
  on(root, '[data-go]', (e, b) => ctx.go(b.dataset.go));

  const q = root.querySelector('[data-q]');
  if (q && onSearch) {
    q.addEventListener('input', () => {
      onSearch(q.value);
      clearTimeout(q._t);
      q._t = setTimeout(() => ctx.refresh(), 220);
    });
  }
}

function withinDays(iso, days) {
  if (!iso) return false;
  const now = new Date(todayISO());
  const then = new Date(iso);
  const diff = (then - now) / 86400000;
  return diff >= 0 && diff <= days;
}

function card(g, late) {
  const meta = [`${g.lines.length} piece${g.lines.length === 1 ? '' : 's'}`];
  if (g.deliveryDate) meta.push(`due ${dmy(g.deliveryDate)}`);
  return orderCard({
    id: g.mrNo, mrNo: g.mrNo, client: g.client, meta,
    tint: late ? 'sub' : 'prod',
    pill: late ? 'Overdue' : stageLabel(g.stage),
    pillTone: late ? 'out' : 'warn',
  });
}

/** The floating button's action, from app.js. */
export function openNewOrder(ctx) {
  openPieceSheet({}, ctx.refresh);
}
