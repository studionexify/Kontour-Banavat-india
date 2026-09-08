/* ui.js — the handful of DOM primitives every view is built from. */

import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escapes anything that came from the user before it goes into innerHTML. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Delegated click handling — views render strings, then bind by selector. */
export function on(root, selector, handler, evt = 'click') {
  root.addEventListener(evt, (e) => {
    const hit = e.target.closest(selector);
    if (hit && root.contains(hit)) handler(e, hit);
  });
}

export function haptic(ms = 8) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch {} }
}

/* ── Toast ─────────────────────────────────────────────────── */

export function toast(msg, kind = '', ms = 2400) {
  const root = $('#toast-root');
  const t = el(`<div class="toast ${kind}">${esc(msg)}</div>`);
  root.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 260);
  }, ms);
}

/* ── Sheets ────────────────────────────────────────────────── */

const stack = [];

/**
 * openSheet({ title, body, dark, full, onMount, onClose })
 * Returns a handle with .close() and .el
 */
export function openSheet({ title = '', body = '', dark = false, full = false, wide = false, headRight = '', onMount, onClose } = {}) {
  const root = $('#sheet-root');
  const scrim = el('<div class="scrim"></div>');
  const sheet = el(`
    <section class="sheet ${dark ? 'dark' : ''} ${full ? 'full' : ''} ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      ${full ? '' : '<div class="grab"></div>'}
      <header class="sheet-head">
        <button class="icon-btn ${dark ? '' : 'plain'}" data-sheet-close aria-label="Close">${icon(full ? 'back' : 'close', 21)}</button>
        <h2>${esc(title)}</h2>
        <div class="sheet-head-right">${headRight || '<span style="width:38px;display:block"></span>'}</div>
      </header>
      <div class="sheet-content" style="display:flex;flex-direction:column;min-height:0;flex:1">${body}</div>
    </section>`);

  root.appendChild(scrim);
  root.appendChild(sheet);
  document.body.style.overflow = 'hidden';

  const handle = {
    el: sheet,
    close() {
      if (handle._closed) return;
      handle._closed = true;
      /* How it leaves is decided in CSS, because where it came from
         is: a phone's sheet drops back off the bottom edge, a
         desktop's centred window fades back into the floor it is
         sitting on. Setting a transform here would fight the one
         that centres it. */
      sheet.style.animation = 'none';
      sheet.classList.add('closing');
      scrim.style.transition = 'opacity .2s';
      scrim.style.opacity = '0';
      setTimeout(() => { sheet.remove(); scrim.remove(); }, 200);
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      if (onClose) onClose();
    },
  };

  scrim.addEventListener('click', handle.close);
  on(sheet, '[data-sheet-close]', handle.close);
  stack.push(handle);
  if (onMount) onMount(sheet, handle);
  return handle;
}

/* ── The picture, full screen ──────────────────────────────────
   Every line item in this business is recognised by its photograph
   rather than its description — "the console" means nothing until
   you see which console. So a thumbnail is never the whole of it:
   tapping one has to give you the picture at the size you can
   actually judge a finish from.

   It joins the same stack as a sheet, so the back button and a tap
   outside close the picture before they close whatever it was
   opened from. Nothing else about the screen underneath moves. */
export function openLightbox(src, caption = '') {
  if (!src) return null;
  const root = $('#sheet-root');
  const box = el(`
    <div class="lightbox" role="dialog" aria-modal="true" aria-label="${esc(caption || 'Photograph')}">
      <button class="lightbox-x" data-lb-close aria-label="Close">${icon('close', 22)}</button>
      <figure class="lightbox-fig">
        <img src="${esc(src)}" alt="${esc(caption)}">
        ${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}
      </figure>
    </div>`);

  root.appendChild(box);
  document.body.style.overflow = 'hidden';

  const handle = {
    el: box,
    close() {
      if (handle._closed) return;
      handle._closed = true;
      box.classList.add('closing');
      setTimeout(() => box.remove(), 180);
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      // Only the last thing on the stack hands scrolling back.
      if (!stack.length) document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    },
  };

  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); handle.close(); } }
  document.addEventListener('keydown', onKey);

  // Anywhere on the dark ground, including beside the picture.
  box.addEventListener('click', handle.close);
  stack.push(handle);
  return handle;
}

/* One handler for the whole app: anything carrying data-zoom opens
   its own <img> full screen. Views therefore only have to draw a
   thumbnail — none of them wires a viewer of its own. */
export function bindZoom(scope = document) {
  scope.addEventListener('click', (e) => {
    const hit = e.target.closest('[data-zoom]');
    if (!hit) return;
    const img = hit.matches('img') ? hit : hit.querySelector('img');
    if (!img || !img.getAttribute('src')) return;
    e.preventDefault();
    e.stopPropagation();
    haptic();
    openLightbox(img.getAttribute('src'), hit.dataset.zoom || img.alt || '');
  });
}

export function closeTopSheet() {
  if (stack.length) { stack[stack.length - 1].close(); return true; }
  return false;
}

export function sheetCount() { return stack.length; }

/* ── Confirm ───────────────────────────────────────────────── */

export function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const h = openSheet({
      title,
      body: `
        <div class="sheet-body">
          <p style="margin:2px 0 4px;font-size:14.5px;color:var(--ink-2);line-height:1.5">${esc(message)}</p>
          <button class="btn ${danger ? 'danger' : ''}" data-yes>${esc(confirmLabel)}</button>
          <button class="btn sec sm" data-sheet-close>Cancel</button>
        </div>`,
      onMount(root) {
        on(root, '[data-yes]', () => { done = true; resolve(true); h.close(); });
      },
      onClose() { if (!done) resolve(false); },
    });
  });
}

/* ── Small builders shared by views ────────────────────────── */

export function emptyState(iconName, text, sub = '') {
  return `
    <div class="empty">
      <div class="empty-ico">${icon(iconName, 34, 1.4)}</div>
      <p>${esc(text)}</p>
      ${sub ? `<small>${esc(sub)}</small>` : ''}
    </div>`;
}

export function field(label, controlHtml, hint = '') {
  return `
    <div class="field">
      <label>${esc(label)}</label>
      ${controlHtml}
      ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
    </div>`;
}

export function switchRow(title, sub, on_, attr = '') {
  return `
    <div class="switchrow" ${attr}>
      <div><div class="sw-t">${esc(title)}</div>${sub ? `<div class="sw-s">${esc(sub)}</div>` : ''}</div>
      <div class="switch ${on_ ? 'on' : ''}"></div>
    </div>`;
}
