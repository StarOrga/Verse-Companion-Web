// SHA-256 of a string, synchronous.
//
// The translation memory is keyed by the hash of the English text, so a walk over the table hashes
// every string: ~5 000 per slice. `crypto.subtle.digest` is an async call per string - a task on
// another thread and a trip through the event loop each time - and that overhead, not the hashing,
// was most of a slice's CPU (measured 2026-11-17: 200-750 ms for the strings of 8 shards, against
// under 40 ms here). Strings are short (two or three blocks), which is the case a plain loop wins.
//
// The digest is the standard one: a test pins it against `crypto.subtle` (_pure.test.mjs).

/** First 32 bits of the fractional part of the n-th root of the first primes (FIPS 180-4, 4.2.2 and 5.3.3). */
function primeRoots(count: number, root: (p: number) => number): Uint32Array {
  const out = new Uint32Array(count);
  let n = 0;
  for (let p = 2; n < count; p++) {
    let prime = true;
    for (let d = 2; d * d <= p; d++) if (p % d === 0) { prime = false; break; }
    if (!prime) continue;
    const r = root(p);
    out[n++] = Math.floor((r - Math.floor(r)) * 0x100000000);
  }
  return out;
}

const K = primeRoots(64, Math.cbrt);
const H = primeRoots(8, Math.sqrt);
const W = new Int32Array(64);
const ENC = new TextEncoder();
const BYTE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

const word = (w: number) => BYTE[(w >>> 24) & 255] + BYTE[(w >>> 16) & 255] + BYTE[(w >>> 8) & 255] + BYTE[w & 255];

export function sha256HexSync(s: string): string {
  const msg = ENC.encode(s);
  const len = msg.length;
  // Message, one 0x80 byte, zeros, the bit length as 64 bits big-endian: a multiple of 64 bytes.
  const total = ((len + 9 + 63) >>> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor((len * 8) / 0x100000000));
  view.setUint32(total - 4, (len * 8) >>> 0);

  let h0 = H[0] | 0, h1 = H[1] | 0, h2 = H[2] | 0, h3 = H[3] | 0, h4 = H[4] | 0, h5 = H[5] | 0, h6 = H[6] | 0, h7 = H[7] | 0;
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getInt32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15];
      const y = W[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return word(h0) + word(h1) + word(h2) + word(h3) + word(h4) + word(h5) + word(h6) + word(h7);
}
