#!/usr/bin/env python3
"""build-fonts.py — regenerates js/fonts/montserrat-*.js.

The quotation is set in Montserrat, so the PDF writer has to carry the
font with it: PDF's standard fourteen faces are Helvetica and friends,
and none of them has a rupee sign. This pulls the two weights the
document uses from Google Fonts, cuts them down to the characters a
quotation can print, and writes each one out as an ES module holding
the subset as base64 plus the metrics pdf.js needs to set type with it
— the character-to-glyph map and the advance widths.

Run it only when the character set or the font version changes:

    pip install fonttools
    python3 tools/build-fonts.py

Montserrat is under the SIL Open Font License 1.1; the licence travels
with the subsets in assets/OFL-Montserrat.txt.
"""

import base64
import io
import os
import re
import subprocess
import sys
import urllib.parse

from fontTools.ttLib import TTFont
from fontTools.subset import Options, Subsetter

# Latin-1 and Latin Extended-A cover the names and addresses that turn
# up on a quotation; the rest is the punctuation and the currency marks
# the boilerplate and the money columns actually use.
WANTED = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x100))
    + list(range(0x100, 0x180))
    + [0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E,
       0x2022, 0x2026, 0x2039, 0x203A, 0x2044, 0x20AC, 0x20B9, 0x2122,
       0x2212, 0x25CF]
)

# Google Fonts serves woff2 to anything modern and plain TrueType to
# what came before it, and TrueType is the one format PDF can embed.
OLD_UA = ('Mozilla/5.0 (Linux; U; Android 2.2; en-us; DROID2 Build/VZW) '
          'AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1')

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, os.pardir, 'js', 'fonts')

NOTE = """/* fonts/montserrat-{slug}.js — Montserrat {style}, subset to the
   characters a quotation can print, as base64 TrueType.

   The document is set in Montserrat because that is what the
   business's own quotations have always been set in, and because
   WinAnsi's Helvetica has no rupee sign — every figure on the page
   needs one. The subset is Latin-1 plus Latin Extended-A, the
   typographic punctuation the boilerplate uses, and the currency
   marks; anything outside it falls back to a transliteration in
   pdf.js rather than a blank.

   Generated from Google Fonts' Montserrat (SIL Open Font License
   1.1) — see assets/OFL-Montserrat.txt. Regenerate with
   tools/build-fonts.py. Do not edit by hand. */"""


def fetch(weight, chars):
    """The TrueType subset Google Fonts builds for exactly `chars`."""
    url = ('https://fonts.googleapis.com/css?family=Montserrat:%d&text=%s'
           % (weight, urllib.parse.quote(chars, safe='')))
    css = subprocess.run(['curl', '-sS', '--max-time', '60', '-A', OLD_UA, url],
                         capture_output=True, text=True, check=True).stdout
    found = re.search(r'url\((https://[^)]+)\)', css)
    if not found:
        sys.exit('Google Fonts returned no font URL:\n%s' % css[:400])
    return subprocess.run(['curl', '-sS', '--max-time', '120', '-A', OLD_UA, found.group(1)],
                          capture_output=True, check=True).stdout


def trim(raw):
    """Everything a static PDF does not need, dropped."""
    opts = Options()
    opts.drop_tables += ['GSUB', 'GPOS', 'GDEF', 'STAT', 'gasp', 'DSIG', 'FFTM',
                         'VDMX', 'LTSH', 'hdmx', 'kern', 'fpgm', 'prep', 'cvt ']
    opts.hinting = False
    opts.desubroutinize = True
    opts.glyph_names = False
    opts.notdef_outline = False
    opts.layout_features = []
    opts.name_IDs = [1, 2, 6]
    opts.name_legacy = False
    opts.legacy_kern = False
    font = TTFont(io.BytesIO(raw))
    cut = Subsetter(options=opts)
    cut.populate(unicodes=WANTED)
    cut.subset(font)
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


def measure(data, weight):
    """The map and the metrics pdf.js sets type with."""
    font = TTFont(io.BytesIO(data))
    order = font.getGlyphOrder()
    gid = {name: i for i, name in enumerate(order)}
    cmap = {cp: gid[name] for cp, name in font.getBestCmap().items() if name in gid}
    # PDF's glyph space is 1/1000 em whatever the font's own head says.
    em = 1000 / font['head'].unitsPerEm
    widths = [0] * len(order)
    for name, i in gid.items():
        widths[i] = int(round(font['hmtx'][name][0] * em))
    head, os2, hhea = font['head'], font['OS/2'], font['hhea']
    return cmap, widths, {
        'numGlyphs': len(order),
        'ascent': int(round(hhea.ascent * em)),
        'descent': int(round(hhea.descent * em)),
        'capHeight': int(round(getattr(os2, 'sCapHeight', 700) * em)),
        'bbox': [int(round(v * em)) for v in (head.xMin, head.yMin, head.xMax, head.yMax)],
        # Non-symbolic, and italic is never one of these two.
        'flags': (1 << 5) | ((1 << 18) if weight >= 600 else 0),
        'stemV': 80 if weight < 600 else 140,
    }


def emit(path, style, data, cmap, widths, meta):
    b64 = base64.b64encode(data).decode('ascii')
    wrapped = "'" + "'\n  + '".join(b64[i:i + 96] for i in range(0, len(b64), 96)) + "'"
    with open(path, 'w') as out:
        out.write(NOTE.format(slug=style.lower(), style=style) + '\n')
        out.write('export default {\n')
        out.write("  name: 'Montserrat-%s',\n" % style)
        for key in ('flags', 'ascent', 'descent', 'capHeight', 'stemV', 'numGlyphs'):
            out.write('  %s: %s,\n' % (key, meta[key]))
        out.write('  bbox: [%s],\n' % ', '.join(str(v) for v in meta['bbox']))
        out.write('  /* Unicode code point -> glyph id, for the subset below. */\n')
        out.write('  cmap: {%s},\n' % ','.join('%d:%d' % kv for kv in sorted(cmap.items())))
        out.write('  /* Advance width per glyph id, 1/1000 em. */\n')
        out.write('  widths: [%s],\n' % ','.join(str(w) for w in widths))
        out.write('  /* The subset itself. Decoded once, on the first document. */\n')
        out.write('  data: %s,\n' % wrapped)
        out.write('};\n')
    print('%s — %d glyphs, %d font bytes' % (os.path.relpath(path), meta['numGlyphs'], len(data)))


def main():
    chars = ''.join(chr(c) for c in WANTED)
    for weight, style in ((400, 'Regular'), (700, 'Bold')):
        data = trim(fetch(weight, chars))
        cmap, widths, meta = measure(data, weight)
        emit(os.path.join(OUT, 'montserrat-%s.js' % style.lower()), style, data, cmap, widths, meta)


if __name__ == '__main__':
    main()
