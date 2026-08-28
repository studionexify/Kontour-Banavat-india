/* views/dashboard.js — Kontour's own screen.
 *
 * Not a fifth copy of the money log. The Dashboard answers one
 * question — what needs me today — and every block on it is a
 * snippet that belongs somewhere else, with a way through to the
 * screen that owns it. Nothing here can be edited in place; that
 * is the point. You look, you decide where to go.
 */

import { icon } from '../icons.js';
import { on, esc, emptyState } from '../ui.js';
import { jobs, jobSummary, sortedEntries, accountName, categoryName } from '../store.js';
import { openQuotes, pipelineValue, recentQuotes, quoteTotals, STATUS } from '../quotes.js';
import { inr, inrShort, todayISO, dmy, fyOf, ago } from '../format.js';
import { openEntryDetail } from './entry.js';

export async function render(root, ctx) {
  const today = todayISO();
  const open = openQuotes();
  const pipeline = pipelineValue();

  // Only jobs with an order value can be outstanding — a job with no
  // target has nothing to be short of. Biggest gap first.
  const live = jobs()
    .map((j) => ({ job: j, sum: jobSummary(j.code) }))
    .filter((x) => x.sum.outstanding != null && x.sum.outstanding > 0)
    .sort((a, b) => b.sum.outstanding - a.sum.outstanding);

  const outstanding = live.reduce((t, x) => t + x.sum.outstanding, 0);

  root.innerHTML = `
    <header class="hero with-panel">
      <div class="hero-bar">
        <div class="hero-title">
          Dashboard
          <small>Banavat India · ${esc(fyOf(today))}</small>
        </div>
        <button class="icon-btn" data-settings aria-label="Settings">${icon('gear', 21)}</button>
      </div>

      <div class="stat-row">
        <div class="stat">
          <span class="stat-ico">${icon('note', 17)}</span>
          <div class="stat-val num" ${pipeline ? `data-count="${pipeline}" data-fmt="short"` : ''}>${pipeline ? '' : '—'}</div>
          <div class="stat-lbl">QUOTED, OPEN</div>
        </div>
        <div class="stat">
          <span class="stat-ico">${icon('jobs', 17)}</span>
          <div class="stat-val num" ${outstanding ? `data-count="${outstanding}" data-fmt="short"` : ''}>${outstanding ? '' : '—'}</div>
          <div class="stat-lbl">TO COLLECT</div>
        </div>
      </div>
    </header>

    <div class="panel">
      ${snippet('Open quotations', 'quotes', open.length ? quotesHTML(open) : none('note', 'No quotation is waiting on a client'))}
      ${snippet('Jobs outstanding', 'jobs', live.length ? jobsHTML(live) : none('jobs', 'Nothing outstanding'))}
      ${snippet('Recent activity', 'ledger', activityHTML())}
    </div>
  `;

  on(root, '[data-settings]', () => ctx.openSettings());
  on(root, '[data-more]', (e, b) => ctx.go(b.dataset.more));
  on(root, '[data-quote]', (e, b) => ctx.go('quotes', { id: b.dataset.quote }));
  on(root, '[data-job]', (e, b) => ctx.go('jobs', { code: b.dataset.job }));
  on(root, '[data-entry]', (e, b) => openEntryDetail(b.dataset.entry, ctx));
}

/* Every block is the same shape: a heading, a way through to the
   screen that owns the data, and at most a handful of rows. The
   cap is the whole idea — a snippet that grows into a list is
   just the other screen, badly. */
function snippet(title, go, inner) {
  return `
    <section class="snip reveal">
      <div class="snip-head">
        <h2 class="snip-t">${esc(title)}</h2>
        <button class="snip-go" data-more="${go}">Open ${icon('chevR', 15)}</button>
      </div>
      ${inner}
    </section>
  `;
}

function none(ico, text) {
  return `<div class="snip-none">${icon(ico, 20)}<span>${esc(text)}</span></div>`;
}

function quotesHTML(list) {
  return `<div class="snip-rows">${list.slice(0, 4).map((q) => {
    const t = quoteTotals(q);
    const st = STATUS[q.status];
    return `
      <button class="qrow" data-quote="${esc(q.id)}">
        <div class="qrow-main">
          <div class="qrow-t">${esc(q.client.name || 'Unnamed client')}</div>
          <div class="qrow-s">MR # ${esc(q.mrNo)}${q.validUntil ? ` · valid to ${esc(dmy(q.validUntil))}` : ''}</div>
        </div>
        <div class="qrow-side">
          <span class="qrow-amt num">${inr(t.total)}</span>
          <span class="pill ${st.tone}">${esc(st.label)}</span>
        </div>
      </button>`;
  }).join('')}</div>`;
}

function jobsHTML(list) {
  return `<div class="snip-rows">${list.slice(0, 4).map(({ job, sum }) => `
    <button class="qrow" data-job="${esc(job.code)}">
      <div class="qrow-main">
        <div class="qrow-t">${esc(job.code)}${job.title ? ` · ${esc(job.title)}` : ''}</div>
        <div class="qrow-s">${inr(sum.received)} received of ${inr(sum.orderValue)}</div>
      </div>
      <div class="qrow-side">
        <span class="qrow-amt num out">${inrShort(sum.outstanding)}</span>
        <span class="qrow-cap">to collect</span>
      </div>
    </button>
  `).join('')}</div>`;
}

/* One combined stream — the last few things that happened anywhere
   in Kontour, so the Dashboard shows movement rather than a
   snapshot. Ledger entries and quotations interleave by time. */
function activityHTML() {
  const items = [
    ...sortedEntries().slice(0, 6).map((e) => ({
      at: e.createdAt || 0,
      html: `
        <button class="qrow" data-entry="${esc(e.id)}">
          <div class="qrow-main">
            <div class="qrow-t">${esc(e.particulars || categoryName(e.categoryId) || 'Entry')}</div>
            <div class="qrow-s">${esc(accountName(e.accountId))} · ${esc(dmy(e.date))}</div>
          </div>
          <div class="qrow-side">
            <span class="qrow-amt num ${e.type === 'in' ? 'in' : e.type === 'out' ? 'out' : ''}">${
              e.type === 'in' ? '+' : e.type === 'out' ? '−' : ''}${inrShort(e.amount)}</span>
            <span class="qrow-cap">${e.createdAt ? esc(ago(e.createdAt)) : ''}</span>
          </div>
        </button>`,
    })),
    ...recentQuotes(6).map((q) => ({
      at: q.updatedAt || 0,
      html: `
        <button class="qrow" data-quote="${esc(q.id)}">
          <div class="qrow-main">
            <div class="qrow-t">MR # ${esc(q.mrNo)}</div>
            <div class="qrow-s">${esc(q.client.name || 'Unnamed client')} · quotation</div>
          </div>
          <div class="qrow-side">
            <span class="qrow-amt num">${inrShort(quoteTotals(q).total)}</span>
            <span class="qrow-cap">${q.updatedAt ? esc(ago(q.updatedAt)) : ''}</span>
          </div>
        </button>`,
    })),
  ].sort((a, b) => b.at - a.at).slice(0, 5);

  if (!items.length) return none('inbox', 'Nothing has happened yet');
  return `<div class="snip-rows">${items.map((i) => i.html).join('')}</div>`;
}
