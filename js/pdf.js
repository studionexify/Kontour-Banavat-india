/* pdf.js — a small PDF writer, because the alternative was a CDN.
 *
 * The app ships with no runtime dependencies and has to work with no
 * signal, so pulling jsPDF off a CDN to produce a quotation would
 * break the one promise the whole thing is built on. A quotation is
 * text in a table; PDF 1.4 with the two standard Helvetica faces
 * covers that without embedding a font.
 *
 * Scope is deliberately narrow: text, rules, filled rectangles and
 * JPEG images, on repeating A4 pages. JPEG is the one image format
 * that needs no work — PDF's DCTDecode filter *is* JPEG, so the bytes
 * go in exactly as they came off the camera. PNG would have to be
 * un-filtered row by row first, so callers re-encode it instead.
 *
 * Everything is written in WinAnsi, which has no rupee sign, so
 * callers spell it "Rs." — see money() in quotepdf.js.
 */

/* Helvetica and Helvetica-Bold advance widths, 1/1000 em, for the
   printable ASCII range. Needed for wrapping and right-alignment:
   without them every column would have to be guessed at. */
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

export const A4 = { w: 595.28, h: 841.89 };

/** Width of a string at a given size, in points. */
export function textWidth(str, size, bold = false) {
  const table = bold ? W_BOLD : W_REG;
  let total = 0;
  for (const ch of String(str)) {
    const code = ch.charCodeAt(0);
    total += (code >= 32 && code <= 126) ? table[code - 32] : table[0];
  }
  return (total * size) / 1000;
}

/** Greedy word wrap to a pixel width. Always returns at least one line. */
export function wrapText(str, width, size, bold = false) {
  const out = [];
  for (const para of String(str == null ? '' : str).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) <= width || !line) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/* WinAnsi has no ₹ and no typographic dashes, and a byte outside the
   encoding renders as a blank or breaks the viewer. Transliterating
   here means callers never have to think about it. */
function toWinAnsi(str) {
  return String(str == null ? '' : str)
    .replace(/₹/g, 'Rs.')
    .replace(/[—–]/g, '-')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\n]/g, '');
}

function pdfString(str) {
  return toWinAnsi(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * A document being written. Coordinates are the ones people think in
 * — x from the left, y from the *top* — and flipped to PDF's own
 * bottom-left origin on the way out.
 */
/* ── JPEG ───────────────────────────────────────────────────────
   Everything needed to place a JPEG in a PDF is in its own header:
   the frame marker carries the pixel size and how many colour
   channels it has. The scan data itself is never decoded — it is
   handed to the viewer as-is. */

/** Turns a base64 data URI into bytes. Returns null if it is not one. */
export function dataUriToBytes(uri) {
  const at = String(uri || '').indexOf(';base64,');
  if (at < 0) return null;
  try {
    const bin = atob(String(uri).slice(at + 8));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

/**
 * Reads a JPEG's dimensions and colour space out of its markers.
 * Returns null for anything that is not a JPEG this can place —
 * the caller then re-encodes it rather than shipping a broken page.
 */
export function readJpeg(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  let i = 2;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xFF) { i += 1; continue; }         // resync on padding
    const marker = bytes[i + 1];
    // SOF0-SOF15, minus the four that are not frame headers.
    if (marker >= 0xC0 && marker <= 0xCF
        && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC && marker !== 0xC9) {
      const h = (bytes[i + 5] << 8) | bytes[i + 6];
      const w = (bytes[i + 7] << 8) | bytes[i + 8];
      const comps = bytes[i + 9];
      const space = comps === 1 ? 'DeviceGray' : comps === 4 ? 'DeviceCMYK' : 'DeviceRGB';
      if (!w || !h) return null;
      return { bytes, w, h, space };
    }
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD9)) { i += 2; continue; }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

export function createPdf({ size = A4 } = {}) {
  const pages = [];
  const images = [];
  let ops = [];

  function newPage() {
    if (ops.length) pages.push(ops.join('\n'));
    ops = [];
  }
  newPage.toString = () => '';

  const doc = {
    size,

    addPage() {
      if (ops.length) { pages.push(ops.join('\n')); ops = []; }
      return doc;
    },

    text(str, x, y, { size: fs = 10, bold = false, align = 'left', width = 0, gray = 0 } = {}) {
      const s = String(str == null ? '' : str);
      if (!s) return doc;
      let tx = x;
      if (align === 'right') tx = x - textWidth(s, fs, bold);
      else if (align === 'center') tx = x + (width - textWidth(s, fs, bold)) / 2;
      ops.push(
        'BT',
        `${gray} g`,
        `/${bold ? 'F2' : 'F1'} ${fs} Tf`,
        `1 0 0 1 ${tx.toFixed(2)} ${(size.h - y).toFixed(2)} Tm`,
        `(${pdfString(s)}) Tj`,
        'ET',
      );
      return doc;
    },

    /** A filled rectangle — used for table headers and status bands. */
    fill(x, y, w, h, gray = 0.92) {
      ops.push(`${gray} g`, `${x.toFixed(2)} ${(size.h - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
      return doc;
    },

    /**
     * Places a JPEG read by readJpeg, fitted inside the box rather
     * than stretched to it — a square thumbnail slot must not turn a
     * wide sofa into a tall one. Returns the box it actually used.
     */
    image(img, x, y, boxW, boxH) {
      if (!img || !img.bytes) return null;
      let at = images.indexOf(img);
      if (at < 0) { images.push(img); at = images.length - 1; }

      const scale = Math.min(boxW / img.w, boxH / img.h);
      const w = img.w * scale;
      const h = img.h * scale;
      const ox = x + (boxW - w) / 2;
      const oy = y + (boxH - h) / 2;

      // The image matrix draws into a unit square with its origin at
      // the bottom-left, so the height goes into the matrix and the
      // top-down y is flipped once for the whole placement.
      ops.push(
        'q',
        `${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${ox.toFixed(2)} ${(size.h - oy - h).toFixed(2)} cm`,
        `/Im${at} Do`,
        'Q',
      );
      return { x: ox, y: oy, w, h };
    },

    line(x1, y1, x2, y2, { gray = 0.75, weight = 0.6 } = {}) {
      ops.push(
        `${gray} G`, `${weight} w`,
        `${x1.toFixed(2)} ${(size.h - y1).toFixed(2)} m ${x2.toFixed(2)} ${(size.h - y2).toFixed(2)} l S`,
      );
      return doc;
    },

    /** Wrapped paragraph. Returns the y it ended at. */
    paragraph(str, x, y, w, { size: fs = 10, bold = false, leading = 1.35, gray = 0.15 } = {}) {
      let cy = y;
      for (const line of wrapText(str, w, fs, bold)) {
        doc.text(line, x, cy, { size: fs, bold, gray });
        cy += fs * leading;
      }
      return cy;
    },

    blob() {
      if (ops.length) { pages.push(ops.join('\n')); ops = []; }
      return build(pages, size, images);
    },
  };

  return doc;
}

/* ── Assembly ───────────────────────────────────────────────────
   Object numbering: 1 catalog, 2 pages, 3 and 4 the two fonts, then
   a page object and a content stream for each page. The xref table
   needs byte offsets, so the file is assembled as Latin-1 chunks and
   measured as it goes rather than joined at the end. */
function build(pages, size, images = []) {
  const chunks = [];
  let length = 0;
  const offsets = [];

  const put = (str) => {
    chunks.push(str);
    length += str.length;      // Latin-1: one char, one byte.
  };
  /* Image data is binary and can be megabytes, so it is carried as
     bytes rather than turned into a string and back. */
  const putBytes = (bytes) => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    put(`${n} 0 obj\n${body}\nendobj\n`);
  };

  const count = pages.length || 1;
  const firstImage = 5;
  const firstPage = firstImage + images.length;
  const kids = Array.from({ length: count }, (_, i) => `${firstPage + i * 2} 0 R`).join(' ');
  // Every page offers every image. A quotation carries a handful of
  // thumbnails, so the alternative — tracking which page used which —
  // costs more code than the dictionary entries save.
  const xobjects = images.length
    ? `/XObject << ${images.map((_, i) => `/Im${i} ${firstImage + i} 0 R`).join(' ')} >>`
    : '';

  put('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`);
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  images.forEach((img, i) => {
    const n = firstImage + i;
    offsets[n] = length;
    put(`${n} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} `
      + `/ColorSpace /${img.space || 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode `
      + `/Length ${img.bytes.length} >>\nstream\n`);
    putBytes(img.bytes);
    put('\nendstream\nendobj\n');
  });

  (pages.length ? pages : ['']).forEach((content, i) => {
    const pageNo = firstPage + i * 2;
    obj(pageNo,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.w.toFixed(2)} ${size.h.toFixed(2)}] `
      + `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${xobjects} >> /Contents ${pageNo + 1} 0 R >>`);
    obj(pageNo + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  const total = firstPage + count * 2;
  const xrefAt = length;
  put(`xref\n0 ${total}\n`);
  put('0000000000 65535 f \n');
  for (let n = 1; n < total; n += 1) {
    put(`${String(offsets[n] || 0).padStart(10, '0')} 00000 n \n`);
  }
  put(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    if (typeof chunk === 'string') {
      for (let i = 0; i < chunk.length; i += 1) bytes[at + i] = chunk.charCodeAt(i) & 0xff;
    } else {
      bytes.set(chunk, at);
    }
    at += chunk.length;
  }
  return new Blob([bytes], { type: 'application/pdf' });
}
