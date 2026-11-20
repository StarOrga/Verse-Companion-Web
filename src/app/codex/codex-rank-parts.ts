import type { CodexKind } from './codex.service';

/**
 * `rank-parts.json` of a build: what the "Einordnung" cohort
 * (`CodexService.getRankCohort`) reads of the parts in the ships' stock loadouts,
 * instead of the full payload of every part from the database (116 requests,
 * 26.5 MB on a cold browser, LIVE 4.10.3). Written by ingest-catalog:
 * supabase/functions/ingest-catalog/_rank-parts.ts is the source of truth.
 *
 * The file holds a slice of each payload, so every payload handed out here is
 * guarded: reading a top-level key the file does not carry, or anything inside
 * a `stats` / `raw` child the publisher cut, throws {@link SnapshotCut} AND is
 * counted ({@link RankParts.cutReads}) — the count still tells when some
 * `try/catch` on the way swallowed the throw. The cohort then declines the
 * file and reads the database: a file never answers with a value the full
 * payload would not have given.
 */

/** A read reached something the file left out: decline, use the database. */
export class SnapshotCut extends Error {
  constructor(what: string) {
    super(`rank-parts: "${what}" is not in the file`);
    this.name = 'SnapshotCut';
  }
}

/** The top-level payload keys the cohort reads of a part (PART_PAYLOAD_KEYS of the publisher). */
export const RANK_PART_KEYS: readonly string[] = [
  'entityKind', 'kind', 'subType', 'attachType', 'className', 'weaponParams', 'impactDamage', 'raw', 'stats',
];
/** The same for the ammunition a weapon fires (AMMO_PAYLOAD_KEYS of the publisher). */
export const RANK_AMMO_KEYS: readonly string[] = ['impactDamage', 'weaponParams', 'raw'];

/** The publisher's placeholder for a cut object (jsonb cannot hold U+0000, so it is never data). */
const CUT = '\u0000';
/** The payload keys whose children the publisher may cut. */
const CUT_PARENTS: readonly string[] = ['stats', 'raw'];

const PART_TABLES: ReadonlySet<string> = new Set(['weapon', 'component', 'item']);

export interface RankParts {
  /** Class name → the table that owns it and its guarded payload slice. */
  entities: ReadonlyMap<string, { kind: CodexKind; payload: unknown }>;
  /** Class names of the stock loadouts that no table of the build holds. */
  absent: ReadonlySet<string>;
  /** Every ammunition row of the build: class name → guarded payload slice. */
  ammo: ReadonlyMap<string, unknown>;
  /**
   * How many reads have reached something the file left out since it was
   * parsed. An answer computed over these payloads is the database's only if
   * this did not move while it was computed.
   */
  cutReads(): number;
}

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/**
 * rank-parts.json → {@link RankParts}, or `null` when this client cannot use
 * it: an unexpected shape, or a file published before a key the cohort reads
 * existed (keys are looked up by name, so added keys never matter).
 */
export function parseRankParts(body: unknown): RankParts | null {
  const f = body as
    | { v?: unknown; kind?: unknown; payloadKeys?: unknown; ammoKeys?: unknown; absent?: unknown; rows?: unknown; ammo?: unknown }
    | null;
  if (!f || f.v !== 1 || f.kind !== 'rank-parts') return null;
  const { payloadKeys, ammoKeys, absent, rows, ammo } = f;
  if (!isStrings(payloadKeys) || !isStrings(ammoKeys) || !isStrings(absent)) return null;
  if (!RANK_PART_KEYS.every((k) => payloadKeys.includes(k)) || !RANK_AMMO_KEYS.every((k) => ammoKeys.includes(k))) return null;
  if (!Array.isArray(rows) || !Array.isArray(ammo)) return null;

  let cuts = 0;
  const fail = (what: string): never => {
    cuts++;
    throw new SnapshotCut(what);
  };
  /** Stands in for a cut object: any look inside it declines the file. */
  const cutObject: object = new Proxy(Object.freeze({}), {
    get: (_t, k) => fail(`a cut object (.${String(k)})`),
    has: (_t, k) => fail(`a cut object (${String(k)} in)`),
    ownKeys: () => fail('a cut object (keys)'),
    getOwnPropertyDescriptor: (_t, k) => fail(`a cut object (.${String(k)})`),
  });
  /**
   * The slice as the payload it stands for: the keys the file carries read as
   * in the full payload (absent stays absent, null stays null), every other
   * read declines.
   */
  const guarded = (slice: Record<string, unknown>, carried: ReadonlySet<string>): unknown => {
    for (const parent of CUT_PARENTS) {
      const o = slice[parent];
      // The cut keys keep their place: a scan sees the same struct names in the same order.
      if (isPlain(o)) for (const k of Object.keys(o)) if (o[k] === CUT) o[k] = cutObject;
    }
    // `then`: a promise resolving to a payload probes it; no payload has that key.
    const known = (k: string | symbol): boolean =>
      typeof k !== 'string' || carried.has(k) || k === 'then' || k in Object.prototype;
    return new Proxy(slice, {
      get: (t, k, r) => (known(k) ? Reflect.get(t, k, r) : fail(String(k))),
      has: (t, k) => (known(k) ? Reflect.has(t, k) : fail(String(k))),
      getOwnPropertyDescriptor: (t, k) => (known(k) ? Reflect.getOwnPropertyDescriptor(t, k) : fail(String(k))),
      ownKeys: () => fail('the payload keys'),
    });
  };

  const partKeys = new Set(payloadKeys);
  const entities = new Map<string, { kind: CodexKind; payload: unknown }>();
  for (const r of rows as unknown[]) {
    if (!Array.isArray(r) || r.length !== 3) return null;
    const [className, table, slice] = r as [unknown, unknown, unknown];
    if (typeof className !== 'string' || typeof table !== 'string' || !PART_TABLES.has(table) || !isPlain(slice)) return null;
    // The publisher writes each class name once, from the first table that holds it.
    if (!entities.has(className)) entities.set(className, { kind: table as CodexKind, payload: guarded(slice, partKeys) });
  }
  const shotKeys = new Set(ammoKeys);
  const shots = new Map<string, unknown>();
  for (const r of ammo as unknown[]) {
    if (!Array.isArray(r) || r.length !== 2 || typeof r[0] !== 'string' || !isPlain(r[1])) return null;
    shots.set(r[0], guarded(r[1], shotKeys));
  }
  return { entities, absent: new Set(absent), ammo: shots, cutReads: () => cuts };
}
