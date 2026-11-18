import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { SupabaseClientProvider } from '../../core/supabase.client';

export const HQ_SPOT_NAME_MAX = 120;

/** The columns of `user_spots` (migration 20261008124350) the page shows. */
export interface HqSpot {
  id: string;
  name: string;
  system_code: string | null;
  parent_body: string | null;
  note: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id,name,system_code,parent_body,note,created_at,updated_at';

/**
 * The reader's own saved spots (created in the desktop app, synced through `user_spots`).
 * Reads and writes are RLS self-only. The desktop app merges last-write-wins on `updated_at`, so
 * a rename bumps it and a delete is a tombstone (`deleted_at`), never a hard delete, or the app
 * would push the spot back on its next sync.
 */
@Injectable({ providedIn: 'root' })
export class HqSpotsService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  readonly spots = signal<readonly HqSpot[]>([]);
  readonly loaded = signal(false);
  readonly loading = signal(false);
  /** i18n key of the last failed load, never raw text. */
  readonly loadError = signal<string | null>(null);
  /** i18n key of the last failed rename/delete. */
  readonly writeError = signal<string | null>(null);

  async load(): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const { data, error } = await this.sb.client
        .from('user_spots' as never)
        .select(COLUMNS)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      this.spots.set((data ?? []) as unknown as HqSpot[]);
      this.loaded.set(true);
    } catch (err) {
      this.loadError.set(toErrorKey('hq', 'spots.load', err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Renames a spot. False on invalid input or failure (the list is then reloaded). */
  rename(id: string, name: string): Promise<boolean> {
    const n = name.trim();
    if (!n || n.length > HQ_SPOT_NAME_MAX) return Promise.resolve(false);
    return this.write(id, 'rename', (at) => ({ name: n, updated_at: at }), (s, at) => ({ ...s, name: n, updated_at: at }));
  }

  /** Soft-deletes a spot (tombstone) so the desktop app drops it instead of pushing it back. */
  remove(id: string): Promise<boolean> {
    return this.write(id, 'remove', (at) => ({ deleted_at: at, updated_at: at }), () => null);
  }

  /** `updated_at` never behind the stored value, or the server trigger skips the write silently. */
  private stamp(id: string): string {
    const stored = Date.parse(this.spots().find((s) => s.id === id)?.updated_at ?? '');
    return new Date(Math.max(Date.now(), Number.isFinite(stored) ? stored + 1 : 0)).toISOString();
  }

  private async write(
    id: string,
    op: string,
    patch: (at: string) => Record<string, unknown>,
    next: (s: HqSpot, at: string) => HqSpot | null,
  ): Promise<boolean> {
    const userId = this.auth.user()?.id;
    const have = this.spots().find((s) => s.id === id);
    if (!userId || !have) return false;
    this.writeError.set(null);
    const at = this.stamp(id);
    try {
      const { data, error } = await this.sb.client
        .from('user_spots' as never)
        .update(patch(at) as never)
        .eq('user_id', userId)
        .eq('id', id)
        .is('deleted_at', null)
        .select('id');
      if (error) throw error;
      // 0 rows: the trigger skipped a stale write, or the row is gone - never report success.
      if (!Array.isArray(data) || data.length === 0) throw new Error('spot write skipped');
      this.spots.set(
        this.spots()
          .map((s) => (s.id === id ? next(s, at) : s))
          .filter((s): s is HqSpot => s !== null),
      );
      return true;
    } catch (err) {
      this.writeError.set(toErrorKey('hq', `spots.${op}`, err));
      void this.load();
      return false;
    }
  }
}
