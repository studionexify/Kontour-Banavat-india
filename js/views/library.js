/* views/library.js — the design library.
 *
 * A design is a thing you make more than once. The library is
 * where its code, its picture, its default size, the finishes it
 * comes in and the words that describe it are settled once — so
 * that quoting it later is a matter of picking it, not retyping
 * it.
 *
 * Browsing is visual on purpose. Nobody remembers what BD-14 is,
 * but everybody recognises the photograph.
 */

import { icon } from '../icons.js';
import { on, esc, emptyState, toast, openSheet, field, confirmSheet } from '../ui.js';
import { designs, getDesign, addDesign, updateDesign, deleteDesign, CATEGORIES } from '../quotes.js';
import { pickImage, shrink, toBase64 } from '../photos.js';
import { inr } from '../format.js';

let cat = 'All';
let query = '';

export async function render(root, ctx) {
  const list = designs({ category: cat, q: query });
  const all = designs();
  const cats = ['All', ...CATEGORIES.filter((c) => all.some((d) => d.category === c))];

  root.innerHTML = `
    <header class="hero with-panel">
      <div class="hero-bar">
        <div class="hero-title">
          Design library
          <small>${all.length} design${all.length === 1 ? '' : 's'}</small>
        </div>
        <button class="icon-btn" data-new aria-label="Add design">${icon('plus', 21)}</button>
      </div>
    </header>

    <div class="panel">
      <div class="searchbar">
        <input class="control" type="search" data-q value="${esc(query)}"
               placeholder="Search code, name, description" aria-label="Search designs">
      </div>

      ${cats.length > 1 ? `<div class="chipbar">
        ${cats.map((c) => `<button class="chip ${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>` : ''}

      ${list.length ? `<div class="dgrid">${list.map(card).join('')}</div>`
        : emptyState('box',
            query || cat !== 'All' ? 'Nothing matches' : 'The library is empty',
            query || cat !== 'All' ? 'Try another category' : 'Add a design and it becomes one tap in every future quotation')}
    </div>
  `;

  on(root, '[data-new]', () => openDesignSheet({ onSaved: ctx.refresh }));
  on(root, '[data-edit]', (e, b) => openDesignSheet({ code: b.dataset.edit, onSaved: ctx.refresh }));
  on(root, '[data-cat]', (e, b) => { cat = b.dataset.cat; ctx.refresh(); });

  const q = root.querySelector('[data-q]');
  if (q) {
    q.addEventListener('input', () => {
      query = q.value;
      clearTimeout(q._t);
      q._t = setTimeout(() => ctx.refresh(), 220);
    });
  }
}

function card(d) {
  return `
    <button class="dcard reveal" data-edit="${esc(d.code)}">
      ${d.photo ? `<img class="dcard-img" src="${esc(d.photo)}" alt="">`
                : `<span class="dcard-img ph">${icon('box', 26)}</span>`}
      <div class="dcard-body">
        <div class="dcard-code">${esc(d.code)}</div>
        <div class="dcard-name">${esc(d.name || '—')}</div>
        ${d.dims ? `<div class="dcard-dims">${esc(d.dims)}</div>` : ''}
        <div class="dcard-foot">
          <span class="dcard-rate num">${inr(d.unitPrice)}</span>
          <span class="pill mut">${esc(d.category)}</span>
        </div>
        ${d.finishes.length ? `<div class="dcard-fin">${d.finishes.length} finish${d.finishes.length === 1 ? '' : 'es'}</div>` : ''}
      </div>
    </button>
  `;
}

/* ── The design sheet ──────────────────────────────────────────
   One form for both adding and editing. A finish is a name and
   what it does to the base rate, so re-rating a design does not
   mean re-rating every finish under it. */
export function openDesignSheet({ code = '', onSaved } = {}) {
  const existing = code ? getDesign(code) : null;

  /* The form repaints whenever a finish is added or removed, so what
     has been typed lives in a draft rather than in the DOM. Without
     this, adding a finish halfway through would blank the fields
     above it. */
  const draft = {
    code: existing ? existing.code : '',
    name: existing ? existing.name : '',
    category: existing ? existing.category : 'Other',
    unitPrice: existing ? existing.unitPrice : 0,
    dims: existing ? existing.dims : '',
    description: existing ? existing.description : '',
    photo: existing ? existing.photo : '',
    finishes: existing ? existing.finishes.map((f) => ({ ...f })) : [],
  };

  const h = openSheet({
    title: existing ? existing.code : 'New design',
    full: true,
    wide: true,
    body: `<div class="qb"><div class="qb-scroll" data-form></div></div>`,
    onMount(root) {
      const host = root.querySelector('[data-form]');
      paint();

      /* Pull the live DOM back into the draft before any repaint. */
      function readForm() {
        host.querySelectorAll('[data-k]').forEach((inp) => {
          const k = inp.dataset.k;
          draft[k] = k === 'unitPrice' ? Number(inp.value) || 0 : inp.value;
        });
        host.querySelectorAll('[data-fin]').forEach((inp) => {
          const i = Number(inp.dataset.fin);
          if (!draft.finishes[i]) return;
          draft.finishes[i][inp.dataset.fk] =
            inp.dataset.fk === 'delta' ? Number(inp.value) || 0 : inp.value;
        });
      }

      function paint() {
        host.innerHTML = `
          <section class="qb-sec">
            <button class="dphoto ${draft.photo ? 'has' : ''}" data-photo>
              ${draft.photo ? `<img src="${esc(draft.photo)}" alt="">`
                            : `<span>${icon('camera', 26)}<small>Add a photograph</small></span>`}
            </button>

            <div class="qb-grid">
              ${field('Design code', `<input class="control" data-k="code" value="${esc(draft.code)}"
                       placeholder="BD-14" autocapitalize="characters" ${existing ? 'readonly' : ''}>`)}
              ${field('Category', `<select class="control" data-k="category">
                  ${CATEGORIES.map((c) => `<option ${c === draft.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                </select>`)}
            </div>

            ${field('Name', `<input class="control" data-k="name" value="${esc(draft.name)}" placeholder="Panelled king bed">`)}
            ${field('Unit price', `<input class="control" type="number" min="0" data-k="unitPrice" value="${draft.unitPrice}">`,
                    'Before any finish adjustment, and before GST.')}
            ${field('Dimensions',
              `<input class="control" data-k="dims" value="${esc(draft.dims)}" placeholder="38 x 1 x 58&quot;">`,
              'Written the way it prints — inches, mm, a diameter, or a note like "as per drawing".')}

            <div class="qb-sec-head">
              <h3 class="qb-h">Finishes</h3>
              <button class="mini" data-add-fin>${icon('plus', 14)} Add finish</button>
            </div>
            ${draft.finishes.length ? draft.finishes.map((f, i) => `
              <div class="fin-row">
                <input class="control" data-fin="${i}" data-fk="name" value="${esc(f.name)}" placeholder="Veneer">
                <input class="control mini-in" type="number" data-fin="${i}" data-fk="delta" value="${f.delta || 0}">
                <button class="mini danger" data-rm-fin="${i}" aria-label="Remove finish">${icon('trash', 14)}</button>
              </div>
            `).join('') : `<p class="qb-hint">No finishes — the base rate is used as it is.</p>`}
            <p class="qb-hint">The second figure is added to the base rate when that finish is chosen. It can be negative.</p>

            ${field('Description',
              `<textarea class="control" data-k="description" rows="4"
                 placeholder="Material, finish, construction — prints in the Description column">${esc(draft.description)}</textarea>`)}

            <button class="btn" data-save>${existing ? 'Save design' : 'Add to library'}</button>
            ${existing ? `<button class="btn sec sm" data-del>Remove from library</button>` : ''}
          </section>
        `;
        bind();
      }

      function bind() {
        on(host, '[data-photo]', async () => {
          const files = await pickImage({ camera: true });
          if (!files || !files[0]) return;
          const blob = await shrink(files[0]);
          readForm();
          draft.photo = await toBase64(blob);
          paint();
        });

        on(host, '[data-add-fin]', () => {
          readForm();
          draft.finishes.push({ name: '', delta: 0 });
          paint();
        });

        on(host, '[data-rm-fin]', (e, b) => {
          readForm();
          draft.finishes.splice(Number(b.dataset.rmFin), 1);
          paint();
        });

        on(host, '[data-save]', () => {
          readForm();
          const codeVal = String(draft.code || '').trim().toUpperCase();
          if (!codeVal) { toast('A design needs a code', 'err'); return; }
          if (!existing && getDesign(codeVal)) { toast(`${codeVal} already exists`, 'err'); return; }

          const payload = {
            ...draft,
            code: codeVal,
            finishes: draft.finishes.filter((f) => String(f.name).trim()),
          };

          if (existing) updateDesign(existing.code, payload);
          else addDesign(payload);
          toast(existing ? 'Design saved' : `${codeVal} added`);
          h.close();
          if (onSaved) onSaved();
        });

        on(host, '[data-del]', async () => {
          const ok = await confirmSheet({
            title: `Remove ${existing.code}?`,
            message: 'Quotations already written keep their copy of it — only the library entry goes.',
            confirmLabel: 'Remove', danger: true,
          });
          if (!ok) return;
          deleteDesign(existing.code);
          toast('Removed from library');
          h.close();
          if (onSaved) onSaved();
        });
      }
    },
  });
}
