import { Injectable, inject } from '@angular/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { environment } from '../../../environments/environment';
import { logWarn } from '../../core/log';
import { shipSkinsBase } from '../ship-skins.service';
import {
  type AssetPackageKind,
  type AssetPackageManifest,
  type AssetPackageRow,
  packageUrls,
  parseManifest,
  rowFromDb,
} from './asset-package.model';

/**
 * Dev-only fixture override: set `localStorage['sc.assetPackages.devBase']` to a
 * local folder URL laid out like `ship-skins/` (`_manifests/`, `_hulls/`,
 * `_parts/`, `_interiors/`) plus an `asset_packages.json` array of rows. Ignored
 * in production builds.
 */
export const DEV_BASE_KEY = 'sc.assetPackages.devBase';

/** The slice of the supabase query builder this service uses (asset_packages is newer than database.types). */
interface RowQuery {
  select(cols: string): RowQuery;
  eq(col: string, v: string): RowQuery;
  in(col: string, v: readonly string[]): RowQuery;
  limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
}

const ROW_COLS =
  'kind, entity_class, ship_id, manifest_sha256, root_sha256, interior_sha256, part_count, total_bytes, schema_version';

/**
 * A cached GLB download. `background` = started by an idle prefetch (#404): its
 * own controller aborts it when the prefetch is cancelled, unless a foreground
 * caller joined it first (that clears the flag, and the download then runs to
 * the end for that caller).
 */
interface BufferEntry {
  p: Promise<ArrayBuffer>;
  bytes: number;
  background: boolean;
}

/** An idle prefetch's handle: cancelled with `signal`, fetched at low network priority. */
export interface BackgroundFetch {
  readonly signal: AbortSignal;
}

/** Keep at most this many GLB bytes in the session cache (parts are shared between entities). */
const BUFFER_BUDGET = 96 * 1024 * 1024;

/**
 * Loads 3D asset packages: `asset_packages` row → manifest → GLB bytes, every
 * blob cached by sha256 (immutable keys). Errors are thrown to the caller,
 * which maps them through `toErrorKey`.
 */
@Injectable({ providedIn: 'root' })
export class AssetPackageService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly rows = new Map<string, Promise<AssetPackageRow | null>>();
  private readonly manifests = new Map<string, Promise<AssetPackageManifest>>();
  private readonly buffers = new Map<string, BufferEntry>();
  private bufferedBytes = 0;

  /** `…/ship-skins/` (or the dev fixture folder). */
  readonly base: string = this.devBase() ?? shipSkinsBase(environment.assets?.r2BaseUrl);
  readonly urls = packageUrls(this.base);

  private devBase(): string | null {
    if (environment.production) return null;
    try {
      const v = localStorage.getItem(DEV_BASE_KEY)?.trim();
      return v ? (v.endsWith('/') ? v : `${v}/`) : null;
    } catch {
      return null;
    }
  }

  /**
   * The package row for an entity, trying `kinds` in order. Null = no package
   * (the caller hides the viewer / falls back). Throws on a query failure.
   */
  findRow(kinds: readonly AssetPackageKind[], entityClass: string): Promise<AssetPackageRow | null> {
    const key = `${kinds.join(',')}|${entityClass.toLowerCase()}`;
    let hit = this.rows.get(key);
    if (!hit) {
      hit = this.queryRow(kinds, entityClass);
      this.rows.set(key, hit);
      hit.catch(() => this.rows.delete(key));
    }
    return hit;
  }

  private async queryRow(kinds: readonly AssetPackageKind[], entityClass: string): Promise<AssetPackageRow | null> {
    if (!entityClass || kinds.length === 0) return null;
    let raw: unknown[];
    if (this.base !== shipSkinsBase(environment.assets?.r2BaseUrl)) {
      const res = await fetch(`${this.base}asset_packages.json`);
      if (!res.ok) throw Object.assign(new Error(`fixture rows ${res.status}`), { status: res.status });
      raw = (await res.json()) as unknown[];
    } else {
      const q = (this.sb.client as unknown as { from(t: string): RowQuery })
        .from('asset_packages')
        .select(ROW_COLS)
        .eq('entity_class', entityClass)
        .in('kind', kinds);
      const { data, error } = await q.limit(kinds.length);
      if (error) throw error;
      raw = data ?? [];
    }
    const rows = raw.map(rowFromDb).filter((r): r is AssetPackageRow => !!r);
    const lc = entityClass.toLowerCase();
    for (const k of kinds) {
      const r = rows.find((x) => x.kind === k && x.entityClass.toLowerCase() === lc);
      if (r) return r;
    }
    return null;
  }

  manifest(sha: string): Promise<AssetPackageManifest> {
    let hit = this.manifests.get(sha);
    if (!hit) {
      hit = this.fetchOk(this.urls.manifest(sha)).then(async (r) => parseManifest(await r.json()));
      this.manifests.set(sha, hit);
      hit.catch(() => this.manifests.delete(sha));
    }
    return hit;
  }

  /**
   * GLB bytes by URL (URLs are sha-keyed, so the URL is the cache key). With `bg`
   * the download is an idle prefetch: low priority and cancelled by `bg.signal`.
   * A foreground call that finds a background download joins it and keeps it alive.
   */
  glb(url: string, bg?: BackgroundFetch): Promise<ArrayBuffer> {
    const hit = this.buffers.get(url);
    if (hit) {
      // LRU touch.
      this.buffers.delete(url);
      this.buffers.set(url, hit);
      if (!bg) hit.background = false;
      return hit.p;
    }
    const entry: BufferEntry = { p: Promise.resolve(new ArrayBuffer(0)), bytes: 0, background: !!bg };
    let init: RequestInit | undefined;
    if (bg) {
      const ctrl = new AbortController();
      const cancel = (): void => {
        if (entry.background) ctrl.abort();
      };
      if (bg.signal.aborted) cancel();
      else bg.signal.addEventListener('abort', cancel, { once: true });
      init = lowPriority(ctrl.signal);
    }
    entry.p = this.fetchOk(url, init)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        entry.bytes = buf.byteLength;
        this.bufferedBytes += buf.byteLength;
        this.evict();
        return buf;
      });
    entry.p.catch(() => {
      if (this.buffers.get(url) === entry) this.buffers.delete(url);
    });
    this.buffers.set(url, entry);
    return entry.p;
  }

  private evict(): void {
    for (const [url, e] of this.buffers) {
      if (this.bufferedBytes <= BUFFER_BUDGET || this.buffers.size <= 1) break;
      this.buffers.delete(url);
      this.bufferedBytes -= e.bytes;
    }
  }

  private readonly preloads = new Map<string, Promise<boolean>>();
  private scenePreload: Promise<unknown> | null = null;

  /**
   * Warm the cache for a ship's package: row, manifest, root GLB and every
   * part GLB the viewer will ask for (same URLs, so `glb()` is a cache hit).
   * Resolves true when all of it is cached, false when the ship has no package
   * or anything failed (logged). Never throws; callers share one promise.
   */
  preloadShip(shipId: string): Promise<boolean> {
    const key = shipId.toLowerCase();
    let hit = this.preloads.get(key);
    if (!hit) {
      hit = this.doPreloadShip(shipId).catch((err: unknown) => {
        logWarn('asset-package', 'preload failed', { shipId, err });
        this.preloads.delete(key);
        return false;
      });
      this.preloads.set(key, hit);
    }
    return hit;
  }

  private async doPreloadShip(shipId: string): Promise<boolean> {
    const row = await this.findRow(['ship'], shipId);
    if (!row) return false;
    const m = await this.manifest(row.manifestSha256);
    const shas = [...new Set(m.placements.filter((p) => p.partSha256 && p.position).map((p) => p.partSha256!))];
    await Promise.all([
      m.root ? this.glb(this.urls.root(m.kind, m.root.sha256)) : Promise.resolve(),
      ...shas.map((sha) => this.glb(this.urls.part(sha))),
    ]);
    return true;
  }

  /**
   * The idle prefetch of one ship's package (#404): row, manifest, root and part
   * GLBs one after the other at low priority, stopping as soon as `bg.signal`
   * aborts. Everything lands in the same caches the viewer reads, so a click on
   * "3D" finds it ready or joins the download in flight. Resolves true when all
   * of it is cached; false when there is no package, it was cancelled or failed.
   * Never throws.
   */
  async prefetchShip(shipId: string, bg: BackgroundFetch): Promise<boolean> {
    try {
      const row = await this.findRow(['ship'], shipId);
      if (!row || bg.signal.aborted) return false;
      const m = await this.manifest(row.manifestSha256);
      const urls = [
        ...(m.root ? [this.urls.root(m.kind, m.root.sha256)] : []),
        ...new Set(m.placements.filter((p) => p.partSha256 && p.position).map((p) => this.urls.part(p.partSha256!))),
      ];
      for (const url of urls) {
        if (bg.signal.aborted) return false;
        await this.glb(url, bg);
      }
      return !bg.signal.aborted;
    } catch (err) {
      if (!bg.signal.aborted) logWarn('asset-package', 'prefetch failed', { shipId, err });
      return false;
    }
  }

  /** Fetch the lazy three.js scene chunk ahead of the viewer (idempotent; failures only retry later). */
  preloadScene(): Promise<unknown> {
    this.scenePreload ??= import('./asset-package-scene').catch((err: unknown) => {
      this.scenePreload = null;
      logWarn('asset-package', 'scene chunk preload failed', { err });
    });
    return this.scenePreload;
  }

  private async fetchOk(url: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(url, init);
    if (!res.ok) throw Object.assign(new Error(`GET ${url} → ${res.status}`), { status: res.status });
    return res;
  }
}

/** Request options of an idle prefetch: low fetch priority (where supported) and cancellable. */
function lowPriority(signal: AbortSignal): RequestInit {
  return { signal, priority: 'low' } as RequestInit;
}
