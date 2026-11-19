// Mapping of the desktop wire format (v1) to PostHog events (D1) and the per-IP
// rate limit that replaces the old telemetry_events count. Pure module so
// `node --test` runs _forward.test.ts.
//
//   crash                       -> `$exception`  (source 'desktop')
//   crash / extract-aborted     -> `desktop:extract_abort`     (not a crash, as before)
//   crash / job-diagnostics     -> `desktop:job_diagnostics_report` (+ log_url / log_bytes)
//   usage                       -> `desktop:usage_metric`
//
// distinct_id is the install hash the function already derives (salted SHA-256
// of the raw install id, never the raw value) or, without an install id, the
// session hash, or a per-product bucket. `$process_person_profile: false`
// throughout: no person is ever created from desktop telemetry.

import type { BatchEvent } from '../_shared/posthog.ts';
import { fingerprintPart, redactText } from '../_shared/posthog.ts';
import { capDetail } from './_detail.ts';

export const EXTRACT_ABORTED = 'extract-aborted';
export const JOB_DIAGNOSTICS = 'job-diagnostics';

export interface WireContext {
  type: 'crash' | 'usage';
  appVersion: string;
  buildId: string | null;
  channel: string;
  product: string | null;
  os: string | null;
  osRelease: string | null;
  arch: string | null;
  role: string | null;
  installHash: string | null;
  sessionHash: string | null;
  /** Receive time; a client-side timestamp is never trusted. */
  now: string;
}

export interface StoredLogRef { url: string; bytes: number; truncated?: boolean }

export function clamp(s: unknown, n: number): string | null {
  if (s == null) return null;
  return String(s).slice(0, n);
}

/** The transcript of a job-diagnostics event (what `error_stack` carried before). */
export function logTextOf(ev: Record<string, unknown>): string | null {
  const t = ev.logText ?? ev.stack;
  return typeof t === 'string' && t.length > 0 ? t : null;
}

export function isJobDiagnostics(type: string, ev: Record<string, unknown>): boolean {
  return type === 'crash' && ev.errorType === JOB_DIAGNOSTICS;
}

export function distinctIdOf(ctx: WireContext): string {
  return ctx.installHash ?? ctx.sessionHash ?? `desktop:${ctx.product ?? 'unknown'}`;
}

function commonProps(ctx: WireContext): Record<string, unknown> {
  return {
    $process_person_profile: false,
    source: 'desktop',
    product: ctx.product ?? 'scc-app',
    app_version: ctx.appVersion,
    release: ctx.appVersion,
    channel: ctx.channel,
    os: ctx.os,
    os_release: ctx.osRelease,
    arch: ctx.arch,
    role: ctx.role,
    build_id: ctx.buildId,
    session_hash: ctx.sessionHash,
  };
}

export function mapEvent(ctx: WireContext, ev: Record<string, unknown>, log?: StoredLogRef | null): BatchEvent {
  const base = commonProps(ctx);
  const distinct_id = distinctIdOf(ctx);
  const timestamp = ctx.now;
  const detail = capDetail((ctx.type === 'crash' ? ev.extra : ev.detail) ?? null);

  if (ctx.type === 'usage') {
    return {
      event: 'desktop:usage_metric',
      distinct_id,
      timestamp,
      properties: {
        ...base,
        metric: clamp(ev.metric, 80),
        metric_value: typeof ev.value === 'number' ? ev.value : null,
        detail,
      },
    };
  }

  const errorType = clamp(ev.errorType, 60);
  if (errorType === EXTRACT_ABORTED) {
    return {
      event: 'desktop:extract_abort',
      distinct_id,
      timestamp,
      properties: { ...base, error_type: errorType, message: redactText(clamp(ev.message, 500) ?? '', 300), detail },
    };
  }
  if (errorType === JOB_DIAGNOSTICS) {
    const props: Record<string, unknown> = {
      ...base,
      error_type: errorType,
      message: redactText(clamp(ev.message, 500) ?? '', 300),
      detail,
    };
    if (log) {
      props.log_url = log.url;
      props.log_bytes = log.bytes;
      if (log.truncated) props.log_truncated = true;
    }
    return { event: 'desktop:job_diagnostics_report', distinct_id, timestamp, properties: props };
  }

  const name = clamp(ev.name, 120) ?? errorType ?? 'Error';
  const value = redactText(clamp(ev.message, 500) ?? '');
  const stack = typeof ev.stack === 'string' ? redactText(ev.stack, 4000) : null;
  const entry: Record<string, unknown> = {
    type: redactText(name, 120),
    value,
    mechanism: { handled: false, synthetic: false },
  };
  if (stack) entry.stacktrace = { type: 'raw', frames: [], raw: stack };
  return {
    event: '$exception',
    distinct_id,
    timestamp,
    properties: {
      ...base,
      $exception_list: [entry],
      $exception_type: entry.type,
      $exception_message: value,
      $exception_level: 'fatal',
      // one PostHog issue per product and error type, never one catch-all for every `Error`
      $exception_fingerprint: `desktop:${fingerprintPart(base.product)}:${fingerprintPart(errorType)}`,
      error_type: errorType,
      detail,
    },
  };
}

// ---- per-IP rate limit (replaces the telemetry_events count) -----------------
// Per isolate, sliding window. Honest limit: not distributed (several warm
// isolates each count on their own); the HMAC check is the real gate and
// PostHog's own ingest limits sit behind it. Same approach as ship-link.

export const RATE_LIMIT_PER_IP = 1000; // events / window / ip
export const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED_IPS = 5000;

export class RateLimiter {
  private hits = new Map<string, { at: number; n: number }[]>();
  private limit: number;
  private windowMs: number;
  constructor(limit = RATE_LIMIT_PER_IP, windowMs = RATE_WINDOW_MS) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Counts `n` events for `key`; false = over the limit (nothing counted). */
  take(key: string, n: number, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((h) => now - h.at < this.windowMs);
    const used = recent.reduce((s, h) => s + h.n, 0);
    if (used + n > this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push({ at: now, n });
    this.hits.set(key, recent);
    if (this.hits.size > MAX_TRACKED_IPS) {
      for (const [k, v] of this.hits) if (!v.some((h) => now - h.at < this.windowMs)) this.hits.delete(k);
    }
    return true;
  }
}
