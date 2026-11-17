import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { setNumberLocale } from '../codex/codex-format';
import { FakeCall, FakeResult, chainArgs, fakeSupabase } from '../testing/fake-supabase';
import type { HqSupplyRow } from './data/hq-db.types';
import {
  HqSuppliesService,
  SUPPLIES_CACHE_KEY,
  SUPPLIES_MAX_ITEMS,
  SUPPLIES_STORAGE_KEY,
  SUPPLY_QTY_MAX,
  suppliesCacheKey,
  supplyQtyText,
} from './hq-supplies.service';

function serverRow(id: string, patch: Partial<HqSupplyRow> = {}): HqSupplyRow {
  return {
    user_id: 'u1', id, name: `Part ${id}`, qty: 1, done: false, entity_kind: null, class_name: null, set_kind: null,
    set_id: null, step_kind: null, wanted: true, source: 'manual', deleted_at: null,
    created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z', synced_at: '2026-11-01T10:00:01.000Z',
    ...patch,
  };
}

describe('HqSuppliesService', () => {
  let user: ReturnType<typeof signal<{ id: string } | null>>;
  let server: HqSupplyRow[];
  let fake: ReturnType<typeof fakeSupabase>;
  let failPush = false;

  /** Ids whose upsert the (fake) server trigger rejects as stale: it keeps its row and returns nothing. */
  let rejectIds: Set<string>;
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  /** The server's met guard (trigger hq_supplies_c_met_guard): an unmarked write never turns wish_met back into wish. */
  let metGuard = true;
  /** Parameters of the casSource calls that reached the server function. */
  let casCalls: { p_ids: string[]; p_from: string; p_to: string }[];

  const answer = (call: FakeCall): FakeResult => {
    if (call.op === 'rpc' && call.target === 'hq_supplies_cas_source') {
      if (failPush) return { error: { message: 'offline', status: 0 } };
      const p = call.args as { p_ids: string[]; p_from: HqSupplyRow['source']; p_to: HqSupplyRow['source']; p_at: string };
      casCalls.push(p);
      const won: { won_id: string }[] = [];
      for (const row of server) {
        if (!p.p_ids.includes(row.id) || row.source !== p.p_from || row.deleted_at) continue;
        Object.assign(row, { source: p.p_to, updated_at: p.p_at, synced_at: new Date().toISOString() });
        won.push({ won_id: row.id });
      }
      return { data: won };
    }
    if (call.target !== 'hq_supplies') return { data: null };
    const upsert = chainArgs(call, 'upsert');
    if (upsert) {
      if (failPush) return { error: { message: 'offline', status: 0 } };
      const accepted: { id: string }[] = [];
      for (const r of upsert[0] as Partial<HqSupplyRow>[]) {
        if (rejectIds.has(r.id!)) continue;
        const i = server.findIndex((s) => s.id === r.id);
        const row = { ...(i >= 0 ? server[i] : serverRow(r.id!)), ...r, synced_at: new Date().toISOString() } as HqSupplyRow;
        if (metGuard && i >= 0 && server[i].source === 'wish_met' && row.source === 'wish') {
          row.source = server[i].source;
          row.done = server[i].done;
        }
        if (i >= 0) server[i] = row;
        else server.push(row);
        accepted.push({ id: r.id! });
      }
      return { data: accepted };
    }
    const ids = chainArgs(call, 'in');
    if (ids) return { data: server.filter((s) => (ids[1] as string[]).includes(s.id)) };
    // Keyset filter `synced_at.gt.X[,and(synced_at.eq.X,id.gt.Y)]`
    const or = chainArgs(call, 'or')?.[0] as string | undefined;
    const gt = or?.match(/synced_at\.gt\.([^,]+)/)?.[1];
    const tie = or?.match(/id\.gt\.([^)]+)\)/)?.[1];
    const rows = server
      .filter((s) => !gt || Date.parse(s.synced_at) > Date.parse(gt) || (tie !== undefined && s.synced_at === gt && s.id > tie))
      .sort((a, b) => (a.synced_at === b.synced_at ? a.id.localeCompare(b.id) : a.synced_at.localeCompare(b.synced_at)));
    return { data: rows };
  };

  function make(signedIn = true): HqSuppliesService {
    TestBed.resetTestingModule();
    user = signal<{ id: string } | null>(signedIn ? { id: 'u1' } : null);
    fake = fakeSupabase({ answer });
    TestBed.configureTestingModule({
      providers: [
        fake.provider,
        { provide: AuthService, useValue: { user } },
      ],
    });
    const s = TestBed.inject(HqSuppliesService);
    TestBed.flushEffects();
    return s;
  }

  function clearStorage(): void {
    localStorage.removeItem(SUPPLIES_STORAGE_KEY);
    localStorage.removeItem(SUPPLIES_CACHE_KEY);
    localStorage.removeItem(suppliesCacheKey('u1'));
    localStorage.removeItem(suppliesCacheKey('u2'));
  }

  beforeEach(() => {
    server = [];
    failPush = false;
    rejectIds = new Set();
    metGuard = true;
    casCalls = [];
    clearStorage();
  });
  afterEach(clearStorage);

  it('adds a line, merges the same open name like a cart', async () => {
    const s = make();
    await s.sync();
    expect(s.add('  Quantum drive ', 1)).toBe(true);
    expect(s.add('quantum DRIVE', 2)).toBe(true);
    expect(s.items().length).toBe(1);
    expect(s.items()[0].qty).toBe(3);
  });

  it('keeps the minimum quality on the line, the stricter one wins on a merge, and pushes it as min_quality', async () => {
    const s = make();
    await s.sync();
    const first = s.addLine('Eisen', 1, { minQuality: 700 });
    expect(first).not.toBeNull();
    s.addLine('Eisen', 1, { minQuality: 600 });
    expect(s.items().length).toBe(1);
    expect(s.items()[0].minQuality).toBe(700);
    s.addLine('Eisen', 1, { minQuality: 850 });
    expect(s.items()[0].minQuality).toBe(850);
    s.setMinQuality(s.items()[0].id, 2000);
    expect(s.items()[0].minQuality).toBeNull();
    s.setMinQuality(s.items()[0].id, 720);
    await s.sync();
    expect(server.find((r) => r.name === 'Eisen')?.min_quality).toBe(720);
  });

  it('rejects empty names and clamps quantities', () => {
    const s = make();
    expect(s.add('   ', 1)).toBe(false);
    s.add('Shield', 5000);
    expect(s.items()[0].qty).toBe(SUPPLY_QTY_MAX);
    s.setQty(s.items()[0].id, -4);
    expect(s.items()[0].qty).toBe(1);
  });

  it('ticks lines off, counts what is open and clears the ticked ones', () => {
    const s = make();
    s.add('A', 2);
    s.add('B', 3);
    s.toggle(s.items()[0].id);
    expect(s.open().map((i) => i.name)).toEqual(['B']);
    expect(s.openUnits()).toBe(3);
    s.clearDone();
    expect(s.items().map((i) => i.name)).toEqual(['B']);
    s.remove(s.items()[0].id);
    expect(s.items()).toEqual([]);
  });

  it('caps the list', () => {
    const s = make();
    for (let i = 0; i < SUPPLIES_MAX_ITEMS + 5; i++) s.add(`item ${i}`, 1);
    expect(s.items().length).toBe(SUPPLIES_MAX_ITEMS);
  });

  it('keeps set, step kind, class name and source of a line and groups by set', () => {
    const s = make();
    s.add('S3 Repeater', 2, { setKind: 'ship', setId: 'c1', stepKind: 'buy', className: 'REP_S3', source: 'set' });
    s.add('Core', 1, { setKind: 'ship', setId: 'c1' });
    s.add('Loose', 1, { setKind: 'ship' }); // set_kind without set_id is dropped (DB pair constraint)
    const i = s.items()[0];
    expect([i.setKind, i.setId, i.stepKind, i.className, i.source]).toEqual(['ship', 'c1', 'buy', 'REP_S3', 'set']);
    expect(s.bySet().get('ship:c1')?.length).toBe(2);
    expect(s.items()[2].setKind).toBeNull();
  });

  it('pushes a new line and a tombstone to the server', async () => {
    const s = make();
    s.add('Rifle', 2);
    await s.sync();
    expect(server.map((r) => [r.name, r.qty, r.deleted_at])).toEqual([['Rifle', 2, null]]);
    s.remove(s.items()[0].id);
    await s.sync();
    expect(server[0].deleted_at).not.toBeNull();
    expect(s.items()).toEqual([]);
    expect(s.syncError()).toBeNull();
  });

  it('keeps an offline add (dirty) across a reload and pushes it once online', async () => {
    failPush = true;
    const s = make();
    s.add('Offline part', 1);
    await s.sync();
    expect(server).toEqual([]);
    expect(s.syncError()).not.toBeNull();
    failPush = false;
    const again = make();
    expect(again.items().map((i) => i.name)).toEqual(['Offline part']);
    await again.sync();
    expect(server.map((r) => r.name)).toEqual(['Offline part']);
    expect(again.syncError()).toBeNull();
  });

  it('two devices converge: a newer remote edit wins, a newer local edit stays', async () => {
    server = [serverRow('a', { name: 'Remote name', updated_at: '2026-11-01T12:00:00.000Z' }), serverRow('b')];
    const s = make();
    await s.sync();
    expect(s.items().map((i) => i.name).sort()).toEqual(['Part b', 'Remote name']);
    // A newer edit on the other device arrives with a higher synced_at.
    server[1] = serverRow('b', { name: 'Edited elsewhere', updated_at: '2026-11-01T11:00:00.000Z', synced_at: '2026-11-01T11:00:00.000Z' });
    await s.sync();
    expect(s.items().find((i) => i.id === 'b')?.name).toBe('Edited elsewhere');
    // A remote tombstone removes the line here.
    server[0] = serverRow('a', { deleted_at: '2026-11-01T13:00:00.000Z', updated_at: '2026-11-01T13:00:00.000Z', synced_at: '2026-11-01T13:00:00.000Z' });
    await s.sync();
    expect(s.items().map((i) => i.id)).toEqual(['b']);
  });

  it('caches per user: a second account on the same browser never sees the first one\'s lines', async () => {
    const s = make();
    s.add('Mine', 1);
    await s.sync();
    expect(localStorage.getItem(suppliesCacheKey('u1'))).not.toBeNull();
    expect(localStorage.getItem(SUPPLIES_CACHE_KEY)).toBeNull();
    server = [];
    user.set({ id: 'u2' });
    TestBed.flushEffects();
    await flush();
    expect(s.items()).toEqual([]);
  });

  it('pushes once more on sign-out and then drops that account\'s cache', async () => {
    failPush = false;
    const s = make();
    await s.sync();
    s.add('Last second', 1);
    user.set(null);
    TestBed.flushEffects();
    await flush();
    await flush();
    expect(server.map((r) => r.name)).toEqual(['Last second']);
    expect(localStorage.getItem(suppliesCacheKey('u1'))).toBeNull();
  });

  it('keeps a row the server rejected as stale dirty, and takes the server version instead of marking it pushed', async () => {
    // Far in the future: the server's copy must stay newer than the local
    // edit's clock (a fixed "today" turned into the past and broke this).
    server = [serverRow('a', { name: 'Server wins', updated_at: '2099-01-01T00:00:00.000Z', synced_at: '2099-01-01T00:00:00.000Z' })];
    const s = make();
    await s.sync();
    rejectIds.add('a');
    s.setQty('a', 5);
    expect(s.items().find((i) => i.id === 'a')?.dirty).toBe(true);
    await s.sync();
    const a = s.items().find((i) => i.id === 'a')!;
    expect(a.name).toBe('Server wins');
    expect(a.qty).toBe(1);
    expect(a.dirty).toBe(false);
  });

  describe('H2: a met wish line stays met (server guard + compare-and-set function)', () => {
    it('casSource calls the server function, returns the ids it won and adopts the server source', async () => {
      server = [serverRow('m', { source: 'wish', done: true }), serverRow('n', { source: 'search' })];
      const s = make();
      await s.sync();
      const won = await s.casSource(['m', 'n'], 'wish', 'wish_met');
      expect(won).toEqual(['m']);
      expect(casCalls).toEqual([expect.objectContaining({ p_ids: ['m', 'n'], p_from: 'wish', p_to: 'wish_met' })]);
      expect(s.items().find((i) => i.id === 'm')?.source).toBe('wish_met');
      expect(s.items().find((i) => i.id === 'n')?.source).toBe('search');
      // the deliberate way back works, once: the second caller wins nothing
      expect(await s.casSource(['m'], 'wish_met', 'wish')).toEqual(['m']);
      expect(await s.casSource(['m'], 'wish_met', 'wish')).toEqual([]);
      expect(s.items().find((i) => i.id === 'm')?.source).toBe('wish');
    });

    it('casSource reports null when the function call fails (offline), nothing adopted', async () => {
      server = [serverRow('m', { source: 'wish' })];
      const s = make();
      await s.sync();
      failPush = true;
      expect(await s.casSource(['m'], 'wish', 'wish_met')).toBeNull();
      expect(s.items().find((i) => i.id === 'm')?.source).toBe('wish');
    });

    it('a device that missed the met state pushes its stale wish and converges to the server row on the next pull', async () => {
      server = [serverRow('m', { source: 'wish', qty: 2, entity_kind: 'item', class_name: 'medpen' })];
      const s = make();
      await s.sync();
      // another device met the line: server row is wish_met and ticked, this device does not know yet
      Object.assign(server[0], { source: 'wish_met', done: true, updated_at: '2026-11-17T09:00:00.000Z', synced_at: new Date().toISOString() });
      s.setQty('m', 3); // an offline edit on the stale copy: newer, full row, source still 'wish'
      expect(s.items()[0]).toEqual(expect.objectContaining({ source: 'wish', done: false, dirty: true }));
      await s.sync();
      expect(server[0]).toEqual(expect.objectContaining({ source: 'wish_met', done: true, qty: 3 })); // newer qty applied, met state kept
      expect(s.items()[0]).toEqual(expect.objectContaining({ source: 'wish_met', done: true, qty: 3, dirty: false }));
    });

    it('without the guard the same push would reopen the line (the failure the guard prevents)', async () => {
      metGuard = false;
      server = [serverRow('m', { source: 'wish', entity_kind: 'item', class_name: 'medpen' })];
      const s = make();
      await s.sync();
      Object.assign(server[0], { source: 'wish_met', done: true, updated_at: '2026-11-17T09:00:00.000Z', synced_at: new Date().toISOString() });
      s.setQty('m', 3);
      await s.sync();
      expect(server[0].source).toBe('wish');
    });
  });

  it('is not ready before the first pull and ready after', async () => {
    const s = make();
    expect(s.ready()).toBe(false);
    await s.sync();
    expect(s.ready()).toBe(true);
  });

  it('pulls with a keyset on (synced_at, id) and re-reads a few seconds before the watermark', async () => {
    server = [serverRow('a', { synced_at: '2026-11-01T10:00:10.000Z' })];
    const s = make();
    await s.sync();
    fake.calls.length = 0;
    server.push(serverRow('b', { synced_at: '2026-11-01T10:00:07.000Z' })); // committed late, older synced_at
    await s.sync();
    const pull = fake.calls.find((c) => c.target === 'hq_supplies' && chainArgs(c, 'or'))!;
    expect(chainArgs(pull, 'order')).toBeDefined();
    expect(pull.chain.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual(['synced_at', 'id']);
    expect(chainArgs(pull, 'or')![0]).toBe('synced_at.gt.2026-11-01T10:00:05.000Z');
    expect(s.items().map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('H1: a wish line and a Bestand / manual line of the same item in one Nachschub never merge, either way round', () => {
    const s = make();
    const wishLine = s.addLine('Medpen', 2, { className: 'medpen', packageId: 'P', source: 'wish' });
    const bestand = s.addLine('Medpen', 3, { className: 'medpen', packageId: 'P', source: 'search' });
    expect(bestand?.id).not.toBe(wishLine?.id);
    expect(s.addLine('Medpen', 1, { className: 'medpen', packageId: 'P', source: 'wish' })?.id).toBe(wishLine?.id);
    expect(s.items().map((i) => [i.source, i.qty])).toEqual([['wish', 3], ['search', 3]]);
    expect(s.items().every((i) => !!i.createdAt)).toBe(true);
  });

  describe('live agent API', () => {
    it('H2: a purchase smaller than a wish line leaves it to the stock rise; a whole one ticks it', () => {
      const s = make();
      s.addLine('Repeater', 3, { className: 'REP_S3', packageId: 'P', source: 'wish' });
      expect(s.tickByClassName('rep_s3', 1)).toBeNull();
      expect(s.items()[0].qty).toBe(3);
      expect(s.tickByClassName('rep_s3', 3)).toBe(s.items()[0].id);
      expect(s.items()[0].done).toBe(true);
    });

    it('tickByClassName covers a line, reduces a bigger one, and untick reverts exactly that', () => {
      const s = make();
      s.add('Repeater', 3, { className: 'REP_S3' });
      const id = s.items()[0].id;
      expect(s.tickByClassName('rep_s3', 1)).toBe(id);
      expect(s.items()[0].qty).toBe(2);
      expect(s.items()[0].done).toBe(false);
      s.untick(id, 1);
      expect(s.items()[0].qty).toBe(3);
      expect(s.tickByClassName('REP_S3', 5)).toBe(id);
      expect(s.items()[0].done).toBe(true);
      expect(s.items()[0].qty).toBe(3);
      s.untick(id, 5);
      expect(s.items()[0].done).toBe(false);
      expect(s.items()[0].qty).toBe(3);
    });

    it('tickByClassName returns null without a match and ignores ticked lines', () => {
      const s = make();
      s.add('Repeater', 1, { className: 'REP_S3' });
      expect(s.tickByClassName('OTHER', 1)).toBeNull();
      expect(s.tickByClassName('REP_S3', 1)).not.toBeNull();
      expect(s.tickByClassName('REP_S3', 1)).toBeNull();
    });

    it('prefers a wanted line', () => {
      const s = make();
      s.add('A', 1, { className: 'X', wanted: false });
      s.add('B', 1, { className: 'X', setKind: 'fps', setId: 'f1', wanted: true });
      const id = s.tickByClassName('x', 1);
      expect(s.items().find((i) => i.id === id)?.name).toBe('B');
    });
  });

  describe('exact amounts (SCU) and the blueprint link', () => {
    it('keeps 0.36 SCU exact, scales it with the portions and never rounds it', () => {
      const s = make();
      s.addLine('Agricium', 1, { amount: 0.36, unit: 'scu', forClassName: 'BP_X', className: 'Agricium' });
      const l = s.items()[0];
      expect([l.qty, l.amount, l.unit, l.forClassName]).toEqual([1, 0.36, 'scu', 'BP_X']);
      s.setQty(l.id, 3);
      expect(s.items()[0].amount).toBe(1.08);
      s.setQty(l.id, 1);
      expect(s.items()[0].amount).toBe(0.36);
    });

    it('adds the same material of the same blueprint up in SCU, keeps another blueprint and a pieces line apart', () => {
      const s = make();
      s.addLine('Agricium', 1, { amount: 0.36, unit: 'scu', forClassName: 'BP_X' });
      s.addLine('Agricium', 1, { amount: 0.36, unit: 'scu', forClassName: 'BP_X' });
      s.addLine('Agricium', 1, { amount: 0.5, unit: 'scu', forClassName: 'BP_Y' });
      s.addLine('Agricium', 2);
      expect(s.items().map((i) => [i.qty, i.amount, i.forClassName])).toEqual([
        [2, 0.72, 'BP_X'],
        [1, 0.5, 'BP_Y'],
        [2, null, null],
      ]);
      expect(s.openLinesForBlueprint('bp_x').length).toBe(1);
    });

    it('shows the amount locale-aware: 0,36 SCU in German, 0.36 SCU in English', () => {
      const s = make();
      s.addLine('Agricium', 1, { amount: 0.36, unit: 'scu' });
      try {
        setNumberLocale('de-DE');
        expect(supplyQtyText(s.items()[0])).toBe('0,36 SCU');
        setNumberLocale('en-US');
        expect(supplyQtyText(s.items()[0])).toBe('0.36 SCU');
      } finally {
        setNumberLocale(null);
      }
      s.add('Shield', 2);
      expect(supplyQtyText(s.items()[1])).toBe('2');
    });

    it('restore() brings a removed line back', () => {
      const s = make();
      s.addLine('Agricium', 1, { amount: 0.36, unit: 'scu', forClassName: 'BP_X' });
      const id = s.items()[0].id;
      s.remove(id);
      expect(s.items().length).toBe(0);
      s.restore(id);
      expect(s.items()[0].amount).toBe(0.36);
    });

    it('restore() still brings a line back after the sync dropped its pushed tombstone (AUD-3)', async () => {
      const s = make();
      s.add('Rifle', 2, { className: 'RIFLE', packageId: 'p1' });
      s.add('Helmet', 1, { className: 'HELM', packageId: 'p1' });
      await s.sync();
      const ids = s.items().map((i) => i.id);
      s.removeMany(ids);
      await s.sync(); // pushes the tombstones; the clean ones are dropped from the local rows
      expect(s.items()).toEqual([]);
      expect(server.every((r) => r.deleted_at !== null)).toBe(true);
      for (const id of ids) s.restore(id);
      expect(s.items().map((i) => [i.id, i.name, i.qty, i.packageId, i.dirty])).toEqual([
        [ids[0], 'Rifle', 2, 'p1', true],
        [ids[1], 'Helmet', 1, 'p1', true],
      ]);
      await s.sync();
      expect(server.map((r) => r.deleted_at)).toEqual([null, null]);
    });

    it('pushes the new columns only on lines that have them (rows without them write what they always did)', async () => {
      const s = make();
      await s.sync();
      s.add('Shield', 2);
      s.addLine('Agricium', 1, { amount: 0.36, unit: 'scu', forClassName: 'BP_X' });
      fake.calls.length = 0;
      await s.sync();
      const sent = chainArgs(fake.calls.find((c) => c.target === 'hq_supplies' && chainArgs(c, 'upsert'))!, 'upsert')![0] as Record<string, unknown>[];
      const shield = sent.find((r) => r['name'] === 'Shield')!;
      const agri = sent.find((r) => r['name'] === 'Agricium')!;
      expect('amount' in shield || 'unit' in shield || 'for_class_name' in shield).toBe(false);
      expect([agri['amount'], agri['unit'], agri['for_class_name']]).toEqual([0.36, 'scu', 'BP_X']);
    });

    it('reads the columns back from the server (numeric may arrive as a string) and tolerates rows without them', async () => {
      server = [
        serverRow('a', { amount: 0.36, unit: 'scu', for_class_name: 'BP_X' }),
        serverRow('b', { amount: '1.5' as unknown as number, unit: 'scu' }),
        serverRow('c'),
        serverRow('d', { amount: 4, unit: 'pcs' }),
      ];
      const s = make();
      await s.sync();
      const by = (id: string) => s.items().find((i) => i.id === id)!;
      expect([by('a').amount, by('a').unit, by('a').forClassName]).toEqual([0.36, 'scu', 'BP_X']);
      expect(by('b').amount).toBe(1.5);
      expect([by('c').amount, by('c').unit, by('c').forClassName]).toEqual([null, null, null]);
      expect(by('d').amount).toBeNull();
    });

  });
});
