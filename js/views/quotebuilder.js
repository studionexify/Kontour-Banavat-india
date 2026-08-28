/* views/quotebuilder.js — writing the quotation.
 *
 * The sheet is laid out in the order the document is read: who it
 * is for, what is being supplied, what it comes to. Lines are the
 * body of the work, so they get the room, and the totals stay
 * pinned at the foot where the eye checks them.
 *
 * Every edit writes straight through to the store. A quotation is
 * revised over days, often on a phone in someone's showroom, and
 * losing an afternoon's pricing to a closed tab is not a risk
 * worth taking for the sake of a Save button.
 */

import { icon } from '../icons.js';
import { openSheet, on, esc, toast, field, emptyState } from '../ui.js';
import {
  getQuote, addQuote, updateQuote, newLine, lineAmount, quoteTotals,
  LINE_KINDS, designs, getDesign, lineFromDesign, designRate, settings,
} from '../quotes.js';
import { inr, todayISO, dmy, fyOf, isoOf, fromISO } from '../format.js';

export function openQuoteSheet({ id = '', onSaved } = {}) {
  let quote = id ? getQuote(id) : null;

  if (!quote) {
    const s = settings();
    const valid = new Date();
    valid.setDate(valid.getDate() + (s.validityDays || 15));
    quote = addQuote({
      fy: fyOf(todayISO()),
      date: todayISO(),
      validUntil: isoOf(valid),
    });
  }

  const sheet = openSheet({
    title: quote.number,
    full: true,
    wide: true,
    headRight: `<button class="icon-btn plain" data-add-design aria-label="Add from library">${icon('box', 20)}</button>`,
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
          <div data-terms></div>
        </div>
        <div data-foot></div>
      `;
      const $client = host.querySelector('[data-client]');
      const $lines = host.querySelector('[data-lines]');
      const $terms = host.querySelector('[data-terms]');
      const $foot = host.querySelector('[data-foot]');

      $client.innerHTML = clientBlock(quote);
      $terms.innerHTML = termsBlock(quote);
      renderLines();
      renderFoot();
      bindOnce();

      function renderLines() { $lines.innerHTML = linesBlock(quote); }
      function renderFoot() { $foot.innerHTML = footBlock(quoteTotals(quote), quote); }

      function save(changes, { lines = false } = {}) {
        quote = updateQuote(quote.id, changes);
        if (lines) renderLines();
        renderFoot();
      }

      function setLines(lines) { save({ lines }, { lines: true }); }

      /* Delegated once on the host, so a repaint of any region never
         stacks a second copy of these handlers. */
      function bindOnce() {
        host.addEventListener('change', (e) => {
          const inp = e.target;

          if (inp.dataset && inp.dataset.f != null) {
            const path = inp.dataset.f;
            const val = inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
            if (path.startsWith('client.')) {
              // The client block is not redrawn — the field already
              // holds what was typed, and redrawing it would move the
              // caret out from under the person typing.
              quote = updateQuote(quote.id, { client: { ...quote.client, [path.slice(7)]: val } });
              renderFoot();
            } else {
              save({ [path]: val });
            }
            return;
          }

          if (inp.dataset && inp.dataset.l) {
            const { l: lid, k: key } = inp.dataset;
            const lines = quote.lines.map((l) => l.id !== lid ? l : {
              ...l, [key]: inp.type === 'number' ? Number(inp.value) || 0 : inp.value,
            });
            quote = updateQuote(quote.id, { lines });
            // Only this line's amount and the totals move; the line
            // itself is left alone so the field keeps focus.
            const row = inp.closest('.qline');
            const amt = row && row.querySelector('.qline-amt');
            const line = quote.lines.find((l) => l.id === lid);
            if (amt && line) amt.textContent = inr(lineAmount(line));
            renderFoot();
          }
        });

        on(host, '[data-kind]', (e, b) => {
          const { kind, l: lid } = b.dataset;
          setLines(quote.lines.map((l) => l.id === lid ? { ...l, kind } : l));
        });
        on(host, '[data-rm]', (e, b) => setLines(quote.lines.filter((l) => l.id !== b.dataset.rm)));
        on(host, '[data-add-blank]', () => setLines([...quote.lines, newLine()]));
        on(host, '[data-pick]', () => pickDesign((line) => setLines([...quote.lines, line])));
        on(host, '[data-done]', () => { handle.close(); if (onSaved) onSaved(); });
      }

      on(root, '[data-add-design]', () => pickDesign((line) => setLines([...quote.lines, line])));
    },
    onClose() { if (onSaved) onSaved(); },
  });

  return sheet;
}

/* ── Blocks ────────────────────────────────────────────────────── */

function clientBlock(q) {
  return `
    <section class="qb-sec">
      <h3 class="qb-h">Client</h3>
      <div class="qb-grid">
        ${field('Name', `<input class="control" data-f="client.name" value="${esc(q.client.name)}" placeholder="Contact person">`)}
        ${field('Company', `<input class="control" data-f="client.company" value="${esc(q.client.company)}" placeholder="Firm or site name">`)}
        ${field('Phone', `<input class="control" data-f="client.phone" value="${esc(q.client.phone)}" inputmode="tel">`)}
        ${field('GSTIN', `<input class="control" data-f="client.gstin" value="${esc(q.client.gstin)}" autocapitalize="characters">`)}
      </div>
      ${field('Address', `<textarea class="control" data-f="client.address" rows="2" placeholder="Delivery address">${esc(q.client.address)}</textarea>`)}

      <div class="qb-grid">
        ${field('Quotation date', `<input class="control" type="date" data-f="date" value="${esc(q.date)}">`)}
        ${field('Valid until', `<input class="control" type="date" data-f="validUntil" value="${esc(q.validUntil)}">`)}
      </div>
      ${field('Subject', `<input class="control" data-f="title" value="${esc(q.title)}" placeholder="Bedroom furniture — Villa 12">`)}
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

      ${q.lines.length ? q.lines.map((l, i) => lineRow(l, i)).join('')
        : `<div class="qb-none">${icon('box', 22)}
             <p>No items yet</p>
             <small>Pick a design from the library, or add a blank line for a one-off.</small>
           </div>`}
    </section>
  `;
}

function lineRow(l, i) {
  const design = l.designCode ? getDesign(l.designCode) : null;
  return `
    <article class="qline">
      <div class="qline-head">
        <span class="qline-n">${i + 1}</span>
        ${design && design.photo
          ? `<img class="qline-img" src="${esc(design.photo)}" alt="">`
          : `<span class="qline-img ph">${icon('box', 18)}</span>`}
        <input class="control flush qline-title" data-l="${esc(l.id)}" data-k="title"
               value="${esc(l.title)}" placeholder="Item description">
        <button class="mini danger" data-rm="${esc(l.id)}" aria-label="Remove line">${icon('trash', 14)}</button>
      </div>

      <div class="qline-kind">
        ${Object.entries(LINE_KINDS).map(([k, v]) => `
          <button class="seg-mini ${l.kind === k ? 'on' : ''}" data-kind="${k}" data-l="${esc(l.id)}">${esc(v.label)}</button>
        `).join('')}
        ${l.designCode ? `<span class="qline-code">${esc(l.designCode)}</span>` : ''}
      </div>

      <div class="qline-dims">
        <label>W <input class="control mini-in" type="number" data-l="${esc(l.id)}" data-k="w" value="${l.w || ''}"></label>
        <label>D <input class="control mini-in" type="number" data-l="${esc(l.id)}" data-k="d" value="${l.d || ''}"></label>
        <label>H <input class="control mini-in" type="number" data-l="${esc(l.id)}" data-k="h" value="${l.h || ''}"></label>
        ${design && design.finishes.length ? `
          <label class="grow">Finish
            <select class="control mini-in" data-l="${esc(l.id)}" data-k="finish">
              ${design.finishes.map((f) => `
                <option value="${esc(f.name)}" ${f.name === l.finish ? 'selected' : ''}>${esc(f.name)}</option>
              `).join('')}
            </select>
          </label>` : ''}
      </div>

      <textarea class="control qline-spec" data-l="${esc(l.id)}" data-k="spec" rows="2"
                placeholder="Specification that prints under this item">${esc(l.spec)}</textarea>

      <div class="qline-money">
        ${l.kind === 'unit' ? `
          <label>Qty <input class="control mini-in" type="number" min="0" data-l="${esc(l.id)}" data-k="qty" value="${l.qty}"></label>
          <label>Rate <input class="control mini-in" type="number" min="0" data-l="${esc(l.id)}" data-k="rate" value="${l.rate}"></label>
        ` : `
          <label class="grow">Lump sum
            <input class="control mini-in" type="number" min="0" data-l="${esc(l.id)}" data-k="lump" value="${l.lump}">
          </label>
        `}
        <span class="qline-amt num">${inr(lineAmount(l))}</span>
      </div>
    </article>
  `;
}

function termsBlock(q) {
  return `
    <section class="qb-sec">
      <h3 class="qb-h">Terms</h3>
      ${field('Terms &amp; conditions',
        `<textarea class="control" data-f="terms" rows="6">${esc(q.terms)}</textarea>`,
        'One per line. These print at the foot of the quotation.')}
      ${field('Private note',
        `<textarea class="control" data-f="notes" rows="2" placeholder="Not printed">${esc(q.notes)}</textarea>`)}
    </section>
  `;
}

/* The foot stays put while the body scrolls: the total is the
   figure being negotiated, so it should never be a scroll away. */
function footBlock(t, q) {
  return `
    <footer class="qb-foot">
      <div class="qb-sums">
        <div class="qb-sum"><span>Subtotal</span><b class="num">${inr(t.sub)}</b></div>
        <div class="qb-sum">
          <span>Discount</span>
          <input class="control mini-in" type="number" min="0" data-f="discount" value="${q.discount || 0}">
        </div>
        <div class="qb-sum">
          <span>GST</span>
          <span class="qb-gst">
            <input class="control mini-in" type="number" min="0" max="28" data-f="gstRate" value="${q.gstRate}">%
            <b class="num">${inr(t.gst)}</b>
          </span>
        </div>
        <div class="qb-sum tot"><span>Total</span><b class="num">${inr(t.total)}</b></div>
      </div>
      <button class="btn" data-done>Done</button>
    </footer>
  `;
}

/* ── Picking from the library ──────────────────────────────────
   A second sheet over the first, so the quote stays exactly where
   it was underneath. Picking adds the line and closes; the rate
   and dimensions come along and are editable afterwards. */
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
          <span class="dcard-rate num">${inr(d.baseRate)}</span>
          <span class="pill mut">${esc(d.category)}</span>
        </div>
      </div>
    </button>
  `;
}
