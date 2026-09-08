/* views/viewkit.js — the four ways a list can be read.
 *
 * Every screen on the line holds the same thing — a set of records
 * with a stage, a date and a value — and the only real difference
 * between the screens is which shape of that set answers the
 * question being asked:
 *
 *   board     what is where, and what moves next   (production)
 *   timeline  who is on what, and for how long     (sub-contract)
 *   cards     one order at a glance, with its parts (shipping,
 *             archive)
 *   table     everything, sorted by any column      (Phynance,
 *             commission)
 *
 * All four live here so the tint of a stage, the shape of a card and
 * the behaviour of a sortable heading are decided once. A screen
 * picks its shapes and hands over rows; it never draws a grid line
 * of its own.
 *
 * Colour is load-bearing, not decoration. Each stage of the line
 * owns one tint (`--st-*` in styles.css) and every shape below reads
 * from the same map, so a piece at Assembly is the same blue in the
 * board, the bar chart and the card grid.
 */

import { icon } from '../icons.js';
import { esc, haptic } from '../ui.js';

/* ── The stage palette ─────────────────────────────────────────
   One tone per stage, in the order work moves. The tones are the
   station tints the rest of the app already uses, so a colour never
   means two things. */
export const STAGE_TONE = {
  pending:    'wait',
  drawings:   'quote',
  commission: 'sub',
  production: 'prod',
  assembly:   'qc',
  shipped:    'ship',
  delivered:  'done',
};

export function toneOf(stage) { return STAGE_TONE[stage] || 'wait'; }

/* A tone for a plain ordinal — used where the thing being coloured
   has no stage of its own (a sub-contractor's trades, a channel in
   a chart). Six steps, then it wraps. */
const LEVELS = ['quote', 'prod', 'sub', 'qc', 'ship', 'done'];
export function levelTone(i) { return LEVELS[((i % LEVELS.length) + LEVELS.length) % LEVELS.length]; }

/* ── The view switch ───────────────────────────────────────────
   One row of buttons, one per shape the screen offers. The screen
   keeps the choice; this only draws it and reports the tap. */

export function viewToggle(options, current) {
  return `
    <div class="viewtoggle" role="tablist" aria-label="How to view this list">
      ${options.map((o) => `
        <button class="viewbtn ${o.key === current ? 'on' : ''}" data-view="${esc(o.key)}"
                role="tab" aria-selected="${o.key === current}" title="${esc(o.label)}">
          ${icon(o.icon, 15)}<span>${esc(o.label)}</span>
        </button>`).join('')}
    </div>`;
}

export function wireViewToggle(root, set) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b || !root.contains(b)) return;
    haptic();
    set(b.dataset.view);
  });
}

/* ── Sortable table ────────────────────────────────────────────
   Sorting is a property of the column, not of a menu somewhere
   else: every heading is a button, tapping it sorts by that column,
   tapping it again reverses. Which column and which direction lives
   with the screen so it survives a redraw.

   columns: [{ key, label, cell(row), cmp(a,b), cls, align }]
   Any column with a `cmp` sorts; one without is a display column
   only, and its heading is inert. */

export function createSorter(columns, defaultKey, defaultDir = 'asc') {
  let key = defaultKey;
  let dir = defaultDir;
  const byKey = Object.fromEntries(columns.map((c) => [c.key, c]));

  function sort(list) {
    const col = byKey[key];
    if (!col || !col.cmp) return [...list];
    const d = dir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => d * col.cmp(a, b));
  }

  function mark(k) {
    if (k !== key) return `<span class="dt-mark">${icon('swap', 11)}</span>`;
    return `<span class="dt-mark on">${icon(dir === 'desc' ? 'chevD' : 'chevU', 11)}</span>`;
  }

  function head() {
    return `
      <tr>
        ${columns.map((c) => `
          <th class="${c.cls || ''}${c.align ? ` ta-${c.align}` : ''}${c.key === key ? ' sorted' : ''}">
            ${c.cmp
              ? `<button class="dt-h" data-sortby="${esc(c.key)}"
                   aria-label="Sort by ${esc(c.label)}">${esc(c.label)}${mark(c.key)}</button>`
              : `<span class="dt-h flat">${esc(c.label)}</span>`}
          </th>`).join('')}
      </tr>`;
  }

  /* The same decision, offered as chips where a table's headings are
     too narrow to tap — a phone. */
  function chips() {
    return `
      <div class="sortbar only-narrow">
        ${columns.filter((c) => c.cmp).map((c) => `
          <button class="sortbtn ${c.key === key ? 'on' : ''}" data-sortby="${esc(c.key)}">
            ${esc(c.label)}${c.key === key ? icon(dir === 'desc' ? 'chevD' : 'chevU', 12) : ''}
          </button>`).join('')}
      </div>`;
  }

  function wire(root, refresh) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sortby]');
      if (!b || !root.contains(b)) return;
      const k = b.dataset.sortby;
      if (k === key) dir = dir === 'asc' ? 'desc' : 'asc';
      else { key = k; dir = byKey[k] && byKey[k].defaultDir ? byKey[k].defaultDir : 'asc'; }
      haptic();
      refresh();
    });
  }

  return { sort, head, chips, wire, get key() { return key; }, get dir() { return dir; } };
}

/** The table itself. `rowAttrs(row)` decides what a row opens. */
export function dataTable(columns, rows, sorter, { rowAttrs = () => '', empty = '' } = {}) {
  if (!rows.length) return empty;
  return `
    <div class="dtable-wrap">
      <table class="dtable">
        <thead>${sorter.head()}</thead>
        <tbody>
          ${rows.map((r) => `
            <tr ${rowAttrs(r)}>
              ${columns.map((c) => `
                <td class="${c.cls || ''}${c.align ? ` ta-${c.align}` : ''}">${c.cell(r)}</td>`).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ── Board ─────────────────────────────────────────────────────
   The floor as columns, one per stage, in the order work moves.
   Each column is headed by its own tint and its count, so the
   pile-up is visible before anything is read. */

export function board(columns) {
  return `
    <div class="board">
      ${columns.map((c) => `
        <section class="bcol t-${esc(c.tone || 'wait')}">
          <header class="bcol-h">
            <span class="bcol-t">${esc(c.label)}</span>
            <span class="bcol-n">${c.cards.length}</span>
          </header>
          <div class="bcol-b">
            ${c.cards.length ? c.cards.join('') : `<p class="bcol-empty">${esc(c.empty || 'Nothing here')}</p>`}
          </div>
        </section>`).join('')}
    </div>`;
}

/** One card on the board. */
export function boardCard({ id, title, sub = '', meta = [], tone = 'wait', pill = '', flag = '' }) {
  return `
    <article class="bcard t-${esc(tone)}" data-open="${esc(id)}" tabindex="0" role="button">
      <div class="bcard-t">${esc(title)}</div>
      ${sub ? `<div class="bcard-s">${esc(sub)}</div>` : ''}
      ${meta.length ? `<div class="bcard-m">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
      <div class="bcard-f">
        ${pill ? `<span class="pill sm ${esc(flag || 'mut')}">${esc(pill)}</span>` : ''}
      </div>
    </article>`;
}

/* ── Timeline ──────────────────────────────────────────────────
   A bar per row, running from the day the work was taken on to the
   day it is due, against one shared scale with today marked on it.
   The bar carries the stage's colour, so how far along a job is and
   how much time is left are read in one glance instead of two.
   Rows with no dates at all are listed under the chart rather than
   silently dropped. */

export function timeline(rows, { today, months = 'auto', openAttr = 'data-open' } = {}) {
  const dated = rows.filter((r) => r.start && r.end);
  const undated = rows.filter((r) => !(r.start && r.end));
  if (!dated.length) {
    return `<div class="gantt-none">${undated.length
      ? esc(`${undated.length} item${undated.length === 1 ? '' : 's'} with no dates to plot`)
      : 'Nothing to plot'}</div>`;
  }

  const min = dated.reduce((m, r) => (r.start < m ? r.start : m), dated[0].start);
  const max = dated.reduce((m, r) => (r.end > m ? r.end : m), dated[0].end);
  const t0 = Date.parse(min);
  const t1 = Math.max(Date.parse(max), t0 + 86400000);
  const span = t1 - t0;
  const pct = (iso) => Math.max(0, Math.min(100, ((Date.parse(iso) - t0) / span) * 100));

  const ticks = tickDates(t0, t1, months === 'auto' ? 6 : months);
  const nowPct = today && Date.parse(today) >= t0 && Date.parse(today) <= t1 ? pct(today) : null;

  return `
    <div class="gantt">
      <div class="gantt-scale">
        ${ticks.map((t) => `<span class="gantt-tick" style="left:${pct(t.iso)}%">${esc(t.label)}</span>`).join('')}
        ${nowPct != null ? `<span class="gantt-now" style="left:${nowPct}%"><i></i>Today</span>` : ''}
      </div>
      <div class="gantt-rows">
        ${dated.map((r) => {
          const a = pct(r.start);
          const b = Math.max(pct(r.end), a + 0.8);
          return `
            <div class="gantt-row" ${openAttr}="${esc(r.id)}" tabindex="0" role="button">
              <div class="gantt-lbl">
                <span class="gantt-lbl-t">${esc(r.label)}</span>
                ${r.sub ? `<span class="gantt-lbl-s">${esc(r.sub)}</span>` : ''}
              </div>
              <div class="gantt-track">
                ${nowPct != null ? `<span class="gantt-rule" style="left:${nowPct}%"></span>` : ''}
                <span class="gantt-bar t-${esc(r.tone || 'wait')}${r.late ? ' late' : ''}"
                      style="left:${a}%;width:${b - a}%"
                      title="${esc(`${r.label} · ${r.range || ''}`)}">
                  ${r.progress != null ? `<i class="gantt-fill" style="width:${Math.max(0, Math.min(100, r.progress))}%"></i>` : ''}
                  <span class="gantt-bar-t">${esc(r.barLabel || '')}</span>
                </span>
              </div>
            </div>`;
        }).join('')}
      </div>
      ${undated.length ? `
        <p class="gantt-foot">${esc(`${undated.length} more with no dates set`)}</p>` : ''}
    </div>`;
}

function tickDates(t0, t1, count) {
  const out = [];
  const step = (t1 - t0) / Math.max(1, count - 1);
  for (let i = 0; i < count; i += 1) {
    const d = new Date(t0 + step * i);
    out.push({
      iso: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    });
  }
  return out;
}

/* ── Card grid ─────────────────────────────────────────────────
   One order per card, its pieces listed inside it. This is the
   shape Shipping and the Archive want: at those two stations the
   question is about a whole order — is it all out, is it all
   accounted for — and a row of six columns answers that worse than
   a card you can take in whole. */

export function cardGrid(cards) {
  return `<div class="cgrid">${cards.join('')}</div>`;
}

export function bigCard({
  id, title, mrNo = '', tone = 'wait', pill = '', pillTone = 'mut',
  stats = [], lines = [], foot = '', media = '',
}) {
  return `
    <article class="bigcard t-${esc(tone)}" data-open="${esc(id)}" tabindex="0" role="button">
      <div class="bigcard-top">
        <div class="bigcard-id">
          <span class="bigcard-mr">${esc(mrNo)}</span>
          ${pill ? `<span class="pill sm ${esc(pillTone)}">${esc(pill)}</span>` : ''}
        </div>
        <h3 class="bigcard-t">${esc(title)}</h3>
      </div>
      ${media || ''}
      ${stats.length ? `
        <div class="bigcard-stats">
          ${stats.map((s) => `
            <div class="bigcard-stat">
              <span class="bigcard-sv num">${esc(String(s.value))}</span>
              <span class="bigcard-sl">${esc(s.label)}</span>
            </div>`).join('')}
        </div>` : ''}
      ${lines.length ? `<ul class="bigcard-lines">${lines.map((l) => `
        <li class="t-${esc(l.tone || tone)}">
          <span class="bigcard-line-t">${esc(l.text)}</span>
          ${l.right ? `<span class="bigcard-line-r">${esc(l.right)}</span>` : ''}
        </li>`).join('')}</ul>` : ''}
      ${foot ? `<div class="bigcard-foot">${foot}</div>` : ''}
    </article>`;
}
