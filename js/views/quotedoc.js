/* views/quotedoc.js — the quotation as the client receives it.
 *
 * A faithful rendering of the printed document: the same header
 * pairs, the same eight columns, the same totals ladder with
 * shipping added after tax, and the same boilerplate underneath.
 *
 * This is the artefact the whole module exists to produce, so it is
 * built from the stored quote alone — if a figure is wrong here it
 * is wrong in the data, not in a second copy of the arithmetic.
 *
 * Printing goes through the browser. `@media print` in the
 * stylesheet drops the app around it and leaves the page.
 */

import { icon } from '../icons.js';
import { openSheet, esc, on, toast } from '../ui.js';
import { getQuote, quoteTotals, lineAmount, linePhoto, settings, renderTerms } from '../quotes.js';
import { inr, dmy, imageSrc } from '../format.js';
import { markHTML, hasLogo } from '../brand.js';

export function openQuoteDoc(id) {
  const q = getQuote(id);
  if (!q) return;

  openSheet({
    title: `MR # ${q.mrNo}`,
    full: true,
    wide: true,
    headRight: `<button class="icon-btn plain" data-print aria-label="Print">${icon('download', 20)}</button>`,
    body: `<div class="qb"><div class="qb-scroll doc-scroll">${docHTML(q)}</div></div>`,
    onMount(root) {
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
}

export function docHTML(q) {
  const s = settings();
  const t = quoteTotals(q);
  const lines = q.lines || [];
  const ship = q.shipping || [];

  return `
  <article class="doc" data-doc>
    <header class="doc-head">
      ${hasLogo() ? markHTML({ size: 58, className: 'doc-logo', alt: s.company.name })
                  : `<div class="doc-logo ph">${esc(s.company.name)}</div>`}
      <div class="doc-head-t">
        <h1 class="doc-title">QUOTATION</h1>
        <p class="doc-head-sub">${esc(s.company.name)}</p>
      </div>
    </header>

    ${q.status === 'superseded' || q.status === 'declined'
      ? `<p class="doc-stamp">This quotation is ${q.status === 'superseded'
          ? 'superseded by a later revision' : 'no longer under offer'}.</p>` : ''}

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
            <th class="c-num">Total</th>
          </tr>
        </thead>
        <tbody>
          ${lines.length ? lines.map((l, i) => `
            <tr>
              <td class="c-sr">${i + 1}</td>
              <td class="c-img">${linePhoto(l) ? `<img src="${esc(imageSrc(linePhoto(l)))}" alt="">` : ''}</td>
              <td class="c-name">${esc(l.name)}${l.finish ? `<span class="doc-fin">${esc(l.finish)}</span>` : ''}</td>
              <td class="c-desc">${multiline(l.description)}</td>
              <td class="c-dim">${multiline(l.dims)}</td>
              <td class="c-num num">${inr(l.unitPrice)}</td>
              <td class="c-num num">${l.kind === 'lump' ? 1 : l.qty}</td>
              <td class="c-num num">${inr(lineAmount(l))}</td>
            </tr>
          `).join('') : `<tr><td colspan="8" class="doc-empty">No items yet</td></tr>`}
        </tbody>
      </table>
    </div>

    <div class="doc-split">
      <section class="doc-terms-pay">
        <h2>Payment Terms</h2>
        ${bullets(q.paymentTerms)}
      </section>

      <section class="doc-sums">
        <div class="doc-sum"><span>Sub - Total</span><b class="num">${inr(t.sub)}</b></div>
        ${t.taxed ? `<div class="doc-sum"><span>GST (${q.gstRate}%)</span><b class="num">${inr(t.gst)}</b></div>` : ''}
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
