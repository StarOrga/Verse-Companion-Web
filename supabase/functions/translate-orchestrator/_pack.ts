// Community global.ini packs: parsing and source resolution (concept 2026-11-08).
// Plain, erasable TypeScript (node --test + Deno). Memory: a pack is ~12 MB and a request has 256 MB,
// of which a download can take far more than its size (see `readCapped`). The import therefore never
// holds a pack: `openSource` hands out its bytes as they arrive, `iniDecoder` + `lineCutter` turn them
// into pieces of whole lines, and each piece is stored and parsed on its own. A zip is only inflated
// for its one entry (fflate `filter`).

export interface ParsedPack {
  /** normalised key → value (the Frontend_PU_Version header line is NOT in here). */
  map: Map<string, string>;
  /** Value of the first `Frontend_PU_Version=…` line (the pack's attribution), or null. */
  header: string | null;
  /** Lines that carried a `key=value` pair. */
  lines: number;
}

/** Lower-cased key without the trailing `,P` marker some packs carry. */
export function normalizeKey(k: string): string {
  let key = k.trim().toLowerCase();
  if (key.endsWith(',p')) key = key.slice(0, -2);
  return key;
}

/** UTF-8 (with/without BOM) and UTF-16 LE/BE (BOM, or NUL-heavy start) tolerant decode. */
export function decodeIni(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes.length >= 4 && bytes[1] === 0 && bytes[3] === 0 && bytes[0] !== 0) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  return new TextDecoder('utf-8').decode(bytes);
}

/** Which encoding `decodeIni` would pick, read from the first bytes; null = more bytes are needed to tell. */
function encodingOf(head: Uint8Array, complete: boolean): string | null {
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  if (head.length < 4 && !complete) return null;
  if (head.length >= 4 && head[1] === 0 && head[3] === 0 && head[0] !== 0) return 'utf-16le';
  return 'utf-8';
}

export interface IniDecoder {
  /** The text of these bytes; a character cut by the end of a chunk comes with the next one. */
  push(bytes: Uint8Array): string;
  /** What is left when the bytes are over. */
  end(): string;
}

/**
 * `decodeIni` for bytes that arrive in chunks: same encodings, same result, but the whole file is never
 * held. The BOM is dropped by the decoder itself.
 */
export function iniDecoder(): IniDecoder {
  let dec: TextDecoder | null = null;
  let head: Uint8Array | null = new Uint8Array(0);
  const start = (complete: boolean): string => {
    const enc = encodingOf(head!, complete);
    if (!enc) return '';
    dec = new TextDecoder(enc);
    const first = head!;
    head = null;
    return dec.decode(first, { stream: true });
  };
  return {
    push(bytes) {
      if (dec) return dec.decode(bytes, { stream: true });
      const joined = new Uint8Array(head!.length + bytes.length);
      joined.set(head!, 0);
      joined.set(bytes, head!.length);
      head = joined;
      return start(false);
    },
    end() {
      const first = dec ? '' : start(true);
      return first + dec!.decode();
    },
  };
}

export interface LineCutter {
  /** Adds text and returns the pieces that are full: each ends on a line break. */
  push(text: string): string[];
  /** The rest, or null when nothing is left. */
  end(): string | null;
}

/** Cuts a text that arrives in parts into pieces of about `size` characters, never inside a line. */
export function lineCutter(size: number): LineCutter {
  let buf = '';
  return {
    push(text) {
      buf += text;
      const out: string[] = [];
      while (buf.length >= size) {
        // The last line break inside the first `size` characters; a line longer than that ends the piece.
        let cut = buf.lastIndexOf('\n', size - 1);
        if (cut === -1) cut = buf.indexOf('\n', size);
        if (cut === -1) break;
        out.push(buf.slice(0, cut + 1));
        buf = buf.slice(cut + 1);
      }
      return out;
    },
    end() {
      const rest = buf;
      buf = '';
      return rest ? rest : null;
    },
  };
}

const HEADER_KEY = 'frontend_pu_version';

/** `key=value` per line; later duplicates win; no regex over the whole text, no line array. */
export function parseIni(text: string): ParsedPack {
  const map = new Map<string, string>();
  let header: string | null = null;
  let lines = 0;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  while (pos < n) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = n;
    let stop = end;
    if (stop > pos && text.charCodeAt(stop - 1) === 13) stop--;
    const eq = text.indexOf('=', pos);
    if (eq !== -1 && eq < stop && eq > pos) {
      const key = normalizeKey(text.slice(pos, eq));
      const value = text.slice(eq + 1, stop);
      if (key) {
        lines++;
        if (key === HEADER_KEY) {
          if (header === null) header = value;
        } else map.set(key, value);
      }
    }
    pos = end + 1;
  }
  return { map, header, lines };
}

export function parsePack(bytes: Uint8Array): ParsedPack {
  return parseIni(decodeIni(bytes));
}

// ── source resolution ──

export type Resolver =
  | { kind: 'github-release'; owner: string; repo: string; asset: string }
  | { kind: 'zip-entry'; path: string };

/** `github-release:<owner>/<repo>:<asset>` · `zip-entry:<path>`; null when malformed. */
export function parseResolver(r: string | null | undefined): Resolver | null {
  if (!r) return null;
  if (r.startsWith('zip-entry:')) {
    const path = r.slice('zip-entry:'.length);
    return path && !path.includes('..') ? { kind: 'zip-entry', path } : null;
  }
  const m = /^github-release:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+):(.+)$/.exec(r);
  return m ? { kind: 'github-release', owner: m[1], repo: m[2], asset: m[3] } : null;
}

/** raw.githubusercontent.com/<owner>/<repo>/<branch>/<path> → parts (for the commits API). */
export function parseRawGithub(url: string): { owner: string; repo: string; branch: string; path: string } | null {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url);
  if (!m) return null;
  let path = m[4];
  try {
    path = decodeURIComponent(path);
  } catch { /* keep as is */ }
  return { owner: m[1], repo: m[2], branch: m[3], path };
}

export interface PackSource {
  id: string;
  raw_url: string | null;
  resolver: string | null;
}

export interface ResolvedPack {
  bytes: Uint8Array;
  /** Version marker of what was fetched (release tag, ETag …), best effort. */
  token: string | null;
  url: string;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const MAX_INI_BYTES = 40 * 1024 * 1024;
export const MAX_ZIP_BYTES = 120 * 1024 * 1024;

const GH_HEADERS = (token?: string): Record<string, string> => ({
  accept: 'application/vnd.github+json',
  'user-agent': 'VerseCompanion-translation',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

/**
 * The bytes of a response as they arrive, at most `max` of them.
 *
 * A chunk must not be kept: the runtime reads into a buffer of 64 KB and hands out a view of the part
 * that was filled, so a list of chunks holds 64 KB for every few KB that came in. The first live import
 * (2026-11-17, a pack of 11.8 MB) had 203 MB of such buffers when the worker was killed at its 256 MB.
 * Whoever reads this uses a chunk before asking for the next one.
 */
async function* bodyChunks(res: Response, max: number): AsyncGenerator<Uint8Array> {
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > max) {
    await res.body?.cancel().catch(() => {});
    throw new Error('translate.source_too_large');
  }
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > max) throw new Error('translate.source_too_large');
    yield buf;
    return;
  }
  let total = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      total += value.length;
      if (total > max) throw new Error('translate.source_too_large');
      yield value;
    }
  } finally {
    // Also when the reader of the chunks stops early or throws: the connection is given back.
    await reader.cancel().catch(() => {});
  }
}

/** All bytes of a response in ONE buffer that grows as they arrive (no chunk is kept, see `bodyChunks`). */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const len = Number(res.headers.get('content-length') ?? 0);
  let out = new Uint8Array(Math.min(Math.max(len, 1 << 20), max));
  let total = 0;
  for await (const chunk of bodyChunks(res, max)) {
    if (total + chunk.length > out.length) {
      const grown = new Uint8Array(Math.min(Math.max(out.length * 2, total + chunk.length), Math.max(max, total + chunk.length)));
      grown.set(out.subarray(0, total), 0);
      out = grown;
    }
    out.set(chunk, total);
    total += chunk.length;
  }
  return out.subarray(0, total);
}

async function openUrl(f: FetchFn, url: string, headers?: Record<string, string>): Promise<Response> {
  const res = await f(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`translate.source_fetch_${res.status}`);
  }
  return res;
}

async function getBytes(f: FetchFn, url: string, max: number, headers?: Record<string, string>): Promise<{ bytes: Uint8Array; res: Response }> {
  const res = await openUrl(f, url, headers);
  return { bytes: await readCapped(res, max), res };
}

export interface LatestRelease {
  tag: string;
  assetUrl: string;
  assetUpdated: string | null;
}

export async function latestRelease(f: FetchFn, r: Extract<Resolver, { kind: 'github-release' }>, ghToken?: string): Promise<LatestRelease> {
  const res = await f(`https://api.github.com/repos/${r.owner}/${r.repo}/releases/latest`, {
    headers: GH_HEADERS(ghToken),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`translate.source_fetch_${res.status}`);
  const rel = await res.json() as { tag_name?: string; assets?: { name: string; browser_download_url: string; updated_at?: string }[] };
  const asset = (rel.assets ?? []).find((a) => a.name === r.asset);
  if (!asset) throw new Error('translate.source_asset_missing');
  return { tag: String(rel.tag_name ?? ''), assetUrl: asset.browser_download_url, assetUpdated: asset.updated_at ?? null };
}

/** Extracts one entry of a zip; only that entry is inflated. fflate is loaded lazily (tests never need it). */
export type UnzipFn = (zip: Uint8Array, opts: { filter: (f: { name: string }) => boolean }) => Record<string, Uint8Array>;

/** `unzip` is injectable so tests can pass a node-side reader; the default is fflate (Deno `npm:`). */
export async function unzipEntry(zip: Uint8Array, path: string, unzip?: UnzipFn): Promise<Uint8Array> {
  const unzipSync: UnzipFn = unzip ?? (await import('npm:fflate@0.8.2')).unzipSync;
  const files = unzipSync(zip, { filter: (f: { name: string }) => f.name === path });
  const hit = files[path];
  if (!hit) throw new Error('translate.source_entry_missing');
  return hit;
}

/**
 * The whole global.ini of one source in memory. For tests and scripts only: an edge request takes it
 * through `openSource`, piece by piece.
 */
export async function resolveSource(src: PackSource, f: FetchFn = fetch, ghToken?: string, unzip?: UnzipFn): Promise<ResolvedPack> {
  const opened = await openSource(src, f, ghToken, unzip);
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of opened.chunks) {
    parts.push(chunk.slice());
    total += chunk.length;
  }
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  return { bytes, token: opened.token, url: opened.url };
}

export interface OpenedPack {
  /** The bytes of the global.ini as they arrive. Use each chunk before asking for the next one. */
  chunks: AsyncIterable<Uint8Array>;
  /** Version marker of what is being fetched (release tag, ETag …), best effort. */
  token: string | null;
  url: string;
}

/** What a zip entry is handed out in: it is in memory already, the reader still gets it in small parts. */
const ENTRY_CHUNK = 256 * 1024;

/**
 * Opens one source's global.ini (raw url · latest release asset · zip entry) without reading it: the
 * import takes the bytes chunk by chunk and never holds the file. Only a zip has to be held whole, to
 * inflate its one entry.
 */
export async function openSource(src: PackSource, f: FetchFn = fetch, ghToken?: string, unzip?: UnzipFn): Promise<OpenedPack> {
  const r = parseResolver(src.resolver);
  if (src.resolver && !r) throw new Error('translate.source_resolver_invalid');
  if (r?.kind === 'github-release') {
    const rel = await latestRelease(f, r, ghToken);
    const res = await openUrl(f, rel.assetUrl, GH_HEADERS(ghToken));
    return { chunks: bodyChunks(res, MAX_INI_BYTES), token: `${rel.tag}@${rel.assetUpdated ?? ''}`, url: rel.assetUrl };
  }
  if (!src.raw_url) throw new Error('translate.source_no_url');
  if (r?.kind === 'zip-entry') {
    const { bytes, res } = await getBytes(f, src.raw_url, MAX_ZIP_BYTES);
    const entry = await unzipEntry(bytes, r.path, unzip);
    if (entry.length > MAX_INI_BYTES) throw new Error('translate.source_too_large');
    const parts = (async function* () {
      for (let o = 0; o < entry.length; o += ENTRY_CHUNK) yield entry.subarray(o, o + ENTRY_CHUNK);
    })();
    return { chunks: parts, token: res.headers.get('etag') ?? res.headers.get('last-modified'), url: src.raw_url };
  }
  const res = await openUrl(f, src.raw_url);
  return { chunks: bodyChunks(res, MAX_INI_BYTES), token: res.headers.get('etag'), url: src.raw_url };
}

/**
 * Cheap upstream version marker for the daily sync (no pack download):
 * raw GitHub file → newest commit sha touching the path · release → tag@asset time ·
 * zip / other → ETag or Last-Modified of a HEAD request. null when nothing can be learned.
 */
export async function upstreamToken(src: PackSource, f: FetchFn = fetch, ghToken?: string): Promise<string | null> {
  const r = parseResolver(src.resolver);
  if (r?.kind === 'github-release') {
    const rel = await latestRelease(f, r, ghToken);
    return `${rel.tag}@${rel.assetUpdated ?? ''}`;
  }
  if (!src.raw_url) return null;
  const gh = r ? null : parseRawGithub(src.raw_url);
  if (gh) {
    const q = new URLSearchParams({ path: gh.path, sha: gh.branch, per_page: '1' });
    const res = await f(`https://api.github.com/repos/${gh.owner}/${gh.repo}/commits?${q}`, {
      headers: GH_HEADERS(ghToken),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`translate.source_fetch_${res.status}`);
    const list = await res.json() as { sha?: string }[];
    return list[0]?.sha ?? null;
  }
  const head = await f(src.raw_url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!head.ok) throw new Error(`translate.source_fetch_${head.status}`);
  return head.headers.get('etag') ?? head.headers.get('last-modified');
}
