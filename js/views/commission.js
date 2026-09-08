/* views/commission.js — the people paid a cut, not a wage.
 *
 * One card per partner, each carrying what they are owed and what
 * of that is still outstanding — the same shape as the Jobs screen,
 * because the question asked of both is the same one, just facing
 * the other direction: not what a client owes Banavat India, but
 * what Banavat India owes someone else. */

import { icon } from '../icons.js';
import { on, esc, emptyState, openSheet, toast, confirmSheet, field } from '../ui.js';
import {
  partners, getPartner, addPartner, updatePartner, deletePartner,
  entriesFor, getEntry, addEntry, updateEntry, deleteEntry,
  commissionOf, netOf, partnerSummary, totalSummary, seedKnownPartners,
} from '../commissions.js';
import { inr, dmy, todayISO } from '../format.js';
import { seedingAllowed } from '../shopsync.js';
import {
  viewToggle, wireViewToggle, createSorter, dataTable,
} from './viewkit.js';

/* Commission is a settlement list: the question is almost always
   "who is owed the most", and sometimes "who have we paid the
   least of what they earned". Both are a tap on a column heading,
   so the table is the working view and the cards are the browse. */
let view = 'table';

const VIEWS = [
  { key: 'table', label: 'Table', icon: 'rows' },
  { key: 'cards', label: 'Cards', icon: 'grid' },
];

const COLUMNS = [
  {
    key: 'name',
    label: 'Partner',
    cell: (r) => `<span class="dt-strong">${esc(r.p.name)}</span>`,
    cmp: (a, b) => a.p.name.localeCompare(b.p.name),
  },
  {
    key: 'projects',
    label: 'Projects',
    align: 'right',
    cls: 'num',
    defaultDir: 'desc',
    cell: (r) => String(r.s.count),
    cmp: (a, b) => a.s.count - b.s.count,
  },
  {
    key: 'rate',
    label: 'Rate',
    align: 'right',
    cell: (r) => (r.p.defaultPct != null ? `${esc(String(r.p.defaultPct))}%` : '<span class="dt-mut">varies</span>'),
    cmp: (a, b) => (a.p.defaultPct ?? -1) - (b.p.defaultPct ?? -1),
  },
  {
    key: 'earned',
    label: 'Earned',
    align: 'right',
    cls: 'dt-amt num',
    defaultDir: 'desc',
    cell: (r) => esc(inr(r.s.commission)),
    cmp: (a, b) => a.s.commission - b.s.commission,
  },
  {
    key: 'paid',
    label: 'Paid',
    align: 'right',
    cls: 'dt-amt num',
    defaultDir: 'desc',
    cell: (r) => `<span class="in">${esc(inr(r.s.paid))}</span>`,
    cmp: (a, b) => a.s.paid - b.s.paid,
  },
  {
    key: 'remaining',
    label: 'Outstanding',
    align: 'right',
    cls: 'dt-amt num',
    defaultDir: 'desc',
    cell: (r) => (r.s.remaining > 0
      ? `<span class="out">${esc(inr(r.s.remaining))}</span>`
      : '<span class="pill sm in">settled</span>'),
    cmp: (a, b) => a.s.remaining - b.s.remaining,
  },
];

const sorter = createSorter(COLUMNS, 'remaining', 'desc');

export function render(root, ctx) {
  // Only where this device's copy is the only one — see
  // shopsync.seedingAllowed().
  if (seedingAllowed()) seedKnownPartners();
  const list = partners().map((p) => ({ p, s: partnerSummary(p.id) }));
  const totals = totalSummary();

  root.innerHTML = `
    <header class="hero" style="border-radius:0 0 26px 26px;padding-bottom:12px">
      <div class="hero-bar" style="margin-bottom:8px">
        <div style="width:38px"></div>
        <div class="hero-title" style="text-align:center">
          Commission
          <small>${list.length} partner${list.length === 1 ? '' : 's'}</small>
        </div>
        <button class="icon-btn" data-addpartner aria-label="Add partner">${icon('plus', 21)}</button>
      </div>
      <div class="stat-row">
        <div class="stat">
          <div class="stat-val num" data-count="${totals.commission}" data-fmt="inr"></div>
          <div class="stat-lbl">TOTAL EARNED</div>
        </div>
        <div class="stat">
          <div class="stat-val pos num" data-count="${totals.paid}" data-fmt="inr"></div>
          <div class="stat-lbl">PAID OUT</div>
        </div>
        <div class="stat">
          <div class="stat-val num" style="color:var(--lime)" data-count="${totals.remaining}" data-fmt="inr"></div>
          <div class="stat-lbl">OUTSTANDING</div>
        </div>
      </div>
    </header>

    <section class="sec" style="padding-top:16px">
      <div class="secthead">
        <h2>${esc(view === 'table' ? 'Every partner' : 'Partners')}</h2>
        ${viewToggle(VIEWS, view)}
      </div>
      ${list.length
        ? (view === 'table' ? `
            ${sorter.chips()}
            ${dataTable(COLUMNS, sorter.sort(list), sorter, {
              rowAttrs: (r) => `data-partner="${esc(r.p.id)}" tabindex="0" role="button"`,
            })}`
          : `<div class="list">${list.map(partnerRow).join('')}</div>`)
        : emptyState('percent', 'No commission partners yet',
            'Add anyone who earns a cut of a job rather than a wage for it')}
    </section>`;

  ctx.setTopbar('Commission', `<span class="cur">₹</span>${totals.remaining.toLocaleString('en-IN')}`, 'OUTSTANDING');

  wireViewToggle(root, (v) => { view = v; ctx.refresh(); });
  sorter.wire(root, ctx.refresh);
  on(root, '[data-partner]', (e, b) => openPartner(b.dataset.partner, ctx));
  on(root, '[data-addpartner]', () => openNewPartner(ctx));
}

function partnerRow({ p, s }) {
  return `
    <button class="row" data-partner="${esc(p.id)}">
      <span class="row-ico">${icon('percent', 18)}</span>
      <span class="row-txt">
        <span class="row-t">${esc(p.name)}</span>
        <span class="row-s">${s.count} project${s.count === 1 ? '' : 's'} · earned ${inr(s.commission)}</span>
      </span>
      ${s.remaining > 0
        ? `<span class="row-amt out">${esc(inr(s.remaining))}</span>`
        : `<span class="row-amt tr">settled</span>`}
    </button>`;
}

/* ── Partner detail ────────────────────────────────────────────── */

function openPartner(id, ctx) {
  const p = getPartner(id);
  if (!p) return;
  const s = partnerSummary(id);
  const list = entriesFor(id);

  const sheet = openSheet({
    title: p.name,
    full: true,
    body: `
      <div class="sheet-body">
        <div class="kpis" style="margin-bottom:12px">
          <div class="kpi">
            <div class="kpi-l">COMMISSION EARNED</div>
            <div class="kpi-v num">${inr(s.commission)}</div>
          </div>
          <div class="kpi">
            <div class="kpi-l">PAID OUT</div>
            <div class="kpi-v in num">${inr(s.paid)}</div>
          </div>
        </div>

        <div class="list" style="padding:2px 14px;margin-bottom:14px">
          <div class="kv"><span>Still owed</span><b class="num" style="color:${s.remaining > 0 ? 'var(--out)' : 'var(--in)'}">${inr(s.remaining)}</b></div>
          <div class="kv"><span>Default rate</span><b>${p.defaultPct != null ? `${p.defaultPct}%` : 'varies'}</b></div>
          <div class="kv"><span>Projects</span><b>${s.count}</b></div>
        </div>

        ${p.notes ? `<p class="hint" style="margin:-6px 0 14px">${esc(p.notes)}</p>` : ''}

        <p class="tray-lbl">Details</p>
        <div class="field">
          <label>Name</label>
          <input class="control" data-p="name" value="${esc(p.name)}">
        </div>
        <div class="field">
          <label>Phone</label>
          <input class="control" data-p="phone" value="${esc(p.phone || '')}" inputmode="tel">
        </div>
        <div class="field">
          <label>Default commission (%)</label>
          <input class="control num" data-p="defaultPct" type="number" inputmode="decimal" value="${p.defaultPct ?? ''}">
        </div>
        <button class="btn sm" data-savepartner>Save partner</button>

        <p class="tray-lbl sp">Projects</p>
        ${list.length ? `<div class="list">${list.map(entryRow).join('')}</div>`
          : emptyState('inbox', 'Nothing logged for this partner yet')}

        <button class="btn sec sm" data-newentry>${icon('plus', 15)} Log a project for ${esc(p.name)}</button>
        <button class="btn danger sm" data-delpartner>Remove partner</button>
      </div>`,
    onMount(root) {
      on(root, '[data-entry]', (e, b) => openEntrySheetFor(id, b.dataset.entry, sheet, ctx));

      on(root, '[data-savepartner]', () => {
        const get = (k) => root.querySelector(`[data-p="${k}"]`).value;
        const pct = get('defaultPct');
        updatePartner(id, {
          name: get('name').trim() || p.name,
          phone: get('phone').trim(),
          defaultPct: pct === '' ? null : Number(pct),
        });
        toast('Partner saved');
        sheet.close();
        ctx.refresh();
      });

      on(root, '[data-newentry]', () => {
        sheet.close();
        setTimeout(() => openEntrySheetFor(id, '', null, ctx), 210);
      });

      on(root, '[data-delpartner]', async () => {
        const ok = await confirmSheet({
          title: `Remove ${p.name}?`,
          message: list.length
            ? `${list.length} project${list.length === 1 ? '' : 's'} logged against them stay on file — only the partner is hidden.`
            : 'This partner has no projects logged and will be removed.',
          confirmLabel: 'Remove partner',
          danger: true,
        });
        if (!ok) return;
        deletePartner(id);
        toast('Partner removed');
        sheet.close();
        ctx.refresh();
      });
    },
  });
}

function entryRow(e) {
  const commission = commissionOf(e);
  const remaining = commission - (Number(e.paid) || 0);
  // The base-and-rate reading is only meaningful when that is really
  // how the figure was arrived at — an overridden commission (a
  // historical figure the clean formula does not reproduce) shows
  // the commission itself instead of implying an arithmetic that
  // does not actually hold.
  const basis = e.commissionOverride != null
    ? `${inr(commission)} commission`
    : `${e.pct}% inside ${inr(e.baseAmount)}`;
  return `
    <button class="row" data-entry="${esc(e.id)}">
      <span class="row-ico">${icon('box', 18)}</span>
      <span class="row-txt">
        <span class="row-t">${esc(e.project || e.jobCode || 'Untitled project')}</span>
        <span class="row-s">
          ${e.jobCode ? `${esc(e.jobCode)} · ` : ''}${basis}${e.date ? ` · ${esc(dmy(e.date))}` : ''}
        </span>
      </span>
      ${remaining > 0.5
        ? `<span class="row-amt out">${esc(inr(remaining))}</span>`
        : `<span class="row-amt tr">paid</span>`}
    </button>`;
}

/* ── One project's commission ──────────────────────────────────── */

function openEntrySheetFor(partnerId, entryId, parentSheet, ctx) {
  const e = entryId ? getEntry(entryId) : null;
  const p = getPartner(partnerId);

  const sheet = openSheet({
    title: e ? 'Edit project' : 'New project',
    body: `
      <div class="sheet-body">
        ${field('Project', `<input class="control" data-f="project" value="${esc(e?.project || '')}" placeholder="Gulabchand Jewellers (Mandvi)">`)}
        ${field('Job / MR No.', `<input class="control" data-f="jobCode" value="${esc(e?.jobCode || '')}" autocapitalize="characters" placeholder="Optional">`)}
        <div class="qb-grid">
          ${field('Order total (₹)', `<input class="control num" data-f="baseAmount" type="number" inputmode="decimal" value="${e?.baseAmount || ''}">`,
            'The commission comes out of this figure — it is not added on top.')}
          ${field('Commission (%)', `<input class="control num" data-f="pct" type="number" inputmode="decimal" value="${e?.pct ?? p?.defaultPct ?? 10}">`)}
        </div>
        <p class="hint" data-preview style="margin:-8px 0 14px"></p>
        ${field('Commission override (₹)',
          `<input class="control num" data-f="commissionOverride" type="number" inputmode="decimal" value="${e?.commissionOverride ?? ''}">`,
          'Leave blank to extract it from the order total above. Set this when the real figure on record does not match that — a renegotiated rate, a manual rounding.')}
        <div class="qb-grid">
          ${field('Date', `<input class="control" type="date" data-f="date" value="${e?.date || todayISO()}">`)}
          ${field('Mode', `<input class="control" data-f="mode" value="${esc(e?.mode || '')}" placeholder="Bank, UPI, Cheque">`)}
        </div>
        ${field('Paid so far (₹)', `<input class="control num" data-f="paid" type="number" inputmode="decimal" value="${e?.paid || 0}">`)}
        ${field('Notes', `<textarea class="control" data-f="notes" rows="2">${esc(e?.notes || '')}</textarea>`)}
        <button class="btn" data-save>${e ? 'Save project' : 'Add project'}</button>
        ${e ? `<button class="btn danger sm" data-del>Delete</button>` : ''}
      </div>`,
    onMount(root) {
      const get = (k) => root.querySelector(`[data-f="${k}"]`).value;

      const preview = root.querySelector('[data-preview]');
      const updatePreview = () => {
        const override = get('commissionOverride');
        if (override !== '') { preview.textContent = ''; return; }
        const base = Number(get('baseAmount')) || 0;
        const pct = Number(get('pct')) || 0;
        const fake = { baseAmount: base, pct, commissionOverride: null };
        preview.textContent = base
          ? `Commission ${inr(commissionOf(fake))} · Banavat India nets ${inr(netOf(fake))} of this ${inr(base)}`
          : '';
      };
      root.querySelectorAll('[data-f="baseAmount"], [data-f="pct"], [data-f="commissionOverride"]')
        .forEach((el) => el.addEventListener('input', updatePreview));
      updatePreview();

      on(root, '[data-save]', () => {
        const payload = {
          partnerId,
          project: get('project').trim(),
          jobCode: get('jobCode').trim(),
          baseAmount: Number(get('baseAmount')) || 0,
          pct: Number(get('pct')) || 0,
          commissionOverride: get('commissionOverride') === '' ? null : Number(get('commissionOverride')),
          date: get('date'),
          mode: get('mode').trim(),
          paid: Number(get('paid')) || 0,
          notes: get('notes').trim(),
        };
        if (e) updateEntry(e.id, payload);
        else addEntry(payload);
        toast(e ? 'Project saved' : 'Project added');
        sheet.close();
        ctx.refresh();
      });
      if (e) on(root, '[data-del]', async () => {
        const ok = await confirmSheet({ title: 'Delete this project?', confirmLabel: 'Delete', danger: true, message: 'This only removes the commission record — nothing about the job itself.' });
        if (!ok) return;
        deleteEntry(e.id);
        toast('Deleted');
        sheet.close();
        ctx.refresh();
      });
    },
  });
  return sheet;
}

function openNewPartner(ctx) {
  const sheet = openSheet({
    title: 'New commission partner',
    body: `
      <div class="sheet-body">
        ${field('Name', `<input class="control" data-name placeholder="Shreemay Associate">`)}
        ${field('Phone', `<input class="control" data-phone inputmode="tel" placeholder="Optional">`)}
        ${field('Default commission (%)', `<input class="control num" data-pct type="number" inputmode="decimal" value="10">`)}
        <button class="btn" data-create>Add partner</button>
      </div>`,
    onMount(root) {
      on(root, '[data-create]', () => {
        const name = root.querySelector('[data-name]').value.trim();
        if (!name) { toast('A partner needs a name', 'warn'); return; }
        addPartner({
          name,
          phone: root.querySelector('[data-phone]').value.trim(),
          defaultPct: Number(root.querySelector('[data-pct]').value) || 0,
        });
        toast(`${name} added`);
        sheet.close();
        ctx.refresh();
      });
    },
  });
}
