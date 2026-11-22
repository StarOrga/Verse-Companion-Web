// #354 storage search (concept d83b72d8, round 4 step 3): flight-minute ranking of the quantity search.
import type { MapPlace } from '../plan/map/hq-map.types';
import { slug } from '../plan/map/hq-route';
import { placeOfName } from '../plan/map/hq-places';
import { type LocationCoords, pointOf } from './hq-location-coords';

/** What a stop is, for its approach time (decision t-anflug = fixed values). */
export type PlaceKind = 'station' | 'outpost' | 'city';
/** Approach minutes per place kind: an orbital station is quick, a city needs atmosphere and a landing. */
export const APPROACH_MIN: Readonly<Record<PlaceKind, number>> = { station: 2, outpost: 4, city: 6 };

/** The balance of the quantity filter: minutes added for every further stop (unloading, a second landing). */
export type StockBalance = 'shortest' | 'balanced' | 'oneStop';
export const STOCK_BALANCES: readonly StockBalance[] = ['oneStop', 'balanced', 'shortest'];
export const STOP_SURCHARGE: Readonly<Record<StockBalance, number>> = { shortest: 0, balanced: 3, oneStop: 15 };
export const MAX_STOPS_CHOICES = [1, 2, 3] as const;
export type MaxStops = (typeof MAX_STOPS_CHOICES)[number];

const CITIES = ['lorville', 'area18', 'newbabbage', 'orison', 'levski'];
const STATIONS = ['porttressler', 'baijini', 'everusharbor', 'seraphim', 'ruinstation', 'checkmate', 'orbituary', 'grimhex', 'starlight', 'station', 'harbor', 'point'];
const STANTON_RING = ['hurston', 'crusader', 'arccorp', 'microtech'];
/** A leg into another system (a jump point) and a leg nothing is known about. */
const OTHER_SYSTEM_MIN = 30;
const UNKNOWN_LEG_MIN = 12;

const compact = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function placeKind(location: string): PlaceKind {
  const k = compact(location);
  if (CITIES.some((c) => k.includes(c))) return 'city';
  if (STATIONS.some((c) => k.includes(c))) return 'station';
  return 'outpost';
}

/**
 * Quantum leg from the codex coordinates (decision t-src = codex): align/spool time plus distance at an effective
 * cruise speed. Estimates, not a drive model - drives differ; ~50 Gm (Hurston to microTech) gives about 8 minutes.
 */
const QT_ALIGN_MIN = 1;
const QT_M_PER_MIN = 1.2e8 * 60;

/** Minutes between two place names from the codex coordinates; null when either has none (the tiers take over). */
export function codexMinutes(coords: LocationCoords | null | undefined, a: string, b: string): number | null {
  const pa = pointOf(coords, a);
  const pb = pointOf(coords, b);
  if (!pa || !pb) return null;
  if (pa.id === pb.id) return 0;
  if (compact(pa.system) !== compact(pb.system)) return OTHER_SYSTEM_MIN;
  const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
  return Math.max(1, Math.round(QT_ALIGN_MIN + d / QT_M_PER_MIN));
}

/**
 * Estimated quantum-travel minutes between two places by fixed tiers - the fallback when the codex has no
 * coordinates for an end ({@link codexMinutes}): same place 0, same planet 3, another planet of the system
 * 5 + 3 per ring step, another system 30. Null when either end is unknown.
 */
export function flightMinutes(a: MapPlace | null, b: MapPlace | null): number | null {
  if (!a || !b) return null;
  if (a.id === b.id) return 0;
  if (slug(a.system) !== slug(b.system)) return OTHER_SYSTEM_MIN;
  const pa = a.planet ? compact(a.planet) : '';
  const pb = b.planet ? compact(b.planet) : '';
  if (pa && pa === pb) return 3;
  const ra = STANTON_RING.indexOf(pa);
  const rb = STANTON_RING.indexOf(pb);
  if (ra < 0 || rb < 0) return UNKNOWN_LEG_MIN;
  return 5 + 3 * Math.abs(ra - rb);
}

export interface RouteSource {
  location: string;
  qty: number;
}

export interface RouteStop {
  location: string;
  /** What to take here. */
  take: number;
  /** Flight minutes of the leg into this stop (from the reference point or the stop before). */
  fly: number;
  approach: number;
}

export interface RoutePlan {
  stops: RouteStop[];
  fly: number;
  approach: number;
  /** fly + approach, the estimate shown on the card. */
  minutes: number;
  /** minutes + the balance surcharge per further stop: the sort key. */
  score: number;
}

export interface RouteOptions {
  maxStops: MaxStops;
  balance: StockBalance;
  /** Places the search reads at most (nearest first) before combining. */
  maxSources?: number;
  /** Codex coordinates; without them (or for a place they lack) the fixed tiers count. */
  coords?: LocationCoords | null;
}

/** One leg from a reference place to a place name: codex coordinates first, then the tiers. */
function leg(from: MapPlace, location: string, coords: LocationCoords | null | undefined, fromName: string = from.location): number {
  return codexMinutes(coords, fromName, location) ?? flightMinutes(from, placeOfName(location)) ?? UNKNOWN_LEG_MIN;
}

/** Minutes from `from` to one place, approach included; null without a reference point. */
export function minutesTo(from: MapPlace | null, location: string, coords?: LocationCoords | null): { fly: number; approach: number } | null {
  if (!from) return null;
  const fly = leg(from, location, coords);
  return { fly, approach: APPROACH_MIN[placeKind(location)] };
}

/**
 * Every way to collect `want` from the sources with at most `maxStops` stops, best first. A combination with a
 * superfluous stop (the amount is there without it) never shows. Stops are visited nearest-first from `from`;
 * without a reference point the first leg counts 0 and only the legs between the stops count. Pure.
 */
export function planRoutes(sources: readonly RouteSource[], want: number, from: MapPlace | null, opts: RouteOptions): RoutePlan[] {
  if (want <= 0) return [];
  const usable = sources.filter((s) => s.qty > 0);
  const near = (s: RouteSource): number => (from ? leg(from, s.location, opts.coords) : 0) + APPROACH_MIN[placeKind(s.location)];
  const pool = [...usable].sort((a, b) => near(a) - near(b) || b.qty - a.qty).slice(0, opts.maxSources ?? 12);
  const plans: RoutePlan[] = [];
  const pick = (start: number, chosen: RouteSource[]): void => {
    if (chosen.length) {
      const sum = chosen.reduce((n, s) => n + s.qty, 0);
      if (sum >= want) {
        // Minimal only: dropping any stop must leave the amount short.
        if (chosen.every((s) => sum - s.qty < want)) plans.push(toPlan(chosen, want, from, opts.balance, opts.coords));
        return;
      }
    }
    if (chosen.length >= opts.maxStops) return;
    for (let i = start; i < pool.length; i++) pick(i + 1, [...chosen, pool[i]]);
  };
  pick(0, []);
  return plans.sort((a, b) => a.score - b.score || a.stops.length - b.stops.length || a.minutes - b.minutes);
}

function toPlan(chosen: readonly RouteSource[], want: number, from: MapPlace | null, balance: StockBalance, coords?: LocationCoords | null): RoutePlan {
  // Greedy nearest-next order from the reference point.
  const left = [...chosen];
  const ordered: { src: RouteSource; fly: number }[] = [];
  let at: MapPlace | null = from;
  let atName = from?.location ?? '';
  while (left.length) {
    let best = 0;
    let bestFly = Infinity;
    left.forEach((s, i) => {
      const f = at ? leg(at, s.location, coords, atName) : 0;
      if (f < bestFly) {
        bestFly = f;
        best = i;
      }
    });
    const [src] = left.splice(best, 1);
    ordered.push({ src, fly: bestFly });
    at = placeOfName(src.location) ?? at;
    atName = src.location;
  }
  let need = want;
  const stops = ordered.map(({ src, fly }) => {
    const take = Math.min(src.qty, need);
    need -= take;
    return { location: src.location, take, fly, approach: APPROACH_MIN[placeKind(src.location)] };
  });
  const fly = stops.reduce((n, s) => n + s.fly, 0);
  const approach = stops.reduce((n, s) => n + s.approach, 0);
  const minutes = fly + approach;
  return { stops, fly, approach, minutes, score: minutes + STOP_SURCHARGE[balance] * (stops.length - 1) };
}
