// Pure key rules for diagnostic logs in R2 (D2). `diag/<yyyy-mm-dd>/<random>.log`,
// kept 30 days. The date in the key is what the purge reads, so no object
// listing metadata or DB row is needed to know what is expired.

export const DIAG_PREFIX = 'diag/';
export const DIAG_RETENTION_DAYS = 30;
/** Largest log accepted from a client; bigger text is cut (marker line appended). */
export const MAX_LOG_BYTES = 256 * 1024;

export function diagKey(now: Date, random: string): string {
  if (!/^[0-9a-f]{16,64}$/.test(random)) throw new Error('diag key random must be 16-64 hex chars');
  return `${DIAG_PREFIX}${now.toISOString().slice(0, 10)}/${random}.log`;
}

export function randomHex(bytes = 16): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Day the object was written, from its key; null for a key that is not a diag log. */
export function diagKeyDate(key: string): Date | null {
  const m = /^diag\/(\d{4}-\d{2}-\d{2})\/[0-9a-f]{16,64}\.log$/.exec(key);
  if (!m) return null;
  const d = new Date(`${m[1]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isExpired(key: string, now: Date, days = DIAG_RETENTION_DAYS): boolean {
  const d = diagKeyDate(key);
  return d != null && now.getTime() - d.getTime() > days * 86_400_000;
}

/** ISO instant after which the object may be deleted (written into the object metadata). */
export function expiresAt(now: Date, days = DIAG_RETENTION_DAYS): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

/** Cut to MAX_LOG_BYTES on a character boundary; reports the original size. */
export function capLog(text: string, max = MAX_LOG_BYTES): { text: string; bytes: number; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= max) return { text, bytes: bytes.length, truncated: false };
  // A character cut in half decodes to U+FFFD at the end, which is dropped.
  const cut = new TextDecoder().decode(bytes.subarray(0, max)).replace(/�+$/, '');
  return { text: cut + '\n[truncated]', bytes: bytes.length, truncated: true };
}
