/* docfont.js — Montserrat on screen, from the same bytes the PDF
   embeds.
 *
 * The preview is only worth having if it is the file: same face, same
 * widths, same wraps. Both surfaces therefore read js/fonts, and this
 * turns those subsets into an @font-face rule so the browser can set
 * type in them. No network, no CDN, no webfont request — the bytes
 * are already in the bundle.
 *
 * Injected on first use rather than at boot, because the only screen
 * that needs it is the quotation document. Anything the subset does
 * not cover falls through to the system stack, which is what the
 * font-family list in styles.css is for.
 */

import REGULAR from './fonts/montserrat-regular.js';
import BOLD from './fonts/montserrat-bold.js';

let injected = false;

export function useDocFont() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const face = (font, weight) => `
@font-face {
  font-family: 'Kontour Montserrat';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url(data:font/ttf;base64,${font.data}) format('truetype');
}`;
  const style = document.createElement('style');
  style.id = 'kontour-doc-font';
  style.textContent = face(REGULAR, 400) + face(BOLD, 700);
  document.head.appendChild(style);
}
