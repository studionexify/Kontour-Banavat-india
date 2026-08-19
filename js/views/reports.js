/* views/reports.js — the month in one screen, and the exports the CA wants. */

import { icon } from '../icons.js';
import { on, esc, emptyState, toast } from '../ui.js';
import {
  entries, totals, byCategory, accounts, balance, totalOnHand, monthsWithData, jobs, jobSummary,
} from '../store.js';
import { inr, num, monthLabel, monthShort, thisMonthKey, shiftMonth, monthKey, todayISO, fyRange } from '../format.js';
import { exportMonthCSV, exportMonthSummaryCSV, exportFYCSV, exportAllCSV } from '../export.js';

let month = thisMonthKey();

export function render(root, ctx) {
  const list = entries().filter((e) => monthKey(e.date) === month);
  const t = totals(list);
  const outs = byCategory(list, 'out');
  const ins = byCategory(list, 'in');
  const maxOut = outs.length ? outs[0].amount : 0;
  const maxIn = ins.length ? ins[0].amount : 0;
  const fy = fyRange(todayISO());
  const prev = totals(entries().filter((e) => monthKey(e.date) === shiftMonth(month, -1)));

  const jobRows = jobs()
    .map((j) => ({ j, s: jobSummary(j.code) }))
    .filter((x) => x.s.outstanding !== null && x.s.outstanding > 0)
    .sort((a, b) => b.s.outstanding - a.s.outstanding)
    .slice(0, 5);

  root.classList.add('two-col');   // see home.js — the report is a dashboard too

  root.innerHTML = `
    <header class="hero tight">
      <div class="hero-bar" style="margin-bottom:14px">
        <button class="icon-btn" data-m="-1" aria-label="Previous month">${icon('back', 20)}</button>
        <div class="hero-title" style="text-align:center">
          ${esc(monthLabel(month))}
          <small>${t.count} entr${t.count === 1 ? 'y' : 'ies'}</small>
        </div>
        <button class="icon-btn" data-m="1" aria-label="Next month"
          ${month >= thisMonthKey() ? 'style="opacity:.3"' : ''}>${icon('chevR', 20)}</button>
      </div>
      <div class="stat-row">
        <div class="stat">
          <div class="stat-val pos num" data-count="${t.in}" data-fmt="inr"></div>
          <div class="stat-lbl">MONEY IN</div>
        </div>
        <div class="stat">
          <div class="stat-val neg num" data-count="${t.out}" data-fmt="inr"></div>
          <div class="stat-lbl">MONEY OUT</div>
        </div>
        <div class="stat">
          <div class="stat-val num">${t.net < 0 ? '−' : ''}<span class="cur">₹</span>${num(Math.abs(t.net))}</div>
          <div class="stat-lbl">NET</div>
        </div>
      </div>
      ${prev.count ? `<div style="text-align:center;font-size:11.5px;color:var(--pine-200);margin-top:14px">
        ${compare(t.net, prev.net)} than ${esc(monthShort(shiftMonth(month, -1)))}
      </div>` : ''}
    </header>

    <section class="sec">
      <div class="sec-head"><div class="sec-title">In hand right now</div></div>
      <div class="list" style="padding:2px 14px">
        ${accounts().map((a) => `
          <div class="kv"><span>${esc(a.name)}</span><b class="num">${inr(balance(a.id))}</b></div>`).join('')}
        <div class="kv"><span style="font-weight:600;color:var(--ink)">Total</span><b class="num">${inr(totalOnHand())}</b></div>
      </div>
    </section>

    ${t.count ? `
      <section class="sec">
        <div class="sec-head"><div class="sec-title">Where it went</div></div>
        ${outs.length ? outs.map((c) => meter(c, maxOut, 'out')).join('') : `<div class="hint">Nothing spent this month.</div>`}
      </section>

      <section class="sec">
        <div class="sec-head"><div class="sec-title">Where it came from</div></div>
        ${ins.length ? ins.map((c) => meter(c, maxIn, 'in')).join('') : `<div class="hint">Nothing received this month.</div>`}
      </section>

      <section class="sec">
        <div class="sec-head"><div class="sec-title">GST</div></div>
        <div class="list" style="padding:2px 14px">
          <div class="kv"><span>Collected on sales</span><b class="num">${inr(t.gstIn)}</b></div>
          <div class="kv"><span>Paid on purchases</span><b class="num">${inr(t.gstOut)}</b></div>
          <div class="kv">
            <span style="font-weight:600;color:var(--ink)">Net ${t.gstNet >= 0 ? 'payable' : 'credit'}</span>
            <b class="num">${inr(Math.abs(t.gstNet))}</b>
          </div>
        </div>
        <div class="hint">Figures for your CA to work from — Phynance does not file anything.</div>
      </section>
    ` : emptyState('chart', `Nothing logged in ${monthShort(month)}`, 'Pick another month, or log an entry')}

    ${jobRows.length ? `
      <section class="sec">
        <div class="sec-head"><div class="sec-title">Still to collect</div>
          <button class="sec-link" data-go="jobs">All jobs</button></div>
        <div class="list" style="padding:2px 14px">
          ${jobRows.map(({ j, s }) => `
            <div class="kv"><span>${esc(j.code)}${j.client ? ' · ' + esc(j.client) : ''}</span>
            <b class="num" style="color:var(--out)">${inr(s.outstanding)}</b></div>`).join('')}
        </div>
      </section>` : ''}

    <section class="sec">
      <div class="sec-head"><div class="sec-title">Export</div></div>
      <button class="btn sec sm" data-x="month">${icon('download', 15)} ${esc(monthShort(month))} — every entry</button>
      <button class="btn sec sm" data-x="summary">${icon('download', 15)} ${esc(monthShort(month))} — summary for the CA</button>
      <button class="btn sec sm" data-x="fy">${icon('download', 15)} ${esc(fy.label)} — full year</button>
      <button class="btn sec sm" data-x="all">${icon('download', 15)} Everything, all time</button>
      <div class="hint" style="text-align:center;margin-top:10px">
        CSV opens in Excel. Amounts are the rupees that actually moved, with GST split out.
      </div>
    </section>`;

  ctx.setTopbar(monthLabel(month), `${t.net < 0 ? '−' : ''}<span class="cur">₹</span>${num(Math.abs(t.net))}`, 'NET');

  on(root, '[data-m]', (e, b) => {
    const next = shiftMonth(month, Number(b.dataset.m));
    if (next > thisMonthKey()) return;
    month = next;
    ctx.refresh();
  });
  on(root, '[data-go]', (e, b) => ctx.go(b.dataset.go));
  on(root, '[data-x]', (e, b) => {
    const k = b.dataset.x;
    let n = 0;
    if (k === 'month') n = exportMonthCSV(month);
    else if (k === 'summary') n = exportMonthSummaryCSV(month);
    else if (k === 'fy') n = exportFYCSV(todayISO());
    else n = exportAllCSV();
    toast(n ? `${n} entries exported` : 'Nothing to export for that period', n ? '' : 'warn');
  });
}

function meter(c, max, kind) {
  const pct = max ? Math.max(3, Math.round((c.amount / max) * 100)) : 0;
  return `
    <div class="meter">
      <div class="meter-top">
        <b>${esc(c.name)}</b>
        <span class="num">${esc(inr(c.amount))}</span>
      </div>
      <div class="meter-bar"><div class="meter-fill ${kind}" data-w="${pct}"></div></div>
    </div>`;
}

function compare(now, before) {
  if (before === 0) return 'First month with figures';
  const diff = now - before;
  if (Math.abs(diff) < 1) return 'Same';
  return `${inr(Math.abs(diff))} ${diff > 0 ? 'better' : 'worse'}`;
}

export function setMonth(k) { month = k; }
