// Constant-time comparison for secrets (service key, tokens, MACs). Length differences are folded into the
// result instead of returning early, so timing does not reveal how much of a guess matched.
export function safeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  return safeEqualBytes(enc.encode(a), enc.encode(b));
}
