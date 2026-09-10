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

let loading = null;

/**
 * Injects the faces and resolves once the browser can actually set
 * type in them. The document is measured before it is paginated, and
 * measuring it in the fallback face would break the pages in the
 * wrong places — so the caller waits on this first.
 */
export function useDocFont() {
  if (loading) return loading;
  if (typeof document === 'undefined') return Promise.resolve();
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

  // A face nobody asked for is never fetched, and these are already
  // in memory — so ask, then wait. Where the Font Loading API is
  // missing there is nothing to wait on and the fallback metrics are
  // the best that can be done.
  const fonts = document.fonts;
  const asked = fonts && fonts.load
    ? Promise.all([
      fonts.load("400 10px 'Kontour Montserrat'"),
      fonts.load("700 10px 'Kontour Montserrat'"),
    ]).catch(() => {})
    : Promise.resolve();
  /* Whatever happens, the document appears. A browser that never
     settles the load leaves the caller waiting on nothing, and a
     preview broken in slightly the wrong places beats a blank one. */
  loading = Promise.race([asked, new Promise((done) => { setTimeout(done, 2000); })]);
  return loading;
}
