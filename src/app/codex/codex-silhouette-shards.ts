import { Injectable, InjectionToken, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { logWarn } from '../core/log';
import type { SilhouetteKind } from './holo-silhouette';

/**
 * Silhouettes of a build, read from R2 through the assets Worker instead of
 * `codex_silhouettes`. Written by ingest-catalog:
 * supabase/functions/ingest-catalog/_silhouette-shards.ts is the source of truth.
 *
 *   codex-silhouettes/<build>/index.json                which kinds exist, their gen (5 min cache)
 *   codex-silhouettes/<build>/<gen>/<kind>/names.json   every class name with an outline, shard by shard (immutable)
 *   codex-silhouettes/<build>/<gen>/<kind>/<n>.json     the rows of one shard (immutable)
 *
 * Shards follow the catalog's list order, so a list page's rows sit in a few
 * neighbouring shards and a detail page needs one. An answer is rows shaped
 * exactly like the table's, or `null` / `open` names - then the caller reads
 * the database as before. Until a build is published the index is a 404: the
 * normal state, remembered for {@link ABSENT_RETRY_MS} and never logged.
 */

/** A build without an index is asked again after this long. */
export const ABSENT_RETRY_MS = 5 * 60 * 1000;
/** A file whose download failed is not asked again before this. */
export const FAILED_RETRY_MS = 60 * 1000;
/** A download still running after this is aborted and counts as failed. */
export const FETCH_TIMEOUT_MS = 10 * 1000;
/** Parsed shards kept in memory (about 110 kB each); the browser's HTTP cache holds the rest. */
export const SHARDS_KEPT = 64;

export interface SilhouetteShardIndex {
  v: 1;
  build: string;
  gen: string;
  kinds: Record<string, { count: number; shards: number }>;
}

const GEN_RE = /^[0-9a-z]{6,16}$/;

export function isSilhouetteShardIndex(v: unknown, buildId: string): v is SilhouetteShardIndex {
  const i = v as SilhouetteShardIndex | null;
  if (!i || i.v !== 1 || i.build !== buildId || typeof i.gen !== 'string' || !GEN_RE.test(i.gen)) return false;
  if (!i.kinds || typeof i.kinds !== 'object' || Array.isArray(i.kinds)) return false;
  return Object.values(i.kinds).every((k) =>
    !!k && Number.isInteger(k.count) && k.count >= 0 && Number.isInteger(k.shards) && k.shards >= 0);
}

/** names.json → class name → shard number, or `null` when its shape is not what this client reads. */
export function parseSilhouetteNames(body: unknown, kind: string): Map<string, number> | null {
  const f = body as { v?: unknown; kind?: unknown; shards?: unknown } | null;
  if (!f || f.v !== 1 || f.kind !== kind || !Array.isArray(f.shards)) return null;
  const out = new Map<string, number>();
  for (let n = 0; n < f.shards.length; n++) {
    const names: unknown = f.shards[n];
    if (!Array.isArray(names)) return null;
    for (const name of names) {
      if (typeof name !== 'string') return null;
      out.set(name, n);
    }
  }
  return out;
}

const ROW_COLUMNS = ['class_name', 'shape', 'meta', 'generated_at', 'channel', 'patch_version', 'build_number'] as const;
const SHAPE_COLUMNS = ['view_box', 'path', 'edges', 'bbox', 'anchors', 'unresolved'] as const;

function startsWith(columns: unknown, expected: readonly string[]): boolean {
  return Array.isArray(columns) && expected.every((c, i) => columns[i] === c);
}

/**
 * A shard file → class name → the row as `codex_silhouettes` returns it for
 * CodexService's select, or `null` when its shape is not what this client reads.
 */
export function parseSilhouetteShard(body: unknown, kind: string): Map<string, Record<string, unknown>> | null {
  const f = body as { v?: unknown; kind?: unknown; columns?: unknown; shapeColumns?: unknown; shapes?: unknown; rows?: unknown } | null;
  if (!f || f.v !== 1 || f.kind !== kind) return null;
  if (!startsWith(f.columns, ROW_COLUMNS) || !startsWith(f.shapeColumns, SHAPE_COLUMNS)) return null;
  if (!Array.isArray(f.shapes) || !Array.isArray(f.rows)) return null;
  const shapes = f.shapes as unknown[];
  const out = new Map<string, Record<string, unknown>>();
  for (const r of f.rows as unknown[]) {
    if (!Array.isArray(r) || r.length < ROW_COLUMNS.length) return null;
    const [className, shapeAt, meta, generatedAt, channel, patchVersion, buildNumber] = r as unknown[];
    const shape = Number.isInteger(shapeAt) ? shapes[shapeAt as number] : undefined;
    if (typeof className !== 'string' || !Array.isArray(shape) || shape.length < SHAPE_COLUMNS.length) return null;
    const [viewBox, path, edges, bbox, anchors, unresolved] = shape as unknown[];
    out.set(className, {
      kind,
      class_name: className,
      channel,
      patch_version: patchVersion,
      build_number: buildNumber,
      view_box: viewBox,
      path,
      edges,
      bbox,
      anchors,
      unresolved,
      meta,
      generated_at: generatedAt,
    });
  }
  return out;
}

/** The fetch the shard reader uses — a token so specs never touch the network. */
export const SILHOUETTE_SHARD_FETCH = new InjectionToken<typeof fetch>('SILHOUETTE_SHARD_FETCH', {
  providedIn: 'root',
  factory: () => (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
});

/** Base of the assets Worker, without a trailing slash; '' when none is configured. */
export const SILHOUETTE_SHARD_BASE = new InjectionToken<string>('SILHOUETTE_SHARD_BASE', {
  providedIn: 'root',
  factory: () => (environment.assets?.r2BaseUrl ?? '').trim().replace(/\/+$/, ''),
});

export interface SilhouetteShardAnswer {
  /** Class name → its row, shaped like a `codex_silhouettes` row. */
  rows: Map<string, Record<string, unknown>>;
  /** Names the build has no silhouette of this kind for (the table would return no row). */
  absent: string[];
  /** Names whose shard could not be read right now: the caller asks the database for these. */
  open: string[];
}

class NotPublished extends Error {}
/** A file the index names is gone: the build was published again. */
class Gone extends Error {}
/** A file that failed or was malformed a moment ago: not asked again yet. */
class Backoff extends Error {}

type Shard = Map<string, Record<string, unknown>>;

@Injectable({ providedIn: 'root' })
export class CodexSilhouetteShards {
  private readonly fetchFn = inject(SILHOUETTE_SHARD_FETCH);
  private readonly base = inject(SILHOUETTE_SHARD_BASE);

  /** The build whose files are held; a call for another build drops them all. */
  private buildId: string | null = null;
  private index: Promise<SilhouetteShardIndex> | null = null;
  /** Until when this build counts as unpublished (index 404). */
  private absentUntil = 0;
  /** Per path: the names map of a kind, in flight or settled. */
  private readonly names = new Map<string, Promise<Map<string, number>>>();
  /** Per path: a shard, in flight or settled; the oldest leave past {@link SHARDS_KEPT}. */
  private readonly shards = new Map<string, Promise<Shard>>();
  /** Per path (or 'index'): no new download before this time. */
  private readonly failedUntil = new Map<string, number>();
  /** Paths with an unexpected shape: immutable, so never asked again. */
  private readonly malformed = new Set<string>();
  private readonly warned = new Set<string>();

  /**
   * The rows of `classNames` for `kind` in `buildId`, or `null` when the files
   * cannot answer at all (not published, this kind not published, outage, a
   * shape this client does not read). Never throws.
   */
  async resolve(buildId: string, kind: SilhouetteKind, classNames: readonly string[]): Promise<SilhouetteShardAnswer | null> {
    if (!this.base) return null;
    this.switchTo(buildId);
    try {
      const index = await this.loadIndex(buildId);
      const entry = index.kinds[kind];
      // A kind the index does not name was not published: the table answers.
      if (!entry) return null;
      const answer: SilhouetteShardAnswer = { rows: new Map(), absent: [], open: [] };
      if (entry.count === 0) {
        answer.absent.push(...classNames);
        return answer;
      }
      const dir = `codex-silhouettes/${buildId}/${index.gen}/${kind}/`;
      const where = await this.loadNames(`${dir}names.json`, kind);

      const byShard = new Map<number, string[]>();
      for (const name of classNames) {
        const n = where.get(name);
        if (n === undefined) answer.absent.push(name);
        else if (byShard.has(n)) byShard.get(n)!.push(name);
        else byShard.set(n, [name]);
      }
      await Promise.all(
        [...byShard].map(async ([n, wanted]) => {
          let shard: Shard;
          try {
            shard = await this.loadShard(`${dir}${n}.json`, kind);
          } catch (err) {
            this.failed(buildId, 'shard', err);
            answer.open.push(...wanted);
            return;
          }
          for (const name of wanted) {
            const row = shard.get(name);
            // In names.json but not in its shard: the row went away between plan and publish.
            if (row) answer.rows.set(name, row);
            else answer.absent.push(name);
          }
        }),
      );
      // The build changed while this ran: let the caller's own path decide.
      return this.buildId === buildId ? answer : null;
    } catch (err) {
      if (!(err instanceof NotPublished)) this.failed(buildId, 'files', err);
      return null;
    }
  }

  private switchTo(buildId: string): void {
    if (this.buildId === buildId) return;
    this.buildId = buildId;
    this.index = null;
    this.absentUntil = 0;
    this.names.clear();
    this.shards.clear();
    this.failedUntil.clear();
    this.malformed.clear();
  }

  /** Bookkeeping of a failed read: a vanished file drops the index, everything else is logged once. */
  private failed(buildId: string, what: string, err: unknown): void {
    if (this.buildId !== buildId) return;
    if (err instanceof Gone) {
      // Published again and the old generation collected: read the new index next time.
      this.index = null;
      return;
    }
    if (err instanceof NotPublished || err instanceof Backoff) return;
    this.warnOnce(`${buildId}|${what}`, 'silhouette shards unavailable, using the database', { what, err });
  }

  private loadIndex(buildId: string): Promise<SilhouetteShardIndex> {
    const now = Date.now();
    if (now < this.absentUntil) return Promise.reject(new NotPublished());
    if (now < (this.failedUntil.get('index') ?? 0)) return Promise.reject(new Backoff());
    if (!this.index) {
      const p = this.fetchIndex(buildId).catch((err: unknown) => {
        if (this.index === p) this.index = null; // outage, not absence: ask again later
        if (this.buildId === buildId && !(err instanceof NotPublished)) this.failedUntil.set('index', Date.now() + FAILED_RETRY_MS);
        throw err;
      });
      this.index = p;
    }
    return this.index;
  }

  private async fetchIndex(buildId: string): Promise<SilhouetteShardIndex> {
    const res = await this.getJson(`${this.base}/codex-silhouettes/${buildId}/index.json`);
    if (res.status === 404) {
      if (this.buildId === buildId) this.absentUntil = Date.now() + ABSENT_RETRY_MS;
      throw new NotPublished();
    }
    if (!res.ok) throw new Error(`silhouette index HTTP ${res.status}`);
    if (!isSilhouetteShardIndex(res.body, buildId)) throw new Error('silhouette index malformed');
    return res.body;
  }

  private loadNames(path: string, kind: string): Promise<Map<string, number>> {
    return this.cached(this.names, path, (body) => parseSilhouetteNames(body, kind));
  }

  private loadShard(path: string, kind: string): Promise<Shard> {
    const hit = this.shards.get(path);
    if (hit) {
      // Most recently used last.
      this.shards.delete(path);
      this.shards.set(path, hit);
      return hit;
    }
    const p = this.cached(this.shards, path, (body) => parseSilhouetteShard(body, kind));
    while (this.shards.size > SHARDS_KEPT) {
      const oldest: string = this.shards.keys().next().value!;
      this.shards.delete(oldest);
    }
    return p;
  }

  /** One immutable file per path: in flight or settled in `cache`, dropped from it when it fails. */
  private cached<T>(cache: Map<string, Promise<T>>, path: string, parse: (body: unknown) => T | null): Promise<T> {
    let p = cache.get(path);
    if (p) return p;
    if (this.malformed.has(path)) return Promise.reject(new Backoff());
    if (Date.now() < (this.failedUntil.get(path) ?? 0)) return Promise.reject(new Backoff());
    p = this.fetchFile(path, parse);
    p.catch(() => {
      if (cache.get(path) === p) cache.delete(path);
    });
    cache.set(path, p);
    return p;
  }

  private async fetchFile<T>(path: string, parse: (body: unknown) => T | null): Promise<T> {
    const buildId = this.buildId;
    const mine = () => this.buildId === buildId;
    let res: { status: number; ok: boolean; body: unknown };
    try {
      res = await this.getJson(`${this.base}/${path}`);
    } catch (err) {
      if (mine()) this.failedUntil.set(path, Date.now() + FAILED_RETRY_MS);
      throw err;
    }
    if (res.status === 404) throw new Gone();
    if (!res.ok) {
      if (mine()) this.failedUntil.set(path, Date.now() + FAILED_RETRY_MS);
      throw new Error(`silhouette file HTTP ${res.status}`);
    }
    const parsed = parse(res.body);
    if (parsed === null) {
      // Files are immutable: this path stays unusable; a new gen in the index is a new path.
      if (mine()) this.malformed.add(path);
      throw new Error('silhouette file has an unexpected shape');
    }
    return parsed;
  }

  /** GET + JSON body with a {@link FETCH_TIMEOUT_MS} abort; `body` is null for a non-2xx answer. */
  private async getJson(url: string): Promise<{ status: number; ok: boolean; body: unknown }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await this.fetchFn(url, { signal: ctrl.signal });
      const body: unknown = res.ok ? await res.json() : null;
      return { status: res.status, ok: res.ok, body };
    } finally {
      clearTimeout(timer);
    }
  }

  private warnOnce(key: string, message: string, detail: unknown): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    logWarn('codex', message, detail);
  }
}
