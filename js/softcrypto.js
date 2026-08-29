/* PBKDF2-SHA256 and AES-256-GCM in plain JavaScript.
 *
 * WebCrypto does all of this, faster and in constant time, and is
 * what the app uses whenever it is there. But `crypto.subtle` only
 * exists on a secure context: open the app over plain http, or from
 * inside a sandboxed frame with an opaque origin, and it is simply
 * undefined. That is not a reason for the quotation history to be
 * unopenable, so this stands in.
 *
 * It is used for one thing — decrypting a file that shipped with the
 * app, on the reader's own machine — where the timing side channels
 * that rule table-driven AES out of serious use do not apply: there
 * is no attacker positioned to measure them, and the key is derived
 * from a passphrase the reader typed. Do not reach for this anywhere
 * a secret has to survive an adversary who can watch it run.
 */

/* ── SHA-256 ─────────────────────────────────────────────────── */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/* The message schedule, reused across every block so the hot path in
   PBKDF2 allocates nothing. */
const W = new Uint32Array(64);

function compress(h, block, off) {
  for (let i = 0; i < 16; i += 1) {
    W[i] = (block[off + i * 4] << 24) | (block[off + i * 4 + 1] << 16)
      | (block[off + i * 4 + 2] << 8) | block[off + i * 4 + 3];
  }
  for (let i = 16; i < 64; i += 1) {
    const a = W[i - 15];
    const b = W[i - 2];
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }

  let a = h[0]; let b = h[1]; let c = h[2]; let d = h[3];
  let e = h[4]; let f = h[5]; let g = h[6]; let x = h[7];

  for (let i = 0; i < 64; i += 1) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (x + S1 + ch + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    x = g; g = f; f = e; e = (d + t1) | 0;
    d = c; c = b; b = a; a = (t1 + t2) | 0;
  }

  h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
  h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + x) | 0;
}

function words(h, out) {
  for (let i = 0; i < 8; i += 1) {
    out[i * 4] = h[i] >>> 24; out[i * 4 + 1] = (h[i] >>> 16) & 255;
    out[i * 4 + 2] = (h[i] >>> 8) & 255; out[i * 4 + 3] = h[i] & 255;
  }
  return out;
}

export function sha256(msg) {
  const len = msg.length;
  const total = (((len + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const bits = len * 8;
  // Lengths here are far below 2^32 bits, so the high word stays zero.
  buf[total - 4] = (bits >>> 24) & 255; buf[total - 3] = (bits >>> 16) & 255;
  buf[total - 2] = (bits >>> 8) & 255; buf[total - 1] = bits & 255;

  const h = H0.slice();
  for (let off = 0; off < total; off += 64) compress(h, buf, off);
  return words(h, new Uint8Array(32));
}

/* ── HMAC-SHA256, kept in a form PBKDF2 can hammer ─────────────── */

/* The inner and outer blocks depend only on the key, and PBKDF2 uses
   one key for the whole derivation — so both are prepared once and
   only their message halves are rewritten per iteration. */
function hmacKey(key) {
  const k = key.length > 64 ? sha256(key) : key;
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  ipad.set(k); opad.set(k);
  for (let i = 0; i < 64; i += 1) { ipad[i] ^= 0x36; opad[i] ^= 0x5c; }
  return { ipad, opad };
}

/* HMAC of a message that is exactly 32 bytes — the shape every PBKDF2
   iteration after the first has. Both hashes are then a fixed two
   blocks, so the padding can be laid down once. */
function hmac32(hk, msg, out) {
  const inner = new Uint8Array(128);
  inner.set(hk.ipad);
  inner.set(msg, 64);
  inner[96] = 0x80;
  inner[126] = 0x03; // (64 + 32) * 8 = 768 bits
  const h = H0.slice();
  compress(h, inner, 0); compress(h, inner, 64);

  const outer = new Uint8Array(128);
  outer.set(hk.opad);
  words(h, out);
  outer.set(out, 64);
  outer[96] = 0x80;
  outer[126] = 0x03;
  const h2 = H0.slice();
  compress(h2, outer, 0); compress(h2, outer, 64);
  return words(h2, out);
}

function hmac(hk, msg) {
  const inner = new Uint8Array(64 + msg.length);
  inner.set(hk.ipad); inner.set(msg, 64);
  const mid = sha256(inner);
  const outer = new Uint8Array(96);
  outer.set(hk.opad); outer.set(mid, 64);
  return sha256(outer);
}

/* ── PBKDF2-SHA256 ────────────────────────────────────────────── */

export function pbkdf2(passphrase, salt, iterations, bytes, onProgress) {
  const hk = hmacKey(passphrase);
  const blocks = Math.ceil(bytes / 32);
  const out = new Uint8Array(blocks * 32);
  const total = blocks * iterations;
  let done = 0;

  for (let b = 1; b <= blocks; b += 1) {
    const seed = new Uint8Array(salt.length + 4);
    seed.set(salt);
    seed[salt.length] = (b >>> 24) & 255; seed[salt.length + 1] = (b >>> 16) & 255;
    seed[salt.length + 2] = (b >>> 8) & 255; seed[salt.length + 3] = b & 255;

    let u = hmac(hk, seed);
    const acc = u.slice();
    for (let i = 1; i < iterations; i += 1) {
      u = hmac32(hk, u, u);
      for (let j = 0; j < 32; j += 1) acc[j] ^= u[j];
      done += 1;
      if (onProgress && (done & 0x3fff) === 0) onProgress(done / total);
    }
    out.set(acc, (b - 1) * 32);
  }
  return out.subarray(0, bytes);
}

/* ── AES-256 ──────────────────────────────────────────────────── */

const SBOX = new Uint8Array(256);
const T = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];

(function tables() {
  const xt = (a) => ((a << 1) ^ ((a & 0x80) ? 0x11b : 0)) & 0xff;
  // Build the S-box from the multiplicative inverse, the usual walk
  // through the field's generator so no 256-byte literal is needed.
  const log = new Uint8Array(256);
  const alog = new Uint8Array(256);
  let a = 1;
  for (let i = 0; i < 255; i += 1) {
    alog[i] = a; log[a] = i;
    a ^= xt(a);
  }
  for (let i = 0; i < 256; i += 1) {
    // log[1] is 0, so the exponent wraps rather than running off the end.
    const inv = i === 0 ? 0 : alog[(255 - log[i]) % 255];
    let s = inv;
    let x = inv;
    for (let j = 0; j < 4; j += 1) {
      x = ((x << 1) | (x >>> 7)) & 0xff;
      s ^= x;
    }
    s ^= 0x63;
    SBOX[i] = s;
    const s2 = xt(s);
    const s3 = s2 ^ s;
    T[0][i] = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
    T[1][i] = ((s3 << 24) | (s2 << 16) | (s << 8) | s) >>> 0;
    T[2][i] = ((s << 24) | (s3 << 16) | (s2 << 8) | s) >>> 0;
    T[3][i] = ((s << 24) | (s << 16) | (s3 << 8) | s2) >>> 0;
  }
}());

function expandKey(key) {
  const nk = key.length / 4;
  const rounds = nk + 6;
  const w = new Uint32Array((rounds + 1) * 4);
  for (let i = 0; i < nk; i += 1) {
    w[i] = ((key[i * 4] << 24) | (key[i * 4 + 1] << 16)
      | (key[i * 4 + 2] << 8) | key[i * 4 + 3]) >>> 0;
  }
  let rcon = 1;
  for (let i = nk; i < w.length; i += 1) {
    let t = w[i - 1];
    if (i % nk === 0) {
      t = ((t << 8) | (t >>> 24)) >>> 0;
      t = ((SBOX[(t >>> 24) & 255] << 24) | (SBOX[(t >>> 16) & 255] << 16)
        | (SBOX[(t >>> 8) & 255] << 8) | SBOX[t & 255]) >>> 0;
      t = (t ^ (rcon << 24)) >>> 0;
      rcon = ((rcon << 1) ^ ((rcon & 0x80) ? 0x11b : 0)) & 0xff;
    } else if (nk > 6 && i % nk === 4) {
      t = ((SBOX[(t >>> 24) & 255] << 24) | (SBOX[(t >>> 16) & 255] << 16)
        | (SBOX[(t >>> 8) & 255] << 8) | SBOX[t & 255]) >>> 0;
    }
    w[i] = (w[i - nk] ^ t) >>> 0;
  }
  return { w, rounds };
}

/* One block, encrypt only — GCM never needs the inverse cipher. */
function encryptBlock(ks, inp, out) {
  const { w, rounds } = ks;
  let s0 = (((inp[0] << 24) | (inp[1] << 16) | (inp[2] << 8) | inp[3]) ^ w[0]) >>> 0;
  let s1 = (((inp[4] << 24) | (inp[5] << 16) | (inp[6] << 8) | inp[7]) ^ w[1]) >>> 0;
  let s2 = (((inp[8] << 24) | (inp[9] << 16) | (inp[10] << 8) | inp[11]) ^ w[2]) >>> 0;
  let s3 = (((inp[12] << 24) | (inp[13] << 16) | (inp[14] << 8) | inp[15]) ^ w[3]) >>> 0;

  for (let r = 1; r < rounds; r += 1) {
    const k = r * 4;
    const t0 = (T[0][s0 >>> 24] ^ T[1][(s1 >>> 16) & 255] ^ T[2][(s2 >>> 8) & 255] ^ T[3][s3 & 255] ^ w[k]) >>> 0;
    const t1 = (T[0][s1 >>> 24] ^ T[1][(s2 >>> 16) & 255] ^ T[2][(s3 >>> 8) & 255] ^ T[3][s0 & 255] ^ w[k + 1]) >>> 0;
    const t2 = (T[0][s2 >>> 24] ^ T[1][(s3 >>> 16) & 255] ^ T[2][(s0 >>> 8) & 255] ^ T[3][s1 & 255] ^ w[k + 2]) >>> 0;
    const t3 = (T[0][s3 >>> 24] ^ T[1][(s0 >>> 16) & 255] ^ T[2][(s1 >>> 8) & 255] ^ T[3][s2 & 255] ^ w[k + 3]) >>> 0;
    s0 = t0; s1 = t1; s2 = t2; s3 = t3;
  }

  const k = rounds * 4;
  const fin = (x, y, z, q, kk) => (((SBOX[x >>> 24] << 24) | (SBOX[(y >>> 16) & 255] << 16)
    | (SBOX[(z >>> 8) & 255] << 8) | SBOX[q & 255]) ^ w[kk]) >>> 0;
  const o0 = fin(s0, s1, s2, s3, k);
  const o1 = fin(s1, s2, s3, s0, k + 1);
  const o2 = fin(s2, s3, s0, s1, k + 2);
  const o3 = fin(s3, s0, s1, s2, k + 3);
  const put = (v, i) => {
    out[i] = v >>> 24; out[i + 1] = (v >>> 16) & 255;
    out[i + 2] = (v >>> 8) & 255; out[i + 3] = v & 255;
  };
  put(o0, 0); put(o1, 4); put(o2, 8); put(o3, 12);
}

/* ── GHASH ────────────────────────────────────────────────────── */

/* Multiplication in GF(2^128) against the fixed key H, via the
   four-bit table the reference implementations use. */
function ghashTable(H) {
  const tbl = new Array(16);
  const zero = new Uint32Array(4);
  tbl[0] = zero;
  const h = new Uint32Array([
    ((H[0] << 24) | (H[1] << 16) | (H[2] << 8) | H[3]) >>> 0,
    ((H[4] << 24) | (H[5] << 16) | (H[6] << 8) | H[7]) >>> 0,
    ((H[8] << 24) | (H[9] << 16) | (H[10] << 8) | H[11]) >>> 0,
    ((H[12] << 24) | (H[13] << 16) | (H[14] << 8) | H[15]) >>> 0,
  ]);
  tbl[8] = h;
  for (let i = 4; i > 0; i >>= 1) {
    const v = tbl[i * 2];
    const n = new Uint32Array(4);
    const lsb = v[3] & 1;
    n[3] = ((v[3] >>> 1) | (v[2] << 31)) >>> 0;
    n[2] = ((v[2] >>> 1) | (v[1] << 31)) >>> 0;
    n[1] = ((v[1] >>> 1) | (v[0] << 31)) >>> 0;
    n[0] = (v[0] >>> 1) >>> 0;
    if (lsb) n[0] = (n[0] ^ 0xe1000000) >>> 0;
    tbl[i] = n;
  }
  for (let i = 2; i < 16; i *= 2) {
    for (let j = 1; j < i; j += 1) {
      const a = tbl[i];
      const b = tbl[j];
      tbl[i + j] = new Uint32Array([a[0] ^ b[0], a[1] ^ b[1], a[2] ^ b[2], a[3] ^ b[3]]);
    }
  }
  return tbl;
}

const R0 = new Uint16Array([
  0x0000, 0x1c20, 0x3840, 0x2460, 0x7080, 0x6ca0, 0x48c0, 0x54e0,
  0xe100, 0xfd20, 0xd940, 0xc560, 0x9180, 0x8da0, 0xa9c0, 0xb5e0,
]);

function ghashBlock(tbl, y, block, off) {
  for (let i = 0; i < 16; i += 1) y[i] ^= block[off + i];

  let z0 = 0; let z1 = 0; let z2 = 0; let z3 = 0;
  for (let i = 15; i >= 0; i -= 1) {
    for (let half = 0; half < 2; half += 1) {
      const nib = half === 0 ? (y[i] & 0x0f) : (y[i] >>> 4);
      const rem = z3 & 0x0f;
      z3 = ((z3 >>> 4) | (z2 << 28)) >>> 0;
      z2 = ((z2 >>> 4) | (z1 << 28)) >>> 0;
      z1 = ((z1 >>> 4) | (z0 << 28)) >>> 0;
      z0 = (z0 >>> 4) >>> 0;
      z0 = (z0 ^ (R0[rem] << 16)) >>> 0;
      const t = tbl[nib];
      z0 = (z0 ^ t[0]) >>> 0; z1 = (z1 ^ t[1]) >>> 0;
      z2 = (z2 ^ t[2]) >>> 0; z3 = (z3 ^ t[3]) >>> 0;
    }
  }
  const put = (v, i) => {
    y[i] = v >>> 24; y[i + 1] = (v >>> 16) & 255;
    y[i + 2] = (v >>> 8) & 255; y[i + 3] = v & 255;
  };
  put(z0, 0); put(z1, 4); put(z2, 8); put(z3, 12);
}

/* ── AES-GCM decrypt ──────────────────────────────────────────── */

/* `data` is ciphertext with the 16-byte tag appended, which is the
   shape WebCrypto both produces and expects. Returns the plaintext,
   or null if the tag does not verify — a wrong key and a tampered
   blob are indistinguishable here, as they should be. */
export function gcmDecrypt(key, iv, data) {
  const ks = expandKey(key);
  const ct = data.subarray(0, data.length - 16);
  const tag = data.subarray(data.length - 16);

  const H = new Uint8Array(16);
  encryptBlock(ks, new Uint8Array(16), H);
  const tbl = ghashTable(H);

  // A 96-bit IV is used as-is; any other length is folded through
  // GHASH first. Ours is 96-bit, but the general case is cheap.
  const j0 = new Uint8Array(16);
  if (iv.length === 12) {
    j0.set(iv);
    j0[15] = 1;
  } else {
    const pad = new Uint8Array((Math.ceil(iv.length / 16) + 1) * 16);
    pad.set(iv);
    const bits = iv.length * 8;
    pad[pad.length - 4] = (bits >>> 24) & 255; pad[pad.length - 3] = (bits >>> 16) & 255;
    pad[pad.length - 2] = (bits >>> 8) & 255; pad[pad.length - 1] = bits & 255;
    for (let o = 0; o < pad.length; o += 16) ghashBlock(tbl, j0, pad, o);
  }

  // The tag covers the ciphertext, so it is computed on the way past.
  const y = new Uint8Array(16);
  const full = Math.floor(ct.length / 16) * 16;
  for (let o = 0; o < full; o += 16) ghashBlock(tbl, y, ct, o);
  if (ct.length > full) {
    const last = new Uint8Array(16);
    last.set(ct.subarray(full));
    ghashBlock(tbl, y, last, 0);
  }
  const lens = new Uint8Array(16);
  const cbits = ct.length * 8;
  // No additional authenticated data, so the first half stays zero.
  lens[8] = (cbits / 0x100000000) & 255;
  lens[12] = (cbits >>> 24) & 255; lens[13] = (cbits >>> 16) & 255;
  lens[14] = (cbits >>> 8) & 255; lens[15] = cbits & 255;
  ghashBlock(tbl, y, lens, 0);

  const s = new Uint8Array(16);
  encryptBlock(ks, j0, s);
  let diff = 0;
  for (let i = 0; i < 16; i += 1) diff |= (y[i] ^ s[i]) ^ tag[i];
  if (diff !== 0) return null;

  // Counter mode from J0 + 1.
  const out = new Uint8Array(ct.length);
  const ctr = j0.slice();
  const blk = new Uint8Array(16);
  for (let o = 0; o < ct.length; o += 16) {
    for (let i = 15; i >= 12; i -= 1) { ctr[i] = (ctr[i] + 1) & 255; if (ctr[i]) break; }
    encryptBlock(ks, ctr, blk);
    const n = Math.min(16, ct.length - o);
    for (let i = 0; i < n; i += 1) out[o + i] = ct[o + i] ^ blk[i];
  }
  return out;
}
