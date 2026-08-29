/* views/quotebuilder.js — writing the quotation.
 *
 * Laid out in the order the printed document is read: who it is
 * for, what is being supplied, how it is paid for, what it ships
 * as, what it comes to. The totals ladder is pinned at the foot in
 * the same shape it prints — Sub Total A, Sub Total B, Total —
 * so the figure being negotiated is never a scroll away and never
 * a different sum from the one the client will see.
 *
 * Every edit writes straight through to the store. A quotation is
 * revised over days, often on a phone in someone's showroom, and
 * losing an afternoon's pricing to a closed tab is not a risk worth
 * taking for the sake of a Save button.
 */

import { icon } from '../icons.js';
import { openSheet, on, esc, toast, field, emptyState } from '../ui.js';
import {
  getQuote, addQuote, updateQuote, newLine, newShipping, lineAmount, quoteTotals,
  LINE_KINDS, designs, getDesign, lineFromDesign, linePhoto, settings, mrNoTaken,
  defaultValidUntil,
} from '../quotes.js';
import { pickImage, toDataUrl, imageSrc } from '../photos.js';
import { inr, todayISO } from '../format.js';
import { openQuoteDoc } from './quotedoc.js';

export function openQuoteSheet({ id = '', onSaved } = {}) {
  let quote = id ? getQuote(id) : null;

  if (!quote) {
    const today = todayISO();
    quote = addQuote({ date: today, validUntil: defaultValidUntil(today) });
  }

  return openSheet({
    title: `MR # ${quote.mrNo}`,
    full: true,
    wide: true,
    headRight: `<button class="icon-btn plain" data-preview aria-label="Preview document">${icon('reports', 20)}</button>`,
    body: `<div class="qb" data-qb></div>`,
    onMount(root, handle) {
      const host = root.querySelector('[data-qb]');

      /* Regions, painted once. Only the part that actually changed is
         redrawn afterwards — rebuilding the whole form on every
         keystroke destroyed the element the next tap was aimed at,
         so a "From library" tap right after typing went nowhere. */
      host.innerHTML = `
        <div class="qb-scroll">
          <div data-client></div>
          <div data-lines></div>
          <div data-ship></div>
          <div data-terms></div>
        </div>
        <div data-foot></div>
      `;
      const region = (n) => host.querySelector(`[data-${n}]`);

      // Declared before the first paint: the breakdown panel's state
      // outlives the repaint that every edit triggers.
      let footOpen = false;

      region('client').innerHTML = clientBlock(quote);
      region('terms').innerHTML = termsBlock(quote);
      renderLines(); renderShip(); renderFoot();
      bindOnce();

      function renderLines() { region('lines').innerHTML = linesBlock(quote); }
      function renderShip() { region('ship').innerHTML = shipBlock(quote); }
      function renderFoot() {
        region('foot').innerHTML = footBlock(quoteTotals(quote), quote, footOpen);
      }

      function setLines(lines) {
        quote = updateQuote(quote.id, { lines });
        renderLines(); renderFoot();
      }
      function setShip(shipping) {
        quote = updateQuote(quote.id, { shipping });
        renderShip(); renderFoot();
      }

      /* Delegated once on the host, so a repaint of any region never
         stacks a second copy of these handlers. */
      function bindOnce() {
        host.addEventListener('change', (e) => {
          const inp = e.target;
          const d = inp.dataset || {};

          if (d.f === 'mrNo') {
            const want = String(inp.value).trim().toUpperCase();
            if (!want) { inp.value = quote.mrNo; return; }
            if (mrNoTaken(want, quote.id)) {
              toast(`${want} is already used`, 'err');
              inp.value = quote.mrNo;
              return;
            }
            quote = updateQuote(quote.id, { mrNo: want });
            inp.value = want;
            renderTitle();
            return;
          }

          if (d.f != null) {
            const val = inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
            if (d.f.startsWith('client.')) {
              // The block is not redrawn — the field already holds what
              // was typed, and redrawing would move the caret out from
              // under the person typing.
              quote = updateQuote(quote.id, { client: { ...quote.client, [d.f.slice(7)]: val } });
            } else {
              quote = updateQuote(quote.id, { [d.f]: val });
            }
            renderFoot();
            return;
          }

          if (d.l) {
            const lines = quote.lines.map((l) => l.id !== d.l ? l : {
              ...l, [d.k]: inp.type === 'number' ? Number(inp.value) || 0 : inp.value,
            });
            quote = updateQuote(quote.id, { lines });
            const row = inp.closest('.qline');
            const amt = row && row.querySelector('.qline-amt');
            const line = quote.lines.find((l) => l.id === d.l);
            if (amt && line) amt.textContent = inr(lineAmount(line));
            renderFoot();
            return;
          }

          if (d.s) {
            const shipping = quote.shipping.map((x) => x.id !== d.s ? x : {
              ...x, [d.k]: inp.type === 'number' ? Number(inp.value) || 0 : inp.value,
            });
            quote = updateQuote(quote.id, { shipping });
            renderFoot();
          }
        });

        on(host, '[data-kind]', (e, b) =>
          setLines(quote.lines.map((l) => l.id === b.dataset.l ? { ...l, kind: b.dataset.kind } : l)));
        on(host, '[data-rm]', (e, b) => setLines(quote.lines.filter((l) => l.id !== b.dataset.rm)));
        on(host, '[data-add-blank]', () => setLines([...quote.lines, newLine()]));
        on(host, '[data-pick]', () => pickDesign((line) => setLines([...quote.lines, line])));

        on(host, '[data-add-ship]', () => setShip([...quote.shipping, newShipping()]));
        on(host, '[data-rm-ship]', (e, b) =>
          setShip(quote.shipping.filter((x) => x.id !== b.dataset.rmShip)));

        // Off means the document drops the row entirely rather than
        // printing a zero, so it is a flag, not a rate of 0.
        on(host, '[data-gst]', (e, b) => {
          quote = updateQuote(quote.id, { gstApplicable: b.dataset.gst === 'on' });
          renderFoot();
        });

        /* A line can carry its own photograph even when it did not come
           from the library — a one-off still prints in the Image column. */
        on(host, '[data-line-img]', async (e, b) => {
          const files = await pickImage({ camera: false });
          if (!files || !files[0]) return;
          const photo = await toDataUrl(files[0]);
          setLines(quote.lines.map((l) => l.id === b.dataset.lineImg ? { ...l, photo } : l));
        });

        on(host, '[data-line-img-rm]', (e, b) =>
          setLines(quote.lines.map((l) => l.id === b.dataset.lineImgRm ? { ...l, photo: '' } : l)));

        on(host, '[data-brk]', () => { footOpen = !footOpen; renderFoot(); });

        on(host, '[data-done]', () => { handle.close(); if (onSaved) onSaved(); });
      }

      /* The MR number is editable, so the sheet's own title follows it. */
      function renderTitle() {
        const h2 = root.querySelector('.sheet-head h2');
        if (h2) h2.textContent = `MR # ${quote.mrNo}`;
      }

      on(root, '[data-preview]', () => openQuoteDoc(quote.id));
    },
    onClose() { if (onSaved) onSaved(); },
  });
}

/* ── Blocks ────────────────────────────────────────────────────── */

function clientBlock(q) {
  return `
    <section class="qb-sec">
      <h3 class="qb-h">Client</h3>
      <div class="qb-grid">
        ${field('Client name', `<input class="control" data-f="client.name" value="${esc(q.client.name)}" placeholder="Rahi Construction">`)}
        ${field('Contact number', `<input class="control" data-f="client.phone" value="${esc(q.client.phone)}" inputmode="tel">`)}
        ${field('Email', `<input class="control" type="email" data-f="client.email" value="${esc(q.client.email || '')}" placeholder="Optional">`)}
        ${field('Delivery city', `<input class="control" data-f="client.shippingAddress" value="${esc(q.client.shippingAddress)}" placeholder="Vadodara">`,
          'City only — that is what the quotation prints.')}
      </div>

      <div class="qb-grid">
        ${field('Quotation number',
          `<input class="control" data-f="mrNo" value="${esc(q.mrNo)}" autocapitalize="characters">`,
          'Offered as the previous number plus one. Type over it if you need to.')}
        ${field('Quoted date', `<input class="control" type="date" data-f="date" value="${esc(q.date)}">`)}
        ${field('Valid till', `<input class="control" type="date" data-f="validUntil" value="${esc(q.validUntil)}">`,
          'Two months from the quoted date by default.')}
      </div>
      ${field('Job name',
        `<input class="control" data-f="title" value="${esc(q.title)}" placeholder="Table and grill">`,
        'For your own filing. It does not print on the quotation.')}
    </section>
  `;
}

function linesBlock(q) {
  return `
    <section class="qb-sec">
      <div class="qb-sec-head">
        <h3 class="qb-h">Items</h3>
        <div class="qb-sec-acts">
          <button class="mini" data-pick>${icon('box', 14)} From library</button>
          <button class="mini" data-add-blank>${icon('plus', 14)} Blank line</button>
        </div>
      </div>
      ${q.lines.length ? q.lines.map(lineRow).join('')
        : `<div class="qb-none">${icon('box', 22)}
             <p>No items yet</p>
             <small>Pick a design from the library, or add a blank line for a one-off.</small>
           </div>`}
    </section>
  `;
}

function lineRow(l, i) {
  const design = l.designCode ? getDesign(l.designCode) : null;
  // What the document will print here — the line's own picture, or
  // the library's for the design it came from.
  const shown = linePhoto(l);
  return `
    <article class="qline">
      <div class="qline-head">
        <span class="qline-n">${i + 1}</span>
        <span class="qline-imgwrap">
          <button class="qline-img ${shown ? 'has' : ''}" data-line-img="${esc(l.id)}"
                  aria-label="${l.photo ? 'Replace image' : 'Add image'}">
            ${shown ? `<img src="${esc(imageSrc(shown))}" alt="">` : icon('camera', 16)}
          </button>
          ${l.photo ? `<button class="qline-img-x" data-line-img-rm="${esc(l.id)}" aria-label="Remove image">×</button>` : ''}
        </span>
        <input class="control flush qline-title" data-l="${esc(l.id)}" data-k="name"
               value="${esc(l.name)}" placeholder="Name">
        <button class="mini danger" data-rm="${esc(l.id)}" aria-label="Remove line">${icon('trash', 14)}</button>
      </div>

      <div class="qline-kind">
        ${Object.entries(LINE_KINDS).map(([k, v]) => `
          <button class="seg-mini ${l.kind === k ? 'on' : ''}" data-kind="${k}" data-l="${esc(l.id)}">${esc(v.label)}</button>
        `).join('')}
        ${l.designCode ? `<span class="qline-code">${esc(l.designCode)}</span>` : ''}
      </div>

      <textarea class="control qline-spec" data-l="${esc(l.id)}" data-k="description" rows="2"
                placeholder="Description — material, finish, construction">${esc(l.description)}</textarea>

      <textarea class="control qline-spec" data-l="${esc(l.id)}" data-k="dims" rows="1"
                placeholder="Dimensions — 38 x 1 x 58&quot;, Dia 8 inch, as per drawing">${esc(l.dims)}</textarea>

      ${design && design.finishes.length ? `
        <div class="qline-dims">
          <label class="grow">Finish
            <select class="control mini-in" data-l="${esc(l.id)}" data-k="finish">
              ${design.finishes.map((f) => `
                <option value="${esc(f.name)}" ${f.name === l.finish ? 'selected' : ''}>${esc(f.name)}</option>
              `).join('')}
            </select>
          </label>
        </div>` : ''}

      <div class="qline-money">
        <label>Unit price
          <input class="control mini-in" type="number" min="0" data-l="${esc(l.id)}" data-k="unitPrice" value="${l.unitPrice}">
        </label>
        ${l.kind === 'unit' ? `
          <label>Qty
            <input class="control mini-in" type="number" min="0" data-l="${esc(l.id)}" data-k="qty" value="${l.qty}">
          </label>` : `<span class="qline-lump">one lot</span>`}
        <span class="qline-amt num">${inr(lineAmount(l))}</span>
      </div>
    </article>
  `;
}

/* Shipping is its own short table on the document, added after tax
   rather than inside it, so it gets its own block here too. */
function shipBlock(q) {
  return `
    <section class="qb-sec">
      <div class="qb-sec-head">
        <h3 class="qb-h">Shipping</h3>
        <button class="mini" data-add-ship>${icon('plus', 14)} Add row</button>
      </div>
      ${(q.shipping || []).map((s) => `
        <div class="fin-row">
          <input class="control" data-s="${esc(s.id)}" data-k="label"
                 value="${esc(s.label)}" placeholder="Delivery City - Vadodara">
          <input class="control mini-in" type="number" min="0" data-s="${esc(s.id)}" data-k="amount" value="${s.amount}">
          <button class="mini danger" data-rm-ship="${esc(s.id)}" aria-label="Remove row">${icon('trash', 14)}</button>
        </div>
      `).join('')}
      <p class="qb-hint">Charged at actuals, and added after GST — the document totals it as Sub Total B.</p>
    </section>
  `;
}

function termsBlock(q) {
  return `
    <section class="qb-sec">
      <h3 class="qb-h">Payment terms</h3>
      ${field('Printed on this quotation',
        `<textarea class="control" data-f="paymentTerms" rows="3">${esc(q.paymentTerms)}</textarea>`,
        'One per line. Usually 50% advance; 70% on larger orders.')}
      <h3 class="qb-h">Standing terms, this quotation</h3>
      <div class="qb-grid">
        ${field('Lead time',
          `<input class="control" data-f="leadTime" value="${esc(q.leadTime || '')}" placeholder="25–30 business days">`,
          'Prints as "Lead time for delivery is …".')}
        ${field('Fabric included up to',
          `<input class="control" type="number" min="0" data-f="fabricRate" value="${q.fabricRate || 0}">`,
          'Per meter. Prints inside the fabric clause.')}
      </div>

      ${field('Private note',
        `<textarea class="control" data-f="notes" rows="2" placeholder="Not printed">${esc(q.notes)}</textarea>`)}
      <p class="qb-hint">
        The rest of the terms, banking and contact details print on every
        quotation and are set once, in Settings.
      </p>
    </section>
  `;
}

/* The foot mirrors the document's own ladder, so the number here is
   the number the client sees, arrived at the same way. */
/* The foot carries one figure and one action, because that is what
   it is for: the total the client will see, and the way out. The
   ladder behind it — sub-total, tax, shipping — is a summary line you
   can open when you want to check the arithmetic, and it stays shut
   the rest of the time so the items keep the screen.

   `open` is passed in rather than read from the DOM so the panel
   survives the repaint that every edit triggers. */
function footBlock(t, q, open = false) {
  const parts = [
    `Sub ${inr(t.sub)}`,
    t.taxed ? `GST ${q.gstRate}% ${inr(t.gst)}` : 'no GST',
    t.subB ? `Shipping ${inr(t.subB)}` : null,
  ].filter(Boolean);

  return `
    <footer class="qb-foot">
      ${open ? `
        <div class="qb-sums">
          <div class="qb-sum"><span>Sub - Total</span><b class="num">${inr(t.sub)}</b></div>
          <div class="qb-sum">
            <span>
              GST
              <button class="seg-mini gst-t ${t.taxed ? 'on' : ''}" data-gst="${t.taxed ? 'off' : 'on'}">
                ${t.taxed ? 'Applicable' : 'Not applicable'}
              </button>
            </span>
            <span class="qb-gst">
              ${t.taxed ? `<input class="control mini-in" type="number" min="0" max="28" data-f="gstRate" value="${q.gstRate}">%` : ''}
              <b class="num">${t.taxed ? inr(t.gst) : '—'}</b>
            </span>
          </div>
          <div class="qb-sum"><span>Sub Total A</span><b class="num">${inr(t.subA)}</b></div>
          <div class="qb-sum"><span>Sub Total B — shipping</span><b class="num">${inr(t.subB)}</b></div>
        </div>` : ''}

      <div class="qb-bar">
        <button class="qb-brk" data-brk aria-expanded="${open ? 'true' : 'false'}">
          ${icon('chevD', 14)}<span>${esc(parts.join(' · '))}</span>
        </button>
        <div class="qb-tot">
          <span>Total</span>
          <b class="num">${inr(t.total)}</b>
        </div>
        <button class="btn sm" data-done>Done</button>
      </div>
    </footer>
  `;
}

/* ── Picking from the library ────────────────────────────────── */

function pickDesign(onPick) {
  let q = '';
  let cat = 'All';

  const h = openSheet({
    title: 'Add from library',
    full: true,
    wide: true,
    body: `<div class="qb-scroll" data-pickroot></div>`,
    onMount(root) {
      const host = root.querySelector('[data-pickroot]');
      paint();

      function paint() {
        const list = designs({ category: cat, q });
        const cats = ['All', ...new Set(designs().map((d) => d.category))];
        host.innerHTML = `
          <div class="qb-sec">
            <input class="control" data-q value="${esc(q)}" placeholder="Search the library" type="search">
            <div class="chipbar">
              ${cats.map((c) => `<button class="chip ${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
            </div>
            ${list.length ? `<div class="dgrid">${list.map(pickCard).join('')}</div>`
              : emptyState('box', 'Nothing in the library yet', 'Add designs from the Library screen.')}
          </div>
        `;
        const input = host.querySelector('[data-q]');
        input.addEventListener('input', () => {
          q = input.value;
          clearTimeout(input._t);
          input._t = setTimeout(paint, 200);
        });
        on(host, '[data-cat]', (e, b) => { cat = b.dataset.cat; paint(); });
        on(host, '[data-take]', (e, b) => {
          const d = getDesign(b.dataset.take);
          if (!d) return;
          onPick(lineFromDesign(d));
          toast(`${d.code} added`);
          h.close();
        });
      }
    },
  });
}

function pickCard(d) {
  return `
    <button class="dcard" data-take="${esc(d.code)}">
      ${d.photo ? `<img class="dcard-img" src="${esc(imageSrc(d.photo))}" alt="">`
                : `<span class="dcard-img ph">${icon('box', 26)}</span>`}
      <div class="dcard-body">
        <div class="dcard-code">${esc(d.code)}</div>
        <div class="dcard-name">${esc(d.name)}</div>
        <div class="dcard-foot">
          <span class="dcard-rate num">${inr(d.unitPrice)}</span>
          <span class="pill mut">${esc(d.category)}</span>
        </div>
      </div>
    </button>
  `;
}
