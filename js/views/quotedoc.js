/* views/quotedoc.js — the quotation as the client receives it.
 *
 * A preview of the file, not a screen of its own: the same Letter
 * sheet, the same 0.7in margin, the same eight-column grid, the same
 * Montserrat, and the same two pages — the quotation, then the note.
 * Every measurement lives in styles.css, in points, beside the ones
 * js/quotepdf.js draws with; if the two ever disagree the preview is
 * lying about what gets sent.
 *
 * Nothing here scrolls sideways. The item table is fixed-layout with
 * its columns set as percentages, so a long description wraps inside
 * its column instead of pushing the page out, and the sheet itself is
 * scaled down to whatever width the screen has — see fitPages().
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
import { shareQuotePdf, downloadQuotePdf } from '../quotepdf.js';
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
  // Images arrive after the first paint and change the height.
  for (const img of fit.querySelectorAll('img')) {
    if (!img.complete) img.addEventListener('load', apply, { once: true });
  }
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
  useDocFont();

  let unfit = () => {};
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
          <div class="doc-fit"><div class="doc-fit-in">${docHTML(q)}</div></div>
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
      unfit = fitPages(root);

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
    onClose() { unfit(); },
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

  const ladder = [
    [t.discount ? 'Total' : 'Sub - Total', inr(t.sub), false],
    ...(t.discount ? [
      ['Discount', `-${inr(t.discount)}`, false],
      ['Sub-Total', inr(t.afterDiscount), false],
    ] : []),
    ...(t.taxed ? [[`GST (${q.gstRate}%)`, inr(t.gst), false]] : []),
    ['Sub Total A', inr(t.subA), true],
  ];

  return `
  <div class="doc-sheets">
    <article class="doc-page">
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
            <tr class="addr"><th>Shipping Address:</th><td>${multiline(q.client.shippingAddress || '-')}</td></tr>
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

      <table class="doc-items">
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
              <td class="c-name">${esc(l.name)}</td>
              <td class="c-desc">${multiline([l.description || '', l.finish ? `- Finish: ${l.finish}` : ''].filter(Boolean).join('\n'))}</td>
              <td class="c-dim">${multiline(l.dims)}</td>
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
          ${clauses(String(q.paymentTerms || '').split('\n').map((c) => [{ text: c }]))}
        </section>
        <table class="doc-ladder">
          <tbody>
            ${ladder.map(([label, value, strong]) => `
              <tr${strong ? ' class="a"' : ''}><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>

      <table class="doc-ship">
        <thead><tr><th class="c-sr">Sr. No.</th><th>Shipping</th><th class="c-amt">Sub Total B</th></tr></thead>
        <tbody>
          ${(ship.length ? ship : [{ label: '—', amount: 0 }]).map((sx, i) => `
            <tr>
              <td class="c-sr">${i + 1}</td>
              <td>${esc(sx.label || 'Shipping')}</td>
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
            Address: ${esc(s.company.address)}<br>
            Email: ${esc(s.company.email)}<br>
            Phone: ${esc(s.company.phone)}<br>
            Website: ${esc(s.company.website)}
          </p>
        </section>
      </div>

      <section class="doc-terms">
        <h2>Terms &amp; Conditions</h2>
        ${clauses(termRuns(q))}
        <p class="doc-aster">*Terms and conditions apply.</p>
      </section>
    </article>

    ${s.note ? `
      <article class="doc-page doc-page-note">
        <section class="doc-note">
          <h2>Note Please</h2>
          ${String(s.note).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
            .map((p) => `<p>${esc(p)}</p>`).join('')}
        </section>
      </article>` : ''}
  </div>`;
}

function panelRow(label, value) {
  return `<tr><th>${esc(label)}:</th><td>${esc(value || '')}</td></tr>`;
}

function multiline(text) {
  return String(text || '').split('\n').map(esc).join('<br>');
}

/* A clause per line, set as "- text" with anything that wraps hanging
   under the text — and the values this quotation filled in set bold,
   the way the printed document sets them. */
function clauses(runsPerClause) {
  return (runsPerClause || [])
    .filter((runs) => runs.some((r) => String(r.text || '').trim()))
    .map((runs) => {
      const body = runs.map((r, i) => {
        const text = i === 0 ? String(r.text).replace(/^[-–•]\s*/, '') : String(r.text);
        return r.bold ? `<b>${esc(text)}</b>` : esc(text);
      }).join('');
      return `<p class="doc-clause">- ${body}</p>`;
    }).join('');
}
