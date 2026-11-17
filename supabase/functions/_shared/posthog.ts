// Server-side PostHog helper (contract §1 of the posthog-audit concept).
//
// No SDK: one fetch to the EU ingest host's /batch/. The project token is the
// PUBLIC ingest key (the same value ships in environment.prod.ts), so falling
// back to the literal is not a leak. Nothing here ever throws: a failed send is
// logged and swallowed, telemetry must not break the function it observes.
//
// Every server event is person-less (`$process_person_profile: false`) and
// carries `source: 'server'` + `function`. No IP, no user id, no prompt text.
//
// Pure module (Deno only through `globalThis.Deno?.env`) so `node --test` runs
// _shared/posthog.test.ts.

export const POSTHOG_HOST = 'https://eu.i.posthog.com';
const PUBLIC_PROJECT_TOKEN = 'phc_Am939BozLUF73xus4GT5KKEKRx44xL5syfXHZDvL97iZ';
const MAX_TEXT = 500;
const MAX_STACK = 4000;
const SEND_TIMEOUT_MS = 4000;

export interface BatchEvent {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  timestamp?: string;
}

function env(key: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const d = (globalThis as any).Deno;
  try { return d?.env?.get(key) || undefined; } catch { return undefined; }
}

export function projectToken(): string {
  return env('POSTHOG_PROJECT_TOKEN')?.trim() || PUBLIC_PROJECT_TOKEN;
}

export function serverDistinctId(fn: string): string {
  return `server:${fn}`;
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const BEARER_HEADER = /Bearer\s+[^\s'",]+/gi;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const KEY_PARAM = /([?&](?:apikey|api_key|key|token|access_token)=)[^&\s'")]+/gi;
const SECRET_LIKE = /\b(?:sk-[\w-]{16,}|sbp_\w{16,}|sb_secret_[\w-]{10,})\b/g;

/** Same intent as the web's redactErrorText, plus server secrets; capped. */
export function redactText(text: string, max = MAX_TEXT): string {
  return String(text ?? '')
    .replace(KEY_PARAM, '$1***')
    .replace(/\?[^\s'")]*/g, '')
    .replace(BEARER_HEADER, '***')
    .replace(JWT, '***')
    .replace(SECRET_LIKE, '***')
    .replace(EMAIL, '***')
    .slice(0, max);
}

/** Base properties every server event carries. */
export function baseProps(fn?: string): Record<string, unknown> {
  const p: Record<string, unknown> = { $process_person_profile: false, source: 'server' };
  if (fn) p.function = fn;
  const release = env('RELEASE') ?? env('APP_VERSION');
  if (release) { p.release = release; p.app_version = release; }
  return p;
}

export function buildCapture(
  event: string,
  props: Record<string, unknown>,
  opts: { fn?: string; distinctId?: string; timestamp?: string } = {},
): BatchEvent {
  const e: BatchEvent = {
    event,
    distinct_id: opts.distinctId ?? serverDistinctId(opts.fn ?? 'unknown'),
    // caller props first, then the base ones: a caller can never switch a profile on.
    properties: { ...props, ...baseProps(opts.fn) },
  };
  if (opts.timestamp) e.timestamp = opts.timestamp;
  return e;
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

/** One fingerprint component: word chars, dot and dash only, capped. */
export function fingerprintPart(v: unknown, max = 64): string {
  const t = String(v ?? '').trim().replace(/[^\w.-]+/g, '_').slice(0, max);
  return t || 'none';
}

/**
 * `extra.fingerprint` sets `$exception_fingerprint`; without one it is `server:<fn>:<type>`,
 * so the same error type of two functions never shares one PostHog issue.
 */
export function buildException(fn: string, err: unknown, extra: Record<string, unknown> = {}): BatchEvent {
  const isErr = err instanceof Error;
  const type = redactText(isErr ? err.name : typeof err === 'string' ? 'Error' : 'NonError', 80);
  const value = redactText(isErr ? err.message : typeof err === 'string' ? err : safeJson(err));
  const stack = isErr && err.stack ? redactText(err.stack, MAX_STACK) : undefined;
  const entry: Record<string, unknown> = {
    type,
    value,
    mechanism: { handled: Boolean(extra.handled ?? true), synthetic: false },
  };
  if (stack) entry.stacktrace = { type: 'raw', frames: [], raw: stack };
  const { handled: _h, fingerprint, ...rest } = extra;
  const fp = typeof fingerprint === 'string' && fingerprint
    ? redactText(fingerprint, 200)
    : `server:${fingerprintPart(fn)}:${fingerprintPart(type)}`;
  return buildCapture('$exception', {
    ...rest,
    $exception_fingerprint: fp,
    $exception_list: [entry],
    $exception_type: type,
    $exception_message: value,
    $exception_level: 'error',
  }, { fn });
}

export interface AiGeneration {
  fn: string;
  model: string;
  provider?: 'anthropic' | 'openai';
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
  costUsd?: number;
  latencyMs: number;
  ok: boolean;
  status?: number;
  error?: string;
  traceId?: string;
}

/** `$ai_generation` metadata only: never prompt or output text. */
export function buildAiGeneration(g: AiGeneration): BatchEvent {
  const props: Record<string, unknown> = {
    $ai_provider: g.provider ?? 'anthropic',
    $ai_model: g.model,
    $ai_input_tokens: g.inputTokens ?? 0,
    $ai_output_tokens: g.outputTokens ?? 0,
    $ai_latency: g.latencyMs / 1000,
    $ai_is_error: !g.ok,
    $ai_trace_id: g.traceId ?? crypto.randomUUID(),
  };
  if (g.cacheRead) props.$ai_cache_read_input_tokens = g.cacheRead;
  if (g.cacheWrite) props.$ai_cache_creation_input_tokens = g.cacheWrite;
  if (g.costUsd != null) props.$ai_total_cost_usd = g.costUsd;
  if (g.status != null) props.$ai_http_status = g.status;
  if (g.error) props.$ai_error = redactText(g.error, 200);
  return buildCapture('$ai_generation', props, { fn: g.fn });
}

export async function captureBatch(events: BatchEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    const res = await fetch(`${POSTHOG_HOST}/batch/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: projectToken(), batch: events }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      console.warn(`[posthog] batch rejected: HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn(`[posthog] send failed: ${redactText((e as Error)?.message ?? String(e), 120)}`);
  }
}

export async function captureServer(
  event: string,
  props: Record<string, unknown>,
  opts?: { fn?: string; distinctId?: string; timestamp?: string },
): Promise<void> {
  await captureBatch([buildCapture(event, props, opts)]);
}

export async function captureServerException(fn: string, err: unknown, extra?: Record<string, unknown>): Promise<void> {
  await captureBatch([buildException(fn, err, extra)]);
}

export async function captureAiGeneration(g: AiGeneration): Promise<void> {
  await captureBatch([buildAiGeneration(g)]);
}

/** Keep the isolate alive until the report is out, without delaying the response. */
function keepAlive(p: Promise<unknown>): void {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}

const MAX_ERROR_CODE = 64;

/** The `error` field of a JSON error body (string only), redacted and capped; null on anything else. */
export async function readErrorCode(res: Response): Promise<string | null> {
  try {
    if (!/json/i.test(res.headers.get('content-type') ?? '')) return null;
    const body = await res.clone().json();
    const code = body && typeof body === 'object' ? (body as Record<string, unknown>).error : null;
    if (typeof code !== 'string' || !code.trim()) return null;
    return redactText(code.trim().slice(0, MAX_ERROR_CODE), MAX_ERROR_CODE) || null;
  } catch {
    return null;
  }
}

/** A 5xx response as `HttpError`: one PostHog issue per function, status and error code. */
export function buildHttpException(fn: string, status: number, code: string | null, method: string): BatchEvent {
  const err = new Error(`${fn}: HTTP ${status}${code ? ` ${code}` : ''}`);
  err.name = 'HttpError';
  err.stack = undefined;
  return buildException(fn, err, {
    handled: true,
    http_status: status,
    http_method: method,
    error_code: code,
    fingerprint: `server:${fingerprintPart(fn)}:${status}:${code ? fingerprintPart(code) : 'none'}`,
  });
}

export const CRON_RUN_EVENT = 'server:cron_run_finish';

/** The cron-run outcome event: a 5xx or a throw is a failure, everything else (incl. 429 throttle) is a healthy run. */
export function buildCronRun(fn: string, status: number | null, durationMs: number, error?: unknown): BatchEvent {
  const ok = error === undefined && status != null && status < 500;
  const props: Record<string, unknown> = { ok, duration_ms: Math.round(durationMs), http_status: status };
  if (error !== undefined) props.error = redactText(error instanceof Error ? error.message : String(error), 200);
  return buildCapture(CRON_RUN_EVENT, props, { fn });
}

/**
 * Reports thrown errors and 5xx responses as `$exception` (a 5xx as `HttpError`, fingerprinted by
 * function, status and the body's `error` code); the outcome reaches the caller unchanged.
 * `opts.cron` (pg_cron driven functions) additionally reports every run's outcome as `server:cron_run_finish`.
 */
export function withPosthog(
  fn: string,
  handler: (req: Request) => Response | Promise<Response>,
  opts: { cron?: boolean } = {},
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const started = Date.now();
    let res: Response;
    try {
      res = await handler(req);
    } catch (e) {
      const events = [buildException(fn, e, { handled: false, http_method: req.method })];
      if (opts.cron) events.push(buildCronRun(fn, null, Date.now() - started, e));
      const p = captureBatch(events);
      keepAlive(p);
      await p;
      throw e;
    }
    const status = res.status;
    const cronRun = opts.cron ? buildCronRun(fn, status, Date.now() - started) : null;
    if (status >= 500) {
      // The body is read from a clone in the background: the response leaves unchanged and undelayed.
      const p = readErrorCode(res)
        .catch(() => null)
        .then((code) => {
          const events = [buildHttpException(fn, status, code, req.method)];
          if (cronRun) events.push(cronRun);
          return captureBatch(events);
        })
        .catch(() => undefined);
      keepAlive(p);
    } else if (cronRun) {
      keepAlive(captureBatch([cronRun]));
    }
    return res;
  };
}
