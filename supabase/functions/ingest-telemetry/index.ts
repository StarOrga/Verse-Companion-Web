// supabase/functions/ingest-telemetry
// ---------------------------------------------------------------
// Anonymous crash + opt-in usage telemetry ingest for every desktop client
// (StarOrga/Star-Citizen-Companion-App#21). Wire contract v1.
//
// PRODUCTS — one endpoint, one PostHog project, one signature scheme for all of them:
//   scc-app       — the main Verse Companion desktop app
//   data-uploader — the P4K extraction & upload tool (Electron)
//   starscape     — the native Windows wallpaper/screensaver tray app (Rust)
// `product` on the wire is what separates them in the admin dashboard.
//
// AUTH — no JWT (verify_jwt = false). The desktop app is an unauthenticated
// machine client; this function does its own HMAC auth:
//   X-SCC-Signature = hex HMAC-SHA256 over `${X-SCC-Timestamp}.${rawBody}`
//   key = env TELEMETRY_HMAC_KEY — no fallback (AUD-114): without it (or
//   without TELEMETRY_HASH_SALT) every request gets 503. TELEMETRY_DEV=1 opts
//   a local stack into the public dev key/salt; set it in
//   supabase/functions/.env (gitignored), which `supabase functions serve`
//   loads by itself — supabase/.env is NOT read by functions serve.
// Replay guard: |now - timestamp| must be <= 10 min.
//
// FORWARD — since the PostHog single-source switch (concept 20261115-0211-posthog-audit)
// nothing is stored in our own database: the validated batch goes to PostHog
// (_shared/posthog.ts captureBatch, mapping in _forward.ts). Crashes become
// `$exception` (source 'desktop'), usage becomes `desktop:usage_metric`.
// distinct_id = the salted install hash, `$process_person_profile: false`.
// A job-diagnostics transcript is uploaded to R2 under diag/<yyyy-mm-dd>/ (30
// days, _shared/diag-log.ts) and the event carries log_url + log_bytes.
//
// PRIVACY — no PII leaves this function. installId/sessionId and the caller IP
// exist only as salted SHA-256 hashes (the IP hash is only the rate-limit key,
// it is not forwarded); free text is redacted and truncated again server-side.
//
// Responses: 204 accepted · 400 bad payload · 401 bad/old signature ·
//            429 rate-limited (Retry-After) · 500 server error ·
//            503 server misconfigured (secrets missing).

import { resolveTelemetrySecrets } from './_config.ts';
import { RateLimiter, clamp, isJobDiagnostics, logTextOf, mapEvent, type StoredLogRef, type WireContext } from './_forward.ts';
import { clientIp } from '../_shared/client-ip.ts';
import { safeEqual } from '../_shared/safe-equal.ts';
import { captureBatch, withPosthog, type BatchEvent } from '../_shared/posthog.ts';
import { diagR2, purgeExpiredDiagLogs, uploadDiagLog } from '../_shared/diag-log.ts';
import type { R2Config } from '../ingest-skins/_r2.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'content-type, x-scc-version, x-scc-timestamp, x-scc-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

const REPLAY_WINDOW_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;
const limiter = new RateLimiter();
const MAX_BATCH = 200;
const SECRETS = resolveTelemetrySecrets((k) => Deno.env.get(k));
if (!SECRETS.ok) {
  console.error(`[ingest-telemetry] missing secrets: ${SECRETS.missing.join(', ')}, refusing all events`);
} else if (SECRETS.dev) {
  console.warn('[ingest-telemetry] TELEMETRY_DEV=1 — dev key active');
}

const enc = new TextEncoder();

async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ROLES = new Set(['host', 'daemon', 'overlay', 'desktop', 'renderer']);
// 'alpha' exists because Starscape ships stable/beta/ALPHA rings. Without it an
// alpha install would be normalised to 'dev' below and the ring signal lost.
const CHANNELS = new Set(['stable', 'beta', 'alpha', 'dev']);
// Every reporting client (the `product` property of the forwarded events).
const PRODUCTS = new Set(['scc-app', 'data-uploader', 'starscape']);

let lastPurge = 0;
/** R2 retention (D2): at most once a day per isolate, never blocks the response. */
function purgeOncePerDay(r2: R2Config): void {
  if (Date.now() - lastPurge < 24 * 3600_000) return;
  lastPurge = Date.now();
  purgeExpiredDiagLogs(r2).catch((e) => console.warn(`[ingest-telemetry] diag purge failed: ${(e as Error).message}`));
}

Deno.serve(withPosthog('ingest-telemetry', async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!SECRETS.ok) return json({ error: 'server_misconfigured' }, 503);

  // --- read RAW body first (HMAC must cover the exact bytes the client signed) ---
  const declaredLen = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
  const rawBody = await req.text();
  if (enc.encode(rawBody).byteLength > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
  const ts = req.headers.get('x-scc-timestamp') ?? '';
  const sig = req.headers.get('x-scc-signature') ?? '';

  // --- replay window ---
  const tsNum = Number(ts);
  if (!ts || Number.isNaN(tsNum) || Math.abs(Date.now() - tsNum) > REPLAY_WINDOW_MS) {
    return json({ error: 'stale_or_missing_timestamp' }, 401);
  }

  // --- HMAC verify ---
  const expected = await hmacHex(SECRETS.hmacKey, `${ts}.${rawBody}`);
  if (!sig || !safeEqual(expected, sig.toLowerCase())) {
    return json({ error: 'bad_signature' }, 401);
  }

  // --- parse + validate wire body ---
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const type = String(body.type ?? '');
  const events = body.events;
  if ((type !== 'crash' && type !== 'usage') || !Array.isArray(events) || events.length === 0) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (events.length > MAX_BATCH) {
    return json({ error: 'batch_too_large' }, 400);
  }

  // --- anonymous, salted identifiers ---
  const ipRaw = clientIp(req);
  const ipHash = await sha256Hex(`${SECRETS.hashSalt}:ip:${ipRaw}`);
  const sessionHash = body.sessionId ? await sha256Hex(`${SECRETS.hashSalt}:s:${body.sessionId}`) : null;
  const installHash = body.installId ? await sha256Hex(`${SECRETS.hashSalt}:i:${body.installId}`) : null;

  // --- per-IP rate limit (per isolate, see _forward.ts) ---
  if (!limiter.take(ipHash, events.length)) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '600', ...CORS },
    });
  }

  const appVersion = clamp(body.appVersion, 40) ?? 'unknown';
  const channel = CHANNELS.has(String(body.channel)) ? String(body.channel) : 'dev';
  const role = ROLES.has(String(body.role)) ? String(body.role) : null;
  // product identifies the sending client (scc-app | data-uploader | starscape).
  // Unknown / absent → null (legacy readers coalesce NULL to 'scc-app').
  const product = PRODUCTS.has(String(body.product)) ? String(body.product) : null;

  const ctx: WireContext = {
    type: type as 'crash' | 'usage',
    appVersion,
    buildId: clamp(body.buildId, 80),
    channel,
    product,
    os: clamp(body.os, 20),
    osRelease: clamp(body.osRelease, 40),
    arch: clamp(body.arch, 20),
    role,
    installHash,
    sessionHash,
    now: new Date().toISOString(),
  };

  // D2: a job-diagnostics transcript goes to R2 (30 days); the event keeps only the reference.
  const r2 = diagR2();
  const batch: BatchEvent[] = [];
  for (const raw of events as Record<string, unknown>[]) {
    const ev = raw && typeof raw === 'object' ? raw : {};
    let log: StoredLogRef | null = null;
    const text = isJobDiagnostics(type, ev) ? logTextOf(ev) : null;
    if (text && r2) {
      try {
        log = await uploadDiagLog(r2, text);
      } catch (err) {
        console.warn(`[ingest-telemetry] diag log upload failed: ${(err as Error).message}`);
      }
    }
    batch.push(mapEvent(ctx, ev, log));
  }
  await captureBatch(batch);
  if (r2) purgeOncePerDay(r2);

  return new Response(null, { status: 204, headers: CORS });
}));
