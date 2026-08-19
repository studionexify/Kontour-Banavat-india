/* views/ledger.js — every entry, grouped by day, with just enough filtering. */

import { icon } from '../icons.js';
import { on, esc, emptyState, toast } from '../ui.js';
import {
  sortedEntries, totals, accounts, categoryName, accountName, monthsWithData,
} from '../store.js';
import { inr, num, monthLabel, monthShort, thisMonthKey, shiftMonth, dayHeading, monthKey } from '../format.js';
import { openEntryDetail } from './entry.js';
import { rowHTML } from './home.js';
import { exportMonthCSV, dayTextSummary } from '../export.js';

const state = { month: thisMonthKey(), type: 'all', accountId: '', jobCode: '', q: '' };

export function setFilter(params = {}) {
  Object.assign(state, params);
}

export function render(root, ctx) {
  const all = sortedEntries();
  const list = all.filter(match);
  const t = totals(list);
  const groups = groupByDay(list);
  const months = monthsWithData();

  root.innerHTML = `
    <header class="hero" style="border-radius:0 0 26px 26px;padding-bottom:18px">
      <div class="hero-bar" style="margin-bottom:14px">
        <button class="icon-btn" data-month="-1" aria-label="Previous month">${icon('back', 20)}</button>
        <div class="hero-title" style="text-align:center">
          ${esc(monthLabel(state.month))}
          <small>${list.length} entr${list.length === 1 ? 'y' : 'ies'}${state.accountId || state.jobCode || state.q ? ' · filtered' : ''}</small>
        </div>
        <button class="icon-btn" data-month="1" aria-label="Next month"
          ${state.month >= thisMonthKey() ? 'style="opacity:.3"' : ''}>${icon('chevR', 20)}</button>
      </div>

      <div class="stat-row">
        <div class="stat">
          <div class="stat-val pos num" data-count="${t.in}" data-fmt="inr"></div>
          <div class="stat-lbl">IN</div>
        </div>
        <div class="stat">
          <div class="stat-val neg num" data-count="${t.out}" data-fmt="inr"></div>
          <div class="stat-lbl">OUT</div>
        </div>
        <div class="stat">
          <div class="stat-val num">${t.net < 0 ? '−' : ''}<span class="cur">₹</span>${num(Math.abs(t.net))}</div>
          <div class="stat-lbl">NET</div>
        </div>
      </div>
    </header>

    <section class="sec" style="padding-top:16px">
      <div class="field" style="margin-bottom:10px">
        <input class="control" type="search" data-q value="${esc(state.q)}"
               placeholder="Search party, job, particulars" autocomplete="off">
      </div>
      <div class="chipbar" style="margin-bottom:4px">
        ${chip('all', 'All')}
        ${chip('in', 'Money in')}
        ${chip('out', 'Money out')}
        ${chip('transfer', 'Transfers')}
        ${accounts().map((a) => `
          <button class="chip ${state.accountId === a.id ? 'on' : ''}" data-acct="${a.id}">${esc(a.name)}</button>`).join('')}
        ${state.jobCode ? `<button class="chip on" data-clearjob>${esc(state.jobCode)} ✕</button>` : ''}
      </div>
    </section>

    <section class="sec" style="padding-top:6px">
      ${groups.length ? groups.map(dayHTML).join('') : emptyState(
        'inbox',
        state.q || state.accountId || state.jobCode ? 'Nothing matches that' : `No entries in ${monthShort(state.month)}`,
        state.q || state.accountId || state.jobCode ? 'Try clearing the filters' : 'Tap + to log one'
      )}
    </section>

    ${list.length ? `
      <section class="sec">
        <button class="btn sec sm" data-export>${icon('download', 16)} Export ${esc(monthShort(state.month))} to CSV</button>
      </section>` : ''}`;

  ctx.setTopbar(monthLabel(state.month), `${t.net < 0 ? '−' : ''}<span class="cur">₹</span>${num(Math.abs(t.net))}`, 'NET');

  on(root, '[data-month]', (e, b) => {
    const next = shiftMonth(state.month, Number(b.dataset.month));
    if (next > thisMonthKey()) return;
    state.month = next;
    ctx.refresh();
  });
  on(root, '[data-type]', (e, b) => { state.type = b.dataset.type; ctx.refresh(); });
  on(root, '[data-acct]', (e, b) => {
    state.accountId = state.accountId === b.dataset.acct ? '' : b.dataset.acct;
    ctx.refresh();
  });
  on(root, '[data-clearjob]', () => { state.jobCode = ''; ctx.refresh(); });
  on(root, '[data-entry]', (e, b) => openEntryDetail(b.dataset.entry, ctx.refresh));
  on(root, '[data-export]', () => {
    const n = exportMonthCSV(state.month);
    toast(`${n} entries exported`);
  });
  on(root, '[data-share]', (e, b) => {
    const iso = b.dataset.share;
    const text = dayTextSummary(iso, sortedEntries().filter((x) => x.date === iso).reverse());
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => toast('Day summary copied'));
    } else toast('Sharing is not available here', 'warn');
  });

  const q = root.querySelector('[data-q]');
  let timer = null;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = q.value;
      ctx.refresh();
      const again = document.querySelector('[data-q]');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }, 260);
  });

  function chip(type, label) {
    return `<button class="chip ${state.type === type ? 'on' : ''}" data-type="${type}">${label}</button>`;
  }
}

function match(e) {
  if (monthKey(e.date) !== state.month) return false;
  if (state.type !== 'all' && e.type !== state.type) return false;
  if (state.accountId && e.accountId !== state.accountId && e.toAccountId !== state.accountId) return false;
  if (state.jobCode && e.jobCode !== state.jobCode) return false;
  if (state.q) {
    const hay = [
      e.party, e.note, e.jobCode,
      categoryName(e.categoryId), accountName(e.accountId), String(e.total),
    ].join(' ').toLowerCase();
    if (!hay.includes(state.q.toLowerCase())) return false;
  }
  return true;
}

function groupByDay(list) {
  const map = new Map();
  for (const e of list) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items, t: totals(items) }));
}

function dayHTML(g) {
  return `
    <section class="daygroup">
    <div class="daybar">
      <b>${esc(dayHeading(g.date))}</b>
      <span>
        ${g.t.in ? `<span style="color:var(--in)">+${esc(inr(g.t.in))}</span>` : ''}
        ${g.t.in && g.t.out ? ' · ' : ''}
        ${g.t.out ? `<span style="color:var(--out)">−${esc(inr(g.t.out))}</span>` : ''}
      </span>
    </div>
    <div class="list">${g.items.map((e) => rowHTML(e)).join('')}</div>
    </section>`;
}
