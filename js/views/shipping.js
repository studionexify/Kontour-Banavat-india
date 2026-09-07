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
import { on, esc, toast, haptic } from '../ui.js';
import { linesAt, groupsAt, updateLine, isOverdue } from '../orders.js';
import { dmy } from '../format.js';
import { pageHead, statCards, searchBar, orderCard, nothingHere, sectionHead, comingUp } from './chrome.js';
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

      ${comingUp([
        'The despatch record is still being specified.',
        'Courier, docket number, vehicle, expected arrival and proof of delivery all belong here — tell me how you want them tracked and they become fields on each order.',
        'Marking an order delivered moves it to Archive, which is the last step a job takes.',
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
}

function card(g) {
  const meta = [`${g.lines.length} piece${g.lines.length === 1 ? '' : 's'}`];
  if (g.deliveryDate) meta.push(`due ${dmy(g.deliveryDate)}`);
  const late = isOverdue(g);
  return orderCard({
    id: g.mrNo, mrNo: g.mrNo, client: g.client, meta,
    tint: late ? 'sub' : 'ship',
    pill: late ? 'Past due' : 'Shipped',
    pillTone: late ? 'out' : 'in',
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
