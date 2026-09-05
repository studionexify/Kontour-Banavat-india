/* views/quotelist.js — every quotation, newest first.
 *
 * The list is a working queue, not an archive: what is still out with
 * a client sits at the top of mind, so status is the primary filter
 * and the figure shown is always the one the client saw. Decided
 * quotations — accepted or declined — file themselves into Archive,
 * which is a filter of its own rather than a second screen.
 *
 * A card carries one cluster of facts and one row of actions, and
 * nothing else: client, number, date and total, then share, PDF and
 * everything-else. The long tail of actions lives in a sheet, because
 * a phone has room for three buttons and a thumb, not for nine.
 */

import { icon } from '../icons.js';
import { on, esc, emptyState, toast, confirmSheet, field, openSheet, haptic } from '../ui.js';
import {
  quoteFamilies, quoteTotals, STATUS, setStatus, deleteQuote, getQuote,
  reviseQuote, duplicateQuote, pipelineValue, archiveQuote, unarchiveQuote, isArchived,
} from '../quotes.js';
import { inr, dmy, fyOf } from '../format.js';
import { openQuoteSheet } from './quotebuilder.js';
import { openQuoteDoc } from './quotedoc.js';
import { shareQuotePdf, downloadQuotePdf } from '../quotepdf.js';

let filter = 'all';
let query = '';
let fy = 'all';
let archived = false;

/* Opening one quotation straight from the Dashboard. */
export function openById(id, ctx) {
  openQuoteSheet({ id, onSaved: ctx.refresh });
}

export function setFilter(next) {
  if (next && next.status) filter = next.status;
  if (next && next.q != null) query = next.q;
}

export async function render(root, ctx) {
  const inFy = (f) => fy === 'all' || fyOf(f.head.date) === fy;
  const list = quoteFamilies({ status: filter, q: query, archived }).filter(inFy);
  const pipeline = pipelineValue();
  const all = quoteFamilies({ q: query, archived }).filter(inFy);
  const archivedCount = quoteFamilies({ q: query, archived: true }).filter(inFy).length;
  // Newest year first, and only offered once there is more than one.
  const years = [...new Set(quoteFamilies({ archived: null })
    .map((f) => f.head.date).filter(Boolean).map(fyOf))].sort().reverse();
  const counts = { all: all.length };
  for (const k of ['draft', 'sent', 'accepted', 'declined']) {
    counts[k] = all.filter((f) => f.head.status === k).length;
  }
  // In the archive the live statuses are all that is left, so the
  // chips that would read zero forever are simply not offered.
  const statusKeys = archived ? ['all', 'accepted', 'declined'] : ['all', 'draft', 'sent'];

  root.innerHTML = `
    <header class="hero with-panel">
      <div class="hero-bar">
        <div class="hero-title">
          ${archived ? 'Archive' : 'Quotations'}
          <small>${counts.all} job${counts.all === 1 ? '' : 's'}${fy === 'all' ? '' : ` · ${esc(fy)}`}</small>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat">
          <div class="stat-val num" ${pipeline ? `data-count="${pipeline}" data-fmt="short"` : ''}>${pipeline ? '' : '—'}</div>
          <div class="stat-lbl">OPEN VALUE</div>
        </div>
        <div class="stat">
          <div class="stat-val num">${archived ? counts.accepted : counts.sent}</div>
          <div class="stat-lbl">${archived ? 'ACCEPTED' : 'AWAITING REPLY'}</div>
        </div>
        <div class="stat">
          <div class="stat-val num">${archived ? counts.declined : counts.draft}</div>
          <div class="stat-lbl">${archived ? 'DECLINED' : 'DRAFTS'}</div>
        </div>
      </div>
    </header>

    <div class="panel">
      <div class="searchbar">
        <span class="searchbar-ico">${icon('search', 17)}</span>
        <input class="control" type="search" data-q value="${esc(query)}"
               placeholder="${archived ? 'Search the archive' : 'Search client, MR number, job'}"
               aria-label="Search quotations">
      </div>

      <div class="chipbar">
        ${statusKeys.map((k) => `
          <button class="chip ${filter === k ? 'on' : ''}" data-filter="${k}">
            ${k === 'all' ? 'All' : STATUS[k].label}
            <small>${counts[k]}</small>
          </button>
        `).join('')}
        <button class="chip ${archived ? 'on' : ''}" data-archived="${archived ? 'off' : 'on'}">
          ${icon('inbox', 13)} Archive
          ${archived ? '' : `<small>${archivedCount}</small>`}
        </button>
        ${years.length > 1 ? `
          <span class="chipbar-sep"></span>
          <button class="chip ${fy === 'all' ? 'on' : ''}" data-fy="all">All years</button>
          ${years.map((y) => `<button class="chip ${fy === y ? 'on' : ''}" data-fy="${esc(y)}">${esc(y)}</button>`).join('')}
        ` : ''}
      </div>

      ${list.length ? `<div class="qlist">${list.map(card).join('')}</div>`
        : emptyState(archived ? 'inbox' : 'note',
            archived ? 'Nothing archived yet'
              : query || filter !== 'all' ? 'No quotation matches' : 'No quotations yet',
            archived ? 'Accepted and declined quotations land here'
              : query || filter !== 'all' ? 'Try another filter' : 'Tap + to write the first one')}
    </div>
  `;

  on(root, '[data-filter]', (e, b) => { filter = b.dataset.filter; ctx.refresh(); });
  on(root, '[data-fy]', (e, b) => { fy = b.dataset.fy; ctx.refresh(); });
  on(root, '[data-archived]', (e, b) => {
    archived = b.dataset.archived === 'on';
    filter = 'all';
    ctx.refresh();
  });

  on(root, '[data-doc]', (e, b) => { e.stopPropagation(); openQuoteDoc(b.dataset.doc); });

  on(root, '[data-share]', async (e, b) => {
    e.stopPropagation();
    await share(b.dataset.share);
  });

  on(root, '[data-pdf]', (e, b) => {
    e.stopPropagation();
    const q = getQuote(b.dataset.pdf);
    if (!q) return;
    downloadQuotePdf(q);
    toast('PDF saved');
  });

  on(root, '[data-more]', (e, b) => {
    e.stopPropagation();
    openActions(b.dataset.more, ctx);
  });

  // The card itself opens the editor — but only when the tap did not
  // land on one of the actions sitting inside it.
  on(root, '[data-open]', (e, b) => {
    if (e.target.closest('.qcard-acts') || e.target.closest('.qcard-hist')) return;
    openQuoteSheet({ id: b.dataset.open, onSaved: ctx.refresh });
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

/* ── One card per job ──────────────────────────────────────────
   The revision that is currently live, with the earlier rounds
   folded underneath: a job quoted five times takes one row. */
function card({ head: q, family, revisions }) {
  const t = quoteTotals(q);
  const st = STATUS[q.status];
  const lines = (q.lines || []).length;
  const older = family.filter((x) => x.id !== q.id);

  return `
    <article class="qcard reveal" data-open="${esc(q.id)}" tabindex="0" role="button">
      <div class="qcard-top">
        <div class="qcard-id">
          <div class="qcard-client">${esc(q.client.name || 'Unnamed client')}</div>
          <div class="qcard-line">
            <span class="qcard-mr">${esc(q.mrNo)}</span>
            <span class="qcard-dot"></span>${esc(dmy(q.date))}
            <span class="qcard-dot"></span>${lines} item${lines === 1 ? '' : 's'}
            ${revisions > 1 ? `<span class="qcard-dot"></span>rev ${revisions}` : ''}
          </div>
        </div>
        <div class="qcard-money">
          <div class="qcard-amt num">${inr(t.total)}</div>
          <span class="pill ${st.tone}">${esc(st.label)}</span>
        </div>
      </div>

      ${q.title ? `<p class="qcard-title">${esc(q.title)}</p>` : ''}

      ${older.length ? `
        <details class="qcard-hist">
          <summary>${older.length} earlier round${older.length === 1 ? '' : 's'}</summary>
          ${older.map((o) => {
            const ot = quoteTotals(o);
            const ost = STATUS[o.status];
            return `
              <button class="qhist" data-doc="${esc(o.id)}">
                <span class="qhist-n">${esc(o.mrNo)}</span>
                <span class="qhist-d">${esc(dmy(o.date))}</span>
                <span class="pill ${ost.tone}">${esc(ost.label)}</span>
                <span class="qhist-a num">${inr(ot.total)}</span>
              </button>`;
          }).join('')}
        </details>` : ''}

      <div class="qcard-acts">
        <button class="act" data-share="${esc(q.id)}" aria-label="Share this quotation">
          ${icon('upload', 17)}<span>Share</span>
        </button>
        <button class="act" data-pdf="${esc(q.id)}" aria-label="Download as PDF">
          ${icon('download', 17)}<span>PDF</span>
        </button>
        <button class="act" data-doc="${esc(q.id)}" aria-label="Preview the document">
          ${icon('note', 17)}<span>View</span>
        </button>
        <button class="act ghost" data-more="${esc(q.id)}" aria-label="More actions">
          ${icon('filter', 17)}
        </button>
      </div>
    </article>
  `;
}

/* ── Sharing ───────────────────────────────────────────────────
   One call, three outcomes, each of which needs something different
   said — a silent share sheet is indistinguishable from a dead
   button on a phone. */
async function share(id) {
  const q = getQuote(id);
  if (!q) return;
  haptic();
  try {
    const how = await shareQuotePdf(q);
    if (how === 'downloaded') toast('PDF saved — attach it from Downloads');
    else if (how === 'shared') toast('Shared');
  } catch {
    toast('Could not share that', 'err');
  }
}

/* ── The action sheet ──────────────────────────────────────────
   Everything a quotation can do, in the order it is likely wanted:
   the decision first, then the paperwork, then the destructive end.
   Which decisions are offered depends on where the quotation is. */
function openActions(id, ctx) {
  const q = getQuote(id);
  if (!q) return;
  const gone = isArchived(q);

  const rows = [];
  if (!gone && q.status === 'draft') {
    rows.push(['sent', 'check', 'Mark as sent', 'It is with the client now']);
  }
  if (!gone && (q.status === 'sent' || q.status === 'draft')) {
    rows.push(['accept', 'check', 'Client approved', 'Opens the job and archives this']);
    rows.push(['decline', 'close', 'Client declined', 'Moves it to the archive']);
  }
  if (gone) {
    rows.push(['restore', 'upload', 'Move back to the list', 'Status is left as it is']);
  } else {
    rows.push(['archive', 'inbox', 'Archive', 'Out of the working list']);
  }

  rows.push(['edit', 'edit', 'Edit', '']);
  if (q.status !== 'accepted') rows.push(['revise', 'repeat', 'Revise', 'A new round under the same number']);
  rows.push(['dup', 'box', 'Duplicate', 'Same items, a new client']);
  rows.push(['del', 'trash', 'Delete', '']);

  const h = openSheet({
    title: `MR # ${q.mrNo}`,
    body: `
      <div class="sheet-body">
        <div class="actlist">
          ${rows.map(([act, ico, label, sub]) => `
            <button class="actrow ${act === 'del' ? 'danger' : ''}" data-act="${act}">
              <span class="actrow-ico">${icon(ico, 18)}</span>
              <span class="actrow-t">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
              ${icon('chevR', 15)}
            </button>
          `).join('')}
        </div>
      </div>`,
    onMount(root) {
      on(root, '[data-act]', async (e, b) => {
        const act = b.dataset.act;

        // Delete asks before the sheet goes, so the question is not
        // stacked on top of a sheet that is animating away.
        if (act === 'del') {
          h.close();
          const ok = await confirmSheet({
            title: 'Delete this quotation?',
            message: 'Only this revision goes. Other rounds of the same MR number are left alone.',
            confirmLabel: 'Delete', danger: true,
          });
          if (!ok) return;
          deleteQuote(id);
          toast('Quotation deleted');
          return ctx.refresh();
        }

        if (act === 'accept') { h.close(); return openAccept(id, ctx); }

        h.close();
        if (act === 'sent') { setStatus(id, 'sent'); toast('Marked sent'); }
        else if (act === 'decline') { setStatus(id, 'declined'); toast('Declined · moved to archive'); }
        else if (act === 'archive') { archiveQuote(id); toast('Archived'); }
        else if (act === 'restore') { unarchiveQuote(id); toast('Back in the list'); }
        else if (act === 'edit') { return openQuoteSheet({ id, onSaved: ctx.refresh }); }
        else if (act === 'revise') {
          const next = reviseQuote(id);
          toast(`Revised as ${next.mrNo}`);
          return openQuoteSheet({ id: next.id, onSaved: ctx.refresh });
        } else if (act === 'dup') {
          const next = duplicateQuote(id);
          toast(`Copied to ${next.mrNo} — add the client`);
          return openQuoteSheet({ id: next.id, onSaved: ctx.refresh });
        }
        ctx.refresh();
      });
    },
  });
}

/* Accepting is the one action that reaches into Phynance, so it
   asks for the job code rather than inventing one. */
async function openAccept(id, ctx) {
  const { acceptQuote, quoteTotals: totals, baseNo } = await import('../quotes.js');
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
        tracking payment against the figure the client agreed to. The
        quotation moves to the archive.
      </p>
      ${field('Job code',
        `<input class="control" data-code value="${esc(q.jobCode || baseNo(q.mrNo) || '')}" autocapitalize="characters">`)}
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
