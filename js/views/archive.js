/* views/archive.js — everything that is finished.
 *
 * Two kinds of finished end up here, and they are worth keeping
 * apart: an order that was made and delivered, and a quotation that
 * never became one. The first is a record of work done; the second
 * is a record of work lost, and the two answer different questions
 * a year later.
 *
 * Nothing on this screen is editable in place. An archive you can
 * quietly rewrite is not an archive — reopen the order itself if
 * something genuinely needs correcting.
 */

import { esc, on, toast } from '../ui.js';
import { groupsAt } from '../orders.js';
import { quoteFamilies, quoteTotals, quoteName, jobValueFor, STATUS, getQuote, unarchiveQuote } from '../quotes.js';
import { dmy, fyOf, inr, todayISO } from '../format.js';
import { pageHead, statCards, searchBar, orderCard, nothingHere, sectionHead } from './chrome.js';
import { openOrder } from './orderdetail.js';
import { openQuoteDoc } from './quotedoc.js';
import { downloadQuotePdf } from '../quotepdf.js';
import { createQuoteTable } from './quotetable.js';

let tab = 'orders';    // 'orders' | 'quotes'
let query = '';

/* The decided half of the archive is the same list of quotations the
   working screen holds, so it is the same table — columns that sort
   themselves on a wide screen, ticks in the first one — with its own
   sort and its own selection, and only the two bulk actions an
   archive is allowed to offer.

   Nothing here edits a record: bringing one back to the working list
   leaves its status exactly as it was, and a PDF only reads. Deleting
   in bulk is deliberately not on this bar — an archive you can empty
   by the handful is not an archive. The "⋯" on a single row still
   offers it, one deliberate decision at a time.

   Newest number first, like the working list. */
const qtable = createQuoteTable({
  bulk: [
    { key: 'restore', icon: 'upload',   label: 'Move back to the list' },
    { key: 'pdf',     icon: 'download', label: 'Download PDFs' },
  ],
  run: runBulk,
});

async function runBulk(act, ids, ctx) {
  if (act === 'pdf') {
    let made = 0;
    for (const id of ids) {
      const q = getQuote(id);
      if (!q) continue;
      try { await downloadQuotePdf(q); made += 1; } catch {}
    }
    return toast(made ? `${made} PDF${made === 1 ? '' : 's'} saved` : 'Could not make those PDFs', made ? '' : 'err');
  }

  if (act === 'restore') {
    let done = 0;
    for (const id of ids) { if (getQuote(id)) { unarchiveQuote(id); done += 1; } }
    qtable.clear();
    toast(done === 1 ? 'Back in the list' : `${done} back in the list`);
    ctx.refresh();
  }
}

export function render(root, ctx) {
  const delivered = groupsAt('archive', { q: query });
  const allDelivered = groupsAt('archive', {});
  const decided = quoteFamilies({ archived: true });
  const declined = decided.filter((f) => f.head.status === 'declined');
  const accepted = decided.filter((f) => f.head.status === 'accepted');

  // Sorted and searched once, so the table and the cards below it are
  // the same list in the same order — and so the tick-pruning in
  // wire() is looking at what is genuinely on screen.
  const shown = tab === 'quotes' ? qtable.sortList(filterQuotes(decided)) : [];

  const thisYear = fyOf(todayISO());
  const deliveredThisFy = allDelivered.filter((g) => g.deliveryDate && fyOf(g.deliveryDate) === thisYear).length;

  root.innerHTML = `
    <div class="floor">
      ${pageHead({
        title: 'Archive',
        sub: `${allDelivered.length} completed order${allDelivered.length === 1 ? '' : 's'} · ${decided.length} decided quotation${decided.length === 1 ? '' : 's'}`,
      })}

      ${statCards([
        { label: 'Completed orders', value: allDelivered.length, tone: 'done' },
        { label: `Delivered ${esc(thisYear)}`, value: deliveredThisFy, hint: 'this financial year' },
        { label: 'Quotations declined', value: declined.length, hint: `${accepted.length} accepted` },
      ])}

      <div class="segbar" style="margin-bottom:20px">
        <button class="seg-mini ${tab === 'orders' ? 'on' : ''}" data-tab="orders">Completed orders</button>
        <button class="seg-mini ${tab === 'quotes' ? 'on' : ''}" data-tab="quotes">Decided quotations</button>
      </div>

      ${searchBar(query, tab === 'orders' ? 'Search client, MR number' : 'Search client, MR number')}

      ${tab === 'orders' ? `
        ${sectionHead('Made and delivered')}
        ${delivered.length ? `<div class="olist">${delivered.map(orderRow).join('')}</div>`
          : nothingHere('archive', query ? 'Nothing matches' : 'Nothing archived yet',
              query ? 'Try another search' : 'Orders land here once every piece is delivered')}
      ` : `
        ${sectionHead('Accepted and declined', qtable.sortControl())}
        ${qtable.bulkBar()}
        ${shown.length
          ? `${qtable.table(shown, { rowActions })}<div class="olist">${shown.map(quoteRow).join('')}</div>`
          : nothingHere('note', query ? 'Nothing matches' : 'No decided quotations yet',
              query ? 'Try another search' : 'A quotation files itself here once it is accepted or declined')}
      `}
    </div>`;

  if (tab === 'quotes') qtable.wire(root, ctx, shown);

  on(root, '[data-tab]', (e, b) => { tab = b.dataset.tab; query = ''; qtable.clear(); ctx.refresh(); });
  // The table's own rows carry data-open, so on the quotations tab
  // that id is a quotation, not an order.
  on(root, '[data-open]', (e, b) => {
    if (e.target.closest('button, label, input')) return;
    if (tab === 'quotes') openQuoteDoc(b.dataset.open, { onSaved: ctx.refresh });
    else openOrder(b.dataset.open, ctx.refresh);
  });
  on(root, '[data-quote]', (e, b) => {
    if (e.target.closest('button, label, input')) return;
    openQuoteDoc(b.dataset.quote, { onSaved: ctx.refresh });
  });


  const q = root.querySelector('[data-q]');
  if (q) {
    q.addEventListener('input', () => {
      query = q.value;
      clearTimeout(q._t);
      q._t = setTimeout(() => ctx.refresh(), 220);
    });
  }
}

function filterQuotes(list) {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((f) => quoteName(f.head).toLowerCase().includes(needle));
}

/* Nothing on this screen is editable in place, so a decided
   quotation carries no row actions at all — the row opens the
   document, and what can still be done to a handful of them is on
   the bulk bar. */
const rowActions = () => '';

function orderRow(g) {
  const meta = [`${g.lines.length} piece${g.lines.length === 1 ? '' : 's'}`];
  if (g.deliveryDate) meta.push(`delivered ${dmy(g.deliveryDate)}`);
  return orderCard({
    id: g.mrNo, mrNo: g.mrNo, client: g.client, meta,
    tint: 'done', pill: 'Delivered', pillTone: 'in',
  });
}

/* A decided quotation shows the figure it was decided at, not the
   figure it was written at — an approved sub-quotation is what the
   client actually agreed to, and that is the number worth keeping. */
function quoteRow({ head: q }) {
  const t = quoteTotals(q);
  const st = STATUS[q.status] || STATUS.draft;
  const value = q.status === 'accepted' ? jobValueFor(q) : t.total;
  return `
    <article class="ocard t-done" data-quote="${esc(q.id)}" tabindex="0" role="button">
      ${qtable.checkbox(q.id, `Select ${q.mrNo}`)}
      <div class="ocard-main">
        <div class="ocard-t">${esc(q.client && q.client.name || 'Unnamed client')}</div>
        <div class="ocard-m">
          <span class="ocard-mr">${esc(q.mrNo)}</span>
          <span class="ocard-dot"></span>${esc(dmy(q.date))}
          <span class="ocard-dot"></span>${esc(inr(value))}
        </div>
      </div>
      <div class="ocard-side">
        <span class="pill ${st.tone}">${esc(st.label)}</span>
      </div>
    </article>`;
}
