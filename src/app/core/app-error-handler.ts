import { ErrorHandler, Injectable, Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AnalyticsService, pageviewUrl } from './analytics.service';
import { logError } from './log';
import { RouteLoadRecoveryService, isRouteChunkError } from './route-load-recovery.service';

/** At most this many `$exception` events per page session. */
const MAX_REPORTS = 10;
const MAX_TEXT = 500;

/**
 * App-wide handler for every error nobody caught (audit plan D05, AUD-098).
 *
 * 1. Always logs `[app] unhandled error` with the route (query dropped, share
 *    tokens masked) — the console is the first place a bug report points to.
 * 2. Forwards a REDACTED copy to PostHog as `$exception`, and only through
 *    `AnalyticsService.captureException`, which is gated on the statistics
 *    consent. Each distinct `name:message` goes out once per page session, and
 *    no more than {@link MAX_REPORTS} in total, so a render loop that throws on
 *    every frame cannot flood the project.
 *
 * `Router` and `AnalyticsService` are resolved lazily inside `handleError`:
 * the ErrorHandler is created very early, and injecting them in the constructor
 * risks a DI cycle. `handleError` itself never throws.
 */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private readonly injector = inject(Injector);
  private readonly sent = new Set<string>();

  handleError(error: unknown): void {
    try {
      const route = this.route();
      const deferChunk = isDeferLoadError(error);
      logError('app', deferChunk ? 'defer chunk failed' : 'unhandled error', { route, error });
      // A `@defer` block without an `@error` branch whose chunk did not load
      // (#367): the same one-shot recovery as a dead route chunk. Reported as
      // handled — the app answers it, the reader is not left on a placeholder.
      if (deferChunk) this.recover();
      this.forward(error, route, deferChunk);
    } catch {
      // Reporting must never become the next unhandled error.
    }
  }

  private route(): string {
    try {
      return pageviewUrl(this.injector.get(Router).url);
    } catch {
      return '';
    }
  }

  private recover(): void {
    try {
      this.injector.get(RouteLoadRecoveryService).recoverFromStaleChunk({ notice: true });
    } catch {
      // Recovery is best effort; reporting below still runs.
    }
  }

  private forward(error: unknown, route: string, handled = false): void {
    if (this.sent.size >= MAX_REPORTS) return;
    const err = error instanceof Error ? error : null;
    const name = err?.name || 'Error';
    const msg = err ? err.message : String(error);
    const dedupe = `${name}:${msg}`;
    if (this.sent.has(dedupe)) return;
    this.sent.add(dedupe);

    const safe = new Error(redactErrorText(msg));
    safe.name = name;
    safe.stack = redactErrorText(err?.stack ?? '');
    this.injector.get(AnalyticsService).captureException(safe, { $current_url: route, handled });
  }
}

/**
 * True for Angular's NG0750 (DEFER_LOADING_FAILED): a `@defer` block's chunk
 * did not load and the block has no `@error` branch. Production builds carry
 * only the code (`RuntimeError.code === -750`, message "NG0750"); dev builds
 * add the cause to the message, which {@link isRouteChunkError} also matches.
 */
export function isDeferLoadError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code === -750 || code === 750) return true;
  const raw = (error as { message?: unknown }).message;
  if (typeof raw !== 'string') return false;
  return /^NG0750(?!d)/.test(raw) || (raw.includes('@defer') && isRouteChunkError(error));
}

const BEARER_PATH = /(\/shared\/loadout\/|\/hangar\/shared\/)[^/\s'")?#]+/g;
const BEARER_HEADER = /Bearer\s+[^\s'",]+/gi;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * Strip what must not reach an analytics project from an error text: query
 * strings, share-link bearer segments (same prefixes as `maskBearerSegments`),
 * `Bearer` headers, JWTs and e-mail addresses. Capped at 500 characters.
 */
export function redactErrorText(text: string): string {
  return text
    .replace(/\?[^\s'")]*/g, '')
    .replace(BEARER_PATH, '$1:token')
    .replace(BEARER_HEADER, '***')
    .replace(JWT, '***')
    .replace(EMAIL, '***')
    .slice(0, MAX_TEXT);
}
