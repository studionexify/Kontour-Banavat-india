/* pdf.js — a small PDF writer, because the alternative was a CDN.
 *
 * The app ships with no runtime dependencies and has to work with no
 * signal, so pulling jsPDF off a CDN to produce a quotation would
 * break the one promise the whole thing is built on.
 *
 * Scope is deliberately narrow: text, rules, filled rectangles and
 * JPEG images, on repeating pages of one size. JPEG is the one image
 * format that needs no work — PDF's DCTDecode filter *is* JPEG, so
 * the bytes go in exactly as they came off the camera. PNG would have
 * to be un-filtered row by row first, so callers re-encode it instead.
 *
 * There are two ways to set type, and a document picks one:
 *
 *  - Pass nothing, and it uses PDF's own Helvetica in WinAnsi. That
 *    costs no bytes and is what the work order prints in. WinAnsi has
 *    no rupee sign, so those callers spell it "Rs.".
 *
 *  - Pass a pair of faces from js/fonts, and the document carries
 *    them: Identity-H over a CIDFontType2, with the TrueType subset
 *    embedded whole. That is how the quotation prints — in
 *    Montserrat, with a real ₹ in every money column.
 */

/* Helvetica and Helvetica-Bold advance widths, 1/1000 em, for the
   printable ASCII range. Needed for wrapping and right-alignment:
   without them every column would have to be guessed at. */
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

export const A4 = { w: 595.28, h: 841.89 };
/* The quotation prints on Letter, because every quotation this
   business has issued has. */
export const LETTER = { w: 612, h: 792 };

/** Width of a string at a given size, in points, in Helvetica. */
export function textWidth(str, size, bold = false) {
  const table = bold ? W_BOLD : W_REG;
  let total = 0;
  for (const ch of String(str)) {
    const code = ch.charCodeAt(0);
    total += (code >= 32 && code <= 126) ? table[code - 32] : table[0];
  }
  return (total * size) / 1000;
}

/* Greedy word wrap, given a way to measure a candidate line. Always
   returns at least one line, and never drops a word that is wider
   than the column — it goes on a line of its own and overhangs,
   which reads better than vanishing. */
function greedy(str, width, measure) {
  const out = [];
  for (const para of String(str == null ? '' : str).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= width || !line) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/** Greedy word wrap to a width, in Helvetica. */
export function wrapText(str, width, size, bold = false) {
  return greedy(str, width, (line) => textWidth(line, size, bold));
}

/* What to print when a face has no glyph for a character. The
   embedded subsets cover Latin and the punctuation the boilerplate
   uses, so this is mostly for Helvetica, which has no rupee sign at
   all — but it is also what keeps a pasted character from some other
   script out of the page as a row of blanks. */
const FOLD = {
  '₹': 'Rs.', '€': 'EUR', '™': '(TM)',
  '—': '-', '–': '-', '−': '-', '•': '-',
  '“': '"', '”': '"', '„': '"',
  '‘': "'", '’': "'", '‚': "'",
  '…': '...', ' ': ' ', '±': '+/-',
};

/* WinAnsi has no ₹ and no typographic dashes, and a byte outside the
   encoding renders as a blank or breaks the viewer. Folding first and
   dropping whatever is left means Helvetica's callers never have to
   think about it. */
function toWinAnsi(str) {
  return String(str == null ? '' : str)
    .replace(/[^\x20-\x7E\n]/g, (ch) => FOLD[ch] || '')
    .replace(/[^\x20-\x7E\n]/g, '');
}

function pdfString(str) {
  return toWinAnsi(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/* ── Faces ──────────────────────────────────────────────────────
   A face answers the same two questions however it is set: how wide
   is this string, and which operand shows it. Nothing above this
   line has to know whether the glyphs came with the viewer or with
   the file. */

function helveticaFace(bold) {
  return {
    embedded: null,
    res: bold ? 'F2' : 'F1',
    width: (str, size) => textWidth(str, size, bold),
    show: (str) => `(${pdfString(str)}) Tj`,
  };
}

function embeddedFace(font, res) {
  /* Identity-H addresses glyphs directly, so a string is carried as
     its glyph ids rather than its characters — which is also what
     makes the rupee sign possible, and why the file needs a
     ToUnicode map before anything can be copied back out of it. */
  const gids = (str) => {
    const out = [];
    for (const ch of String(str == null ? '' : str)) {
      const gid = font.cmap[ch.codePointAt(0)];
      if (gid !== undefined) { out.push(gid); continue; }
      for (const sub of FOLD[ch] || '') {
        const g = font.cmap[sub.codePointAt(0)];
        if (g !== undefined) out.push(g);
      }
    }
    return out;
  };
  return {
    embedded: font,
    res,
    width: (str, size) => gids(str).reduce((t, g) => t + (font.widths[g] || 0), 0) * size / 1000,
    show: (str) => `<${gids(str).map((g) => g.toString(16).padStart(4, '0')).join('')}> Tj`,
  };
}

/* ── JPEG ───────────────────────────────────────────────────────
   Everything needed to place a JPEG in a PDF is in its own header:
   the frame marker carries the pixel size and how many colour
   channels it has. The scan data itself is never decoded — it is
   handed to the viewer as-is. */

/** Turns base64 into bytes. */
export function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Turns a base64 data URI into bytes. Returns null if it is not one. */
export function dataUriToBytes(uri) {
  const at = String(uri || '').indexOf(';base64,');
  if (at < 0) return null;
  try { return base64ToBytes(String(uri).slice(at + 8)); } catch { return null; }
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

/**
 * A document being written. Coordinates are the ones people think in
 * — x from the left, y from the *top* — and flipped to PDF's own
 * bottom-left origin on the way out.
 *
 * `fonts` is an optional `{ regular, bold }` pair of subsets from
 * js/fonts; without it the document is set in Helvetica.
 */
export function createPdf({ size = A4, fonts = null } = {}) {
  const pages = [];
  const images = [];
  let ops = [];

  const faces = fonts && fonts.regular && fonts.bold
    ? { regular: embeddedFace(fonts.regular, 'F1'), bold: embeddedFace(fonts.bold, 'F2') }
    : { regular: helveticaFace(false), bold: helveticaFace(true) };
  const faceFor = (bold) => (bold ? faces.bold : faces.regular);

  const doc = {
    size,

    addPage() {
      if (ops.length) { pages.push(ops.join('\n')); ops = []; }
      return doc;
    },

    /** Width of a string as this document would set it, in points. */
    width(str, fs = 10, bold = false) { return faceFor(bold).width(String(str == null ? '' : str), fs); },

    /** Greedy word wrap in this document's own face. */
    wrap(str, w, fs = 10, bold = false) {
      const face = faceFor(bold);
      return greedy(str, w, (line) => face.width(line, fs));
    },

    /* Grayscale (`gray`) is the whole document's palette but for one
       exception: the business's own name prints in its brand blue on
       the letterhead. `rgb` — [r, g, b], each 0–1 — overrides `gray`
       when given, switching the fill operator from `g` to `rg`.

       `align` is 'left', 'right' — x is then the right edge — or
       'center', which centres inside [x, x + width]. */
    text(str, x, y, { size: fs = 10, bold = false, align = 'left', width = 0, gray = 0, rgb = null } = {}) {
      const s = String(str == null ? '' : str);
      if (!s) return doc;
      const face = faceFor(bold);
      let tx = x;
      if (align === 'right') tx = x - face.width(s, fs);
      else if (align === 'center') tx = x + (width - face.width(s, fs)) / 2;
      ops.push(
        'BT',
        rgb ? `${rgb[0]} ${rgb[1]} ${rgb[2]} rg` : `${gray} g`,
        `/${face.res} ${fs} Tf`,
        `1 0 0 1 ${tx.toFixed(2)} ${(size.h - y).toFixed(2)} Tm`,
        face.show(s),
        'ET',
      );
      return doc;
    },

    /**
     * A run of pieces set one after another on the same baseline,
     * each with its own weight — how a standing term prints with the
     * lead time bold inside it. Returns the x it ended at.
     */
    runs(pieces, x, y, opts = {}) {
      let tx = x;
      for (const piece of pieces) {
        if (!piece || !piece.text) continue;
        doc.text(piece.text, tx, y, { ...opts, bold: Boolean(piece.bold), align: 'left' });
        tx += faceFor(Boolean(piece.bold)).width(piece.text, opts.size || 10);
      }
      return tx;
    },

    /** A filled rectangle — used for table headers and status bands. */
    fill(x, y, w, h, gray = 0.92, rgb = null) {
      ops.push(
        rgb ? `${rgb[0]} ${rgb[1]} ${rgb[2]} rg` : `${gray} g`,
        `${x.toFixed(2)} ${(size.h - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`,
      );
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

    /** The four sides of a box, as one stroked rectangle. */
    rect(x, y, w, h, { gray = 0.75, weight = 0.6 } = {}) {
      ops.push(
        `${gray} G`, `${weight} w`,
        `${x.toFixed(2)} ${(size.h - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`,
      );
      return doc;
    },

    /** Wrapped paragraph. Returns the y it ended at. */
    paragraph(str, x, y, w, { size: fs = 10, bold = false, leading = 1.35, gray = 0.15 } = {}) {
      let cy = y;
      for (const line of doc.wrap(str, w, fs, bold)) {
        doc.text(line, x, cy, { size: fs, bold, gray });
        cy += fs * leading;
      }
      return cy;
    },

    blob() {
      if (ops.length) { pages.push(ops.join('\n')); ops = []; }
      return build(pages, size, images, faces);
    },
  };

  return doc;
}

/* ── Assembly ───────────────────────────────────────────────────
   Object numbers are handed out in the order the objects will be
   written, because the xref table needs a byte offset for each and
   the file is measured as it is assembled rather than joined at the
   end. Image and font data are binary and can be tens of kilobytes,
   so they are carried as bytes rather than turned into a string and
   back. */

/* Enough of a CMap for a viewer to give back the characters a
   reader selects — without it, copying a figure out of the
   quotation yields glyph numbers. One entry per glyph; where two
   characters share a glyph the first one wins, which is only ever
   a space and a non-breaking space. */
function toUnicodeCMap(font) {
  const seen = new Set();
  const pairs = [];
  for (const cp of Object.keys(font.cmap)) {
    const gid = font.cmap[cp];
    if (!gid || seen.has(gid)) continue;
    seen.add(gid);
    pairs.push([gid, Number(cp)]);
  }
  pairs.sort((a, b) => a[0] - b[0]);

  const hex = (n) => n.toString(16).padStart(4, '0');
  const blocks = [];
  for (let i = 0; i < pairs.length; i += 100) {
    const part = pairs.slice(i, i + 100);
    blocks.push(`${part.length} beginbfchar\n`
      + part.map(([gid, cp]) => `<${hex(gid)}> <${hex(cp)}>`).join('\n')
      + '\nendbfchar');
  }

  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${blocks.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

function build(pages, size, images = [], faces = null) {
  const chunks = [];
  let length = 0;
  const offsets = [];

  const put = (str) => {
    chunks.push(str);
    length += str.length;      // Latin-1: one char, one byte.
  };
  const putBytes = (bytes) => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    put(`${n} 0 obj\n${body}\nendobj\n`);
  };
  const streamObj = (n, dict, bytes) => {
    offsets[n] = length;
    put(`${n} 0 obj\n${dict}\nstream\n`);
    putBytes(bytes);
    put('\nendstream\nendobj\n');
  };

  let next = 1;
  const alloc = () => { next += 1; return next - 1; };

  const catalogNo = alloc();
  const pagesNo = alloc();

  /* One font object per weight either way; an embedded face needs
     four more behind it — the CID font, its descriptor, the subset
     itself and the ToUnicode map. */
  const fontNos = { F1: alloc(), F2: alloc() };
  const embeds = [faces.regular, faces.bold]
    .filter((f) => f.embedded)
    .map((face) => ({
      face,
      font: face.embedded,
      bytes: base64ToBytes(face.embedded.data),
      type0: fontNos[face.res],
      cid: alloc(),
      desc: alloc(),
      file: alloc(),
      toUni: alloc(),
    }));

  const imageNos = images.map(() => alloc());
  const count = pages.length || 1;
  const pageNos = Array.from({ length: count }, () => ({ page: alloc(), content: alloc() }));

  // Every page offers every image. A quotation carries a handful of
  // thumbnails, so the alternative — tracking which page used which —
  // costs more code than the dictionary entries save.
  const xobjects = images.length
    ? `/XObject << ${images.map((_, i) => `/Im${i} ${imageNos[i]} 0 R`).join(' ')} >>`
    : '';
  const fontRes = `/Font << /F1 ${fontNos.F1} 0 R /F2 ${fontNos.F2} 0 R >>`;

  put('%PDF-1.4\n');
  obj(catalogNo, `<< /Type /Catalog /Pages ${pagesNo} 0 R >>`);
  obj(pagesNo, `<< /Type /Pages /Kids [${pageNos.map((p) => `${p.page} 0 R`).join(' ')}] /Count ${count} >>`);

  if (!embeds.length) {
    obj(fontNos.F1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(fontNos.F2, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  }

  for (const e of embeds) {
    const f = e.font;
    obj(e.type0,
      `<< /Type /Font /Subtype /Type0 /BaseFont /${f.name} /Encoding /Identity-H `
      + `/DescendantFonts [${e.cid} 0 R] /ToUnicode ${e.toUni} 0 R >>`);
    obj(e.cid,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${f.name} `
      + '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> '
      + `/FontDescriptor ${e.desc} 0 R /DW 1000 /W [0 [${f.widths.join(' ')}]] /CIDToGIDMap /Identity >>`);
    obj(e.desc,
      `<< /Type /FontDescriptor /FontName /${f.name} /Flags ${f.flags} `
      + `/FontBBox [${f.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${f.ascent} /Descent ${f.descent} `
      + `/CapHeight ${f.capHeight} /StemV ${f.stemV} /FontFile2 ${e.file} 0 R >>`);
    streamObj(e.file, `<< /Length ${e.bytes.length} /Length1 ${e.bytes.length} >>`, e.bytes);
    const cmap = toUnicodeCMap(f);
    obj(e.toUni, `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
  }

  images.forEach((img, i) => {
    streamObj(imageNos[i],
      `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} `
      + `/ColorSpace /${img.space || 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode `
      + `/Length ${img.bytes.length} >>`,
      img.bytes);
  });

  (pages.length ? pages : ['']).forEach((content, i) => {
    const { page, content: contentNo } = pageNos[i];
    obj(page,
      `<< /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 ${size.w.toFixed(2)} ${size.h.toFixed(2)}] `
      + `/Resources << ${fontRes} ${xobjects} >> /Contents ${contentNo} 0 R >>`);
    obj(contentNo, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  const total = next;
  const xrefAt = length;
  put(`xref\n0 ${total}\n`);
  put('0000000000 65535 f \n');
  for (let n = 1; n < total; n += 1) {
    put(`${String(offsets[n] || 0).padStart(10, '0')} 00000 n \n`);
  }
  put(`trailer\n<< /Size ${total} /Root ${catalogNo} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

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
