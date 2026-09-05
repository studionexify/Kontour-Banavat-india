/* pdf.js — a small PDF writer, because the alternative was a CDN.
 *
 * The app ships with no runtime dependencies and has to work with no
 * signal, so pulling jsPDF off a CDN to produce a quotation would
 * break the one promise the whole thing is built on. A quotation is
 * text in a table; PDF 1.4 with the two standard Helvetica faces
 * covers that without embedding a font.
 *
 * Scope is deliberately narrow: text, rules and filled rectangles,
 * on repeating A4 pages. No images — the printed document uses them,
 * this one does not, and a shareable file that opens on any phone
 * matters more than a thumbnail column.
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
export function createPdf({ size = A4 } = {}) {
  const pages = [];
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
      return build(pages, size);
    },
  };

  return doc;
}

/* ── Assembly ───────────────────────────────────────────────────
   Object numbering: 1 catalog, 2 pages, 3 and 4 the two fonts, then
   a page object and a content stream for each page. The xref table
   needs byte offsets, so the file is assembled as Latin-1 chunks and
   measured as it goes rather than joined at the end. */
function build(pages, size) {
  const chunks = [];
  let length = 0;
  const offsets = [];

  const put = (str) => {
    chunks.push(str);
    length += str.length;      // Latin-1: one char, one byte.
  };
  const obj = (n, body) => {
    offsets[n] = length;
    put(`${n} 0 obj\n${body}\nendobj\n`);
  };

  const count = pages.length || 1;
  const firstPage = 5;
  const kids = Array.from({ length: count }, (_, i) => `${firstPage + i * 2} 0 R`).join(' ');

  put('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`);
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  (pages.length ? pages : ['']).forEach((content, i) => {
    const pageNo = firstPage + i * 2;
    obj(pageNo,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.w.toFixed(2)} ${size.h.toFixed(2)}] `
      + `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageNo + 1} 0 R >>`);
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
    for (let i = 0; i < chunk.length; i += 1) bytes[at + i] = chunk.charCodeAt(i) & 0xff;
    at += chunk.length;
  }
  return new Blob([bytes], { type: 'application/pdf' });
}
