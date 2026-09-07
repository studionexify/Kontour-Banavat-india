/* views/jobs.js — money per job code.
   Enter an order value and the outstanding figure keeps itself current;
   leave it blank and the job simply has no target. */

import { icon } from '../icons.js';
import { on, esc, emptyState, openSheet, toast, confirmSheet } from '../ui.js';
import { jobs, jobSummary, updateJob, deleteJob, sortedEntries, ensureJob } from '../store.js';
import { inr, num } from '../format.js';
import { openEntryDetail, openEntrySheet } from './entry.js';
import { rowHTML } from './home.js';

let sort = 'outstanding';
let stage = 'all';

export function render(root, ctx) {
  const all = jobs().map((j) => ({ j, s: jobSummary(j.code) }));
  const stageOf = (j) => j.stage === 'completed' ? 'completed' : 'production';
  const list = stage === 'all' ? all : all.filter((x) => stageOf(x.j) === stage);
  const withTarget = list.filter((x) => x.s.outstanding !== null);
  const owed = withTarget.reduce((sum, x) => sum + Math.max(0, x.s.outstanding), 0);
  const received = list.reduce((sum, x) => sum + x.s.received, 0);
  const spent = list.reduce((sum, x) => sum + x.s.spent, 0);
  const stageCounts = {
    all: all.length,
    production: all.filter((x) => stageOf(x.j) === 'production').length,
    completed: all.filter((x) => stageOf(x.j) === 'completed').length,
  };

  const ordered = list.slice().sort((a, b) => {
    if (sort === 'outstanding') {
      const ao = a.s.outstanding === null ? -1 : a.s.outstanding;
      const bo = b.s.outstanding === null ? -1 : b.s.outstanding;
      return bo - ao;
    }
    if (sort === 'received') return b.s.received - a.s.received;
    return (b.j.lastUsed || 0) - (a.j.lastUsed || 0);
  });

  root.innerHTML = `
    <header class="hero" style="border-radius:0 0 26px 26px;padding-bottom:18px">
      <div class="hero-bar" style="margin-bottom:14px">
        <div style="width:38px"></div>
        <div class="hero-title" style="text-align:center">
          Jobs
          <small>${list.length} code${list.length === 1 ? '' : 's'} used</small>
        </div>
        <button class="icon-btn" data-addjob aria-label="Add job">${icon('plus', 21)}</button>
      </div>
      <div class="stat-row">
        <div class="stat">
          <div class="stat-val pos num" data-count="${received}" data-fmt="inr"></div>
          <div class="stat-lbl">RECEIVED</div>
        </div>
        <div class="stat">
          <div class="stat-val neg num" data-count="${spent}" data-fmt="inr"></div>
          <div class="stat-lbl">SPENT</div>
        </div>
        <div class="stat">
          <div class="stat-val num" style="color:var(--lime)" data-count="${owed}" data-fmt="inr"></div>
          <div class="stat-lbl">TO COLLECT</div>
        </div>
      </div>
    </header>

    <section class="sec" style="padding-top:16px">
      <div class="chipbar">
        ${stageChip('all', 'All')}
        ${stageChip('production', 'In production')}
        ${stageChip('completed', 'Completed')}
      </div>
      <div class="chipbar" style="margin-top:8px">
        ${sortChip('outstanding', 'To collect')}
        ${sortChip('received', 'Received')}
        ${sortChip('recent', 'Recent')}
      </div>
    </section>

    <section class="sec" style="padding-top:12px">
      ${ordered.length ? `<div class="list">${ordered.map(jobRow).join('')}</div>`
        : emptyState('jobs',
            stage === 'all' ? 'No jobs yet' : stage === 'production' ? 'Nothing in production' : 'Nothing completed yet',
            stage === 'all' ? 'Put a job code like B109 on an entry and it shows up here' : 'Try another tab')}
    </section>

    ${withTarget.length < list.length ? `
      <section class="sec">
        <div class="hint" style="text-align:center">
          ${list.length - withTarget.length} job${list.length - withTarget.length === 1 ? ' has' : 's have'} no order value set,
          so ${list.length - withTarget.length === 1 ? 'it shows' : 'they show'} no outstanding figure.
        </div>
      </section>` : ''}`;

  ctx.setTopbar('Jobs', `<span class="cur">₹</span>${num(owed)}`, 'TO COLLECT');

  on(root, '[data-sort]', (e, b) => { sort = b.dataset.sort; ctx.refresh(); });
  on(root, '[data-stage]', (e, b) => { stage = b.dataset.stage; ctx.refresh(); });
  on(root, '[data-jobopen]', (e, b) => openJob(b.dataset.jobopen, ctx));
  on(root, '[data-addjob]', () => openNewJob(ctx));

  function sortChip(key, label) {
    return `<button class="chip ${sort === key ? 'on' : ''}" data-sort="${key}">${label}</button>`;
  }
  function stageChip(key, label) {
    return `<button class="chip ${stage === key ? 'on' : ''}" data-stage="${key}">${label} <small>${stageCounts[key]}</small></button>`;
  }
}

function jobRow({ j, s }) {
  // With an order value the row answers "how much is still owed". Without
  // one there is nothing to be owed against, so it shows whichever side of
  // the job has actually moved money.
  let right;
  if (s.outstanding !== null) {
    right = `<span class="row-amt ${s.outstanding > 0 ? 'out' : 'in'}">${esc(inr(Math.max(0, s.outstanding)))}</span>`;
  } else if (s.received) {
    right = `<span class="row-amt in">+${esc(inr(s.received))}</span>`;
  } else if (s.spent) {
    right = `<span class="row-amt out">−${esc(inr(s.spent))}</span>`;
  } else {
    right = `<span class="row-amt tr">—</span>`;
  }
  const sub = [
    j.title || j.client || `${s.count} ${s.count === 1 ? 'entry' : 'entries'}`,
    s.orderValue ? `order ${inr(s.orderValue)}` : 'no order value',
  ].join(' · ');
  return `
    <button class="row" data-jobopen="${esc(j.code)}">
      <span class="row-ico">${icon('jobs', 18)}</span>
      <span class="row-txt">
        <span class="row-t">${esc(j.code)} ${j.stage === 'completed' ? '<span class="pill mut sm">Completed</span>' : ''}</span>
        <span class="row-s">${esc(sub)}</span>
      </span>
      ${right}
    </button>`;
}

/* ── Job detail ────────────────────────────────────────────── */

export function openJob(code, ctx) {
  const s = jobSummary(code);
  const j = s.job || { code, title: '', client: '', orderValue: 0 };
  const list = sortedEntries().filter((e) => e.jobCode === s.code);

  const sheet = openSheet({
    title: code,
    full: true,
    body: `
      <div class="sheet-body">
        <div class="kpis" style="margin-bottom:12px">
          <div class="kpi">
            <div class="kpi-l">RECEIVED</div>
            <div class="kpi-v in num">${inr(s.received)}</div>
          </div>
          <div class="kpi">
            <div class="kpi-l">SPENT ON IT</div>
            <div class="kpi-v out num">${inr(s.spent)}</div>
          </div>
        </div>

        <div class="list" style="padding:2px 14px;margin-bottom:14px">
          <div class="kv">
            <span>Order value${j.orderExcludesGst ? ' <span class="pill mut sm">excl. GST</span>' : ''}</span>
            <b class="num">${j.orderValue ? inr(j.orderValue) : 'not set'}</b>
          </div>
          ${s.outstanding !== null
            ? `<div class="kv"><span>Still to collect</span><b class="num" style="color:${s.outstanding > 0 ? 'var(--out)' : 'var(--in)'}">${inr(Math.max(0, s.outstanding))}</b></div>`
            : ''}
          <div class="kv"><span>Money in minus out</span><b class="num">${inr(s.margin)}</b></div>
          <div class="kv"><span>Entries</span><b>${s.count}</b></div>
        </div>

        <label class="switchrow" data-stage-row>
          <div><div class="sw-t">Completed</div>
            <div class="sw-s">Off keeps it in the In production list.</div></div>
          <div class="switch ${j.stage === 'completed' ? 'on' : ''}" data-stage-switch></div>
        </label>

        <p class="tray-lbl">Details</p>
        <div class="field">
          <label>Title</label>
          <input class="control" data-j="title" value="${esc(j.title || '')}" placeholder="Console, bed & side tables">
        </div>
        <div class="field">
          <label>Client</label>
          <input class="control" data-j="client" value="${esc(j.client || '')}" placeholder="Veer Chaudhary">
        </div>
        <div class="field">
          <label>Order value (₹)</label>
          <input class="control num" data-j="orderValue" type="number" inputmode="decimal"
                 value="${j.orderValue || ''}" placeholder="Leave blank for no target">
          <div class="hint">Set this and Kontour keeps the outstanding figure current on its own.</div>
        </div>
        <button class="btn sm" data-savejob>Save job</button>

        <p class="tray-lbl sp">Entries</p>
        ${list.length ? `<div class="list">${list.map((e) => rowHTML(e, true)).join('')}</div>`
          : emptyState('inbox', 'Nothing logged against this job yet')}

        <button class="btn sec sm" data-newforjob>${icon('plus', 15)} Log an entry for ${esc(code)}</button>
        <button class="btn danger sm" data-deljob>Remove job</button>
      </div>`,
    onMount(root) {
      on(root, '[data-entry]', (e, b) => openEntryDetail(b.dataset.entry, () => { sheet.close(); ctx.refresh(); }));

      on(root, '[data-stage-row]', () => {
        ensureJob(code, { silent: true });
        const next = j.stage === 'completed' ? 'production' : 'completed';
        j.stage = next;
        updateJob(code, { stage: next });
        root.querySelector('[data-stage-switch]').classList.toggle('on', next === 'completed');
        toast(next === 'completed' ? 'Marked completed' : 'Back in production');
        ctx.refresh();
      });

      on(root, '[data-savejob]', () => {
        const get = (k) => root.querySelector(`[data-j="${k}"]`).value;
        ensureJob(code, { silent: true });
        updateJob(code, {
          title: get('title').trim(),
          client: get('client').trim(),
          orderValue: Number(get('orderValue') || 0),
        });
        toast('Job saved');
        sheet.close();
        ctx.refresh();
      });

      on(root, '[data-newforjob]', () => {
        sheet.close();
        setTimeout(() => openEntrySheet({ prefill: { jobCode: code, party: j.client }, onSaved: ctx.refresh }), 210);
      });

      on(root, '[data-deljob]', async () => {
        const ok = await confirmSheet({
          title: `Remove ${code}?`,
          message: list.length
            ? `${list.length} entries use this code, so the job will be hidden rather than deleted — no money log is ever removed.`
            : 'This job has no entries and will be deleted.',
          confirmLabel: 'Remove job',
          danger: true,
        });
        if (!ok) return;
        deleteJob(code);
        toast('Job removed');
        sheet.close();
        ctx.refresh();
      });
    },
  });
}

function openNewJob(ctx) {
  const sheet = openSheet({
    title: 'New job',
    body: `
      <div class="sheet-body">
        <div class="field">
          <label>Job / MR No.</label>
          <input class="control" data-code placeholder="B109" autocapitalize="characters">
        </div>
        <div class="field">
          <label>Title</label>
          <input class="control" data-title placeholder="Console, bed & side tables">
        </div>
        <div class="field">
          <label>Client</label>
          <input class="control" data-client placeholder="Veer Chaudhary">
        </div>
        <div class="field">
          <label>Order value (₹)</label>
          <input class="control num" data-value type="number" inputmode="decimal" placeholder="Optional">
        </div>
        <button class="btn" data-create>Create job</button>
      </div>`,
    onMount(root) {
      on(root, '[data-create]', () => {
        const code = root.querySelector('[data-code]').value.trim().toUpperCase();
        if (!code) { toast('A job needs a code', 'warn'); return; }
        ensureJob(code, {
          title: root.querySelector('[data-title]').value.trim(),
          client: root.querySelector('[data-client]').value.trim(),
        });
        const v = Number(root.querySelector('[data-value]').value || 0);
        if (v) updateJob(code, { orderValue: v });
        toast(`${code} created`);
        sheet.close();
        ctx.refresh();
      });
    },
  });
}
