/* brand.js — the Banavat mark, wherever it appears.
 *
 * Two marks, and they are not interchangeable. The app wears the dark
 * square — the rail, the lock screen, the tab — because it sits on a
 * dark ground there. The quotation wears the light one, with the
 * wordmarks above and below, because that is the mark the printed
 * document has always carried in the top-right of its letterhead.
 *
 * A logo uploaded in Settings is a deliberate statement about the
 * business's mark, so it replaces both. That upload is held with the
 * quotation settings, so it travels in a backup and needs no deploy
 * to change. Until one is set every surface falls back to type, so
 * nothing is ever broken-image shaped.
 */

import { settings } from './quotes.js';
import { esc } from './ui.js';
import { DEFAULT_LOGO } from './default-logo.js';
import { DOC_MARK } from './doc-mark.js';

export function logo() {
  try { return settings().logo || ''; } catch (e) { return ''; }
}

export function hasLogo() { return Boolean(logo()); }

/** The mark the quotation's letterhead prints — see the note above. */
export function docMark() {
  const own = logo();
  return own && own !== DEFAULT_LOGO ? own : DOC_MARK;
}

/* `alt` is empty on purpose wherever a text label sits beside the
   mark — a screen reader should hear the name once, not twice. */
export function markHTML({ size = 34, className = 'brand-mark', alt = '', src = '' } = {}) {
  const href = src || logo();
  if (!href) return '';
  return `<img class="${esc(className)}" src="${esc(href)}" alt="${esc(alt)}"
               style="width:${size}px;height:${size}px" width="${size}" height="${size}">`;
}
