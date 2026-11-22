// #354 storage search (concept d83b72d8, decision t-src = codex): flight minutes from the codex coordinates.
import { Injectable, inject, signal } from '@angular/core';
import { CodexService } from '../../codex/codex.service';
import { logWarn } from '../../core/log';
import { SupabaseClientProvider } from '../../core/supabase.client';

/** One `codex_locations` row as far as the distance needs it. */
export interface CodexLocationRow {
  id: string;
  name: string;
  system_code: string;
  parent_id: string | null;
  frame: 'system' | 'body' | null;
  pos_x: number | null;
  pos_y: number | null;
  pos_z: number | null;
  aliases: string[] | null;
}

/** A place resolved to the star-system frame (metres). */
export interface LocationPoint {
  readonly id: string;
  readonly system: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Place name (compacted) → its point in the system frame. */
export type LocationCoords = ReadonlyMap<string, LocationPoint>;

export const compactPlace = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Resolves every row with coordinates to the system frame: `frame = 'body'` offsets add onto the parent's system
 * position (the body's rotation is ignored - at most a planet diameter, nothing against the Gm of a quantum leg).
 * Keyed by the compacted name and every alias; the first row of a name wins. Pure.
 */
export function buildLocationCoords(rows: readonly CodexLocationRow[]): Map<string, LocationPoint> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const memo = new Map<string, LocationPoint | null>();
  const resolve = (r: CodexLocationRow, depth: number): LocationPoint | null => {
    if (memo.has(r.id)) return memo.get(r.id) ?? null;
    let p: LocationPoint | null = null;
    if (r.frame && r.pos_x !== null && r.pos_y !== null && r.pos_z !== null) {
      const own = { id: r.id, system: r.system_code, x: Number(r.pos_x), y: Number(r.pos_y), z: Number(r.pos_z) };
      if (r.frame === 'system') p = own;
      else {
        const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
        const base = parent && depth < 8 ? resolve(parent, depth + 1) : null;
        p = base ? { ...own, x: base.x + own.x, y: base.y + own.y, z: base.z + own.z } : null;
      }
    }
    if (p && ![p.x, p.y, p.z].every(Number.isFinite)) p = null;
    memo.set(r.id, p);
    return p;
  };
  const out = new Map<string, LocationPoint>();
  for (const r of rows) {
    const p = resolve(r, 0);
    if (!p) continue;
    for (const n of [r.name, ...(r.aliases ?? [])]) {
      const k = compactPlace(n ?? '');
      if (k && !out.has(k)) out.set(k, p);
    }
  }
  return out;
}

/** The point of a place name (as the Bestand writes it, e.g. "Port Tressler", "Stanton4_NewBabbage"), or null. */
export function pointOf(coords: LocationCoords | null | undefined, location: string): LocationPoint | null {
  if (!coords?.size) return null;
  const k = compactPlace(location);
  const hit = coords.get(k);
  if (hit) return hit;
  // A desktop name carries a system/body prefix ("Stanton4_NewBabbage"): try the part after the last underscore.
  const tail = location.split('_').pop() ?? '';
  return tail && tail !== location ? (coords.get(compactPlace(tail)) ?? null) : null;
}

const PAGE = 1000;

/**
 * The codex coordinates of the current build, loaded once on demand (public read, like every codex_* table).
 * Best effort: a failed or empty read leaves the map empty and the route falls back to the fixed tiers.
 */
@Injectable({ providedIn: 'root' })
export class HqLocationCoordsService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly codex = inject(CodexService);
  readonly coords = signal<LocationCoords>(new Map());
  private started = false;

  ensureLoaded(): void {
    if (this.started) return;
    this.started = true;
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const build = await this.codex.loadCurrentBuild();
      if (!build) return;
      const rows: CodexLocationRow[] = [];
      for (let from = 0; from < 20 * PAGE; from += PAGE) {
        const { data, error } = await this.sb.client
          .from('codex_locations' as never)
          .select('id, name, system_code, parent_id, frame, pos_x, pos_y, pos_z, aliases')
          .eq('build_id', build.id)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as CodexLocationRow[];
        rows.push(...page);
        if (page.length < PAGE) break;
      }
      this.coords.set(buildLocationCoords(rows));
    } catch (err) {
      this.started = false;
      logWarn('hq', 'codex location coordinates load failed', err);
    }
  }
}
