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
  groupsAt, isOverdue, stageLabel, STAGES, linesAt,
} from '../orders.js';
import { dmy, todayISO } from '../format.js';
import { pageHead, statCards, searchBar, orderCard, nothingHere, sectionHead } from './chrome.js';
import { openOrder, openPieceSheet } from './orderdetail.js';
import {
  viewToggle, wireViewToggle, board, boardCard, timeline, toneOf,
} from './viewkit.js';
import { lineThumb, lineImage, orderImage, thumb } from './thumbs.js';
import { nextButton, wireNext } from './nextstep.js';

let query = '';

/* Three ways to read the same queue, and the floor genuinely wants
   all three: the board to see where the work is piled up, the
   timeline to see what collides next week, the list to scan the
   whole queue at once. The choice sticks for the session — coming
   back from an order should not reset how you were reading it. */
let view = 'board';

const VIEWS = [
  { key: 'board', label: 'Board', icon: 'columns' },
  { key: 'timeline', label: 'Timeline', icon: 'timeline' },
  { key: 'list', label: 'List', icon: 'rows' },
];

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

      ${sectionHead(view === 'board' ? 'The floor, stage by stage'
        : view === 'timeline' ? 'What is due when' : 'On the floor',
        viewToggle(VIEWS, view))}

      ${groups.length
        ? (view === 'board' ? pieceBoard(groups)
          : view === 'timeline' ? orderTimeline(groups)
          : listView(groups, overdue))
        : nothingHere('anvil', query ? 'No order matches' : 'Nothing in production',
            query ? 'Try another search' : 'Approved quotations arrive here')}
    </div>`;

  wire(root, ctx, { onSearch: (v) => { query = v; } });
  wireViewToggle(root, (v) => { view = v; ctx.refresh(); });
  wireNext(root, ctx.refresh);
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

/* ── The board ─────────────────────────────────────────────────
   One column per stage a piece can be standing at while it is still
   in production, in the order work moves through them. The unit is
   the piece, not the order: that is what actually sits at a stage,
   and an order whose drawings are done but whose metal has not
   started belongs in two columns at once, which is exactly what the
   board shows.

   Colour is the stage, all the way down — the same tint the card,
   the timeline bar and the dashboard donut use. */
function pieceBoard(groups) {
  const shown = new Set(groups.map((g) => g.mrNo));
  const pieces = linesAt('inproduction').filter((l) => shown.has(l.mrNo));
  const cols = [{ key: 'pending', label: 'To start' },
    ...STAGES.filter((s) => ['drawings', 'commission', 'production'].includes(s.key))];

  return board(cols.map((col) => ({
    label: col.label,
    tone: toneOf(col.key),
    empty: 'Nothing at this stage',
    cards: pieces.filter((l) => l.stage === col.key).map((l) => {
      const late = l.deliveryDate && l.deliveryDate < todayISO();
      return boardCard({
        id: l.mrNo,
        // Only where there is a picture: an empty frame is worth its
        // space in a list, where it keeps the rows the same height,
        // and not on a card, where it is just a hole.
        media: lineImage(l) ? lineThumb(l, 'lg') : '',
        title: l.name || 'Untitled piece',
        sub: `${l.mrNo}${l.client ? ` · ${l.client}` : ''}`,
        meta: [l.qty > 1 ? `Qty ${l.qty}` : '', l.deliveryDate ? `due ${dmy(l.deliveryDate)}` : ''].filter(Boolean),
        tone: toneOf(col.key),
        pill: late ? 'Overdue' : '',
        flag: 'out',
        // What happens to this piece next, named on the card, so the
        // board is worked from rather than only read.
        action: nextButton(l, 'sm'),
      });
    }),
  })));
}

/* ── The timeline ──────────────────────────────────────────────
   An order as a bar, from the day it was taken on to the day it is
   due, against one shared scale with today on it. Read down the
   today line and you have every job that is already late; read
   right of it and you have the fortnight's collisions. */
function orderTimeline(groups) {
  const today = todayISO();
  const rows = [...groups]
    .sort((a, b) => (a.deliveryDate || '9999').localeCompare(b.deliveryDate || '9999'))
    .map((g) => {
      const late = isOverdue(g);
      return {
        id: g.mrNo,
        label: g.client || g.mrNo,
        sub: `${g.mrNo} · ${g.lines.length} piece${g.lines.length === 1 ? '' : 's'}`,
        start: g.orderReceived || '',
        end: g.deliveryDate || '',
        // The bar keeps its stage colour even when it is late —
        // being late is a second fact about it, and the red outline
        // says so without costing the stage its colour.
        tone: toneOf(g.stage),
        late,
        barLabel: stageLabel(g.stage),
        range: [g.orderReceived && dmy(g.orderReceived), g.deliveryDate && dmy(g.deliveryDate)].filter(Boolean).join(' → '),
      };
    });
  return timeline(rows, { today });
}

/** The queue as it always was: late first, then everything else. */
function listView(groups, overdue) {
  return `
    ${overdue.length ? `
      ${sectionHead('Running late')}
      <div class="olist">${overdue.map((g) => card(g, true)).join('')}</div>
      ${sectionHead('Everything else')}` : ''}
    <div class="olist">${groups
      .filter((g) => !(overdue.length && isOverdue(g)))
      .map((g) => card(g, false)).join('')}</div>`;
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
    thumb: thumb(orderImage(g), g.client || g.mrNo, 'sm'),
    tint: late ? 'sub' : 'prod',
    pill: late ? 'Overdue' : stageLabel(g.stage),
    pillTone: late ? 'out' : 'warn',
  });
}

/** The floating button's action, from app.js. */
export function openNewOrder(ctx) {
  openPieceSheet({}, ctx.refresh);
}
