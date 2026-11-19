import { Injectable, InjectionToken, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { logWarn } from '../core/log';
import { ListSnapshot, ListSnapshotName, SNAPSHOT_COLUMNS, makeSnapshot } from './codex-list-engine';

/**
 * Codex catalog lists of a build, read from R2 through the assets Worker
 * (concept supabase-io-last, item "d-cache"). Written by ingest-catalog:
 * supabase/functions/ingest-catalog/_list-snapshots.ts is the source of truth.
 *
 *   codex-lists/<build>/index.json          which files exist, their gen (5 min cache)
 *   codex-lists/<build>/<gen>/<name>.json   one kind's rows, or `facets` (immutable)
 *
 * The parsed files stay in memory for the current build — they are the list
 * cache. Every answer is "a snapshot" or `null`; `null` means the caller reads
 * the database exactly as before. Until a build is published the index is a
 * 404: that is the normal state, remembered for {@link ABSENT_RETRY_MS} and
 * never logged.
 */

/** How long a call waits for a file still downloading before it uses the database. */
export const LIST_SNAPSHOT_WAIT_MS = 3000;
/** A build without an index is asked again after this long (like the build revalidation gap). */
export const ABSENT_RETRY_MS = 5 * 60 * 1000;
/** A file whose download failed (network, HTTP error, abort) is not asked again before this. */
export const FAILED_RETRY_MS = 60 * 1000;
/** A download (index or file) still running after this is aborted and counts as failed. */
export const FETCH_TIMEOUT_MS = 30 * 1000;

export interface ListsIndex {
  v: 1;
  build: string;
  gen: string;
  files: Record<string, { rows: number; bytes: number }>;
}

/** facets.json: `codex_facet_values(p_build_id, p_kind)` per kind, unchanged. */
export type ListFacets = Record<string, unknown>;

const GEN_RE = /^[0-9a-z]{6,16}$/;

export function isListsIndex(v: unknown, buildId: string): v is ListsIndex {
  const i = v as ListsIndex | null;
  return !!i && i.v === 1 && i.build === buildId && typeof i.gen === 'string' && GEN_RE.test(i.gen) &&
    !!i.files && typeof i.files === 'object' && !Array.isArray(i.files);
}

/** A kind file → snapshot, or `null` when its shape is not what this client reads. */
export function parseListFile(body: unknown, name: ListSnapshotName): ListSnapshot | null {
  const f = body as { v?: unknown; kind?: unknown; columns?: unknown; payloadKeys?: unknown; rows?: unknown } | null;
  if (!f || f.v !== 1 || f.kind !== name) return null;
  const { columns, payloadKeys, rows } = f;
  if (!Array.isArray(columns) || !columns.every((c) => typeof c === 'string')) return null;
  if (!Array.isArray(payloadKeys) || !payloadKeys.every((k) => typeof k === 'string')) return null;
  const expected = SNAPSHOT_COLUMNS[name];
  if (expected.some((c, i) => columns[i] !== c)) return null;
  if (!Array.isArray(rows)) return null;
  const width = columns.length + payloadKeys.length;
  if (!rows.every((r) => Array.isArray(r) && r.length === width)) return null;
  return makeSnapshot(name, columns as string[], payloadKeys as string[], rows as unknown[][]);
}

/** The fetch the list reader uses — a token so specs never touch the network. */
export const LIST_SNAPSHOT_FETCH = new InjectionToken<typeof fetch>('LIST_SNAPSHOT_FETCH', {
  providedIn: 'root',
  factory: () => (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
});

/** Base of the assets Worker, without a trailing slash; '' when none is configured. */
export const LIST_SNAPSHOT_BASE = new InjectionToken<string>('LIST_SNAPSHOT_BASE', {
  providedIn: 'root',
  factory: () => (environment.assets?.r2BaseUrl ?? '').trim().replace(/\/+$/, ''),
});

class NotPublished extends Error {}

type FileName = ListSnapshotName | 'facets';

@Injectable({ providedIn: 'root' })
export class CodexListSnapshots {
  private readonly fetchFn = inject(LIST_SNAPSHOT_FETCH);
  private readonly base = inject(LIST_SNAPSHOT_BASE);

  /** The build whose files are held; a call for another build drops them all. */
  private buildId: string | null = null;
  private index: Promise<ListsIndex | null> | null = null;
  /** Until when this build counts as unpublished (index 404). */
  private absentUntil = 0;
  /** Downloads in flight, one per file. */
  private readonly files = new Map<FileName, Promise<unknown>>();
  /** Settled answers, so a loaded file answers without waiting on a timer. */
  private readonly ready = new Map<FileName, unknown>();
  /** Files a call already gave up waiting for: later calls do not wait again while that download runs. */
  private readonly timedOut = new Set<FileName>();
  /** Per file: no new download before this time (a network failure). */
  private readonly failedUntil = new Map<FileName, number>();
  /** `<gen>/<name>` of files with an unexpected shape: immutable, so never asked again for that gen. */
  private readonly malformed = new Set<string>();
  private readonly warned = new Set<string>();

  /**
   * All rows of one list file of `buildId`, or `null` (not published, outage,
   * unexpected shape, or still downloading after `waitMs`; the download then
   * goes on and answers a later call once it has arrived).
   */
  async rows(buildId: string, name: ListSnapshotName, waitMs = LIST_SNAPSHOT_WAIT_MS): Promise<ListSnapshot | null> {
    return (await this.file(buildId, name, waitMs)) as ListSnapshot | null;
  }

  /** facets.json of `buildId` (`kinds` map), or `null` — same rules as {@link rows}. */
  async facets(buildId: string, waitMs = LIST_SNAPSHOT_WAIT_MS): Promise<ListFacets | null> {
    return (await this.file(buildId, 'facets', waitMs)) as ListFacets | null;
  }

  private async file(buildId: string, name: FileName, waitMs: number): Promise<unknown> {
    if (!this.base) return null;
    this.switchTo(buildId);
    if (this.ready.has(name)) return this.ready.get(name) ?? null;
    const now = Date.now();
    if (now < this.absentUntil || now < (this.failedUntil.get(name) ?? 0)) return null;
    let p = this.files.get(name);
    if (p) {
      // A call already waited its 3 s for this download: the database answers until it arrives.
      if (this.timedOut.has(name)) return null;
    } else {
      p = this.start(buildId, name);
      this.files.set(name, p);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let late = false;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        late = true;
        resolve(null);
      }, waitMs);
    });
    try {
      const value = await Promise.race([p, timeout]);
      if (late && this.files.get(name) === p) this.timedOut.add(name);
      return value;
    } finally {
      clearTimeout(timer);
    }
  }

  /** One download of one file with its bookkeeping; resolves to the value or `null`, never rejects. */
  private start(buildId: string, name: FileName): Promise<unknown> {
    const current = () => this.buildId === buildId;
    const settle = () => {
      if (!current()) return;
      this.files.delete(name);
      this.timedOut.delete(name);
    };
    return this.load(buildId, name).then(
      (value) => {
        settle();
        if (current() && value !== null) this.ready.set(name, value);
        return value;
      },
      (err: unknown) => {
        settle();
        if (err instanceof NotPublished) return null;
        if (current()) this.failedUntil.set(name, Date.now() + FAILED_RETRY_MS);
        this.warnOnce(`${buildId}|${name}|load`, 'list snapshot unavailable', { name, err });
        return null;
      },
    );
  }

  private switchTo(buildId: string): void {
    if (this.buildId === buildId) return;
    this.buildId = buildId;
    this.index = null;
    this.absentUntil = 0;
    this.files.clear();
    this.ready.clear();
    this.timedOut.clear();
    this.failedUntil.clear();
    this.malformed.clear();
  }

  private loadIndex(buildId: string): Promise<ListsIndex | null> {
    if (!this.index) {
      const p = this.fetchIndex(buildId).catch((err: unknown) => {
        if (this.index === p) this.index = null; // outage, not absence: ask again next time
        throw err;
      });
      this.index = p;
    }
    return this.index;
  }

  /**
   * GET + JSON body with a {@link FETCH_TIMEOUT_MS} abort: a hung download
   * counts as a failed one. `body` is null for a non-2xx answer.
   */
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

  private async fetchIndex(buildId: string): Promise<ListsIndex> {
    const res = await this.getJson(`${this.base}/codex-lists/${buildId}/index.json`);
    if (res.status === 404) {
      // Not published (yet): the normal state until the first publish.
      if (this.buildId === buildId) this.absentUntil = Date.now() + ABSENT_RETRY_MS;
      this.index = null;
      throw new NotPublished();
    }
    if (!res.ok) throw new Error(`list index HTTP ${res.status}`);
    if (!isListsIndex(res.body, buildId)) throw new Error('list index malformed');
    return res.body;
  }

  private async load(buildId: string, name: FileName): Promise<unknown> {
    const index = await this.loadIndex(buildId);
    if (!index || !index.files[name]) return null;
    const id = `${index.gen}/${name}`;
    if (this.malformed.has(id)) return null;
    const res = await this.getJson(`${this.base}/codex-lists/${buildId}/${id}.json`);
    if (!res.ok) throw new Error(`list file HTTP ${res.status}`);
    if (name === 'facets') {
      const f = res.body as { v?: unknown; kinds?: unknown } | null;
      if (f && f.v === 1 && f.kinds && typeof f.kinds === 'object' && !Array.isArray(f.kinds)) return f.kinds;
    } else {
      const snap = parseListFile(res.body, name);
      if (snap) return snap;
    }
    // Files are immutable: this gen's file stays unusable; a new gen in the index resets it.
    if (this.buildId === buildId) this.malformed.add(id);
    this.warnOnce(`${buildId}|${name}|shape`, 'list snapshot has an unexpected shape', { name });
    return null;
  }

  private warnOnce(key: string, message: string, detail: unknown): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    logWarn('codex', message, detail);
  }
}
