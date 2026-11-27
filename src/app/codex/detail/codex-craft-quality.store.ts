import { Injectable, signal } from '@angular/core';
import { logWarn } from '../../core/log';
import { clampQuality } from '../codex-crafting';

/** Per hardpoint: the quality of each recipe slot, in recipe order. */
export type CraftQualities = ReadonlyMap<string, readonly number[]>;

const KEY_PREFIX = 'sc.craftQuality.';

/**
 * The crafting qualities the pilot set on one ship's loadout cards. Keyed by
 * hardpoint (`slotKey`: the top-level port, or `port>class` for an item a
 * mount carries) so two identical guns can be crafted differently. Kept per
 * ship in localStorage — a what-if of this browser, never sent anywhere, and
 * a missing or unreadable store simply means "stock items".
 */
@Injectable({ providedIn: 'root' })
export class CraftQualityStore {
  private readonly ship = signal<string | null>(null);
  private readonly map = signal<CraftQualities>(new Map());

  /** The qualities of the ship last opened with {@link openShip}. */
  readonly qualities = this.map.asReadonly();

  openShip(shipClassName: string | null): void {
    if (this.ship() === shipClassName) return;
    this.ship.set(shipClassName);
    this.map.set(shipClassName ? this.read(shipClassName) : new Map());
  }

  /** Set one hardpoint's slot qualities; `null` returns it to a stock item. */
  set(slotKey: string, qualities: readonly number[] | null): void {
    const next = new Map(this.map());
    if (qualities === null) next.delete(slotKey);
    else next.set(slotKey, qualities.map(clampQuality));
    this.map.set(next);
    this.write();
  }

  /** Forget every crafted item of this ship. */
  reset(): void {
    this.map.set(new Map());
    this.write();
  }

  private read(ship: string): Map<string, number[]> {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + ship);
      if (!raw) return new Map();
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const out = new Map<string, number[]>();
      for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) out.set(k, v.map(clampQuality));
      }
      return out;
    } catch (err) {
      logWarn('craft-quality', 'stored qualities unreadable', err);
      return new Map();
    }
  }

  private write(): void {
    const ship = this.ship();
    if (!ship) return;
    try {
      const map = this.map();
      if (map.size === 0) localStorage.removeItem(KEY_PREFIX + ship);
      else localStorage.setItem(KEY_PREFIX + ship, JSON.stringify(Object.fromEntries(map)));
    } catch (err) {
      logWarn('craft-quality', 'could not store qualities', err);
    }
  }
}
