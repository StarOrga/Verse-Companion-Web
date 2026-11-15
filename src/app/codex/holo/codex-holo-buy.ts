import type { BuyOption } from '../uex-shop.service';
import type { MapPlace } from '../../hq/plan/map/hq-map.types';
import { placeDistance } from '../../hq/plan/map/hq-places';
import { slug } from '../../hq/plan/map/hq-route';

/** How many places the Kaufen tab shows before "all". */
export const BUY_TOP = 3;

/** One place to buy the ship, as the Kaufen tab lists it. */
export interface ShopRow {
  readonly key: string;
  readonly terminal: string;
  /** "Lorville · Hurston": place and planet (or the UEX location text when the parts are unknown). */
  readonly where: string;
  readonly price: number;
  readonly system: string;
  readonly planet: string | null;
  readonly map: MapPlace | null;
}

export interface ShopGroup {
  readonly key: string;
  readonly system: string;
  readonly planet: string | null;
  readonly rows: readonly ShopRow[];
}

/** The text a wishlist entry keeps as its source: who sells it and where. */
export function shopSource(r: Pick<ShopRow, 'terminal' | 'where'>): string {
  return [r.terminal, r.where].filter(Boolean).join(' · ');
}

export function toShopRows(options: readonly BuyOption[]): ShopRow[] {
  const seen = new Set<string>();
  const rows: ShopRow[] = [];
  for (const o of options) {
    const key = `${o.terminal}|${o.location}|${o.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const system = (o.system ?? '').trim();
    const planet = o.planet && o.planet !== o.place ? o.planet : null;
    const place = o.place?.trim() || '';
    const map: MapPlace | null = place
      ? { id: [system, planet, place].filter((p): p is string => !!p).map(slug).join('/'), system, planet, location: place }
      : null;
    const where = place ? [place, planet].filter(Boolean).join(' · ') : o.location;
    rows.push({ key, terminal: o.terminal, where, price: o.price, system, planet, map });
  }
  return rows;
}

/** Cheapest first; among equals the alphabetically first terminal (stable, no jitter). */
function byPrice(a: ShopRow, b: ShopRow): number {
  return a.price - b.price || a.terminal.localeCompare(b.terminal);
}

/** Nearest to the reader first (schematic distance), then cheapest; without a position the cheapest first. */
export function rankShops(rows: readonly ShopRow[], here: MapPlace | null): ShopRow[] {
  if (!here) return [...rows].sort(byPrice);
  return [...rows].sort((a, b) => placeDistance(here, a.map) - placeDistance(here, b.map) || byPrice(a, b));
}

/** Rows grouped star system -> planet system -> place; groups in system/planet order, an unknown system last. */
export function groupShops(rows: readonly ShopRow[]): ShopGroup[] {
  const groups = new Map<string, { system: string; planet: string | null; rows: ShopRow[] }>();
  for (const r of rows) {
    const key = `${r.system}|${r.planet ?? ''}`;
    const g = groups.get(key) ?? { system: r.system, planet: r.planet, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, system: g.system, planet: g.planet, rows: [...g.rows].sort((a, b) => a.where.localeCompare(b.where) || byPrice(a, b)) }))
    .sort((a, b) => (a.system ? 0 : 1) - (b.system ? 0 : 1) || a.system.localeCompare(b.system) || (a.planet ?? '~').localeCompare(b.planet ?? '~'));
}

/** What the Wikelo row asks for, with how many the reader already holds. */
export interface WikeloNeed {
  readonly className: string;
  readonly name: string;
  readonly qty: number;
}

/** How many of `need` lie in the reader's stock (all places together, by class name). */
export function haveOf(need: WikeloNeed, stock: readonly { class_name: string | null; qty: number }[]): number {
  const c = need.className.toLowerCase();
  return stock.reduce((n, i) => (i.class_name?.toLowerCase() === c ? n + Number(i.qty) : n), 0);
}
