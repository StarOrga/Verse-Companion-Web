import { Injectable, computed, inject, signal } from '@angular/core';
import { toErrorKey } from '../core/describe-error';
import { SupabaseClientProvider } from '../core/supabase.client';
import { eventImageOf, eventStem, eventTeaser, type EventTeaser, type VerseEvent, type VerseEventKind } from './news-events';

/** The `sc_events` columns the teasers read, as PostgREST returns them. */
interface ScEventTeaserRow {
  id: string;
  kind: VerseEventKind;
  name: string;
  start_date: string;
  end_date: string;
  date_status: 'confirmed' | 'estimated';
  free_fly: boolean;
  url: string | null;
  summary: { en?: string; de?: string } | null;
  extra?: unknown;
}

export function toVerseEvent(r: ScEventTeaserRow): VerseEvent {
  const en = r.summary?.en ?? '';
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    start: r.start_date,
    end: r.end_date,
    dateStatus: r.date_status,
    freeFly: !!r.free_fly,
    url: r.url ?? '',
    summary: { en, de: r.summary?.de || en },
    image: eventImageOf(r.extra),
  };
}

/** Re-load at most this often; the timeline changes a few times a month. */
const STALE_MS = 15 * 60 * 1000;

/**
 * The event timeline (`public.sc_events`, curated + `sc-events-sync`) for the
 * Verse News teasers and the hub (feedback #389). Read-only, signed-in readers
 * only (the table's RLS) — the Verse area is behind sign-in anyway. Cancelled
 * and hidden rows never reach the teasers.
 */
@Injectable({ providedIn: 'root' })
export class VerseEventsService {
  private readonly sb = inject(SupabaseClientProvider);

  readonly events = signal<readonly VerseEvent[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  /** i18n key of the last failed load, never raw text. */
  readonly error = signal<string | null>(null);

  private inFlight: Promise<void> | null = null;
  private loadedAt = 0;

  /** Running and upcoming events (re-evaluated against the clock on every read of `now`). */
  teaser(now: number): EventTeaser {
    return eventTeaser(this.events(), now);
  }

  /** The timeline's event names without their year — extra title matches for the Events chip. */
  readonly stems = computed(() => [...new Set(this.events().map((e) => eventStem(e.name)))]);

  /** Load once; a later call within {@link STALE_MS} is free. */
  load(force = false): Promise<void> {
    if (!force && this.loaded() && Date.now() - this.loadedAt < STALE_MS) return Promise.resolve();
    if (!this.inFlight) this.inFlight = this.loadOnce().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private async loadOnce(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      // Yesterday on: an event that ended today still counts as running all day.
      const since = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await this.sb.client
        .from('sc_events' as never)
        .select('id,kind,name,start_date,end_date,date_status,free_fly,url,summary,extra')
        .eq('hidden', false)
        .eq('status', 'scheduled')
        .gte('end_date', since)
        .order('start_date', { ascending: true })
        .limit(40);
      if (error) throw error;
      this.events.set(((data ?? []) as unknown as ScEventTeaserRow[]).map(toVerseEvent));
      this.loaded.set(true);
      this.loadedAt = Date.now();
    } catch (err) {
      this.error.set(toErrorKey('news', 'events', err));
    } finally {
      this.loading.set(false);
    }
  }
}
