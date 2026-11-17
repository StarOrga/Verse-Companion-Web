import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { AnalyticsService } from '../../core/analytics.service';
import { HangarService } from '../../hangar/hangar.service';
import { FakeCall, FakeResult, chainArgs, fakeSupabase } from '../../testing/fake-supabase';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { HqInventoryService } from '../data/hq-inventory.service';
import { WishlistStore } from '../data/wishlist.store';
import { HqSuppliesService } from '../hq-supplies.service';
import { NachschubNamingService } from './nachschub-naming';
import { NachschubService } from './nachschub.service';

/*
 * Wishes assigned to an Operation (concept 20261117-1110-pfad-stationen, A1-A11): a wish stays a wish, the open
 * 'wish' line is the assignment, removals take free pieces first, then the most recently assigned Operation.
 */

interface Ln {
  id: string;
  name: string;
  qty: number;
  amount: number | null;
  unit: null;
  done: boolean;
  entityKind: string | null;
  className: string | null;
  forClassName: string | null;
  packageId: string | null;
  source: string;
  gather: null;
  stepKind: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

let clock = 0;
const tick = (): string => `2026-11-17T10:${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock++ % 60).padStart(2, '0')}Z`;

class FakeSupplies {
  readonly rows = signal<Ln[]>([]);
  readonly items = computed(() => this.rows().filter((r) => !r.deletedAt));
  private n = 0;
  addLine(name: string, qty: number, meta: { entityKind?: string; className?: string; forClassName?: string | null; packageId?: string | null; source?: string } = {}) {
    const pkg = meta.packageId ?? null;
    const same = this.items().find((i) => !i.done && i.name.toLowerCase() === name.toLowerCase() && i.packageId === pkg && (i.forClassName ?? '') === (meta.forClassName ?? ''));
    if (same) {
      this.patch(same.id, { qty: same.qty + qty });
      return { id: same.id, prevQty: same.qty, prevAmount: null };
    }
    const id = `L${++this.n}`;
    this.rows.update((rs) => [
      ...rs,
      {
        id, name, qty, amount: null, unit: null, done: false, entityKind: meta.entityKind ?? null, className: meta.className ?? null,
        forClassName: meta.forClassName ?? null, packageId: pkg, source: meta.source ?? 'manual', gather: null, stepKind: null, updatedAt: tick(), deletedAt: null,
      },
    ]);
    return { id, prevQty: 0, prevAmount: null };
  }
  /** A line as it was written before this change (or by any other path). */
  put(l: Partial<Ln> & Pick<Ln, 'name' | 'qty' | 'className' | 'packageId'>): string {
    const id = `L${++this.n}`;
    this.rows.update((rs) => [...rs, { id, amount: null, unit: null, done: false, entityKind: 'item', forClassName: null, source: 'search', gather: null, stepKind: null, updatedAt: tick(), deletedAt: null, ...l }]);
    return id;
  }
  private patch(id: string, p: Partial<Ln>) {
    this.rows.update((rs) => rs.map((r) => (r.id === id ? { ...r, ...p, updatedAt: tick() } : r)));
  }
  linesOfPackage(id: string) {
    return this.items().filter((i) => i.packageId === id);
  }
  openLinesFor(cls: string) {
    return this.items().filter((i) => !i.done && (i.className ?? '').toLowerCase() === cls.toLowerCase());
  }
  removeMany(ids: readonly string[]) {
    this.rows.update((rs) => rs.map((r) => (ids.includes(r.id) && !r.deletedAt ? { ...r, deletedAt: 'x' } : r)));
  }
  remove(id: string) {
    this.removeMany([id]);
  }
  restore(id: string) {
    this.rows.update((rs) => rs.map((r) => (r.id === id ? { ...r, deletedAt: null } : r)));
  }
  setLine(id: string, qty: number) {
    this.patch(id, { qty });
  }
  setDone(id: string, done: boolean) {
    this.patch(id, { done });
  }
  setSource(ids: readonly string[], source: string) {
    for (const id of ids) this.patch(id, { source });
  }
  line(id: string) {
    return this.rows().find((r) => r.id === id);
  }
}

interface WishRow {
  kind: string;
  className: string;
  name: string | null;
  qty: number;
  forClassName: string;
}

class FakeWish {
  readonly rows = signal<WishRow[]>([]);
  readonly loaded = signal(true);
  async setQty(e: { kind: string; className: string; name?: string | null; forClassName?: string | null }, qty: number): Promise<boolean> {
    const f = e.forClassName ?? '';
    const hit = this.rows().find((r) => r.kind === e.kind && r.className === e.className && r.forClassName === f);
    if (qty <= 0) this.rows.update((rs) => rs.filter((r) => r !== hit));
    else if (hit) this.rows.update((rs) => rs.map((r) => (r === hit ? { ...r, qty } : r)));
    else this.rows.update((rs) => [...rs, { kind: e.kind, className: e.className, name: e.name ?? null, qty, forClassName: f }]);
    return true;
  }
  qty(className: string): number {
    return this.rows().find((r) => r.className === className)?.qty ?? 0;
  }
}

interface ServerPkg {
  id: string;
  name: string;
  status: 'active' | 'archived';
  slot: number | null;
  snapshot: Record<string, number>;
  type?: string;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

describe('NachschubService: wishes assigned to an Operation', () => {
  let server: ServerPkg[];
  let supplies: FakeSupplies;
  let wish: FakeWish;
  let einsaetze: ReturnType<typeof signal<{ id: string; packageId: string; status: string }[]>>;
  let stock: ReturnType<typeof signal<{ class_name: string | null; qty: number }[]>>;
  let tracked: [string, unknown][];
  let svc: NachschubService;

  const idOf = (call: FakeCall): unknown =>
    (call.chain.filter(([m]) => m === 'eq').map(([, a]) => a).find((a) => a[0] === 'id') ?? [])[1];

  const answer = (call: FakeCall): FakeResult => {
    if (call.target !== 'hq_supply_packages') return { data: null };
    const upsert = chainArgs(call, 'upsert');
    if (upsert) {
      const r = upsert[0] as ServerPkg;
      server = [...server.filter((s) => s.id !== r.id), { ...r, created_at: tick() }];
      return { data: null };
    }
    const update = chainArgs(call, 'update');
    if (update) {
      const hit = server.find((s) => s.id === idOf(call));
      if (hit) Object.assign(hit, update[0]);
      return { data: hit ? [{ id: hit.id }] : [] };
    }
    return { data: server.filter((s) => !s.deleted_at) };
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    server = [];
    tracked = [];
    supplies = new FakeSupplies();
    wish = new FakeWish();
    einsaetze = signal([]);
    stock = signal([]);
    const fake = fakeSupabase({ answer });
    TestBed.configureTestingModule({
      providers: [
        fake.provider,
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: HqSuppliesService, useValue: supplies },
        { provide: WishlistStore, useValue: wish },
        { provide: HqInventoryService, useValue: { items: stock, loaded: signal(true), error: signal(null), load: () => Promise.resolve() } },
        { provide: HangarService, useValue: { ships: signal([]), error: signal(null), loadAll: () => Promise.resolve(), shipByClassName: () => undefined } },
        { provide: NachschubNamingService, useValue: { nachschubName: () => Promise.resolve('Auto') } },
        { provide: HqEinsatzService, useValue: { ofPackage: (id: string) => einsaetze().filter((e) => e.packageId === id), setKnownPackages: () => undefined } },
        { provide: AnalyticsService, useValue: { track: (e: string, p: unknown) => tracked.push([e, p]) } },
      ],
    });
    svc = TestBed.inject(NachschubService);
    await svc.ensureLoaded();
  });

  const medpen = { kind: 'item', className: 'medpen', forClassName: null };
  const wishFor = (className: string, qty: number) => wish.rows.update((rs) => [...rs, { kind: 'item', className, name: className, qty, forClassName: '' }]);
  const alloc = () => svc.allocationOf(medpen);
  const pkgNamed = (name: string) => svc.packages().find((p) => p.name === name);

  it('A1/A2: assigning keeps the wish quantity; the line is the assignment', async () => {
    wishFor('medpen', 5);
    const r = await svc.assignWish(medpen, 3, 'new', { name: 'Bodentrupp', surface: 'codex' });
    expect(r.ok).toBe(true);
    expect(wish.qty('medpen')).toBe(5);
    expect(alloc()).toEqual(expect.objectContaining({ wished: 5, assigned: 3, free: 2 }));
    expect(alloc().assignments.map((a) => [a.packageName, a.qty, a.einsaetzeDone, a.einsaetzeTotal])).toEqual([['Bodentrupp', 3, 0, 0]]);
    expect(supplies.items()[0].source).toBe('wish');
    expect(tracked).toEqual([['hq:path_group_assign', { surface: 'codex', created: true }]]);
    // The undo takes the assignment (and the new Operation) back; the wish never moved.
    await r.undo?.();
    expect(svc.packages().length).toBe(0);
    expect(alloc().assigned).toBe(0);
    expect(wish.qty('medpen')).toBe(5);
  });

  it('A3: never more than the free pieces are assigned, over every Operation', async () => {
    wishFor('medpen', 5);
    await svc.assignWish(medpen, 3, 'new', { name: 'A' });
    const id = pkgNamed('A')?.id ?? '';
    const more = await svc.assignWish(medpen, 9, id);
    expect(more.ok).toBe(true);
    expect(alloc()).toEqual(expect.objectContaining({ wished: 5, assigned: 5, free: 0 }));
    expect(await svc.assignWish(medpen, 1, 'new')).toEqual({ ok: false, key: 'hq.nachschub.nothingFree' });
    expect(svc.freeWishPositions()).toEqual([]);
  });

  it('A4: lowering within the free pieces asks nothing and comes with an undo', async () => {
    wishFor('medpen', 5);
    await svc.assignWish(medpen, 3, 'new', { name: 'A' });
    const plan = svc.planWishRemoval(medpen, 2);
    expect(plan).toEqual(expect.objectContaining({ remove: 2, free: 2, needsConfirm: false }));
    expect(plan.parts.map((p) => p.qty)).toEqual([0]);
    const r = await svc.applyWishRemoval({ ...medpen, name: 'Medpen' }, 2);
    expect(r).toEqual(expect.objectContaining({ ok: true, key: 'hq.nachschub.done.wishRemoved', params: { name: 'Medpen', count: 2, dissolved: 0 } }));
    expect(wish.qty('medpen')).toBe(3);
    expect(alloc().assigned).toBe(3);
    await r.undo?.();
    expect(wish.qty('medpen')).toBe(5);
  });

  it('A5/A6: cutting into assigned pieces takes the most recently assigned Operation first; a split must add up', async () => {
    wishFor('medpen', 5);
    await svc.assignWish(medpen, 2, 'new', { name: 'Old' });
    await svc.assignWish(medpen, 2, 'new', { name: 'New' });
    const oldId = pkgNamed('Old')?.id ?? '';
    const newId = pkgNamed('New')?.id ?? '';
    const plan = svc.planWishRemoval(medpen, 4);
    expect(plan.needsConfirm).toBe(true);
    expect(plan.free).toBe(1);
    expect(plan.parts.map((p) => [p.packageName, p.qty, p.max])).toEqual([['New', 2, 2], ['Old', 1, 2]]);
    expect(plan.parts[0]).toEqual(expect.objectContaining({ lastWish: true, dissolves: true, einsaetze: 0 }));

    expect(await svc.applyWishRemoval(medpen, 4, { split: { [oldId]: 3 } })).toEqual({ ok: false, key: 'hq.nachschub.splitInvalid' });
    expect(wish.qty('medpen')).toBe(5);

    einsaetze.set([{ id: 'E1', packageId: newId, status: 'planned' }]);
    const r = await svc.applyWishRemoval(medpen, 4, { split: { [oldId]: 2, [newId]: 1 }, surface: 'wishlist' });
    expect(r.ok).toBe(true);
    expect(wish.qty('medpen')).toBe(1);
    // "Old" lost its last wish and had no Einsatz: dissolved along. "New" keeps one piece.
    expect(pkgNamed('Old')).toBeUndefined();
    expect(alloc().assignments.map((a) => [a.packageName, a.qty])).toEqual([['New', 1]]);
    expect(tracked).toEqual([['hq:path_group_release', { surface: 'wishlist', pieces: 3, dissolved: true }]]);
  });

  it('A7: an Operation with an Einsatz stays when its last wish goes, unless the dissolve flag names it', async () => {
    wishFor('medpen', 2);
    await svc.assignWish(medpen, 2, 'new', { name: 'Kept' });
    const id = pkgNamed('Kept')?.id ?? '';
    einsaetze.set([{ id: 'E1', packageId: id, status: 'done' }]);
    const plan = svc.planWishRemoval(medpen, 2);
    expect(plan.parts[0]).toEqual(expect.objectContaining({ lastWish: true, dissolves: false, einsaetze: 1 }));
    const kept = await svc.applyWishRemoval(medpen, 2);
    expect(kept.ok).toBe(true);
    expect(pkgNamed('Kept')).toBeDefined();
    await kept.undo?.();

    const gone = await svc.applyWishRemoval(medpen, 2, { dissolve: [id] });
    expect(gone.params).toEqual(expect.objectContaining({ dissolved: 1 }));
    expect(pkgNamed('Kept')).toBeUndefined();
    expect(wish.qty('medpen')).toBe(0);
  });

  it('A10: one undo brings back the wish, the assignments and a dissolved Operation with its name and slot', async () => {
    wishFor('medpen', 3);
    await svc.assignWish(medpen, 3, 'new', { name: 'Solo' });
    const before = pkgNamed('Solo');
    const r = await svc.applyWishRemoval(medpen, 3);
    expect(pkgNamed('Solo')).toBeUndefined();
    expect(wish.qty('medpen')).toBe(0);
    const back = await r.undo?.();
    expect(back?.ok).toBe(true);
    expect(pkgNamed('Solo')).toEqual(expect.objectContaining({ id: before?.id, slot: before?.slot, status: 'active' }));
    expect(wish.qty('medpen')).toBe(3);
    expect(alloc()).toEqual(expect.objectContaining({ assigned: 3, free: 0 }));
  });

  it('A9: releasing in the HQ keeps the wish free again, or also deletes it; the info says what happens to the Operation', async () => {
    wishFor('medpen', 4);
    wishFor('rattler', 1);
    await svc.assignWish(medpen, 3, 'new', { name: 'Op' });
    const id = pkgNamed('Op')?.id ?? '';
    await svc.assignWish({ kind: 'item', className: 'rattler', forClassName: null }, 1, id);
    const line = alloc().assignments[0].lineIds[0];
    expect(svc.releaseInfo(line)).toEqual(expect.objectContaining({ pieces: 3, emptiesPackage: false, einsaetze: 0, dissolvesAlong: false }));

    const keep = await svc.release(line, { surface: 'hq' });
    expect(keep).toEqual(expect.objectContaining({ ok: true, key: 'hq.nachschub.done.released' }));
    expect(wish.qty('medpen')).toBe(4);
    expect(alloc()).toEqual(expect.objectContaining({ assigned: 0, free: 4 }));
    await keep.undo?.();
    expect(alloc().assigned).toBe(3);

    const del = await svc.release(line, { alsoRemoveWish: true });
    expect(del.ok).toBe(true);
    expect(wish.qty('medpen')).toBe(1);
    await del.undo?.();
    expect(wish.qty('medpen')).toBe(4);
    expect(tracked).toEqual([['hq:path_group_release', { surface: 'hq', pieces: 3, dissolved: false }]]);
  });

  it('A7/A9: releasing the last wish of an Operation without Einsatz dissolves it; the edit flow\'s removeLine never does', async () => {
    wishFor('medpen', 2);
    await svc.assignWish(medpen, 2, 'new', { name: 'Op' });
    const line = alloc().assignments[0].lineIds[0];
    expect(svc.releaseInfo(line)).toEqual(expect.objectContaining({ emptiesPackage: true, dissolvesAlong: true }));
    const viaEdit = await svc.removeLine(line, true);
    expect(viaEdit.key).toBe('hq.nachschub.done.lineRemoved');
    expect(pkgNamed('Op')).toBeDefined();
    expect(wish.qty('medpen')).toBe(2);
    await viaEdit.undo?.();

    const r = await svc.release(line);
    expect(r.params).toEqual(expect.objectContaining({ dissolved: 1 }));
    expect(pkgNamed('Op')).toBeUndefined();
    await r.undo?.();
    expect(pkgNamed('Op')).toBeDefined();
    expect(alloc().assigned).toBe(2);
  });

  it('"Leeren" with backToWishlist keeps the wish; without it the wish pieces go too', async () => {
    wishFor('medpen', 3);
    await svc.assignWish(medpen, 3, 'new', { name: 'Op' });
    const id = pkgNamed('Op')?.id ?? '';
    const keep = await svc.empty(id, true);
    expect(wish.qty('medpen')).toBe(3);
    await keep.undo?.();
    const drop = await svc.empty(id, false);
    expect(wish.qty('medpen')).toBe(0);
    await drop.undo?.();
    expect(wish.qty('medpen')).toBe(3);
    expect(alloc().assigned).toBe(3);
  });

  it('A8: a fulfilled wish line closes as reached and stays visible in its Operation', async () => {
    wishFor('medpen', 2);
    wishFor('rattler', 1);
    await svc.assignWish(medpen, 2, 'new', { name: 'Op' });
    const id = pkgNamed('Op')?.id ?? '';
    await svc.assignWish({ kind: 'item', className: 'rattler', forClassName: null }, 1, id);
    await svc.reconcile(); // baselines from the (empty) stock
    stock.set([{ class_name: 'medpen', qty: 2 }]);
    await svc.reconcile();
    const lines = svc.linesOf(id);
    expect(lines.find((l) => l.className === 'medpen')?.done).toBe(true);
    expect(lines.length).toBe(2);
    expect(svc.evaluation(id)?.progress).toEqual({ done: 1, total: 2 });
    expect(alloc().assigned).toBe(0);
  });

  it('A11: old wish lines are counted back onto the wishlist once and relabelled; events, closed and pick-up lines stay', async () => {
    server = [
      { id: 'N1', name: 'Normal', status: 'active', slot: 1, snapshot: {}, archived_at: null, deleted_at: null, created_at: tick() },
      { id: 'E1', name: 'Event', status: 'active', slot: 2, snapshot: {}, type: 'event', archived_at: null, deleted_at: null, created_at: tick() },
    ];
    await svc.reload();
    wishFor('medpen', 1);
    const old = supplies.put({ name: 'Medpen', qty: 3, className: 'medpen', packageId: 'N1' });
    const closed = supplies.put({ name: 'Rattler', qty: 2, className: 'rattler', packageId: 'N1', done: true });
    const pickup = supplies.put({ name: 'Gallant', qty: 2, className: 'gallant', packageId: 'N1', stepKind: 'pickup' });
    const event = supplies.put({ name: 'Arrow', qty: 1, className: 'arrow', packageId: 'E1' });

    expect(await svc.reconcileLegacyWishLines()).toBe(1);
    expect(wish.qty('medpen')).toBe(4);
    expect(supplies.line(old)?.source).toBe('wish');
    expect(alloc()).toEqual(expect.objectContaining({ wished: 4, assigned: 3, free: 1 }));
    expect([closed, pickup, event].map((l) => supplies.line(l)?.source)).toEqual(['search', 'search', 'search']);
    expect(wish.qty('rattler') + wish.qty('gallant') + wish.qty('arrow')).toBe(0);

    // Idempotent: a later pass (another session, another device after the relabel synced) finds nothing left.
    (svc as unknown as { legacyReconciled: boolean }).legacyReconciled = false;
    expect(await svc.reconcileLegacyWishLines()).toBe(0);
    expect(wish.qty('medpen')).toBe(4);
  });

  it('the picker lists active normal Operationen newest first with progress and the slots', async () => {
    wishFor('medpen', 5);
    await svc.assignWish(medpen, 1, 'new', { name: 'First' });
    await svc.assignWish(medpen, 1, 'new', { name: 'Second' });
    einsaetze.set([{ id: 'E1', packageId: pkgNamed('First')?.id ?? '', status: 'done' }, { id: 'E2', packageId: pkgNamed('First')?.id ?? '', status: 'planned' }]);
    const t = svc.assignTargets();
    expect(t.operations.map((o) => [o.name, o.einsaetzeDone, o.einsaetzeTotal])).toEqual([['Second', 0, 0], ['First', 1, 2]]);
    expect(t).toEqual(expect.objectContaining({ slotsUsed: 2, slotsMax: 7, canCreate: true, blockKey: null }));
  });
});
