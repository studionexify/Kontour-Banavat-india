/* brand.js — the Banavat mark, wherever it appears.
 *
 * One image, uploaded once in Settings and held with the quotation
 * settings so it travels in a backup and needs no deploy to change.
 * The document prints it, the rail wears it, the lock screen shows
 * it. Until one is set every surface falls back to type, so nothing
 * is ever broken-image shaped.
 */

import { settings } from './quotes.js';
import { esc } from './ui.js';
import { imageSrc } from './format.js';

export function logo() {
  try { return settings().logo || ''; } catch (e) { return ''; }
}

export function hasLogo() { return Boolean(logo()); }

/* `alt` is empty on purpose wherever a text label sits beside the
   mark — a screen reader should hear the name once, not twice. */
export function markHTML({ size = 34, className = 'brand-mark', alt = '' } = {}) {
  const src = imageSrc(logo());
  if (!src) return '';
  return `<img class="${esc(className)}" src="${esc(src)}" alt="${esc(alt)}"
               style="width:${size}px;height:${size}px" width="${size}" height="${size}">`;
}
