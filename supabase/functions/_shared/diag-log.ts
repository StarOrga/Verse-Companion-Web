// Diagnostic logs of desktop runs in Cloudflare R2 (D2). Reuses the S3/SigV4
// client of ingest-skins (same R2_* secrets, same bucket). Keys live under
// `diag/` which the public assets Worker does NOT serve, so a log is only
// reachable through a presigned URL (`presignDiagLog`) minted for an admin.
//
// Retention 30 days, two layers: the date is in the key and `purgeExpiredDiagLogs`
// deletes older objects (ingest-telemetry runs it at most once a day per
// isolate); an R2 lifecycle rule "delete objects with prefix diag/ after 30
// days" in the Cloudflare dashboard is the belt to these braces.

import { deleteObject, listObjects, r2FromEnv, type R2Config } from '../ingest-skins/_r2.ts';
import { DIAG_PREFIX, DIAG_RETENTION_DAYS, capLog, diagKey, expiresAt, isExpired, randomHex } from './diag-key.ts';

const PUT_TIMEOUT_MS = 15_000;

export function diagR2(): R2Config | null {
  return r2FromEnv((k) => Deno.env.get(k));
}

export interface StoredLog { key: string; url: string; bytes: number; truncated: boolean }

/** Upload one log. `url` is the stable reference `r2://<bucket>/<key>`, not a public link. */
export async function uploadDiagLog(cfg: R2Config, text: string, now = new Date()): Promise<StoredLog> {
  const capped = capLog(text);
  const key = diagKey(now, randomHex(16));
  const res = await cfg.client.fetch(`https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${key}`, {
    method: 'PUT',
    body: capped.text,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-amz-meta-expires-at': expiresAt(now),
    },
    signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`R2 put diag log failed: HTTP ${res.status}`);
  }
  return { key, url: `r2://${cfg.bucket}/${key}`, bytes: capped.bytes, truncated: capped.truncated };
}

/** Time-limited GET link for one log (admin tooling; never stored in events). */
export async function presignDiagLog(cfg: R2Config, key: string, seconds = 900): Promise<string> {
  if (!key.startsWith(DIAG_PREFIX)) throw new Error('not a diag key');
  const url = new URL(`https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(seconds));
  const signed = await cfg.client.sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true } });
  return signed.url;
}

/** Delete every diag log older than the retention. Returns the number deleted. */
export async function purgeExpiredDiagLogs(cfg: R2Config, now = new Date(), days = DIAG_RETENTION_DAYS): Promise<number> {
  const objects = await listObjects(cfg, DIAG_PREFIX);
  let n = 0;
  for (const o of objects) {
    if (!isExpired(o.key, now, days)) continue;
    await deleteObject(cfg, o.key);
    n++;
  }
  return n;
}
