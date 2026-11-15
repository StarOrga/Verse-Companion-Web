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
const SECRET_LIKE = /\b(?:sk-[\w-]{16,}|sbp_\w{16,}|sb_secret_[\w-]{10,}|xai-[\w-]{16,})\b/g;

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
  const { handled: _h, ...rest } = extra;
  return buildCapture('$exception', {
    ...rest,
    $exception_list: [entry],
    $exception_type: type,
    $exception_message: value,
    $exception_level: 'error',
  }, { fn });
}

export interface AiGeneration {
  fn: string;
  model: string;
  provider?: 'anthropic' | 'openai' | 'xai';
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

export const CRON_RUN_EVENT = 'server:cron_run_finish';

/** The cron-run outcome event: a 5xx or a throw is a failure, everything else (incl. 429 throttle) is a healthy run. */
export function buildCronRun(fn: string, status: number | null, durationMs: number, error?: unknown): BatchEvent {
  const ok = error === undefined && status != null && status < 500;
  const props: Record<string, unknown> = { ok, duration_ms: Math.round(durationMs), http_status: status };
  if (error !== undefined) props.error = redactText(error instanceof Error ? error.message : String(error), 200);
  return buildCapture(CRON_RUN_EVENT, props, { fn });
}

/**
 * Reports thrown errors and 5xx responses as `$exception`; the outcome reaches the caller unchanged.
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
    const events: BatchEvent[] = [];
    if (res.status >= 500) {
      events.push(buildException(fn, new Error(`HTTP ${res.status}`), { handled: true, http_status: res.status, http_method: req.method }));
    }
    if (opts.cron) events.push(buildCronRun(fn, res.status, Date.now() - started));
    if (events.length) keepAlive(captureBatch(events));
    return res;
  };
}
