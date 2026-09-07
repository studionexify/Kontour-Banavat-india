/* views/quotedoc.js — the quotation as the client receives it.
 *
 * A faithful rendering of the printed document: the same header
 * pairs, the same columns, the same totals ladder with shipping
 * added after tax, and the same boilerplate underneath.
 *
 * This is the artefact the whole module exists to produce, so it is
 * built from the stored quote alone — if a figure is wrong here it
 * is wrong in the data, not in a second copy of the arithmetic.
 *
 * It is also where a saved quotation is looked at: read-only, the
 * way the client sees it, with one Edit button rather than every
 * field standing open. Tapping a card in the list lands here, not
 * in the builder — a card in a scrolling list is too easy to hit by
 * accident to drop someone into an edit form.
 *
 * Printing goes through the browser. `@media print` in the
 * stylesheet drops the app around it and leaves the page.
 */

import { icon } from '../icons.js';
import { openSheet, esc, on, toast, haptic } from '../ui.js';
import { shareQuotePdf, downloadQuotePdf } from '../quotepdf.js';
import {
  getQuote, quoteTotals, quoteName, lineAmount, lineGst, settings, renderTerms, jobValueFor,
} from '../quotes.js';
import { inr, dmy } from '../format.js';
import { markHTML, hasLogo } from '../brand.js';

export function openQuoteDoc(id, { onSaved, review = false, onApprove } = {}) {
  const q = getQuote(id);
  if (!q) return;

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
        <div class="qb-scroll doc-scroll">${docHTML(q)}</div>
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
        try { await downloadQuotePdf(q); toast('PDF saved'); }
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
      // instead of staying a 78px thumbnail.
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
  const ship = q.shipping || [];
  const lineItemGst = q.gstMode === 'lineitem' && t.taxed;
  const decided = q.status === 'accepted';

  return `
  <article class="doc" data-doc>
    <header class="doc-head">
      ${hasLogo() ? markHTML({ size: 34, className: 'doc-logo', alt: '' }) : ''}
      <span class="doc-brand">${esc(s.company.name)}</span>
      <h1 class="doc-title">QUOTATION</h1>
    </header>

    ${q.status === 'superseded' || q.status === 'declined'
      ? `<p class="doc-stamp">This quotation is ${q.status === 'superseded'
          ? 'superseded by a later revision' : 'no longer under offer'}.</p>` : ''}

    ${decided && (q.approvedTotal != null || q.jobExcludesGst) ? `
      <p class="doc-stamp ok">
        Approved${q.approvedTotal != null ? ` at ${inr(jobValueFor(q))} — quoted at ${inr(t.total)}` : ''}${q.jobExcludesGst ? '. The job in Phynance is booked excluding GST.' : '.'}
      </p>` : ''}

    <div class="doc-meta">
      <dl>
        ${metaRow('Client Name', q.client.name)}
        ${metaRow('Contact Number', q.client.phone || '-')}
        ${q.client.email ? metaRow('Email', q.client.email) : ''}
        ${metaRow('Shipping Address', q.client.shippingAddress || '-')}
      </dl>
      <dl>
        ${metaRow('Quoted Date', q.date ? dmy(q.date) : '-')}
        ${metaRow('MR #', q.mrNo)}
        ${metaRow('Valid till', q.validUntil ? dmy(q.validUntil) : '-')}
      </dl>
    </div>

    <div class="doc-tablewrap">
      <table class="doc-table">
        <thead>
          <tr>
            <th class="c-sr">Sr. No.</th>
            <th class="c-img">Image</th>
            <th class="c-name">Name</th>
            <th class="c-desc">Description</th>
            <th class="c-dim">Dimensions</th>
            <th class="c-num">Unit Price</th>
            <th class="c-num">Quantity</th>
            <th class="c-num">${lineItemGst ? 'Sub-Total' : 'Total'}</th>
            ${lineItemGst ? `<th class="c-num">GST (${q.gstRate}%)</th><th class="c-num">Total</th>` : ''}
          </tr>
        </thead>
        <tbody>
          ${lines.length ? lines.map((l, i) => {
            const amt = lineAmount(l);
            const gst = lineItemGst ? lineGst(l, q) : 0;
            return `
            <tr>
              <td class="c-sr">${i + 1}</td>
              <td class="c-img">${l.photo
                ? `<button class="doc-img-btn" data-zoom="${esc(l.photo)}" data-zoom-caption="${esc(l.name)}" aria-label="Enlarge photograph"><img src="${esc(l.photo)}" alt=""></button>`
                : `<span class="doc-img-ph">${icon('camera', 18)}</span>`}</td>
              <td class="c-name">${esc(l.name)}${l.finish ? `<span class="doc-fin">${esc(l.finish)}</span>` : ''}</td>
              <td class="c-desc">${multiline(l.description)}</td>
              <td class="c-dim">${multiline(l.dims)}</td>
              <td class="c-num num">${inr(l.unitPrice)}</td>
              <td class="c-num num">${l.kind === 'lump' ? 1 : l.qty}</td>
              <td class="c-num num">${inr(amt)}</td>
              ${lineItemGst ? `<td class="c-num num">${inr(gst)}</td><td class="c-num num">${inr(amt + gst)}</td>` : ''}
            </tr>
          `; }).join('') : `<tr><td colspan="${lineItemGst ? 10 : 8}" class="doc-empty">No items yet</td></tr>`}
        </tbody>
      </table>
    </div>

    <div class="doc-split">
      <section class="doc-terms-pay">
        <h2>Payment Terms</h2>
        ${bullets(q.paymentTerms)}
      </section>

      <section class="doc-sums">
        <div class="doc-sum"><span>${t.discount ? 'Total' : 'Sub - Total'}</span><b class="num">${inr(t.sub)}</b></div>
        ${t.discount ? `
          <div class="doc-sum"><span>Discount</span><b class="num">-${inr(t.discount)}</b></div>
          <div class="doc-sum"><span>Sub-Total</span><b class="num">${inr(t.afterDiscount)}</b></div>` : ''}
        ${t.taxed ? `<div class="doc-sum"><span>GST (${q.gstRate}%)${lineItemGst ? ' — as above' : ''}</span><b class="num">${inr(t.gst)}</b></div>` : ''}
        <div class="doc-sum a"><span>Sub Total A</span><b class="num">${inr(t.subA)}</b></div>
      </section>
    </div>

    <div class="doc-tablewrap">
      <table class="doc-table doc-ship">
        <thead>
          <tr><th class="c-sr">Sr. No.</th><th>Shipping</th><th class="c-num">Sub Total B</th></tr>
        </thead>
        <tbody>
          ${ship.length ? ship.map((sx, i) => `
            <tr>
              <td class="c-sr">${i + 1}</td>
              <td>${esc(sx.label)}</td>
              <td class="c-num num">${inr(sx.amount)}</td>
            </tr>`).join('') : `<tr><td colspan="3" class="doc-empty">—</td></tr>`}
        </tbody>
      </table>
    </div>

    <table class="doc-table doc-grand">
      <thead><tr><th>Sub Total A</th><th>Sub Total B</th><th>Total</th></tr></thead>
      <tbody><tr>
        <td class="num">${inr(t.subA)}</td>
        <td class="num">${inr(t.subB)}</td>
        <td class="num doc-total">${inr(t.total)}</td>
      </tr></tbody>
    </table>

    <div class="doc-split">
      <section class="doc-block">
        <h2>Banking Details</h2>
        <p>
          Bank: ${esc(s.bank.bank)}<br>
          A/C Name: ${esc(s.bank.name)}<br>
          A/C Number: ${esc(s.bank.account)}<br>
          IFSC: ${esc(s.bank.ifsc)}<br>
          Branch: ${esc(s.bank.branch)}
        </p>
      </section>
      <section class="doc-block">
        <h2>Contact Details</h2>
        <p>
          ${esc(s.company.name)}${s.company.gstin ? `<br>GSTIN: ${esc(s.company.gstin)}` : ''}<br>
          Address: ${esc(s.company.address)}<br>
          Email: ${esc(s.company.email)}<br>
          Phone: ${esc(s.company.phone)}<br>
          Website: ${esc(s.company.website)}
        </p>
      </section>
    </div>

    <section class="doc-block">
      <h2>Terms &amp; Conditions</h2>
      ${bullets(renderTerms(q))}
      <p class="doc-aster">*Terms and conditions apply.</p>
    </section>

    <section class="doc-block">
      <h2>Note Please</h2>
      ${String(s.note || '').split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}
    </section>
  </article>`;
}

function metaRow(label, value) {
  return `<div><dt>${esc(label)}:</dt><dd>${esc(value || '')}</dd></div>`;
}

function multiline(text) {
  return String(text || '').split('\n').map(esc).join('<br>');
}

function bullets(text) {
  const items = String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
  if (!items.length) return '';
  return `<ul>${items.map((x) => `<li>${esc(x.replace(/^[-–•]\s*/, ''))}</li>`).join('')}</ul>`;
}
