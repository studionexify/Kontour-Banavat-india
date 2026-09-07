/* views/dashboard.js — the whole floor on one screen.
 *
 * Not a fifth copy of anything. The Dashboard answers one question —
 * what needs me today — by carrying each station's own headline
 * figure and nothing else, with a way through to the screen that
 * owns it. Every number here is computed by the module it belongs
 * to, never re-derived, so the Dashboard cannot disagree with the
 * screen it links to.
 *
 * What needs attention comes first and what is merely true comes
 * after: an overdue order is a different kind of fact from a
 * turnover figure, and putting them in one undifferentiated grid
 * makes both easier to miss.
 */

import { icon } from '../icons.js';
import { on, esc } from '../ui.js';
import { phynanceStats } from '../store.js';
import { quotationStats } from '../quotes.js';
import { totalSummary, seedKnownPartners } from '../commissions.js';
import {
  stationCounts, groupsAt, orderGroups, isOverdue, stageLabel, seedOrders, linesAt,
} from '../orders.js';
import { todayISO, fyOf, dmy } from '../format.js';
import { pageHead, statCards, sectionHead, orderCard, nothingHere } from './chrome.js';
import { openOrder } from './orderdetail.js';
import { seedingAllowed } from '../shopsync.js';

export function render(root, ctx) {
  // The history this build ships with is seeded only where it is this
  // device's own copy. On shared books it waits for the first pull, or
  // a phone opening the dashboard mid-sign-in would seed a second copy
  // of a history the books already hold. See shopsync.seedingAllowed().
  if (seedingAllowed()) {
    seedOrders();
    seedKnownPartners();
  }

  const today = todayISO();
  const st = stationCounts();
  const qcPieces = linesAt('qc').length;
  const shipPieces = linesAt('shipping').length;
  const q = quotationStats();
  const p = phynanceStats();
  const c = totalSummary();

  const overdue = orderGroups({}).filter(isOverdue)
    .sort((a, b) => (a.deliveryDate || '').localeCompare(b.deliveryDate || ''));
  const dueSoon = groupsAt('inproduction', {})
    .filter((g) => !isOverdue(g) && g.deliveryDate)
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))
    .slice(0, 4);

  root.innerHTML = `
    <div class="floor">
      ${pageHead({
        title: 'Banavat India',
        sub: `The floor today · ${esc(fyOf(today))}`,
        actions: `<button class="pill-btn" data-go="quotes">${icon('plus', 16)} New quotation</button>`,
      })}

      ${sectionHead('The line')}
      ${statCards([
        { label: 'Open quotations', value: q.openCount, tone: 'quote', go: 'quotes', hint: 'awaiting a decision' },
        { label: 'In production', value: st.inproduction, tone: 'prod', go: 'inproduction', hint: 'on the floor' },
        { label: 'Awaiting QC', value: qcPieces, tone: 'qc', go: 'qc', hint: qcPieces === 1 ? 'piece at assembly' : 'pieces at assembly' },
        // Pieces, not orders: a piece ships the day it is ready,
        // whether or not the rest of its order is, so counting
        // orders here would read zero with a van already loaded.
        { label: 'Shipping', value: shipPieces, tone: 'ship', go: 'shipping', hint: shipPieces === 1 ? 'piece out for delivery' : 'pieces out for delivery' },
      ])}

      ${statCards([
        { label: 'Active orders', value: q.activeCount, go: 'quotes', hint: 'confirmed' },
        { label: 'Active order value', value: q.activeValue || '', money: Boolean(q.activeValue), go: 'quotes' },
        { label: 'Overdue', value: st.overdue, tone: st.overdue ? 'sub' : '', go: 'inproduction', hint: st.overdue ? 'past delivery date' : 'nothing late' },
        { label: 'Completed', value: st.archive, tone: 'done', go: 'archive', hint: 'in the archive' },
      ])}

      ${sectionHead('Money')}
      ${statCards([
        { label: 'Outstanding', value: p.outstanding || '', money: Boolean(p.outstanding), go: 'home', hint: 'to collect' },
        { label: 'Vendor payment', value: p.vendorPayment || '', money: Boolean(p.vendorPayment), go: 'home', hint: 'not tracked yet' },
        { label: 'Turn over', value: p.turnover || '', money: Boolean(p.turnover), go: 'home', hint: esc(fyOf(today)) },
        { label: 'Commission owed', value: c.remaining || '', money: Boolean(c.remaining), go: 'commission', hint: `${c.paid ? 'paid ₹' + Math.round(c.paid).toLocaleString('en-IN') : 'nothing paid yet'}` },
      ])}

      ${overdue.length ? `
        ${sectionHead('Running late', `<button class="sec-link" data-go="inproduction">Open ${icon('chevR', 13)}</button>`)}
        <div class="olist">${overdue.slice(0, 4).map((g) => row(g, true)).join('')}</div>
      ` : ''}

      ${sectionHead('Due next', `<button class="sec-link" data-go="inproduction">Open ${icon('chevR', 13)}</button>`)}
      ${dueSoon.length ? `<div class="olist">${dueSoon.map((g) => row(g, false)).join('')}</div>`
        : nothingHere('anvil', 'Nothing scheduled', 'Approved quotations arrive in production')}
    </div>`;

  on(root, '[data-go]', (e, b) => ctx.go(b.dataset.go));
  on(root, '[data-open]', (e, b) => openOrder(b.dataset.open, ctx.refresh));
}

function row(g, late) {
  const meta = [`${g.lines.length} piece${g.lines.length === 1 ? '' : 's'}`];
  if (g.deliveryDate) meta.push(`${late ? 'was due' : 'due'} ${dmy(g.deliveryDate)}`);
  return orderCard({
    id: g.mrNo, mrNo: g.mrNo, client: g.client, meta,
    tint: late ? 'sub' : 'prod',
    pill: late ? 'Overdue' : stageLabel(g.stage),
    pillTone: late ? 'out' : 'warn',
  });
}
