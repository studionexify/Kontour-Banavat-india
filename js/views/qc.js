/* views/qc.js — QC + Catalog.
 *
 * Two halves of one habit. A piece reaching assembly is a piece
 * ready to be looked at properly before anyone packs it, and what
 * is being looked at is a design the catalog already describes —
 * its dimensions, its finish, the photograph it is supposed to
 * match. Checking and cataloguing belong on the same screen because
 * they are the same act pointed in two directions.
 *
 * QC's queue is every piece standing at assembly (see STATION in
 * orders.js). Passing it sends it to Shipping; failing it sends it
 * back to production, which is the whole point of a check.
 */

import { icon } from '../icons.js';
import { on, esc, toast, haptic, confirmSheet } from '../ui.js';
import { linesAt, updateLine } from '../orders.js';
import { designs, CATEGORIES } from '../quotes.js';
import { inr, dmy } from '../format.js';
import { pageHead, statCards, searchBar, nothingHere, sectionHead, comingUp } from './chrome.js';
import { openOrder } from './orderdetail.js';
import { openDesignSheet } from './library.js';

let tab = 'qc';        // 'qc' | 'catalog'
let query = '';
let cat = 'All';

export function render(root, ctx) {
  const queue = linesAt('qc');
  const all = designs();

  root.innerHTML = `
    <div class="floor">
      ${pageHead({
        title: 'QC + Catalog',
        sub: tab === 'qc'
          ? `${queue.length} piece${queue.length === 1 ? '' : 's'} waiting to be checked`
          : `${all.length} design${all.length === 1 ? '' : 's'} on file`,
        actions: tab === 'catalog'
          ? `<button class="pill-btn" data-adddesign>${icon('plus', 16)} Add design</button>` : '',
      })}

      <div class="segbar" style="margin-bottom:20px">
        <button class="seg-mini ${tab === 'qc' ? 'on' : ''}" data-tab="qc">Quality check</button>
        <button class="seg-mini ${tab === 'catalog' ? 'on' : ''}" data-tab="catalog">Catalog</button>
      </div>

      ${tab === 'qc' ? qcHTML(queue) : catalogHTML(all)}
    </div>`;

  on(root, '[data-tab]', (e, b) => { tab = b.dataset.tab; query = ''; ctx.refresh(); });

  /* The row opens the order; the buttons inside it decide the piece.
     Both listeners hang off the same root, so stopping propagation
     on the inner one does not stop this one — the row has to check
     for itself whether the tap landed on an action. */
  on(root, '[data-open]', (e, b) => {
    if (e.target.closest('button')) return;
    openOrder(b.dataset.open, ctx.refresh);
  });
  on(root, '[data-adddesign]', () => openDesignSheet({ onSaved: ctx.refresh }));
  on(root, '[data-editdesign]', (e, b) => openDesignSheet({ code: b.dataset.editdesign, onSaved: ctx.refresh }));
  on(root, '[data-cat]', (e, b) => { cat = b.dataset.cat; ctx.refresh(); });

  on(root, '[data-pass]', async (e, b) => {
    e.stopPropagation();
    updateLine(b.dataset.pass, { stage: 'shipped' });
    haptic(10);
    toast('Passed — moved to Shipping');
    ctx.refresh();
  });

  on(root, '[data-fail]', async (e, b) => {
    e.stopPropagation();
    const ok = await confirmSheet({
      title: 'Send this piece back?',
      message: 'It returns to production and leaves the check queue until it is assembled again.',
      confirmLabel: 'Send back',
    });
    if (!ok) return;
    updateLine(b.dataset.fail, { stage: 'production' });
    toast('Back to production');
    ctx.refresh();
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

/* ── The check queue ───────────────────────────────────────── */

function qcHTML(queue) {
  const needle = query.trim().toLowerCase();
  const list = needle
    ? queue.filter((l) => `${l.name} ${l.mrNo} ${l.client}`.toLowerCase().includes(needle))
    : queue;

  return `
    ${statCards([
      { label: 'Awaiting check', value: queue.length, tone: 'qc' },
      { label: 'Pieces', value: queue.reduce((n, l) => n + (l.qty || 1), 0), hint: 'including quantities' },
      { label: 'Orders', value: new Set(queue.map((l) => l.mrNo)).size, hint: 'represented' },
    ])}

    ${comingUp([
      'The checklist itself is still being specified.',
      'Today a piece reaching assembly lands in this queue. Passing it sends it straight to Shipping; sending it back returns it to production. Once you decide what is actually checked — finish, dimensions, hardware, packing — those become the fields on each row.',
    ])}

    ${searchBar(query, 'Search piece, client, MR number')}

    ${sectionHead('Waiting to be checked')}
    ${list.length ? `<div class="plist">${list.map(qcRow).join('')}</div>`
      : nothingHere('clipboard', query ? 'Nothing matches' : 'Nothing waiting',
          query ? 'Try another search' : 'Pieces arrive here when they reach assembly')}`;
}

function qcRow(l) {
  return `
    <article class="prow qcrow" data-open="${esc(l.mrNo)}" tabindex="0" role="button">
      <span class="prow-txt">
        <span class="prow-t">${esc(l.name)}</span>
        <span class="prow-s">${esc(l.mrNo)}${l.client ? ` · ${esc(l.client)}` : ''}${l.deliveryDate ? ` · due ${esc(dmy(l.deliveryDate))}` : ''}</span>
      </span>
      <span class="qcrow-acts">
        <button class="mini" data-fail="${esc(l.id)}">${icon('back', 13)} Back</button>
        <button class="mini ok" data-pass="${esc(l.id)}">${icon('check', 13)} Pass</button>
      </span>
    </article>`;
}

/* ── The catalog ───────────────────────────────────────────────
   The same design library as before, in the floor's own dressing.
   A design is a thing you make more than once; catalogued once, it
   is one tap in every future quotation. */

function catalogHTML(all) {
  const list = designs({ category: cat, q: query });
  const cats = ['All', ...CATEGORIES.filter((c) => all.some((d) => d.category === c))];

  return `
    ${statCards([
      { label: 'Designs', value: all.length, tone: 'quote' },
      { label: 'Categories', value: Math.max(0, cats.length - 1), hint: 'in use' },
      { label: 'Photographed', value: all.filter((d) => d.photo).length, hint: 'of ' + all.length },
    ])}

    ${searchBar(query, 'Search code, name, description')}

    ${cats.length > 1 ? `<div class="chipbar">
      ${cats.map((c) => `<button class="chip ${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>` : ''}

    ${list.length ? `<div class="dgrid">${list.map(designCard).join('')}</div>`
      : nothingHere('box',
          query || cat !== 'All' ? 'Nothing matches' : 'The catalog is empty',
          query || cat !== 'All' ? 'Try another category' : 'Add a design and it becomes one tap in every future quotation')}`;
}

function designCard(d) {
  return `
    <button class="dcard reveal" data-editdesign="${esc(d.code)}">
      ${d.photo ? `<img class="dcard-img" src="${esc(d.photo)}" alt="">`
                : `<span class="dcard-img ph">${icon('box', 26)}</span>`}
      <div class="dcard-body">
        <div class="dcard-code">${esc(d.code)}</div>
        <div class="dcard-name">${esc(d.name || '—')}</div>
        ${d.dims ? `<div class="dcard-dims">${esc(d.dims)}</div>` : ''}
        <div class="dcard-foot">
          <span class="dcard-rate num">${inr(d.unitPrice)}</span>
          <span class="pill mut">${esc(d.category)}</span>
        </div>
      </div>
    </button>`;
}
