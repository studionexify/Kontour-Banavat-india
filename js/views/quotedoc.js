/* views/quotedoc.js — the quotation as the client receives it.
 *
 * A preview of the file, not a screen of its own: the same Letter
 * sheet, the same 0.7in margin, the same eight-column grid, the same
 * Montserrat, and the same pages in the same order — down to the
 * closing page, where the standing terms and the note sit together.
 * Every measurement lives in styles.css, in points, beside the ones
 * js/quotepdf.js draws with; if the two ever disagree the preview is
 * lying about what gets sent.
 *
 * It breaks into pages where the file breaks — see paginate(), which
 * measures the document and cuts it by the same rules quotepdf.js
 * draws by. Nothing here scrolls sideways either: the item table is
 * fixed-layout with its columns set as percentages, so a long
 * description wraps inside its column instead of pushing the page
 * out, and the sheets are scaled down to whatever width the screen
 * has — see fitPages().
 *
 * It is also where a saved quotation is looked at: read-only, the
 * way the client sees it, with one Edit button rather than every
 * field standing open. Tapping a card in the list lands here, not
 * in the builder — a card in a scrolling list is too easy to hit by
 * accident to drop someone into an edit form.
 *
 * Printing goes through the browser. `@media print` in the
 * stylesheet drops the app around it and gives each sheet a page.
 */

import { icon } from '../icons.js';
import { openSheet, esc, on, toast, haptic } from '../ui.js';
import { shareQuotePdf, downloadQuotePdf, DOC } from '../quotepdf.js';
import {
  getQuote, quoteTotals, quoteName, lineAmount, lineGst, settings, termRuns, jobValueFor,
} from '../quotes.js';
import { inrWhole as inr, dmyLong } from '../format.js';
import { markHTML, docMark } from '../brand.js';
import { useDocFont } from '../docfont.js';

/* The sheet is drawn at its true size — 612pt of Letter paper, 816
   CSS pixels — and then scaled to whatever the screen can give it.
   Anything else is a choice between a preview that lies about the
   file and a page that scrolls sideways, and both are worse. */
const SHEET_PX = 816;
const SHADOW = 6;               // room round the sheet for its own shadow

/* ── Pagination ─────────────────────────────────────────────────
   The preview breaks where the file breaks, by the same rules
   js/quotepdf.js paginates with: the note always begins a page, an
   item row is never cut in half, a table that runs over carries its
   column titles onto the next page, and every other block moves
   whole rather than splitting.

   It works by measurement, not by guessing. docHTML lays the whole
   document out as one long sheet; this reads back what each block
   actually came to at 816px, then deals them into pages a Letter
   sheet's worth at a time. Nothing here depends on the screen, so it
   runs once — the fit-to-width scale on top of it is a separate,
   cheaper thing that can re-run on every resize. */
function paginate(inner) {
  const measure = inner.querySelector('.doc-measure');
  if (!measure) return;

  const box = getComputedStyle(measure);
  const limit = parseFloat(box.minHeight) - parseFloat(box.paddingTop) - parseFloat(box.paddingBottom);
  if (!(limit > 0)) return;

  // Measured first, all of it, while the document is still in one
  // piece — heights read back after the cutting has started are
  // heights of a half-built page.
  const blocks = [...measure.children].map((el) => {
    const b = {
      el,
      height: el.getBoundingClientRect().height,
      gap: parseFloat(getComputedStyle(el).marginTop) || 0,
      fresh: el.hasAttribute('data-fresh-page'),
      rows: null,
      head: 0,
    };
    if (el.hasAttribute('data-split-rows') && el.tBodies[0]) {
      b.head = el.tHead ? el.tHead.getBoundingClientRect().height : 0;
      b.rows = [...el.tBodies[0].rows].map((tr) => ({ tr, height: tr.getBoundingClientRect().height }));
    }
    return b;
  });

  const sheets = document.createElement('div');
  sheets.className = 'doc-sheets';
  let page = null;
  let used = 0;

  const turnPage = () => {
    page = document.createElement('article');
    page.className = 'doc-page';
    sheets.appendChild(page);
    used = 0;
  };
  // A block that starts a page loses its gap — see the :first-child
  // rule in styles.css, which has to agree with this or the sums do
  // not describe the page they are cutting.
  const gapFor = (b) => (page.children.length ? b.gap : 0);
  const fits = (need) => used + need <= limit;

  turnPage();
  for (const b of blocks) {
    if (b.fresh && page.children.length) turnPage();

    if (!b.rows) {
      if (!fits(gapFor(b) + b.height) && page.children.length) turnPage();
      used += gapFor(b) + b.height;
      page.appendChild(b.el);
      continue;
    }

    /* A split table becomes one table per page, each with its own
       copy of the column titles — the same repeat the PDF draws. */
    let body = null;
    const startTable = () => {
      const part = b.el.cloneNode(false);
      if (b.el.tHead) part.appendChild(b.el.tHead.cloneNode(true));
      body = document.createElement('tbody');
      part.appendChild(body);
      used += gapFor(b) + b.head;
      page.appendChild(part);
    };

    const first = b.rows.length ? b.rows[0].height : 0;
    if (!fits(gapFor(b) + b.head + first) && page.children.length) turnPage();
    startTable();
    for (const row of b.rows) {
      if (!fits(row.height) && body.rows.length) { turnPage(); startTable(); }
      used += row.height;
      body.appendChild(row.tr);
    }
  }

  inner.querySelector('.doc-sheets').replaceWith(sheets);
}

function fitPages(root) {
  const fit = root.querySelector('.doc-fit');
  const inner = root.querySelector('.doc-fit-in');
  const scroll = root.querySelector('.doc-scroll');
  if (!fit || !inner || !scroll) return () => {};

  const apply = () => {
    const style = getComputedStyle(scroll);
    const room = scroll.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (room <= 0) return;
    const scale = Math.min(1, (room - SHADOW * 2) / SHEET_PX);
    inner.style.transform = `scale(${scale})`;
    // A transform paints small but still lays out at full size, so the
    // wrapper — not the sheet — is what has to be told how big the
    // scaled document actually is. Without this the sheets sit in an
    // 816px box and the scroller finds a page's worth of empty room
    // to the right of a phone screen.
    fit.style.width = `${SHEET_PX * scale}px`;
    fit.style.height = `${inner.scrollHeight * scale}px`;
  };

  apply();
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }
  const watch = new ResizeObserver(apply);
  watch.observe(scroll);
  return () => watch.disconnect();
}

export function openQuoteDoc(id, { onSaved, review = false, onApprove } = {}) {
  const q = getQuote(id);
  if (!q) return;

  let unfit = () => {};
  let closed = false;
  const h = openSheet({
    title: quoteName(q),
    full: true,
    wide: true,
    headRight: review ? '' : `
      <div class="sheet-head-acts">
        <button class="icon-btn plain" data-print aria-label="Print">${icon('reports', 20)}</button>
        <button class="icon-btn plain" data-edit aria-label="Edit">${icon('edit', 19)}</button>
      </div>`,
    body: `
      <div class="qb">
        <div class="qb-scroll doc-scroll">
          <div class="doc-fit"><div class="doc-fit-in laying-out">${docHTML(q)}</div></div>
        </div>
        <footer class="qb-foot">
          <div class="qb-acts">
            ${review ? `
              <button class="btn sm ghost" data-back>${icon('back', 16)} Back</button>
              <button class="btn sm grow ok" data-approve>Done</button>
            ` : `
              <button class="act" data-pdf aria-label="Download as PDF">${icon('download', 18)}<span>PDF</span></button>
              <button class="btn sm grow" data-share>${icon('upload', 17)} Share with client</button>
            `}
          </div>
        </footer>
      </div>`,
    onMount(root) {
      /* Laid out, then broken into pages, then scaled to the screen —
         in that order, and only once the faces are ready, because a
         document measured in the wrong font breaks in the wrong
         places. It is hidden rather than absent until then, so it
         holds its space and never reflows in front of the reader. */
      const inner = root.querySelector('.doc-fit-in');
      useDocFont().then(() => {
        if (closed || !inner.isConnected) return;
        paginate(inner);
        inner.classList.remove('laying-out');
        unfit = fitPages(root);
      });

      if (review) {
        on(root, '[data-back]', () => h.close());
        on(root, '[data-approve]', () => {
          h.close();
          if (onApprove) onApprove();
        });
        on(root, '[data-zoom]', (e, b) => openLightbox(b.dataset.zoom, b.dataset.zoomCaption));
        return;
      }

      on(root, '[data-pdf]', async () => {
        try { const name = await downloadQuotePdf(q); toast(`Saved ${name}`); }
        catch { toast('Could not make that PDF', 'err'); }
      });

      on(root, '[data-share]', async () => {
        haptic();
        try {
          const how = await shareQuotePdf(q);
          if (how === 'downloaded') toast('PDF saved — attach it from Downloads');
          else if (how === 'shared') toast('Shared');
        } catch { toast('Could not share that', 'err'); }
      });

      on(root, '[data-edit]', async () => {
        h.close();
        const { openQuoteSheet } = await import('./quotebuilder.js');
        openQuoteSheet({ id, onSaved: () => { if (onSaved) onSaved(); openQuoteDoc(id, { onSaved }); } });
      });

      // A photo taken on a phone in bad light is the one thing on this
      // document worth a second look — tap it and it fills the screen
      // instead of staying a thumbnail the width of its column.
      on(root, '[data-zoom]', (e, b) => openLightbox(b.dataset.zoom, b.dataset.zoomCaption));

      on(root, '[data-print]', () => {
        document.body.classList.add('printing');
        const done = () => {
          document.body.classList.remove('printing');
          window.removeEventListener('afterprint', done);
        };
        window.addEventListener('afterprint', done);
        window.print();
        // Safari never fires afterprint on a cancelled dialog.
        setTimeout(done, 1500);
      });
    },
    onClose() { closed = true; unfit(); },
  });
  return h;
}

function openLightbox(src, caption) {
  if (!src) return;
  openSheet({
    title: caption || 'Photograph',
    dark: true,
    body: `<div class="lightbox"><img src="${esc(src)}" alt=""></div>`,
  });
}

export function docHTML(q) {
  const s = settings();
  const t = quoteTotals(q);
  const lines = q.lines || [];
  const ship = (q.shipping || []).filter((sx) => Number(sx.amount) > 0 || sx.label);
  const perLineGst = q.gstMode === 'lineitem' && t.taxed;
  const decided = q.status === 'accepted';
  /* The terms open the closing page and the note follows them on it —
     unless there are no terms, in which case the note opens it. */
  const terms = termRuns(q).filter((runs) => runs.some((r) => String(r.text || '').trim()));

  const ladder = [
    [t.discount ? 'Total' : 'Sub - Total', inr(t.sub), false],
    ...(t.discount ? [
      ['Discount', `-${inr(t.discount)}`, false],
      ['Sub-Total', inr(t.afterDiscount), false],
    ] : []),
    ...(t.taxed ? [[`GST (${q.gstRate}%)`, inr(t.gst), false]] : []),
    ['Sub Total A', inr(t.subA), true],
  ];

  /* One sheet holding every block in one flow. paginate() measures it
     and cuts it into as many pages as it actually takes; until then
     this is what the reader would see if the script never ran, which
     is the whole document, in order, on one long page. */
  return `
  <div class="doc-sheets">
    <article class="doc-page doc-measure">
      <header class="doc-head">
        <h1 class="doc-title">Quotation</h1>
        ${markHTML({ size: 59, className: 'doc-mark', src: docMark() })}
      </header>

      <div class="doc-panels">
        <table class="doc-panel who">
          <tbody>
            ${panelRow('Client Name', q.client.name)}
            ${panelRow('Contact Number', q.client.phone || '-')}
            ${q.client.email ? panelRow('Email', q.client.email) : ''}
            <tr class="addr"><th>Shipping Address:</th><td>${setText(q.client.shippingAddress || '-', DOC.width(DOC.col.NAME, DOC.col.DIM))}</td></tr>
          </tbody>
        </table>
        <table class="doc-panel when">
          <tbody>
            ${panelRow('Quoted Date', q.date ? dmyLong(q.date) : '-')}
            ${panelRow('MR #', q.mrNo)}
            ${panelRow('Valid till', q.validUntil ? dmyLong(q.validUntil) : '-')}
          </tbody>
        </table>
      </div>

      ${q.status === 'superseded' || q.status === 'declined'
        ? `<p class="doc-stamp">This quotation is ${q.status === 'superseded'
            ? 'superseded by a later revision' : 'no longer under offer'}.</p>` : ''}

      ${decided && (q.approvedTotal != null || q.jobExcludesGst) ? `
        <p class="doc-stamp">Approved${q.approvedTotal != null
          ? ` at ${inr(jobValueFor(q))} (quoted at ${inr(t.total)})` : ''}${q.jobExcludesGst ? ', excluding GST' : ''}.</p>` : ''}

      <table class="doc-items" data-split-rows>
        <thead>
          <tr>
            <th class="c-sr">Sr. No.</th>
            <th class="c-img">Image</th>
            <th class="c-name">Name</th>
            <th class="c-desc">Description</th>
            <th class="c-dim">Dimensions</th>
            <th class="c-rate">Unit Price</th>
            <th class="c-qty">Quantity</th>
            <th class="c-amt">Total</th>
          </tr>
        </thead>
        <tbody>
          ${lines.length ? lines.map((l, i) => `
            <tr>
              <td class="c-sr">${i + 1}</td>
              <td class="c-img">${l.photo
                ? `<button class="doc-img-btn" data-zoom="${esc(l.photo)}" data-zoom-caption="${esc(l.name)}" aria-label="Enlarge photograph"><img src="${esc(l.photo)}" alt=""></button>`
                : ''}</td>
              <td class="c-name">${setText(l.name || 'Item', DOC.width(DOC.col.NAME, DOC.col.DESC))}</td>
              <td class="c-desc">${setText([l.description || '', l.finish ? `- Finish: ${l.finish}` : ''].filter(Boolean).join('\n'), DOC.width(DOC.col.DESC, DOC.col.DIM))}</td>
              <td class="c-dim">${setText(l.dims || '', DOC.width(DOC.col.DIM, DOC.col.RATE), true)}</td>
              <td class="c-rate">${inr(l.unitPrice)}</td>
              <td class="c-qty">${l.kind === 'lump' ? 1 : l.qty}</td>
              <td class="c-amt">${inr(lineAmount(l))}${perLineGst
                ? `<span class="doc-line-gst">+ ${inr(lineGst(l, q))} GST</span>` : ''}</td>
            </tr>`).join('') : '<tr><td colspan="8" class="doc-empty">No items on this quotation yet.</td></tr>'}
        </tbody>
      </table>

      <div class="doc-band">
        <section class="doc-pay">
          <h2>Payment Terms</h2>
          ${clauses(String(q.paymentTerms || '').split('\n').map((c) => [{ text: c }]), DOC.width(DOC.col.SR, DOC.col.RATE))}
        </section>
        <table class="doc-ladder">
          <tbody>
            ${ladder.map(([label, value, strong]) => `
              <tr${strong ? ' class="a"' : ''}><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>

      <table class="doc-ship" data-split-rows>
        <thead><tr><th class="c-sr">Sr. No.</th><th>Shipping</th><th class="c-amt">Sub Total B</th></tr></thead>
        <tbody>
          ${(ship.length ? ship : [{ label: '—', amount: 0 }]).map((sx, i) => `
            <tr>
              <td class="c-sr">${i + 1}</td>
              <td>${setText(sx.label || 'Shipping', DOC.width(DOC.col.IMG, DOC.col.RATE))}</td>
              <td class="c-amt">${inr(sx.amount)}</td>
            </tr>`).join('')}
        </tbody>
      </table>

      <table class="doc-grand">
        <thead><tr><th class="c-a">Sub Total A</th><th class="c-b">Sub Total B</th><th>Total</th></tr></thead>
        <tbody><tr>
          <td class="c-a">${inr(t.subA)}</td>
          <td class="c-b">${inr(t.subB)}</td>
          <td class="doc-total">${inr(t.total)}</td>
        </tr></tbody>
      </table>

      <div class="doc-details">
        <section>
          <h2>Banking Details</h2>
          <p>
            Bank: ${esc(s.bank.bank)}<br>
            A/C Name: ${esc(s.bank.name)}<br>
            A/C Number: ${esc(s.bank.account)}<br>
            IFSC: ${esc(s.bank.ifsc)}<br>
            Branch: ${esc(s.bank.branch)}
          </p>
        </section>
        <section>
          <h2>Contact Details</h2>
          <p>
            ${s.company.gstin ? `GSTIN: ${esc(s.company.gstin)}<br>` : ''}
            Address: ${esc(s.company.address)}<br>
            Email: ${esc(s.company.email)}<br>
            Phone: ${esc(s.company.phone)}<br>
            Website: ${esc(s.company.website)}
          </p>
        </section>
      </div>

      ${terms.length ? `
        <section class="doc-terms" data-fresh-page>
          <h2>Terms &amp; Conditions</h2>
          ${clauses(terms, DOC.page)}
          <p class="doc-aster">*Terms and conditions apply.</p>
        </section>` : ''}

    ${s.note ? `
      <section class="doc-note"${terms.length ? '' : ' data-fresh-page'}>
        <h2>Note Please</h2>
        ${String(s.note).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
          .map((p) => `<p>${setText(p, DOC.page)}</p>`).join('')}
      </section>` : ''}
    </article>
  </div>`;
}

/* ── Setting the text ───────────────────────────────────────────
   The lines are broken by js/quotepdf.js, not by the browser, and
   handed here already divided. No two text engines break a line in
   quite the same place — Chrome measures a run of Montserrat about
   0.2% narrower than the font's own advance widths do — so a preview
   left to wrap its own text disagrees with the file somewhere, always.
   These come out identical by construction.

   They are still ordinary wrapping text, joined by <br> rather than
   held with `white-space: pre`: if some browser ever did measure a
   line wider than its column, it would re-break that one line rather
   than push the page out sideways. */
function setText(text, width, bold = false) {
  return DOC.lines(text, width, bold).map(esc).join('<br>');
}

/* A clause, hanging under its dash, with the values this quotation
   filled in still bold across a line break. */
function setClause(runs, width) {
  const lines = DOC.clause(runs, width).map((line) => line.runs
    .map((r) => (r.bold ? `<b>${esc(r.text)}</b>` : esc(r.text)))
    .join(''));
  return `<p class="doc-clause">${lines.join('<br>')}</p>`;
}

function panelRow(label, value) {
  return `<tr><th>${esc(label)}:</th><td>${esc(value || '')}</td></tr>`;
}

/* Every clause in a block, each broken where the file breaks it. */
function clauses(runsPerClause, width) {
  return (runsPerClause || [])
    .filter((runs) => runs.some((r) => String(r.text || '').trim()))
    .map((runs) => setClause(runs, width))
    .join('');
}
