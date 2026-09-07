/* views/home.js — what the morning glance answers:
   what happened today, and what do I actually have. */

import { icon } from '../icons.js';
import { on, esc, emptyState, toast } from '../ui.js';
import {
  accounts, balance, monthTotals, entries,
  sortedEntries, categoryName, accountName, jobs, jobSummary,
  dueRecurring, markRecurringDone, phynanceStats,
} from '../store.js';
import { inr, inrShort, num, todayISO, thisMonthKey, monthLabel, dayHeading, fyOf } from '../format.js';
import { openEntrySheet, openEntryDetail } from './entry.js';
import { status } from '../sync.js';

let tab = 'accounts';

export async function render(root, ctx) {
  const today = todayISO();
  const m = monthTotals(thisMonthKey());
  const p = phynanceStats();
  const sync = await status();
  const due = dueRecurring(today);
  const todays = sortedEntries().filter((e) => e.date === today);

  root.innerHTML = `
    <header class="hero with-panel">
      <div class="hero-bar">
        <button class="icon-btn" data-go="reports" aria-label="Reports">${icon('chart', 21)}</button>
        <div class="hero-title" style="text-align:center">
          Phynance
          <small>Banavat India · ${esc(fyOf(today))}</small>
        </div>
        <button class="icon-btn" data-settings aria-label="Settings">${icon('gear', 21)}</button>
      </div>

      <div class="stat-row">
        <div class="stat">
          <span class="stat-ico">${icon('arrowIn', 17)}</span>
          <div class="stat-val num" ${p.outstanding ? `data-count="${p.outstanding}" data-fmt="short"` : ''}>${p.outstanding ? '' : '—'}</div>
          <div class="stat-lbl">OUTSTANDING</div>
        </div>
        <div class="stat">
          <span class="stat-ico">${icon('arrowOut', 17)}</span>
          <div class="stat-val num" ${p.vendorPayment ? `data-count="${p.vendorPayment}" data-fmt="short"` : ''}>${p.vendorPayment ? '' : '—'}</div>
          <div class="stat-lbl">VENDOR PAYMENT</div>
        </div>
        <div class="stat">
          <span class="stat-ico">${icon('wallet', 17)}</span>
          <div class="stat-val num" ${p.turnover ? `data-count="${p.turnover}" data-fmt="short"` : ''}>${p.turnover ? '' : '—'}</div>
          <div class="stat-lbl">TURN OVER</div>
        </div>
      </div>
    </header>

    <div class="panel">
      <div class="seg">
        <button data-tab="accounts" class="${tab === 'accounts' ? 'on' : ''}">Accounts</button>
        <button data-tab="jobs" class="${tab === 'jobs' ? 'on' : ''}">Jobs</button>
      </div>
      ${tab === 'accounts' ? accountsHTML() : jobsHTML()}
      ${stripHTML(sync, due, m)}
    </div>

    <section class="sec">
      <div class="sec-head">
        <div class="sec-title">${todays.length ? 'Today' : 'Recent'}</div>
        <button class="sec-link" data-go="ledger">See all</button>
      </div>
      ${listHTML(todays.length ? todays : sortedEntries().slice(0, 6), todays.length === 0)}
    </section>

    <section class="sec">
      <div class="sec-head"><div class="sec-title">${esc(monthLabel(thisMonthKey()))}</div></div>
      <div class="kpis">
        <div class="kpi">
          <div class="kpi-l">MONEY IN</div>
          <div class="kpi-v in num" data-count="${m.in}" data-fmt="inr"></div>
          <div class="kpi-s">${m.gstIn ? `incl. ₹${num(m.gstIn)} GST` : '&nbsp;'}</div>
        </div>
        <div class="kpi">
          <div class="kpi-l">MONEY OUT</div>
          <div class="kpi-v out num" data-count="${m.out}" data-fmt="inr"></div>
          <div class="kpi-s">${m.gstOut ? `incl. ₹${num(m.gstOut)} GST` : '&nbsp;'}</div>
        </div>
      </div>
      <button class="strip" data-go="reports" style="background:var(--paper);color:var(--ink);box-shadow:var(--shadow)">
        <div class="strip-ico" style="background:var(--pine-100);color:var(--pine-700)">${icon('chart', 19)}</div>
        <div class="strip-txt">
          <div class="strip-t">Net this month ${m.net >= 0 ? '+' : ''}${esc(inr(m.net))}</div>
          <div class="strip-s" style="color:var(--ink-3)">${m.count} entr${m.count === 1 ? 'y' : 'ies'} · tap for the full picture</div>
        </div>
        <span class="strip-go" style="color:var(--ink-3)">${icon('chevR', 18)}</span>
      </button>
    </section>`;

  ctx.setTopbar('Phynance', shortStat(p.outstanding), 'OUTSTANDING');

  /* ── events ─────────────────────────────────────────────── */
  on(root, '[data-tab]', (e, b) => { tab = b.dataset.tab; ctx.refresh(); });
  on(root, '[data-go]', (e, b) => ctx.go(b.dataset.go));
  on(root, '[data-settings]', () => ctx.openSettings());
  on(root, '[data-entry]', (e, b) => openEntryDetail(b.dataset.entry, ctx.refresh));
  on(root, '[data-job]', (e, b) => ctx.go('jobs', { code: b.dataset.job }));
  on(root, '[data-account]', (e, b) => ctx.go('ledger', { accountId: b.dataset.account }));
  on(root, '[data-new]', () => openEntrySheet({ onSaved: ctx.refresh }));

  on(root, '[data-sync]', async () => {
    toast('Uploading pending bills…');
    const { syncPending } = await import('../sync.js');
    const r = await syncPending();
    if (r.skipped) toast('Nothing to upload right now, or Drive is not connected', 'warn');
    else toast(`${r.done} uploaded${r.failed ? `, ${r.failed} failed` : ''}`);
    ctx.refresh();
  });

  on(root, '[data-due]', (e, b) => {
    const r = dueRecurring(today).find((x) => x.id === b.dataset.due);
    if (!r) return;
    openEntrySheet({
      prefill: { ...r.template, date: today },
      onSaved(saved) {
        if (saved) markRecurringDone(r.id, thisMonthKey());
        ctx.refresh();
      },
    });
  });
}

/* ── pieces ────────────────────────────────────────────────── */

function shortStat(v) {
  const s = inrShort(Math.abs(v));
  return `${v < 0 ? '−' : ''}<span class="cur">₹</span>${esc(s.replace('₹', ''))}`;
}

function accountsHTML() {
  const list = accounts();
  if (!list.length) return emptyState('wallet', 'No accounts yet', 'Add one in Settings');
  return `
    <div class="grid2">
      ${list.map((a) => {
        const b = balance(a.id);
        return `
        <button class="card" data-account="${a.id}">
          <span class="card-ico">${icon(a.icon || 'wallet', 22)}</span>
          <div class="card-name">${esc(a.name)}</div>
          <div class="card-sub">${countFor(a.id)} ${countFor(a.id) === 1 ? 'entry' : 'entries'}</div>
          <div class="card-val num ${b < 0 ? 'neg' : ''}" data-count="${b}" data-fmt="inr"></div>
        </button>`;
      }).join('')}
    </div>`;
}

function countFor(accountId) {
  return entries().filter((e) => e.accountId === accountId || e.toAccountId === accountId).length;
}

function jobsHTML() {
  const list = jobs().slice(0, 6);
  if (!list.length) {
    return emptyState('jobs', 'No jobs yet', 'Add a job code to an entry and it appears here');
  }
  return `
    <div class="grid2">
      ${list.map((j) => {
        const s = jobSummary(j.code);
        const owed = s.outstanding !== null;
        const showing = owed ? Math.max(0, s.outstanding) : (s.received || s.spent);
        const label = owed ? 'to collect' : (s.received ? 'received' : s.spent ? 'spent' : 'no movement');
        const entries = `${s.count} ${s.count === 1 ? 'entry' : 'entries'}`;
        return `
        <button class="card" data-job="${esc(j.code)}">
          <span class="card-ico">${icon('jobs', 22)}</span>
          <div class="card-name">${esc(j.code)}</div>
          <div class="card-sub">${esc(j.title || j.client || entries)}</div>
          <div class="card-val num ${owed && s.outstanding > 0 ? 'neg' : ''}">${inr(showing)}</div>
          <div class="card-sub">${label}</div>
        </button>`;
      }).join('')}
    </div>`;
}

function stripHTML(sync, due, m) {
  if (due.length) {
    const r = due[0];
    return `
      <button class="strip accent" data-due="${r.id}">
        <div class="strip-ico">${icon('repeat', 19)}</div>
        <div class="strip-txt">
          <div class="strip-t">${esc(r.label)} is due</div>
          <div class="strip-s">Tap to log it — nothing is saved until you do</div>
        </div>
        <span class="strip-go">${icon('chevR', 18)}</span>
      </button>`;
  }
  if (sync.pending) {
    const canGo = sync.online && sync.drive === 'connected';
    return `
      <button class="strip" ${canGo ? 'data-sync' : 'data-settings'}>
        <div class="strip-ico">${icon(sync.online ? 'cloud' : 'cloudOff', 19)}</div>
        <div class="strip-txt">
          <div class="strip-t">${sync.pending} bill${sync.pending > 1 ? 's' : ''} waiting to upload</div>
          <div class="strip-s">${canGo ? 'Tap to send them to Drive now' : sync.online ? 'Connect Google Drive in Settings' : 'They will go up when you are back online'}</div>
        </div>
        <span class="strip-go">${icon('chevR', 18)}</span>
      </button>`;
  }
  if (!m.count) {
    return `
      <button class="strip" data-new>
        <div class="strip-ico">${icon('plus', 19)}</div>
        <div class="strip-txt">
          <div class="strip-t">Log your first entry</div>
          <div class="strip-s">Amount, in or out, category — that is all it takes</div>
        </div>
        <span class="strip-go">${icon('chevR', 18)}</span>
      </button>`;
  }
  return '';
}

function listHTML(list, showDates) {
  if (!list.length) {
    return emptyState('inbox', 'Nothing logged yet today', 'Tap + when money moves');
  }
  return `<div class="list">${list.map((e) => rowHTML(e, showDates)).join('')}</div>`;
}

export function rowHTML(e, showDate = false) {
  const kind = e.type;
  const title = kind === 'transfer'
    ? `${accountName(e.accountId)} → ${accountName(e.toAccountId)}`
    : (e.party || categoryName(e.categoryId));
  const bits = [];
  if (kind !== 'transfer' && e.party) bits.push(categoryName(e.categoryId));
  if (e.jobCode) bits.push(e.jobCode);
  if (e.note) bits.push(e.note);
  if (showDate) bits.unshift(dayHeading(e.date));
  if (!bits.length) bits.push(accountName(e.accountId));

  return `
    <button class="row" data-entry="${e.id}">
      <span class="row-ico ${kind === 'in' ? 'in' : kind === 'out' ? 'out' : 'tr'}">
        ${icon(kind === 'in' ? 'arrowIn' : kind === 'out' ? 'arrowOut' : 'swap', 18)}
      </span>
      <span class="row-txt">
        <span class="row-t">${esc(title)}</span>
        <span class="row-s">${esc(bits.join(' · '))}${(e.photoIds && e.photoIds.length) ? ' 📎' : ''}</span>
      </span>
      <span class="row-amt ${kind}">${kind === 'in' ? '+' : kind === 'out' ? '−' : ''}${esc(inr(e.total))}</span>
    </button>`;
}
