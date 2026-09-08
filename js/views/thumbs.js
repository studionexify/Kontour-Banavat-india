/* views/thumbs.js — the picture that belongs to a line item.
 *
 * Nothing in this business is recognised by its description. A work
 * order that says "Console 03" tells the person reading it almost
 * nothing; the photograph tells them everything, which is why the
 * original Drive sheets carried one against every row. Kontour
 * already knows how to find that photograph — subphoto.photoFor()
 * walks the order line, the quotation line and the scanned archive
 * in turn — so this file is only about showing it: one thumbnail,
 * the same size and shape wherever a piece is listed, and the same
 * behaviour when it is tapped.
 *
 * A piece with no picture on file gets a frame with the outline of a
 * crate in it rather than nothing at all. A row that is sometimes
 * 76 pixels tall and sometimes not is a list that is hard to scan,
 * and an empty frame is also information: somebody has not
 * photographed this piece yet.
 *
 * Tapping a thumbnail opens the picture full screen — that is
 * handled once, in ui.bindZoom(), for the whole app. Everything here
 * has to do is mark the element with data-zoom.
 */

import { icon } from '../icons.js';
import { esc } from '../ui.js';
import { photoFor } from '../subphoto.js';

/** The photograph for one order line, or '' when there is none. */
export function lineImage(line) {
  if (!line) return '';
  if (line.image) return line.image;
  return photoFor({ orderLineId: line.id, mrNo: line.mrNo, name: line.name });
}

/** The first photograph found under an order, for a card's cover. */
export function orderImage(group) {
  for (const l of (group && group.lines) || []) {
    const img = lineImage(l);
    if (img) return img;
  }
  return '';
}

/**
 * One thumbnail.
 *   size  'sm' in a dense row, '' at the standard 76px, 'lg' on a card
 *   label what the picture is of — the lightbox's caption
 */
export function thumb(src, label = '', size = '') {
  const cls = `pthumb${size ? ` ${size}` : ''}`;
  if (!src) {
    return `<span class="${cls} empty" aria-hidden="true">${icon('box', 20, 1.3)}</span>`;
  }
  return `
    <button type="button" class="${cls}" data-zoom="${esc(label)}"
            aria-label="${esc(label ? `View ${label} full screen` : 'View photograph full screen')}">
      <img src="${esc(src)}" alt="${esc(label)}" loading="lazy">
      <span class="pthumb-z">${icon('search', 13)}</span>
    </button>`;
}

/** The thumbnail for an order line, found and drawn in one call. */
export function lineThumb(line, size = '') {
  return thumb(lineImage(line), line ? (line.name || 'Piece') : '', size);
}

/* A card's cover strip: up to four of an order's pieces, each its own
   picture, each opening full screen on its own. Four because a fifth
   makes every picture too small to tell a walnut finish from a teak
   one, which is the only reason the strip is there. */
export function coverStrip(group, limit = 4) {
  const shot = ((group && group.lines) || [])
    .map((l) => ({ l, img: lineImage(l) }))
    .filter((x) => x.img);
  if (!shot.length) return '';
  const shown = shot.slice(0, limit);
  return `
    <div class="cover">
      ${shown.map(({ l, img }) => thumb(img, l.name || 'Piece', 'lg')).join('')}
      ${shot.length > limit
        ? `<span class="cover-more">+${shot.length - limit}</span>`
        : ''}
    </div>`;
}
