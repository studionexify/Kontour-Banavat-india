/* views/subcontractor.js — who is actually making it.
 *
 * Banavat India does not make everything in one shed: metal goes to
 * one person, wood to another, upholstery to a third, and drawings
 * to someone else again. The order sheet already records that
 * against every piece, so this screen does not ask anyone to keep a
 * second supplier list — it reads the names back out of the work
 * (see vendorBook in orders.js) and shows each person's load.
 *
 * The content of this station is still being specified, so what is
 * here is the part that can be true today: who has what, and how
 * much of it is still open.
 */

import { esc, on, openSheet } from '../ui.js';
import { vendorBook, vendorNamed, stageLabel } from '../orders.js';
import { dmy } from '../format.js';
import { pageHead, statCards, searchBar, nothingHere, sectionHead, comingUp } from './chrome.js';
import { openOrder } from './orderdetail.js';
import { wire } from './production.js';

let query = '';

export function render(root, ctx) {
  const book = vendorBook();
  const needle = query.trim().toLowerCase();
  const list = needle
    ? book.filter((v) => v.name.toLowerCase().includes(needle)
        || v.trades.some((t) => t.includes(needle)))
    : book;

  const busy = book.filter((v) => v.open > 0);
  const openPieces = book.reduce((n, v) => n + v.open, 0);

  root.innerHTML = `
    <div class="floor">
      ${pageHead({
        title: 'Sub-Contractor',
        sub: `${book.length} name${book.length === 1 ? '' : 's'} on file`,
      })}

      ${statCards([
        { label: 'Sub-contractors', value: book.length, tone: 'sub' },
        { label: 'Working now', value: busy.length, hint: 'have open pieces' },
        { label: 'Pieces out', value: openPieces, hint: 'not yet delivered' },
      ])}

      ${comingUp([
        'This station is still being specified.',
        'For now it is read straight out of the order sheet: whoever is named against a piece is listed here, with the trades they are named for and what they currently hold. Assign or change a name from inside any order, under Sub-contractors.',
        'Rates, payments and purchase orders will land here once you have decided how you want them tracked.',
      ])}

      ${searchBar(query, 'Search a name or a trade')}

      ${sectionHead('By load')}
      ${list.length
        ? `<div class="vgrid">${list.map(vcard).join('')}</div>`
        : nothingHere('hands', query ? 'No sub-contractor matches' : 'No names on file yet',
            query ? 'Try another search' : 'Name someone against a piece and they appear here')}
    </div>`;

  wire(root, ctx, { onSearch: (v) => { query = v; } });
  on(root, '[data-vendor]', (e, b) => openVendor(b.dataset.vendor, ctx));
}

function vcard(v) {
  return `
    <button class="vcard" data-vendor="${esc(v.name)}">
      <span class="vcard-ini">${esc(initials(v.name))}</span>
      <span class="vcard-txt">
        <span class="vcard-n">${esc(v.name)}</span>
        <span class="vcard-s">${esc(v.trades.join(' · '))}</span>
      </span>
      <span class="vcard-c">${v.open}</span>
    </button>`;
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* One person's whole board: everything they are named against,
   open work first, each row a door into the order it belongs to. */
function openVendor(name, ctx) {
  const v = vendorNamed(name);
  if (!v) return;
  const sorted = v.lines.slice().sort((a, b) => {
    const ad = a.stage === 'delivered', bd = b.stage === 'delivered';
    if (ad !== bd) return ad ? 1 : -1;
    return (a.deliveryDate || '').localeCompare(b.deliveryDate || '');
  });

  openSheet({
    title: name,
    full: true,
    body: `
      <div class="sheet-body">
        <div class="tags" style="margin-bottom:14px">
          ${v.trades.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
        </div>

        <div class="kpis" style="margin-bottom:16px">
          <div class="kpi">
            <div class="kpi-l">PIECES OPEN</div>
            <div class="kpi-v num">${v.open}</div>
          </div>
          <div class="kpi">
            <div class="kpi-l">PIECES TOTAL</div>
            <div class="kpi-v num">${v.lines.length}</div>
          </div>
        </div>

        <p class="tray-lbl">Work</p>
        <div class="plist">
          ${sorted.map((l) => `
            <button class="prow" data-open="${esc(l.mrNo)}">
              <span class="prow-txt">
                <span class="prow-t">${esc(l.name)}</span>
                <span class="prow-s">${esc(l.mrNo)}${l.client ? ` · ${esc(l.client)}` : ''}${l.deliveryDate ? ` · due ${esc(dmy(l.deliveryDate))}` : ''}</span>
              </span>
              <span class="pill ${l.stage === 'delivered' ? 'mut' : 'warn'}">${esc(stageLabel(l.stage))}</span>
            </button>`).join('')}
        </div>
      </div>`,
    onMount(sheet, handle) {
      on(sheet, '[data-open]', (e, b) => {
        handle.close();
        openOrder(b.dataset.open, ctx.refresh);
      });
    },
  });
}
