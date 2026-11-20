import { TestBed } from '@angular/core/testing';
import {
  ABSENT_RETRY_MS,
  CodexSilhouetteShards,
  FAILED_RETRY_MS,
  SILHOUETTE_SHARD_BASE,
  SILHOUETTE_SHARD_FETCH,
  isSilhouetteShardIndex,
  parseSilhouetteNames,
  parseSilhouetteShard,
} from './codex-silhouette-shards';
import { parseHoloSilhouette } from './holo-silhouette';

const BUILD = 'a3fb1249-9115-4035-9039-2ffc6043d832';
const OTHER = '11111111-2222-4333-8444-555555555555';
const BASE = 'https://assets.test';
const GEN = 'mgaq1z2k';
const ROOT = `${BASE}/codex-silhouettes/${BUILD}/`;

// The exact bodies supabase/functions/ingest-catalog/_silhouette-publish.test.mjs pins the
// writer to: this reader must turn them back into the table's rows.
const GOLDEN_SHARD =
  '{"v":1,"kind":"ship","shard":0,"columns":["class_name","shape","meta","generated_at","channel","patch_version","build_number"],"shapeColumns":["view_box","path","edges","bbox","anchors","unresolved"],"shapes":[["0 0 100 50","M 0 0 L 10 0 L 10 10 Z",null,{"x":0,"y":0,"w":10,"h":10},[{"portId":"hardpoint_a","x":10,"y":20}],[]]],"rows":[["A",0,{"schema":1},"2026-11-19T17:20:11.123456+00:00","LIVE","4.10.3","13165946"],["B",0,{"schema":1,"toolVersion":"0.61.0"},"2026-11-19T17:20:11.123456+00:00","LIVE","4.10.3","13165946"]]}';
const GOLDEN_NAMES = '{"v":1,"kind":"ship","shards":[["A","B"],["C"]]}';

/** What `codex_silhouettes` returns for ship A with CodexService's select. */
const ROW_A = {
  kind: 'ship', class_name: 'A', channel: 'LIVE', patch_version: '4.10.3', build_number: '13165946',
  view_box: '0 0 100 50', path: 'M 0 0 L 10 0 L 10 10 Z', edges: null, bbox: { x: 0, y: 0, w: 10, h: 10 },
  anchors: [{ portId: 'hardpoint_a', x: 10, y: 20 }], unresolved: [], meta: { schema: 1 },
  generated_at: '2026-11-19T17:20:11.123456+00:00',
};

const INDEX = {
  v: 1, build: BUILD, gen: GEN,
  kinds: { ship: { count: 3, shards: 2 }, weapon: { count: 0, shards: 0 }, item: { count: 1, shards: 1 }, armor: { count: 0, shards: 0 } },
};

/** A second ship shard: C alone. */
const SHARD_1 = JSON.stringify({ ...JSON.parse(GOLDEN_SHARD), shard: 1, rows: [['C', 0, {}, null, 'LIVE', '4.10.3', '13165946']] });

type Handler = (url: string) => Response | Promise<Response>;

function worker(over: Record<string, () => Response> = {}, index: unknown = INDEX): Handler {
  const files: Record<string, string> = {
    [`${ROOT}index.json`]: JSON.stringify(index),
    [`${ROOT}${GEN}/ship/names.json`]: GOLDEN_NAMES,
    [`${ROOT}${GEN}/ship/0.json`]: GOLDEN_SHARD,
    [`${ROOT}${GEN}/ship/1.json`]: SHARD_1,
  };
  return (url) => {
    if (over[url]) return over[url]();
    const body = files[url];
    return body ? new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('not found', { status: 404 });
  };
}

function setup(handler: Handler, base = BASE): { svc: CodexSilhouetteShards; calls: string[]; revalidated: string[] } {
  const calls: string[] = [];
  const revalidated: string[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (init?.cache === 'no-cache') revalidated.push(url);
    return handler(url);
  }) as unknown as typeof fetch;
  TestBed.configureTestingModule({
    providers: [
      { provide: SILHOUETTE_SHARD_FETCH, useValue: fetchFn },
      { provide: SILHOUETTE_SHARD_BASE, useValue: base },
    ],
  });
  return { svc: TestBed.inject(CodexSilhouetteShards), calls, revalidated };
}

const short = (calls: string[]) => calls.map((c) => c.slice(ROOT.length));

describe('silhouette shard parsers', () => {
  it('turns the writer golden shard back into the rows the table returns', () => {
    const rows = parseSilhouetteShard(JSON.parse(GOLDEN_SHARD), 'ship')!;
    expect([...rows.keys()]).toEqual(['A', 'B']);
    expect(rows.get('A')).toEqual(ROW_A);
    expect(rows.get('B')).toEqual({ ...ROW_A, class_name: 'B', meta: { schema: 1, toolVersion: '0.61.0' } });
    // and the one parser every caller uses reads both alike
    expect(parseHoloSilhouette(rows.get('A'))).toEqual(parseHoloSilhouette(ROW_A));
  });

  it('refuses a shard of another kind, version or shape', () => {
    const good = JSON.parse(GOLDEN_SHARD);
    expect(parseSilhouetteShard(good, 'item')).toBeNull();
    expect(parseSilhouetteShard({ ...good, v: 2 }, 'ship')).toBeNull();
    expect(parseSilhouetteShard({ ...good, columns: ['shape', 'class_name'] }, 'ship')).toBeNull();
    expect(parseSilhouetteShard({ ...good, rows: [['A', 7, {}, null, 'LIVE', '4', '1']] }, 'ship')).toBeNull();
    expect(parseSilhouetteShard({ ...good, shapes: [['0 0 1 1']] }, 'ship')).toBeNull();
    expect(parseSilhouetteShard(null, 'ship')).toBeNull();
  });

  it('reads later columns by position, so a column added at the end does not break it', () => {
    const good = JSON.parse(GOLDEN_SHARD);
    const wider = { ...good, columns: [...good.columns, 'extra'], rows: good.rows.map((r: unknown[]) => [...r, 1]) };
    expect(parseSilhouetteShard(wider, 'ship')!.get('A')).toEqual(ROW_A);
  });

  it('maps every name of the golden names file to its shard', () => {
    const where = parseSilhouetteNames(JSON.parse(GOLDEN_NAMES), 'ship')!;
    expect([...where]).toEqual([['A', 0], ['B', 0], ['C', 1]]);
    expect(parseSilhouetteNames(JSON.parse(GOLDEN_NAMES), 'item')).toBeNull();
    expect(parseSilhouetteNames({ v: 1, kind: 'ship', shards: [[1]] }, 'ship')).toBeNull();
  });

  it('validates an index', () => {
    expect(isSilhouetteShardIndex(INDEX, BUILD)).toBe(true);
    expect(isSilhouetteShardIndex(INDEX, OTHER)).toBe(false);
    expect(isSilhouetteShardIndex({ ...INDEX, gen: '../x' }, BUILD)).toBe(false);
    expect(isSilhouetteShardIndex({ ...INDEX, kinds: [] }, BUILD)).toBe(false);
  });
});

describe('CodexSilhouetteShards', () => {
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('answers a class from its shard: index, names, one shard - and nothing again', async () => {
    const { svc, calls } = setup(worker());
    const res = (await svc.resolve(BUILD, 'ship', ['A']))!;
    expect(res.rows.get('A')).toEqual(ROW_A);
    expect(res.absent).toEqual([]);
    expect(res.open).toEqual([]);
    expect(short(calls)).toEqual(['index.json', `${GEN}/ship/names.json`, `${GEN}/ship/0.json`]);

    const again = (await svc.resolve(BUILD, 'ship', ['B', 'A']))!;
    expect([...again.rows.keys()].sort()).toEqual(['A', 'B']);
    expect(calls.length).toBe(3);
  });

  it('reads only the shards its names live in', async () => {
    const { svc, calls } = setup(worker());
    const res = (await svc.resolve(BUILD, 'ship', ['C']))!;
    expect([...res.rows.keys()]).toEqual(['C']);
    expect(short(calls)).toEqual(['index.json', `${GEN}/ship/names.json`, `${GEN}/ship/1.json`]);
  });

  it('a class the build has no outline for is absent without a shard request', async () => {
    const { svc, calls } = setup(worker());
    const res = (await svc.resolve(BUILD, 'ship', ['NOPE', 'a']))!;
    expect(res.rows.size).toBe(0);
    // class names are exact, like the table's `in` filter: 'a' is not 'A'
    expect(res.absent).toEqual(['NOPE', 'a']);
    expect(res.open).toEqual([]);
    expect(short(calls)).toEqual(['index.json', `${GEN}/ship/names.json`]);
  });

  it('a kind without any outline answers from the index alone', async () => {
    const { svc, calls } = setup(worker());
    const res = (await svc.resolve(BUILD, 'armor', ['helmet_1', 'helmet_2']))!;
    expect(res.absent).toEqual(['helmet_1', 'helmet_2']);
    expect(short(calls)).toEqual(['index.json']);
  });

  it('a kind the index does not name declines to the database', async () => {
    const { svc } = setup(worker());
    expect(await svc.resolve(BUILD, 'component', ['COOL_A'])).toBeNull();
  });

  it('a build that is not published declines, and is not asked again for a while', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { svc, calls } = setup(() => new Response('not found', { status: 404 }));
    expect(await svc.resolve(BUILD, 'ship', ['A'])).toBeNull();
    expect(await svc.resolve(BUILD, 'ship', ['A'])).toBeNull();
    expect(calls.length).toBe(1);
    vi.setSystemTime(Date.now() + ABSENT_RETRY_MS + 1);
    expect(await svc.resolve(BUILD, 'ship', ['A'])).toBeNull();
    expect(calls.length).toBe(2);
  });

  it('a shard that fails leaves its names open, answers the rest and waits before asking again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let fail = true;
    const { svc, calls } = setup(
      worker({ [`${ROOT}${GEN}/ship/0.json`]: () => (fail ? new Response('boom', { status: 502 }) : new Response(GOLDEN_SHARD)) }),
    );
    const res = (await svc.resolve(BUILD, 'ship', ['A', 'C', 'NOPE']))!;
    expect(res.open).toEqual(['A']);
    expect([...res.rows.keys()]).toEqual(['C']);
    expect(res.absent).toEqual(['NOPE']);

    const before = calls.length;
    expect((await svc.resolve(BUILD, 'ship', ['A']))!.open).toEqual(['A']);
    expect(calls.length).toBe(before);

    fail = false;
    vi.setSystemTime(Date.now() + FAILED_RETRY_MS + 1);
    expect((await svc.resolve(BUILD, 'ship', ['A']))!.rows.get('A')).toEqual(ROW_A);
  });

  it('a shard the index names but the bucket lacks: open now, the index is read again next time', async () => {
    const { svc, calls, revalidated } = setup(worker({ [`${ROOT}${GEN}/ship/0.json`]: () => new Response('not found', { status: 404 }) }));
    expect((await svc.resolve(BUILD, 'ship', ['A']))!.open).toEqual(['A']);
    expect(revalidated).toEqual([]);
    await svc.resolve(BUILD, 'ship', ['C']);
    expect(short(calls).filter((c) => c === 'index.json').length).toBe(2);
    // the second index read goes past the browser's cached copy, once
    expect(short(revalidated)).toEqual(['index.json']);
  });

  it('a shard with an unexpected shape stays open and is never fetched again', async () => {
    const { svc, calls } = setup(worker({ [`${ROOT}${GEN}/ship/0.json`]: () => Response.json({ v: 9 }) }));
    expect((await svc.resolve(BUILD, 'ship', ['A']))!.open).toEqual(['A']);
    expect((await svc.resolve(BUILD, 'ship', ['B']))!.open).toEqual(['B']);
    expect(short(calls).filter((c) => c.endsWith('/ship/0.json')).length).toBe(1);
  });

  it('declines when the names file or the index cannot be read', async () => {
    const names = setup(worker({ [`${ROOT}${GEN}/ship/names.json`]: () => new Response('boom', { status: 500 }) }));
    expect(await names.svc.resolve(BUILD, 'ship', ['A'])).toBeNull();
    TestBed.resetTestingModule();
    const index = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await index.svc.resolve(BUILD, 'ship', ['A'])).toBeNull();
    expect(await index.svc.resolve(BUILD, 'ship', ['A'])).toBeNull();
    expect(index.calls.length).toBe(1);
  });

  it('declines an index of another build or shape', async () => {
    const { svc } = setup(worker({}, { ...INDEX, build: OTHER }));
    expect(await svc.resolve(BUILD, 'ship', ['A'])).toBeNull();
  });

  it('another build starts from its own index', async () => {
    const { svc, calls } = setup(worker());
    await svc.resolve(BUILD, 'ship', ['A']);
    expect(await svc.resolve(OTHER, 'ship', ['A'])).toBeNull();
    expect(calls.at(-1)).toBe(`${BASE}/codex-silhouettes/${OTHER}/index.json`);
  });

  it('asks nothing without a Worker base', async () => {
    const { svc, calls } = setup(worker(), '');
    expect(await svc.resolve(BUILD, 'ship', ['A'])).toBeNull();
    expect(calls).toEqual([]);
  });
});
