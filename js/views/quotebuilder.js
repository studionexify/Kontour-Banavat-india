/* views/quotebuilder.js — writing the quotation.
 *
 * A quotation is written on a phone, in someone's showroom, with one
 * thumb. So the screen carries only what is being decided right now:
 * who it is for, and what is on it. Everything that has a sensible
 * default already — the number, the dates, shipping, the terms that
 * print on every quotation — is folded away until it is wanted.
 *
 * Fields cluster rather than stack. A label above every input turned
 * eight facts into two screens of scrolling; grouped into one card
 * with inline labels, the same eight fit above the fold.
 *
 * Every edit writes straight through to the store. A quotation is
 * revised over days, and losing an afternoon's pricing to a closed
 * tab is not a risk worth taking for the sake of a Save button.
 */

import { icon } from '../icons.js';
import { openSheet, on, esc, toast, emptyState } from '../ui.js';
import {
  getQuote, addQuote, updateQuote, newLine, newShipping, lineAmount, quoteTotals,
  LINE_KINDS, GST_MODES, designs, getDesign, lineFromDesign, mrNoTaken, defaultValidUntil,
  quoteName, clientBook, findClient, leadTimeRangeText,
} from '../quotes.js';
import { pickImage, shrink, toBase64 } from '../photos.js';
import { inr, num, parseNum, todayISO } from '../format.js';
import { openQuoteDoc } from './quotedoc.js';

export function openQuoteSheet({ id = '', onSaved } = {}) {
  let quote = id ? getQuote(id) : null;

  if (!quote) {
    const today = todayISO();
    quote = addQuote({ date: today, validUntil: defaultValidUntil(today) });
  }

  return openSheet({
    title: quoteName(quote),
    full: true,
    wide: true,
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
          <div data-extras></div>
        </div>
        <div data-foot></div>
      `;
      const region = (n) => host.querySelector(`[data-${n}]`);

      // Declared before the first paint: disclosure state outlives the
      // repaint that every edit triggers.
      let footOpen = false;
      const openLines = new Set();
      const openPanels = new Set();

      region('client').innerHTML = clientBlock(quote);
      renderLines(); renderExtras(); renderFoot();
      bindOnce();

      function renderLines() { region('lines').innerHTML = linesBlock(quote, openLines); }
      function renderExtras() { region('extras').innerHTML = extrasBlock(quote, openPanels); }
      function renderFoot() {
        region('foot').innerHTML = footBlock(quoteTotals(quote), quote, footOpen);
      }

      function setLines(lines) {
        quote = updateQuote(quote.id, { lines });
        renderLines(); renderFoot();
      }
      function setShip(shipping) {
        quote = updateQuote(quote.id, { shipping });
        renderExtras(); renderFoot();
      }

      /* Delegated once on the host, so a repaint of any region never
         stacks a second copy of these handlers. */
      /* A money field (data-money) reads back as digits, whatever
         commas or the ₹ mark next to it are doing to the display —
         everything else keeps the old number-vs-text split. */
      function readVal(inp) {
        if (inp.dataset.money !== undefined) return parseNum(inp.value);
        return inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
      }

      function bindOnce() {
        /* A money field shows "₹16,300" at rest. Tapping in clears a
           genuine zero outright (a fresh line's rate must not turn a
           first keystroke into "01,300"), or strips the field to bare
           digits and selects them so typing over an existing figure
           is a single keystroke, not a delete-then-type. Both are
           undone on blur once the value has committed, by the
           `change` handler below writing the formatted string back. */
        host.addEventListener('focus', (e) => {
          const inp = e.target;
          if (inp.dataset.money === undefined) return;
          const n = parseNum(inp.value);
          inp.value = n ? String(n) : '';
          if (n) inp.select();
        }, true);

        // `toggle` does not bubble, so the disclosure state is caught
        // on the way down instead — a repaint would otherwise snap
        // every open line shut.
        host.addEventListener('toggle', (e) => {
          const d = e.target;
          if (!d.dataset) return;
          if (d.dataset.lineMore) {
            if (d.open) openLines.add(d.dataset.lineMore); else openLines.delete(d.dataset.lineMore);
          }
          if (d.dataset.panel) {
            if (d.open) openPanels.add(d.dataset.panel); else openPanels.delete(d.dataset.panel);
          }
        }, true);

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
            const val = readVal(inp);
            if (inp.dataset.money !== undefined) inp.value = val ? num(val) : '';
            if (d.f.startsWith('client.')) {
              // The block is not redrawn — the field already holds what
              // was typed, and redrawing would move the caret out from
              // under the person typing.
              quote = updateQuote(quote.id, { client: { ...quote.client, [d.f.slice(7)]: val } });
              if (d.f === 'client.name') renderTitle();
            } else {
              quote = updateQuote(quote.id, { [d.f]: val });
              // Patched in place rather than a full renderExtras() —
              // the panel is open and mid-edit, and a repaint would
              // only be worth it for a badge nobody is looking at yet.
              if (d.f === 'discountAmount') {
                const badge = host.querySelector('[data-panel="discount"] .qdisc-v');
                if (badge) badge.textContent = quote.discountEnabled && quote.discountAmount ? inr(quote.discountAmount) : 'None';
              }
            }
            renderFoot();
            return;
          }

          if (d.l) {
            const val = readVal(inp);
            if (inp.dataset.money !== undefined) inp.value = val ? num(val) : '';
            const lines = quote.lines.map((l) => l.id !== d.l ? l : { ...l, [d.k]: val });
            quote = updateQuote(quote.id, { lines });
            const row = inp.closest('.qline');
            const amt = row && row.querySelector('.qline-amt');
            const line = quote.lines.find((l) => l.id === d.l);
            if (amt && line) amt.textContent = inr(lineAmount(line));
            renderFoot();
            return;
          }

          if (d.s) {
            const val = readVal(inp);
            if (inp.dataset.money !== undefined) inp.value = val ? num(val) : '';
            const shipping = quote.shipping.map((x) => x.id !== d.s ? x : { ...x, [d.k]: val });
            quote = updateQuote(quote.id, { shipping });
            renderFoot();
          }
        });

        /* Typing (or picking from the datalist) a name already on file
           loads that client's profile — phone and city are what was
           saved for them last time, not whatever a new quote's blank
           form happened to default to. Only these two fields are
           touched, so the name field keeps its caret rather than
           being wiped by a full repaint. */
        host.addEventListener('input', (e) => {
          const inp = e.target;
          if (inp.dataset.f !== 'client.name') return;
          const found = findClient(inp.value);
          if (!found) return;
          const phoneField = host.querySelector('[data-f="client.phone"]');
          const cityField = host.querySelector('[data-f="client.shippingAddress"]');
          const changes = {};
          if (phoneField && found.phone) { phoneField.value = found.phone; changes.phone = found.phone; }
          if (cityField && found.shippingAddress) { cityField.value = found.shippingAddress; changes.shippingAddress = found.shippingAddress; }
          if (Object.keys(changes).length) {
            quote = updateQuote(quote.id, { client: { ...quote.client, ...changes } });
          }
        });

        on(host, '[data-kind]', (e, b) =>
          setLines(quote.lines.map((l) => l.id === b.dataset.l ? { ...l, kind: b.dataset.kind } : l)));
        on(host, '[data-rm]', (e, b) => setLines(quote.lines.filter((l) => l.id !== b.dataset.rm)));
        on(host, '[data-add-blank]', () => {
          const line = newLine();
          openLines.add(line.id);         // a blank line opens ready to fill
          setLines([...quote.lines, line]);
        });
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

        on(host, '[data-gstmode]', (e, b) => {
          quote = updateQuote(quote.id, { gstMode: b.dataset.gstmode });
          renderExtras();
        });

        on(host, '[data-discount]', (e, b) => {
          quote = updateQuote(quote.id, { discountEnabled: b.dataset.discount === 'on' });
          renderExtras(); renderFoot();
        });

        host.addEventListener('input', (e) => {
          const inp = e.target;
          if (!inp.dataset || inp.dataset.leaddays === undefined) return;
          const leadTime = leadTimeRangeText(inp.value);
          quote = updateQuote(quote.id, { leadTimeDays: Number(inp.value) || 0, leadTime });
          const hint = host.querySelector('[data-leadhint] b');
          if (hint) hint.textContent = leadTime || '—';
        });

        /* A line can carry its own photograph even when it did not come
           from the library — a one-off still prints in the Image column. */
        on(host, '[data-line-img]', async (e, b) => {
          const files = await pickImage({ camera: false });
          if (!files || !files[0]) return;
          const { blob } = await shrink(files[0]);
          const photo = `data:image/jpeg;base64,${await toBase64(blob)}`;
          setLines(quote.lines.map((l) => l.id === b.dataset.lineImg ? { ...l, photo } : l));
        });

        on(host, '[data-line-img-rm]', (e, b) =>
          setLines(quote.lines.map((l) => l.id === b.dataset.lineImgRm ? { ...l, photo: '' } : l)));

        on(host, '[data-brk]', () => { footOpen = !footOpen; renderFoot(); });

        on(host, '[data-preview-btn]', () => {
          openQuoteDoc(quote.id, {
            review: true,
            onApprove: () => { handle.close(); if (onSaved) onSaved(); },
          });
        });
      }

      /* The number and the client are both editable, and both are in
         the title, so either one changing has to repaint it. */
      function renderTitle() {
        const h2 = root.querySelector('.sheet-head h2');
        if (h2) h2.textContent = quoteName(quote);
      }

    },
    onClose() { if (onSaved) onSaved(); },
  });
}

/* ── Blocks ────────────────────────────────────────────────────── */

/** A label and its control on one line, inside a clustered card. */
function pair(label, controlHtml) {
  return `<div class="qpair"><span class="qpair-l">${esc(label)}</span>${controlHtml}</div>`;
}

/* A rupee-styled number field: shows formatted with commas and a ₹
   mark when not focused, empty rather than a stuck "0" when there is
   nothing in it yet, and the plain digits while being typed into —
   see the focus/blur handling in bindOnce(). `attrs` is the raw
   data-* string that says which field this is (data-l/data-k or
   data-f), the same convention every other field here already uses. */
function moneyField(attrs, value, extraClass = '') {
  return `
    <span class="money-in ${extraClass}">
      <span class="cur">₹</span>
      <input class="control mini-in" type="text" inputmode="decimal" data-money ${attrs}
             value="${value ? esc(num(value)) : ''}" placeholder="0">
    </span>`;
}

/* Client, number and dates as one card of paired rows. The name is
   the only thing that has to be typed, so it leads at full size; the
   rest carry defaults and sit underneath at label-and-value size. */
function clientBlock(q) {
  return `
    <section class="qb-sec">
      <input class="control lead" data-f="client.name" list="qb-client-list" autocomplete="off"
             value="${esc(q.client.name)}" placeholder="Client name" autocapitalize="words">
      <datalist id="qb-client-list">
        ${clientBook().map((c) => `<option value="${esc(c.name)}">`).join('')}
      </datalist>

      <div class="qcluster">
        ${pair('Phone', `<input class="control flush" data-f="client.phone" value="${esc(q.client.phone)}" inputmode="tel" placeholder="—">`)}
        ${pair('City', `<input class="control flush" data-f="client.shippingAddress" value="${esc(q.client.shippingAddress)}" placeholder="Vadodara">`)}
        ${pair('Number', `<input class="control flush" data-f="mrNo" value="${esc(q.mrNo)}" autocapitalize="characters">`)}
        ${pair('Quoted', `<input class="control flush" type="date" data-f="date" value="${esc(q.date)}">`)}
        ${pair('Valid till', `<input class="control flush" type="date" data-f="validUntil" value="${esc(q.validUntil)}">`)}
      </div>

      <details class="qdisc" data-panel="client-more">
        <summary>${icon('chevR', 15)} Email and job name</summary>
        <div class="qcluster">
          ${pair('Email', `<input class="control flush" type="email" data-f="client.email" value="${esc(q.client.email || '')}" placeholder="—">`)}
          ${pair('Job name', `<input class="control flush" data-f="title" value="${esc(q.title)}" placeholder="Table and grill">`)}
        </div>
      </details>
    </section>
  `;
}

function linesBlock(q, openLines) {
  return `
    <section class="qb-sec">
      <div class="qb-sec-head">
        <h3 class="qb-h">Items <span class="qb-count">${q.lines.length}</span></h3>
        <div class="qb-sec-acts">
          <button class="mini" data-pick>${icon('box', 14)} Library</button>
          <button class="mini" data-add-blank>${icon('plus', 14)} Blank</button>
        </div>
      </div>
      ${q.lines.length ? q.lines.map((l, i) => lineRow(l, i, openLines.has(l.id))).join('')
        : `<div class="qb-none">${icon('box', 22)}<p>No items yet</p></div>`}
    </section>
  `;
}

/* A line shows the three things that change the total — name, rate,
   quantity — and folds the specification underneath. The document
   needs the description; pricing the job does not. */
function lineRow(l, i, open) {
  const design = l.designCode ? getDesign(l.designCode) : null;
  const spec = [l.description, l.dims].filter(Boolean).join(' · ');

  return `
    <article class="qline">
      <div class="qline-head">
        <span class="qline-imgwrap">
          <button class="qline-img ${l.photo ? 'has' : ''}" data-line-img="${esc(l.id)}"
                  aria-label="${l.photo ? 'Replace image' : 'Add image'}">
            ${l.photo ? `<img src="${esc(l.photo)}" alt="">` : icon('camera', 15)}
          </button>
          ${l.photo ? `<button class="qline-img-x" data-line-img-rm="${esc(l.id)}" aria-label="Remove image">×</button>` : ''}
        </span>
        <input class="control flush qline-title" data-l="${esc(l.id)}" data-k="name"
               value="${esc(l.name)}" placeholder="Item ${i + 1}">
        <span class="qline-amt num">${inr(lineAmount(l))}</span>
      </div>

      <div class="qline-money">
        <label class="qmoney">
          <span>Rate</span>
          ${moneyField(`data-l="${esc(l.id)}" data-k="unitPrice"`, l.unitPrice)}
        </label>
        ${l.kind === 'unit' ? `
          <label class="qmoney">
            <span>Qty</span>
            <input class="control mini-in" type="number" min="0" inputmode="numeric"
                   data-l="${esc(l.id)}" data-k="qty" value="${l.qty}">
          </label>` : `<span class="qline-lump">one lot</span>`}
        <div class="qline-kind">
          ${Object.entries(LINE_KINDS).map(([k, v]) => `
            <button class="seg-mini ${l.kind === k ? 'on' : ''}" data-kind="${k}" data-l="${esc(l.id)}">${esc(v.label)}</button>
          `).join('')}
        </div>
      </div>

      <details class="qdisc tight" data-line-more="${esc(l.id)}" ${open ? 'open' : ''}>
        <summary>
          ${icon('chevR', 14)}
          <span class="qdisc-peek">${spec ? esc(spec) : 'Description and dimensions'}</span>
          ${l.designCode ? `<span class="qline-code">${esc(l.designCode)}</span>` : ''}
        </summary>

        <textarea class="control qline-spec" data-l="${esc(l.id)}" data-k="description" rows="2"
                  placeholder="Material, finish, construction">${esc(l.description)}</textarea>

        <textarea class="control qline-spec" data-l="${esc(l.id)}" data-k="dims" rows="1"
                  placeholder="38 x 1 x 58&quot;, Dia 8 inch, as per drawing">${esc(l.dims)}</textarea>

        ${design && design.finishes.length ? `
          <div class="qcluster">
            ${pair('Finish', `
              <select class="control flush" data-l="${esc(l.id)}" data-k="finish">
                ${design.finishes.map((f) => `
                  <option value="${esc(f.name)}" ${f.name === l.finish ? 'selected' : ''}>${esc(f.name)}</option>
                `).join('')}
              </select>`)}
          </div>` : ''}

        <button class="mini danger wide" data-rm="${esc(l.id)}">${icon('trash', 14)} Remove item</button>
      </details>
    </article>
  `;
}

/* Shipping and the printed terms both have defaults that are right
   most of the time, so both stay shut until someone disagrees with
   them. The summary carries the current value, so a closed panel
   still answers the question it is hiding. */
function extrasBlock(q, openPanels) {
  const shipTotal = (q.shipping || []).reduce((n, s) => n + (Number(s.amount) || 0), 0);
  const termCount = String(q.paymentTerms || '').split('\n').filter((x) => x.trim()).length;

  return `
    <section class="qb-sec">
      <details class="qdisc panel-disc" data-panel="tax" ${openPanels.has('tax') ? 'open' : ''}>
        <summary>
          ${icon('chevR', 15)}
          <span class="qdisc-t">GST display</span>
          <span class="qdisc-v">${GST_MODES[q.gstMode].label}</span>
        </summary>
        <div class="segbar">
          ${Object.entries(GST_MODES).map(([k, v]) => `
            <button class="seg-mini ${q.gstMode === k ? 'on' : ''}" data-gstmode="${k}">${esc(v.label)}</button>
          `).join('')}
        </div>
        <p class="qb-hint">${esc(GST_MODES[q.gstMode].hint)} — the total owed is the same either way.</p>
      </details>

      <details class="qdisc panel-disc" data-panel="ship" ${openPanels.has('ship') ? 'open' : ''}>
        <summary>
          ${icon('chevR', 15)}
          <span class="qdisc-t">Shipping</span>
          <span class="qdisc-v num">${shipTotal ? inr(shipTotal) : 'None'}</span>
        </summary>
        ${(q.shipping || []).map((s) => `
          <div class="fin-row">
            <input class="control" data-s="${esc(s.id)}" data-k="label"
                   value="${esc(s.label)}" placeholder="Delivery - Vadodara">
            ${moneyField(`data-s="${esc(s.id)}" data-k="amount"`, s.amount)}
            <button class="mini danger" data-rm-ship="${esc(s.id)}" aria-label="Remove row">${icon('trash', 14)}</button>
          </div>
        `).join('')}
        <button class="mini wide" data-add-ship>${icon('plus', 14)} Add a shipping row</button>
      </details>

      <details class="qdisc panel-disc" data-panel="discount" ${openPanels.has('discount') ? 'open' : ''}>
        <summary>
          ${icon('chevR', 15)}
          <span class="qdisc-t">Discount</span>
          <span class="qdisc-v num">${q.discountEnabled && q.discountAmount ? inr(q.discountAmount) : 'None'}</span>
        </summary>
        <div class="fin-row">
          <button class="seg-mini ${q.discountEnabled ? 'on' : ''}" data-discount="${q.discountEnabled ? 'off' : 'on'}">
            ${q.discountEnabled ? 'Applied' : 'Not applied'}
          </button>
          ${q.discountEnabled ? moneyField('data-f="discountAmount"', q.discountAmount) : ''}
        </div>
        <p class="qb-hint">A flat amount off the goods total, taken before GST.</p>
      </details>

      <details class="qdisc panel-disc" data-panel="terms" ${openPanels.has('terms') ? 'open' : ''}>
        <summary>
          ${icon('chevR', 15)}
          <span class="qdisc-t">Terms</span>
          <span class="qdisc-v">${termCount} line${termCount === 1 ? '' : 's'}</span>
        </summary>
        <textarea class="control" data-f="paymentTerms" rows="3"
                  placeholder="50% advance">${esc(q.paymentTerms)}</textarea>
        <div class="qcluster">
          ${pair('Lead time (days)', `<input class="control flush" type="number" min="0" inputmode="numeric" data-leaddays value="${q.leadTimeDays || ''}" placeholder="15">`)}
          ${pair('Fabric up to', moneyField('data-f="fabricRate"', q.fabricRate))}
        </div>
        <p class="qb-hint" data-leadhint>Shown on the quotation as <b>${esc(q.leadTime || leadTimeRangeText(q.leadTimeDays) || '—')}</b></p>
      </details>

      <details class="qdisc panel-disc" data-panel="note" ${openPanels.has('note') ? 'open' : ''}>
        <summary>
          ${icon('chevR', 15)}
          <span class="qdisc-t">Private note</span>
          <span class="qdisc-v">${q.notes ? 'Written' : 'None'}</span>
        </summary>
        <textarea class="control" data-f="notes" rows="2" placeholder="Not printed">${esc(q.notes)}</textarea>
      </details>
    </section>
  `;
}

/* The foot carries one figure and the three things done with it: send
   it, save it, close it. The ladder behind the total — sub-total, tax,
   shipping — opens when you want to check the arithmetic and stays
   shut the rest of the time so the items keep the screen.

   `open` is passed in rather than read from the DOM so the panel
   survives the repaint that every edit triggers. */
function footBlock(t, q, open = false) {
  const parts = [
    `Sub ${inr(t.sub)}`,
    t.discount ? `Disc -${inr(t.discount)}` : null,
    t.taxed ? `GST ${q.gstRate}%` : 'no GST',
    t.subB ? `Ship ${inr(t.subB)}` : null,
  ].filter(Boolean);

  return `
    <footer class="qb-foot">
      ${open ? `
        <div class="qb-sums">
          <div class="qb-sum"><span>${t.discount ? 'Total' : 'Sub - Total'}</span><b class="num">${inr(t.sub)}</b></div>
          ${t.discount ? `
            <div class="qb-sum"><span>Discount</span><b class="num">-${inr(t.discount)}</b></div>
            <div class="qb-sum"><span>Sub-Total</span><b class="num">${inr(t.afterDiscount)}</b></div>` : ''}
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
      </div>

      <div class="qb-acts">
        <button class="btn sm grow" data-preview-btn>${icon('note', 18)} Preview</button>
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
      ${d.photo ? `<img class="dcard-img" src="${esc(d.photo)}" alt="">`
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
