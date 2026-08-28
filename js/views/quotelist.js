/* views/quotelist.js — every quotation, newest first.
 *
 * The list is a working queue, not an archive: what is still out
 * with a client sits at the top of mind, so status is the primary
 * filter and the figure shown is always the one the client saw.
 */

import { icon } from '../icons.js';
import { on, esc, emptyState, toast, confirmSheet, field } from '../ui.js';
import {
  quotes, quoteTotals, STATUS, setStatus, deleteQuote, reviseQuote, pipelineValue,
} from '../quotes.js';
import { inr, inrShort, dmy, todayISO, fyOf } from '../format.js';
import { openQuoteSheet } from './quotebuilder.js';
import { openQuoteDoc } from './quotedoc.js';

let filter = 'all';
let query = '';

/* Opening one quotation straight from the Dashboard. */
export function openById(id, ctx) {
  openQuoteSheet({ id, onSaved: ctx.refresh });
}

export function setFilter(next) {
  if (next && next.status) filter = next.status;
  if (next && next.q != null) query = next.q;
}

export async function render(root, ctx) {
  const list = quotes({ status: filter, q: query });
  const pipeline = pipelineValue();
  const counts = {
    all: quotes().length,
    draft: quotes({ status: 'draft' }).length,
    sent: quotes({ status: 'sent' }).length,
    accepted: quotes({ status: 'accepted' }).length,
    declined: quotes({ status: 'declined' }).length,
  };

  root.innerHTML = `
    <header class="hero with-panel">
      <div class="hero-bar">
        <div class="hero-title">
          Quotations
          <small>${counts.all} total · ${esc(fyOf(todayISO()))}</small>
        </div>
        <button class="icon-btn" data-new aria-label="New quotation">${icon('plus', 21)}</button>
      </div>
      <div class="stat-row">
        <div class="stat">
          <div class="stat-val num" ${pipeline ? `data-count="${pipeline}" data-fmt="short"` : ''}>${pipeline ? '' : '—'}</div>
          <div class="stat-lbl">OPEN VALUE</div>
        </div>
        <div class="stat">
          <div class="stat-val num">${counts.sent}</div>
          <div class="stat-lbl">AWAITING REPLY</div>
        </div>
        <div class="stat">
          <div class="stat-val num">${counts.accepted}</div>
          <div class="stat-lbl">ACCEPTED</div>
        </div>
      </div>
    </header>

    <div class="panel">
      <div class="searchbar">
        <input class="control" type="search" data-q value="${esc(query)}"
               placeholder="Search client, MR number, job" aria-label="Search quotations">
      </div>

      <div class="chipbar">
        ${['all', 'draft', 'sent', 'accepted', 'declined'].map((k) => `
          <button class="chip ${filter === k ? 'on' : ''}" data-filter="${k}">
            ${k === 'all' ? 'All' : STATUS[k].label}
            <small>${counts[k]}</small>
          </button>
        `).join('')}
      </div>

      ${list.length ? `<div class="qlist">${list.map(card).join('')}</div>`
        : emptyState('note', query || filter !== 'all' ? 'No quotation matches' : 'No quotations yet',
                     query || filter !== 'all' ? 'Try another filter' : 'Tap + to write the first one')}
    </div>
  `;

  on(root, '[data-new]', () => openQuoteSheet({ onSaved: ctx.refresh }));
  on(root, '[data-filter]', (e, b) => { filter = b.dataset.filter; ctx.refresh(); });
  on(root, '[data-doc]', (e, b) => { e.stopPropagation(); openQuoteDoc(b.dataset.doc); });
  // The action buttons live inside the card, and both handlers are
  // delegated on the same root — so stopPropagation on the action
  // does not stop this one. The card opens only when the click did
  // not land on one of its own actions.
  on(root, '[data-open]', (e, b) => {
    if (e.target.closest('.qcard-acts')) return;
    openQuoteSheet({ id: b.dataset.open, onSaved: ctx.refresh });
  });

  on(root, '[data-status]', async (e, b) => {
    e.stopPropagation();
    const { status, id } = b.dataset;
    if (status === 'accepted') return openAccept(id, ctx);
    setStatus(id, status);
    toast(`Marked ${STATUS[status].label.toLowerCase()}`);
    ctx.refresh();
  });

  on(root, '[data-revise]', async (e, b) => {
    e.stopPropagation();
    const q = reviseQuote(b.dataset.revise);
    toast(`Revised as ${q.mrNo}`);
    openQuoteSheet({ id: q.id, onSaved: ctx.refresh });
  });

  on(root, '[data-del]', async (e, b) => {
    e.stopPropagation();
    const ok = await confirmSheet({
      title: 'Delete this quotation?',
      message: 'The number is not reused — the next quote still takes the next number.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    deleteQuote(b.dataset.del);
    toast('Quotation deleted');
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

function card(q) {
  const t = quoteTotals(q);
  const st = STATUS[q.status];
  const lines = (q.lines || []).length;
  return `
    <article class="qcard reveal" data-open="${esc(q.id)}" tabindex="0" role="button">
      <div class="qcard-top">
        <div>
          <div class="qcard-num">MR # ${esc(q.mrNo)}</div>
          <div class="qcard-client">${esc(q.client.name || 'Unnamed client')}</div>
        </div>
        <span class="pill ${st.tone}">${esc(st.label)}</span>
      </div>

      ${q.title ? `<p class="qcard-title">${esc(q.title)}</p>` : ''}

      <div class="qcard-foot">
        <div class="qcard-meta">
          ${esc(dmy(q.date))} · ${lines} item${lines === 1 ? '' : 's'}
          ${q.jobCode ? ` · job ${esc(q.jobCode)}` : ''}
        </div>
        <div class="qcard-amt num">${inr(t.total)}</div>
      </div>

      <div class="qcard-acts">
        ${q.status === 'draft' ? `<button class="mini" data-status="sent" data-id="${esc(q.id)}">Mark sent</button>` : ''}
        ${q.status === 'sent' ? `
          <button class="mini ok" data-status="accepted" data-id="${esc(q.id)}">Accepted</button>
          <button class="mini" data-status="declined" data-id="${esc(q.id)}">Declined</button>` : ''}
        ${q.status === 'declined' ? `<button class="mini" data-revise="${esc(q.id)}">Revise</button>` : ''}
        ${q.status === 'accepted' && q.jobCode ? `<span class="mini flat">Job ${esc(q.jobCode)} open</span>` : ''}
        <button class="mini" data-doc="${esc(q.id)}">${icon('reports', 14)} Preview</button>
        <button class="mini danger" data-del="${esc(q.id)}">${icon('trash', 14)}</button>
      </div>
    </article>
  `;
}

/* Accepting is the one action that reaches into Phynance, so it
   asks for the job code rather than inventing one. */
async function openAccept(id, ctx) {
  const { openSheet } = await import('../ui.js');
  const { acceptQuote, getQuote, quoteTotals: totals } = await import('../quotes.js');
  const q = getQuote(id);
  if (!q) return;
  const t = totals(q);

  openSheet({
    title: 'Quotation accepted',
    body: `
      <div class="sheet-body">
      <p class="sheet-lede">
        This opens the job and sets its order value to
        <strong class="num">${inr(t.total)}</strong>, so Phynance starts
        tracking payment against the figure the client agreed to.
      </p>
      ${field('Job code',
        `<input class="control" data-code value="${esc(q.jobCode || q.mrNo || '')}" autocapitalize="characters">`,
        'The MR number is already the job code. Clear it to accept without opening a job.')}
      <button class="btn" data-go>Accept and open job</button>
      </div>
    `,
    onMount(sheet, h) {
      sheet.querySelector('[data-go]').onclick = () => {
        const code = sheet.querySelector('[data-code]').value.trim().toUpperCase();
        acceptQuote(id, code);
        toast(code ? `Accepted · job ${code} open` : 'Accepted');
        h.close();
        ctx.refresh();
      };
    },
  });
}
