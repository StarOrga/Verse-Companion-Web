import { Injectable, inject, signal } from '@angular/core';
import { preferenceStorage } from '../../core/consent.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { logWarn } from '../../core/log';
import { AnalyticsService } from '../../core/analytics.service';
import {
  NO_SIGNALS,
  OpenedRef,
  RankSignals,
  missKey,
  popularityMap,
  popularityOf,
  pushRecentOpened,
  readRecentOpened,
  recentRank,
} from './search-signals';

/** How long a zero-hit search must stand still before it is counted (typing in progress). */
export const MISS_DEBOUNCE_MS = 1500;
const POPULARITY_LIMIT = 500;
/** The longest search text a zero-hit event carries (PostHog, B4.8). */
export const MISS_TERM_MAX = 80;

/**
 * Client side of the search signals and counters (C9, C10):
 *  - recently opened (local) and what others open often (`search_popularity`,
 *    read once per session, silently absent when the RPC is not deployed),
 *  - `search_log_open` on every open (anonymous class + count),
 *  - a committed search without a hit goes to PostHog as `search:miss_show`
 *    with the area and the normalised text (debounced, once per term and
 *    session; consent-gated like every web event). The former DB counter
 *    `search_log_miss` and its admin card are gone (B4.8). Never throws.
 */
@Injectable({ providedIn: 'root' })
export class SearchSignalsService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly analytics = inject(AnalyticsService);

  readonly recentOpened = signal<OpenedRef[]>(readRecentOpened(storage()));
  private readonly popularity = signal<ReadonlyMap<string, number>>(new Map());
  private popularityRequested = false;
  private readonly missed = new Set<string>();
  private missTimer: ReturnType<typeof setTimeout> | null = null;

  /** The signals as the composer reads them. `owns` is supplied by the caller (HQ ownership). */
  signals(owns: (className: string) => boolean): RankSignals {
    const recent = this.recentOpened();
    const pop = this.popularity();
    return {
      recentRank: (kind, cls) => recentRank(recent, kind, cls),
      owns,
      popularity: (kind, cls) => popularityOf(pop, kind, cls),
    };
  }

  readonly none: RankSignals = NO_SIGNALS;

  /** Load the server popularity once per session. */
  ensurePopularity(): void {
    if (this.popularityRequested) return;
    this.popularityRequested = true;
    void (async () => {
      try {
        const { data, error } = await this.sb.client.rpc('search_popularity', { p_limit: POPULARITY_LIMIT });
        if (error) return;
        this.popularity.set(popularityMap(data as never));
      } catch {
        /* a ranking courtesy: absent is fine */
      }
    })();
  }

  /** A catalog entity was opened from the search: remember it locally, count it anonymously. */
  recordOpen(kind: string, className: string): void {
    if (!kind || !className.trim()) return;
    this.recentOpened.set(pushRecentOpened(preferenceStorage(), this.recentOpened(), kind, className));
    void (async () => {
      try {
        await this.sb.client.rpc('search_log_open', { p_kind: kind, p_class: className });
      } catch (err) {
        logWarn('search', 'log open failed', err);
      }
    })();
  }

  /** A committed search found nothing anywhere: report the term to PostHog, once per term and session. */
  logMiss(term: string, area = 'all'): void {
    const key = missKey(term).slice(0, MISS_TERM_MAX).trim();
    if (key.length < 2 || this.missed.has(key)) return;
    if (this.missTimer) clearTimeout(this.missTimer);
    this.missTimer = setTimeout(() => {
      this.missTimer = null;
      this.missed.add(key);
      try {
        this.analytics.track('search:miss_show', { area, term: key });
      } catch (err) {
        logWarn('search', 'log miss failed', err);
      }
    }, MISS_DEBOUNCE_MS);
  }

  /** Drop a pending miss (the reader kept typing or cleared the field). */
  cancelMiss(): void {
    if (this.missTimer) clearTimeout(this.missTimer);
    this.missTimer = null;
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
