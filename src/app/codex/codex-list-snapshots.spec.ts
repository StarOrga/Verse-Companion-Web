import { TestBed } from '@angular/core/testing';
import {
  ABSENT_RETRY_MS,
  CodexListSnapshots,
  FAILED_RETRY_MS,
  FETCH_TIMEOUT_MS,
  LIST_SNAPSHOT_BASE,
  LIST_SNAPSHOT_FETCH,
} from './codex-list-snapshots';
import { SNAPSHOT_COLUMNS } from './codex-list-engine';

const BUILD = 'a3fb1249-9115-4035-9039-2ffc6043d832';
const OTHER = 'b77f1586-d1fe-4be9-a359-f397266acb86';
const BASE = 'https://assets.test';
const GEN = 'mgaq1z2k';
const dir = (build = BUILD) => `${BASE}/codex-lists/${build}/`;

const index = (build = BUILD) => ({
  v: 1,
  build,
  gen: GEN,
  files: { weapon: { rows: 1, bytes: 10 }, facets: { rows: 4, bytes: 10 } },
});
const weaponFile = (extra: Record<string, unknown> = {}) => ({
  v: 1,
  kind: 'weapon',
  columns: SNAPSHOT_COLUMNS.weapon,
  payloadKeys: ['name'],
  rows: [[...SNAPSHOT_COLUMNS.weapon.map((c) => (c === 'class_name' ? 'W1' : null)), { en: 'W' }]],
  ...extra,
});
const facetsFile = { v: 1, kinds: { weapon: { manufacturers: [], sizes: [1], grades: [], componentKinds: [] } } };

function setup(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, base = BASE) {
  const calls: string[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    return handler(url, init);
  }) as unknown as typeof fetch;
  TestBed.configureTestingModule({
    providers: [
      { provide: LIST_SNAPSHOT_FETCH, useValue: fetchFn },
      { provide: LIST_SNAPSHOT_BASE, useValue: base },
    ],
  });
  return { svc: TestBed.inject(CodexListSnapshots), calls };
}

function worker(files: Record<string, unknown> = { weapon: weaponFile(), facets: facetsFile }, idx = index) {
  return (url: string) => {
    for (const build of [BUILD, OTHER]) {
      if (url === `${dir(build)}index.json`) return Response.json(idx(build));
      for (const [name, body] of Object.entries(files)) {
        if (url === `${dir(build)}${GEN}/${name}.json`) return Response.json(body);
      }
    }
    return new Response('not found', { status: 404 });
  };
}

describe('CodexListSnapshots', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('reads the index once and each file once, then answers from memory', async () => {
    const { svc, calls } = setup(worker());

    const a = await svc.rows(BUILD, 'weapon');
    const b = await svc.rows(BUILD, 'weapon');
    const f = await svc.facets(BUILD);

    expect(a?.rows.length).toBe(1);
    expect(a?.col.get('class_name')).toBe(0);
    expect(a?.key.get('name')).toBe(SNAPSHOT_COLUMNS.weapon.length);
    expect(b).toBe(a);
    expect(f?.['weapon']).toEqual(facetsFile.kinds.weapon);
    expect(calls).toEqual([`${dir()}index.json`, `${dir()}${GEN}/weapon.json`, `${dir()}${GEN}/facets.json`]);
  });

  it('never starts the same download twice', async () => {
    const { svc, calls } = setup(worker());
    await Promise.all([svc.rows(BUILD, 'weapon'), svc.rows(BUILD, 'weapon'), svc.rows(BUILD, 'weapon')]);
    expect(calls.filter((c) => c.endsWith('weapon.json')).length).toBe(1);
    expect(calls.filter((c) => c.endsWith('index.json')).length).toBe(1);
  });

  it('answers null for an unpublished build (404), without a log, and asks again only after 5 minutes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { svc, calls } = setup(() => new Response('not found', { status: 404 }));

    expect(await svc.rows(BUILD, 'weapon')).toBeNull();
    expect(await svc.rows(BUILD, 'item')).toBeNull();
    expect(await svc.facets(BUILD)).toBeNull();
    expect(calls).toEqual([`${dir()}index.json`]);

    now += ABSENT_RETRY_MS + 1;
    expect(await svc.rows(BUILD, 'weapon')).toBeNull();
    expect(calls.length).toBe(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers null on an outage, logs once and asks again only after 60 s', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let down = true;
    const healthy = worker();
    const { svc, calls } = setup((url) => (down ? new Response('', { status: 502 }) : healthy(url)));

    expect(await svc.rows(BUILD, 'weapon')).toBeNull();
    down = false;
    now += FAILED_RETRY_MS - 1;
    expect(await svc.rows(BUILD, 'weapon')).toBeNull();
    expect(calls.length).toBe(1);
    now += 2;
    expect((await svc.rows(BUILD, 'weapon'))?.rows.length).toBe(1);
    expect(calls.filter((c) => c.endsWith('index.json')).length).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('retries a file whose download failed after 60 s, not before', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let down = true;
    const healthy = worker();
    const { svc, calls } = setup((url) => (down && url.endsWith('weapon.json') ? new Response('', { status: 503 }) : healthy(url)));

    expect(await svc.rows(BUILD, 'weapon')).toBeNull();
    expect(await svc.rows(BUILD, 'weapon')).toBeNull();
    expect(calls.filter((c) => c.endsWith('weapon.json')).length).toBe(1);
    down = false;
    now += FAILED_RETRY_MS + 1;
    expect((await svc.rows(BUILD, 'weapon'))?.rows.length).toBe(1);
    expect(calls.filter((c) => c.endsWith('weapon.json')).length).toBe(2);
  });

  it('answers null for a file the index does not list, without fetching it', async () => {
    const { svc, calls } = setup(worker());
    expect(await svc.rows(BUILD, 'ship')).toBeNull();
    expect(calls).toEqual([`${dir()}index.json`]);
  });

  const malformed: [string, unknown][] = [
    ['another version', weaponFile({ v: 2 })],
    ['another kind', weaponFile({ kind: 'item' })],
    ['columns the client does not expect', weaponFile({ columns: ['guid', ...SNAPSHOT_COLUMNS.weapon.slice(1)] })],
    ['a row of the wrong width', weaponFile({ rows: [['W1']] })],
  ];
  for (const [label, body] of malformed) {
    it(`treats a file with ${label} as unusable (logged once)`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { svc, calls } = setup(worker({ weapon: body }));
      expect(await svc.rows(BUILD, 'weapon')).toBeNull();
      expect(await svc.rows(BUILD, 'weapon')).toBeNull();
      expect(await svc.rows(BUILD, 'weapon')).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      // Immutable: the same gen's file is never downloaded again this session.
      expect(calls.filter((c) => c.endsWith('weapon.json')).length).toBe(1);
    });
  }

  it('treats an index for another build as unusable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { svc } = setup(worker(undefined, () => index(OTHER)));
    expect(await svc.rows(BUILD, 'weapon')).toBeNull();
  });

  it('drops the held files when the build changes', async () => {
    const { svc, calls } = setup(worker());
    await svc.rows(BUILD, 'weapon');
    await svc.rows(OTHER, 'weapon');
    await svc.rows(BUILD, 'weapon');
    expect(calls.filter((c) => c.endsWith('weapon.json')).length).toBe(3);
  });

  describe('slow downloads (fake timers)', () => {
    afterEach(() => vi.useRealTimers());

    const flush = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };

    it('waits 3 s once; later calls fall back at once while it runs, then use the file', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const healthy = worker();
      const { svc, calls } = setup(async (url) => {
        if (url.endsWith('weapon.json')) await gate;
        return healthy(url);
      });

      let first: unknown = 'pending';
      void svc.rows(BUILD, 'weapon').then((v) => (first = v));
      await flush();
      await vi.advanceTimersByTimeAsync(2999);
      expect(first).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect(first).toBeNull();

      let second: unknown = 'pending';
      void svc.rows(BUILD, 'weapon').then((v) => (second = v));
      await flush();
      expect(second).toBeNull(); // no second 3 s wait

      vi.useRealTimers();
      release();
      for (let i = 0; i < 50 && !(await svc.rows(BUILD, 'weapon', 10)); i++) await new Promise((r) => setTimeout(r, 5));
      expect((await svc.rows(BUILD, 'weapon'))?.rows.length).toBe(1);
      expect(calls.filter((c) => c.endsWith('weapon.json')).length).toBe(1);
    });

    it('aborts a hung download after 30 s and treats it as a failed one', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const healthy = worker();
      let aborted = false;
      const { svc, calls } = setup((url, init) => {
        if (!url.endsWith('weapon.json')) return healthy(url);
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      });
      void svc.rows(BUILD, 'weapon');
      await flush();
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - 1);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(aborted).toBe(true);
      // Failed download: no new request inside the retry gap, the call answers null at once.
      expect(await svc.rows(BUILD, 'weapon', 0)).toBeNull();
      expect(calls.filter((c) => c.endsWith('weapon.json')).length).toBe(1);
    });
  });

  it('stays on the database path when no assets host is configured', async () => {
    const { svc, calls } = setup(worker(), '');
    expect(await svc.rows(BUILD, 'weapon')).toBeNull();
    expect(await svc.facets(BUILD)).toBeNull();
    expect(calls).toEqual([]);
  });
});
