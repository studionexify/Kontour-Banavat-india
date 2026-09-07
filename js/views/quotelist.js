/* views/quotelist.js — every live quotation, newest first.
 *
 * The list is a working queue, not an archive: what is still out with
 * a client sits at the top of mind, so status is the primary filter
 * and the figure shown is always the one the client saw. Decided
 * quotations — accepted or declined — leave this screen entirely and
 * file themselves into Archive, which is its own station on the line
 * now rather than a filter hiding inside this one.
 *
 * A row is one line: who and what, then the total and where it
 * stands, then the edit pencil a change actually needs. Everything
 * else a quotation can do — share, PDF, revise, decline — lives one
 * tap under the "⋯", because a phone has room for one icon on a row
 * and a thumb, not for five.
 */

import { icon } from '../icons.js';
import { on, esc, toast, confirmSheet, field, openSheet, haptic } from '../ui.js';
import {
  quoteFamilies, quoteTotals, quoteName, STATUS, setStatus, deleteQuote, getQuote,
  reviseQuote, duplicateQuote, archiveQuote, unarchiveQuote, isArchived,
  jobValueFor, quotationStats, acceptQuote,
} from '../quotes.js';
import { inr, dmy, fyOf } from '../format.js';
import { openQuoteSheet } from './quotebuilder.js';
import { openQuoteDoc } from './quotedoc.js';
import { shareQuotePdf, downloadQuotePdf } from '../quotepdf.js';
import { pageHead, statCards, searchBar, sectionHead, nothingHere } from './chrome.js';
import { createQuoteTable } from './quotetable.js';

let filter = 'all';
let query = '';
let fy = 'all';
/* Decided quotations have their own station now — the Archive tab —
   so this screen only ever lists what is still live. */
let archived = false;

/* The columns, the sort behind them and the ticks in the first one
   all live in quotetable.js, so the archive's list of decided
   quotations is the same table with a different set of bulk actions
   rather than a second copy of this one.

   "Reversed ... in terms of MR Number" is the plain-language spec for
   what the order defaults to — newest MR number first, direction
   flipped by tapping the heading already sorting. */
const qtable = createQuoteTable({
  bulk: [
    { key: 'sent',    icon: 'check',    label: 'Mark sent' },
    { key: 'produce', icon: 'anvil',    label: 'Send to production' },
    { key: 'archive', icon: 'inbox',    label: 'Archive' },
    { key: 'pdf',     icon: 'download', label: 'Download PDFs' },
    { key: 'del',     icon: 'trash',    label: 'Delete', danger: true },
  ],
  run: runBulk,
});

/* Opening one quotation straight from the Dashboard — the same
   read-only view a card in this list opens to. */
export function openById(id, ctx) {
  openQuoteDoc(id, { onSaved: ctx.refresh });
}

export function setFilter(next) {
  if (next && next.status) filter = next.status;
  if (next && next.q != null) query = next.q;
}

/* The Quotations subnav pill is navigation, not a filter — tapping it
   always lands on the plain working list, the way tapping any other
   destination does. Without this, tapping it while inside the Archive
   just re-painted the same screen (same route, so `show()` treats it
   as an in-place refresh) and Archive never let go. */
export function resetView() {
  archived = false;
  filter = 'all';
}

export async function render(root, ctx) {
  const inFy = (f) => fy === 'all' || fyOf(f.head.date) === fy;
  const list = qtable.sortList(quoteFamilies({ status: filter, q: query, archived }).filter(inFy));
  const qs = quotationStats();
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
    <div class="floor">
      ${pageHead({
        title: 'Quotation',
        sub: `${counts.all} job${counts.all === 1 ? '' : 's'} quoted${fy === 'all' ? '' : ` · ${esc(fy)}`}`,
        actions: `<button class="pill-btn" data-newquote>${icon('plus', 16)} New quotation</button>`,
      })}

      ${statCards([
        { label: 'Open quotations', value: qs.openCount, tone: 'quote', hint: 'awaiting a decision' },
        { label: 'Active orders', value: qs.activeCount, hint: 'confirmed and in hand' },
        { label: 'Active order value', value: qs.activeValue || '', money: Boolean(qs.activeValue) },
        { label: 'Decided', value: archivedCount, tone: 'done', go: 'archive', hint: 'in the archive' },
      ])}

      ${searchBar(query, 'Search client, MR number, job')}

      <div class="chipbar">
        ${statusKeys.map((k) => `
          <button class="chip ${filter === k ? 'on' : ''}" data-filter="${k}">
            ${k === 'all' ? 'All' : STATUS[k].label}
            <small>${counts[k]}</small>
          </button>
        `).join('')}
        ${years.length > 1 ? `
          <span class="chipbar-sep"></span>
          <button class="chip ${fy === 'all' ? 'on' : ''}" data-fy="all">All years</button>
          ${years.map((y) => `<button class="chip ${fy === y ? 'on' : ''}" data-fy="${esc(y)}">${esc(y)}</button>`).join('')}
        ` : ''}
      </div>

      ${sectionHead(
        filter === 'all' ? 'Live quotations' : `${STATUS[filter].label} quotations`,
        qtable.sortControl(),
      )}
      ${qtable.bulkBar()}
      ${list.length ? `${qtable.table(list, { rowActions })}<div class="qrows">${list.map(row).join('')}</div>`
        : nothingHere('note',
            query || filter !== 'all' ? 'No quotation matches' : 'No quotations yet',
            query || filter !== 'all' ? 'Try another filter' : 'Write the first one and it lands here')}
    </div>
  `;

  qtable.wire(root, ctx, list);

  on(root, '[data-filter]', (e, b) => { filter = b.dataset.filter; ctx.refresh(); });
  on(root, '[data-fy]', (e, b) => { fy = b.dataset.fy; ctx.refresh(); });
  on(root, '[data-go]', (e, b) => ctx.go(b.dataset.go));
  on(root, '[data-newquote]', () => openQuoteSheet({ onSaved: ctx.refresh }));

  on(root, '[data-edit]', (e, b) => {
    e.stopPropagation();
    openQuoteSheet({ id: b.dataset.edit, onSaved: ctx.refresh });
  });

  on(root, '[data-more]', (e, b) => {
    e.stopPropagation();
    openActions(b.dataset.more, ctx);
  });

  // The row opens the document as it stands — the same view.js is
  // for. Editing is its own pencil, never the first tap: a row in a
  // scrolling list is too easy to hit by accident to drop someone
  // into an edit.
  on(root, '[data-open]', (e, b) => {
    if (e.target.closest('button, label, input')) return;
    openQuoteDoc(b.dataset.open, { onSaved: ctx.refresh });
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

/* The one action a row earns its own icon for on this screen: a
   quotation still in play is edited often enough to be worth a
   pencil, and everything else stays one tap under the "⋯". */
function rowActions(q) {
  return `
    <button class="icon-btn plain sm" data-edit="${esc(q.id)}" aria-label="Edit ${esc(q.mrNo)}">${icon('edit', 16)}</button>
    <button class="icon-btn plain sm" data-more="${esc(q.id)}" aria-label="More actions for ${esc(q.mrNo)}">${icon('menu', 16)}</button>`;
}

/* Everything here is worth doing to a dozen quotations at once and
   nothing here needs a decision per quotation: sending to production
   books each job at the figure that was quoted, which is what
   approving one by one with the amount left alone already does. A
   quotation that cannot take an action is skipped rather than
   refused, so one draft in a batch of sent ones does not stop it. */
async function runBulk(act, ids, ctx) {
  if (act === 'del') {
    const ok = await confirmSheet({
      title: `Delete ${ids.length} quotation${ids.length === 1 ? '' : 's'}?`,
      message: 'Only the selected revisions go. Other rounds of the same MR numbers are left alone.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    ids.forEach(deleteQuote);
    qtable.clear();
    toast(`${ids.length} deleted`);
    return ctx.refresh();
  }

  if (act === 'pdf') {
    let made = 0;
    for (const id of ids) {
      const q = getQuote(id);
      if (!q) continue;
      try { await downloadQuotePdf(q); made += 1; } catch {}
    }
    toast(made ? `${made} PDF${made === 1 ? '' : 's'} saved` : 'Could not make those PDFs', made ? '' : 'err');
    return;
  }

  let done = 0;
  for (const id of ids) {
    const q = getQuote(id);
    if (!q) continue;
    if (act === 'sent') {
      if (q.status !== 'draft') continue;
      setStatus(id, 'sent'); done += 1;
    } else if (act === 'produce') {
      if (q.status === 'accepted') continue;
      acceptQuote(id); done += 1;
    } else if (act === 'archive') {
      if (isArchived(q)) continue;
      archiveQuote(id); done += 1;
    }
  }
  qtable.clear();
  const said = {
    sent: `${done} marked sent`,
    produce: `${done} sent to production`,
    archive: `${done} archived`,
  };
  toast(done ? said[act] : 'Nothing in that selection could take it');
  ctx.refresh();
}

/* ── One line per job ────────────────────────────────────────────
   The revision that is currently live: who, what number, when, and
   how many pieces — then the total and its status, then the one
   action a row actually needs often enough to earn its own icon.
   Everything else is a tap under "⋯". Earlier rounds of the same
   job fold under it exactly as they did as a card. */
function row({ head: q, family, revisions }) {
  const t = quoteTotals(q);
  const st = STATUS[q.status];
  const lines = (q.lines || []).length;
  const older = family.filter((x) => x.id !== q.id);
  const jobValue = q.status === 'accepted' ? jobValueFor(q) : t.total;
  const adjusted = q.approvedTotal != null;

  return `
    <article class="qrow2 reveal" data-open="${esc(q.id)}" tabindex="0" role="button">
      ${qtable.checkbox(q.id, `Select ${q.mrNo}`)}
      <div class="qrow2-main">
        <div class="qrow2-top">
          <span class="qrow2-client">${esc(quoteName(q))}</span>
          <span class="pill ${st.tone}">${esc(st.label)}</span>
        </div>
        <div class="qrow2-meta">
          ${esc(dmy(q.date))}
          <span class="qcard-dot"></span>${lines} item${lines === 1 ? '' : 's'}
          ${revisions > 1 ? `<span class="qcard-dot"></span>rev ${revisions}` : ''}
          ${q.title ? `<span class="qcard-dot"></span>${esc(q.title)}` : ''}
        </div>
        ${adjusted || q.jobExcludesGst ? `
          <div class="qcard-flags">
            ${adjusted ? `<span class="pill mut sm">Approved at ${inr(jobValue)}, quoted ${inr(t.total)}</span>` : ''}
            ${q.jobExcludesGst ? `<span class="pill mut sm">Job value excl. GST</span>` : ''}
          </div>` : ''}
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
      </div>

      <div class="qrow2-side">
        <span class="qrow2-amt num">${inr(jobValue)}</span>
        <div class="qrow2-acts">
          <button class="icon-btn plain sm" data-edit="${esc(q.id)}" aria-label="Edit this quotation">${icon('edit', 16)}</button>
          <button class="icon-btn plain sm" data-more="${esc(q.id)}" aria-label="More actions">${icon('menu', 16)}</button>
        </div>
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

  const rows = [
    ['view', 'note', 'Preview the document', ''],
    ['share', 'upload', 'Share', 'Sends the PDF'],
    ['pdf', 'download', 'Download as PDF', ''],
  ];
  if (!gone && q.status === 'draft') {
    rows.push(['sent', 'check', 'Mark as sent', 'It is with the client now']);
  }
  if (!gone && (q.status === 'sent' || q.status === 'draft')) {
    rows.push(['accept', 'check', 'Client approved', 'Opens the job in Phynance']);
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
    title: quoteName(q),
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

        if (act === 'view') { h.close(); return openQuoteDoc(id, { onSaved: ctx.refresh }); }
        if (act === 'share') { h.close(); return share(id); }
        if (act === 'pdf') {
          h.close();
          try { await downloadQuotePdf(q); toast('PDF saved'); }
          catch { toast('Could not make that PDF', 'err'); }
          return;
        }

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

/* Accepting is the one action that reaches into Phynance, and one
   form covers the three ways a quotation is actually approved:
   as quoted, at a figure the client negotiated to, or with GST kept
   out of the job's own value. The amount field is what tells the
   two apart — editing it away from the quoted total is what makes a
   sub-quotation, not a separate button, because that is the one
   piece of information that decides it. */
async function openAccept(id, ctx) {
  const { acceptQuote, quoteTotals: totals, baseNo } = await import('../quotes.js');
  const q = getQuote(id);
  if (!q) return;
  const t = totals(q);
  let includeGst = true;

  const h = openSheet({
    title: 'Quotation approved',
    body: `
      <div class="sheet-body">
      <p class="sheet-lede">This opens the job in Phynance and moves the quotation to the archive.</p>

      ${field('Job code',
        `<input class="control" data-code value="${esc(q.jobCode || baseNo(q.mrNo) || '')}" autocapitalize="characters">`)}

      ${field('Approved amount',
        `<input class="control num" data-amount type="number" inputmode="decimal" value="${t.total}">`,
        'Leave as quoted, or change it to what the client actually agreed — that writes a sub-quotation carrying this figure rather than editing the one you sent.')}

      <label class="switchrow" data-gst-row>
        <div><div class="sw-t">Count GST in the job value</div>
          <div class="sw-s">Off books the job at ${inr(t.sub)} — the pre-tax figure — and the quotation shows it was approved that way.</div></div>
        <div class="switch on" data-gst-switch></div>
      </label>

      <button class="btn" data-go>Approve and open job</button>
      </div>
    `,
    onMount(sheet, hdl) {
      const amountEl = sheet.querySelector('[data-amount]');
      const swEl = sheet.querySelector('[data-gst-switch]');

      on(sheet, '[data-gst-row]', () => {
        includeGst = !includeGst;
        swEl.classList.toggle('on', includeGst);
      });

      sheet.querySelector('[data-go]').onclick = () => {
        const code = sheet.querySelector('[data-code]').value.trim().toUpperCase();
        const approvedTotal = Number(amountEl.value) || 0;
        const result = acceptQuote(id, { jobCode: code, approvedTotal, excludeGst: !includeGst });
        const differed = result && result.approvedTotal != null;
        toast(code
          ? `Approved${differed ? ` at ${inr(approvedTotal)}` : ''} · job ${code} open`
          : 'Approved');
        hdl.close();
        ctx.refresh();
      };
    },
  });
  return h;
}
