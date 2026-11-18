import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { AnalyticsService } from '../../core/analytics.service';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
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
  minQuality: number | null;
  updatedAt: string;
  createdAt: string;
  deletedAt: string | null;
}

let clock = 0;
const tick = (): string => `2026-11-17T10:${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock++ % 60).padStart(2, '0')}Z`;

class FakeSupplies {
  readonly rows = signal<Ln[]>([]);
  readonly items = computed(() => this.rows().filter((r) => !r.deletedAt));
  readonly open = computed(() => this.items().filter((r) => !r.done));
  /** The server's copy of each line's source (the compare-and-set runs against it). */
  readonly server = new Map<string, string>();
  /** The compare-and-set fails (offline). */
  casFails = false;
  casCalls = 0;
  /** What a pull brings in from the server (another tab's edits). */
  onSync: (() => void) | null = null;
  readonly syncError = signal<string | null>(null);
  syncs = 0;
  async sync(): Promise<void> {
    this.syncs++;
    this.onSync?.();
  }
  private n = 0;
  addLine(name: string, qty: number, meta: { entityKind?: string; className?: string; forClassName?: string | null; packageId?: string | null; source?: string } = {}) {
    const pkg = meta.packageId ?? null;
    // Same predicate as HqSuppliesService.addLine, including the wish / non-wish split (H1).
    const same = this.items().find(
      (i) => !i.done && i.name.toLowerCase() === name.toLowerCase() && i.packageId === pkg && (i.forClassName ?? '') === (meta.forClassName ?? '') && (i.source === 'wish') === (meta.source === 'wish'),
    );
    if (same) {
      this.patch(same.id, { qty: same.qty + qty });
      return { id: same.id, prevQty: same.qty, prevAmount: null };
    }
    const id = `L${++this.n}`;
    const at = tick();
    this.rows.update((rs) => [
      ...rs,
      {
        id, name, qty, amount: null, unit: null, done: false, entityKind: meta.entityKind ?? null, className: meta.className ?? null, minQuality: null,
        forClassName: meta.forClassName ?? null, packageId: pkg, source: meta.source ?? 'manual', gather: null, stepKind: null, updatedAt: at, createdAt: at, deletedAt: null,
      },
    ]);
    this.server.set(id, meta.source ?? 'manual');
    return { id, prevQty: 0, prevAmount: null };
  }
  /** A line as it was written before this change (or by any other path). */
  put(l: Partial<Ln> & Pick<Ln, 'name' | 'qty' | 'className' | 'packageId'>): string {
    const id = `L${++this.n}`;
    const at = tick();
    const row: Ln = { id, amount: null, unit: null, done: false, entityKind: 'item', forClassName: null, source: 'search', gather: null, stepKind: null, minQuality: null, updatedAt: at, createdAt: at, deletedAt: null, ...l };
    this.rows.update((rs) => [...rs, row]);
    this.server.set(id, row.source);
    return id;
  }
  async casSource(ids: readonly string[], from: string, to: string): Promise<string[] | null> {
    this.casCalls++;
    if (this.casFails) return null;
    const won = ids.filter((id) => this.server.get(id) === from);
    for (const id of won) this.server.set(id, to);
    this.rows.update((rs) => rs.map((r) => (ids.includes(r.id) && this.server.has(r.id) ? { ...r, source: this.server.get(r.id) as string } : r)));
    return won;
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
  restore(id: string): boolean {
    if (!this.rows().some((r) => r.id === id)) return false;
    this.rows.update((rs) => rs.map((r) => (r.id === id ? { ...r, deletedAt: null } : r)));
    return true;
  }
  /** Another tab or device edited the line (a change the removal under test knows nothing about). */
  edit(id: string, p: Partial<Ln>) {
    this.patch(id, p);
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

interface FakeShip {
  id: string;
  shipClassName: string;
  status: 'owned' | 'wishlist';
  qty: number;
  customName: string | null;
  notes: string | null;
  selectedSkinId: string | null;
  origin: null;
}

class FakeWish {
  readonly rows = signal<WishRow[]>([]);
  readonly loaded = signal(true);
  failOn = new Set<string>();
  reloads = 0;
  reloadFails = false;
  async reload(): Promise<boolean> {
    this.reloads++;
    return !this.reloadFails;
  }
  async setQty(e: { kind: string; className: string; name?: string | null; forClassName?: string | null }, qty: number): Promise<boolean> {
    if (this.failOn.has(e.className)) return false;
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
  let failDrop: boolean;
  let ships: ReturnType<typeof signal<FakeShip[]>>;
  let gateNextRead: Promise<void> | null = null;
  let svc: NachschubService;

  /** Holds the next package read until `open()` is called. */
  const holdNextRead = (): (() => void) => {
    let open!: () => void;
    gateNextRead = new Promise<void>((r) => (open = r));
    return open;
  };
  /** The service as on a fresh page: nothing loaded yet. */
  const unload = (): void => {
    const s = svc as unknown as { loadedFor: string | null };
    s.loadedFor = null;
    svc.loaded.set(false);
    svc.packages.set([]);
  };
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  const idOf = (call: FakeCall): unknown =>
    (call.chain.filter(([m]) => m === 'eq').map(([, a]) => a).find((a) => a[0] === 'id') ?? [])[1];

  const answer = (call: FakeCall): FakeResult | Promise<FakeResult> => {
    if (call.target !== 'hq_supply_packages') return { data: null };
    const upsert = chainArgs(call, 'upsert');
    if (upsert) {
      const r = upsert[0] as ServerPkg;
      server = [...server.filter((s) => s.id !== r.id), { ...r, created_at: tick() }];
      return { data: null };
    }
    const update = chainArgs(call, 'update');
    if (update) {
      if (failDrop && (update[0] as Partial<ServerPkg>).deleted_at) return { error: { code: '500', message: 'boom' } };
      const hit = server.find((s) => s.id === idOf(call));
      if (hit) Object.assign(hit, update[0]);
      return { data: hit ? [{ id: hit.id }] : [] };
    }
    const snapshot = server.filter((s) => !s.deleted_at).map((s) => ({ ...s }));
    if (gateNextRead) {
      // A read that left before the writes below and answers after them (the first load racing an assign).
      const gate = gateNextRead;
      gateNextRead = null;
      return gate.then(() => ({ data: snapshot }));
    }
    return { data: snapshot };
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    server = [];
    tracked = [];
    failDrop = false;
    supplies = new FakeSupplies();
    wish = new FakeWish();
    ships = signal<FakeShip[]>([]);
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
        {
          provide: HangarService,
          useValue: {
            ships,
            error: signal(null),
            loadAll: () => Promise.resolve(),
            shipByClassName: (c: string) => ships().find((s) => s.shipClassName === c) ?? null,
            updateShip: async (id: string, p: Partial<FakeShip>) => (ships.update((l) => l.map((s) => (s.id === id ? { ...s, ...p } : s))), true),
          },
        },
        {
          // A ship wish lives in its hangar row; taking it to 0 deletes the row, a wish above 0 (re)creates it blank.
          provide: SearchWishlistService,
          useValue: {
            setQty: async (_k: string, c: string, _n: string | null | undefined, qty: number) => {
              if (qty <= 0) ships.update((l) => l.filter((s) => s.shipClassName !== c));
              else if (ships().some((s) => s.shipClassName === c)) ships.update((l) => l.map((s) => (s.shipClassName === c ? { ...s, qty } : s)));
              else ships.update((l) => [...l, { id: `sh-${c}`, shipClassName: c, status: 'wishlist', qty, customName: null, notes: null, selectedSkinId: null, origin: null }]);
              return true;
            },
          },
        },
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
    const medLine = lines.find((l) => l.className === 'medpen');
    expect(medLine?.done).toBe(true);
    expect(medLine?.source).toBe('wish_met');
    expect(lines.length).toBe(2);
    expect(svc.evaluation(id)?.progress).toEqual({ done: 1, total: 2 });
    // H2: the reached pieces are no longer wished - the wish shrank by the whole line, nothing turned free.
    expect(wish.qty('medpen')).toBe(0);
    expect(alloc()).toEqual(expect.objectContaining({ wished: 0, assigned: 0, free: 0 }));
  });

  it('H2: a met line lowers its wish exactly once; reopening it gives the pieces back once', async () => {
    wishFor('medpen', 5);
    wishFor('rattler', 1);
    await svc.assignWish(medpen, 3, 'new', { name: 'Op' });
    // A second line keeps the Operation active (a finished one archives itself).
    await svc.assignWish({ kind: 'item', className: 'rattler', forClassName: null }, 1, pkgNamed('Op')?.id ?? '');
    const line = alloc().assignments[0].lineIds[0];
    await svc.reconcile();
    stock.set([{ class_name: 'medpen', qty: 1 }]);
    await svc.reconcile();
    // A partial arrival answers the line, not the wish: still 5 wished, 3 assigned, 2 free.
    expect(alloc()).toEqual(expect.objectContaining({ wished: 5, assigned: 3, free: 2 }));
    supplies.setDone(line, true); // ticked by hand (or by a whole live purchase)
    await svc.reconcile();
    await svc.reconcile();
    expect(wish.qty('medpen')).toBe(2);
    expect(alloc()).toEqual(expect.objectContaining({ wished: 2, assigned: 0, free: 2 }));
    supplies.setDone(line, false);
    await svc.reconcile();
    await svc.reconcile();
    expect(wish.qty('medpen')).toBe(5);
    expect(alloc().assigned).toBe(3);
  });

  it('H1: a wish never merges into a Bestand line of the same item, and a Bestand line never into a wish line', async () => {
    wishFor('medpen', 3);
    await svc.assignWish(medpen, 1, 'new', { name: 'Op' });
    const id = pkgNamed('Op')?.id ?? '';
    await svc.addToNachschub(id, [{ name: 'medpen', className: 'medpen', amount: 4, unit: 'pcs' }]);
    expect(alloc()).toEqual(expect.objectContaining({ assigned: 1, free: 2 }));
    await svc.assignWish(medpen, 2, id);
    const lines = svc.linesOf(id).map((l) => [l.source, l.qty]);
    expect(lines).toEqual([['wish', 3], ['search', 4]]);
    expect(alloc()).toEqual(expect.objectContaining({ assigned: 3, free: 0 }));
  });

  it('M1: when a dissolve fails the lines of that Operation are lowered as well, never above the wish', async () => {
    wishFor('medpen', 2);
    await svc.assignWish(medpen, 2, 'new', { name: 'Solo' });
    failDrop = true;
    const r = await svc.applyWishRemoval(medpen, 2);
    expect(r).toEqual(expect.objectContaining({ ok: true, warn: { key: 'hq.nachschub.dissolveFailed' } }));
    expect(pkgNamed('Solo')).toBeDefined();
    expect(wish.qty('medpen')).toBe(0);
    expect(alloc().assigned).toBe(0);
  });

  it('M3: an event Nachschub keeps the old rule - its picks leave the wishlist and it never holds a wish', async () => {
    wishFor('medpen', 3);
    const r = await svc.createFromWishlist({ picks: [{ key: 'item:medpen', qty: 2 }], name: 'Ev', event: { type: 'event', eventId: 'ev1', name: 'Ev', rewards: [] } });
    expect(r.ok).toBe(true);
    expect(wish.qty('medpen')).toBe(1);
    expect(svc.linesOf(r.id!).map((l) => l.source)).toEqual(['search']);
    expect(alloc()).toEqual(expect.objectContaining({ wished: 1, assigned: 0, free: 1 }));
    expect(svc.planWishRemoval(medpen, 1).parts).toEqual([]);
    await svc.applyWishRemoval(medpen, 1);
    expect(pkgNamed('Ev')).toBeDefined();
    await r.undo?.();
    expect(wish.qty('medpen')).toBe(2); // 0 after the removal, the undo puts back the 2 the event took
  });

  it('M4: "most recently assigned" follows the creation of the lines, not later edits', async () => {
    wishFor('medpen', 4);
    await svc.assignWish(medpen, 2, 'new', { name: 'Old' });
    await svc.assignWish(medpen, 2, 'new', { name: 'New' });
    const oldLine = svc.linesOf(pkgNamed('Old')?.id ?? '')[0].id;
    supplies.setLine(oldLine, 2); // an edit (or a sync) touches the older line later
    expect(svc.planWishRemoval(medpen, 1).parts.map((p) => [p.packageName, p.qty])).toEqual([['New', 1], ['Old', 0]]);
  });

  it('M2: wish lines above a wish lowered elsewhere are trimmed (newest first) after a fresh read; a stale read trims nothing', async () => {
    wishFor('medpen', 4);
    await svc.assignWish(medpen, 2, 'new', { name: 'Old' });
    await svc.assignWish(medpen, 2, 'new', { name: 'New' });
    await wish.setQty({ kind: 'item', className: 'medpen' }, 1); // the cart lowered it without the dialog
    wish.reloadFails = true;
    await svc.reconcile();
    expect(alloc().assignments.map((a) => a.qty)).toEqual([2, 2]);
    wish.reloadFails = false;
    await svc.reconcile();
    expect(alloc().assignments.map((a) => [a.packageName, a.qty])).toEqual([['Old', 1]]);
    await wish.setQty({ kind: 'item', className: 'medpen' }, 0); // the wish is gone: its lines go too
    await svc.reconcile();
    expect(alloc().assigned).toBe(0);
    expect(svc.linesOf(pkgNamed('Old')?.id ?? '').length).toBe(0);
  });

  it('round 2 #1: with two tabs the trim pulls the lines first, so a line another tab met is never cut; a failed sync trims nothing', async () => {
    wishFor('medpen', 5);
    await svc.assignWish(medpen, 2, 'new', { name: 'L' });
    await svc.assignWish(medpen, 3, 'new', { name: 'M' });
    const lLine = svc.linesOf(pkgNamed('L')?.id ?? '')[0].id;
    const mLine = svc.linesOf(pkgNamed('M')?.id ?? '')[0].id;
    // Tab A ticked L: on the server L is met and the wish is down to 3. This tab still holds L as an open wish line.
    await wish.setQty({ kind: 'item', className: 'medpen' }, 3);
    supplies.syncError.set('errors.offline');
    await svc.reconcile();
    expect([supplies.line(lLine)?.qty, supplies.line(mLine)?.qty]).toEqual([2, 3]);

    supplies.syncError.set(null);
    supplies.onSync = () => {
      supplies.server.set(lLine, 'wish_met');
      supplies.rows.update((rs) => rs.map((r) => (r.id === lLine ? { ...r, done: true, source: 'wish_met' } : r)));
    };
    await svc.reconcile();
    expect(supplies.line(mLine)?.qty).toBe(3);
    expect(supplies.line(lLine)).toEqual(expect.objectContaining({ deletedAt: null, source: 'wish_met' }));
    expect(wish.qty('medpen')).toBe(3);
  });

  it('round 2 #2: a live purchase closes the line, then the Operation is deleted - the wish drops exactly once', async () => {
    wishFor('medpen', 5);
    await svc.assignWish(medpen, 2, 'new', { name: 'Op' });
    const id = pkgNamed('Op')?.id ?? '';
    const line = svc.linesOf(id)[0].id;
    supplies.setDone(line, true); // what tickByClassName does for a whole live purchase - no stock change, no reconcile
    const r = await svc.remove(id, true);
    expect(r.ok).toBe(true);
    expect(wish.qty('medpen')).toBe(3);
    TestBed.tick();
    await svc.reconcile();
    expect(wish.qty('medpen')).toBe(3);
  });

  it('round 2 #2: a wish line that becomes done lowers its wish without any reconcile pass', async () => {
    wishFor('medpen', 5);
    wishFor('rattler', 1);
    await svc.assignWish(medpen, 2, 'new', { name: 'Op' });
    supplies.setDone(svc.linesOf(pkgNamed('Op')?.id ?? '')[0].id, true);
    TestBed.tick();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((res) => setTimeout(res, 0));
    expect(wish.qty('medpen')).toBe(3);
  });

  it('round 3: an assign started while the first load is in flight waits for it and lands in the state', async () => {
    wishFor('medpen', 3);
    await svc.assignWish(medpen, 1, 'new', { name: 'Old' });
    unload();
    const open = holdNextRead();
    const pending = svc.assignWish(medpen, 2, 'new', { name: 'Neu' });
    await settle();
    expect(svc.packages().length).toBe(0); // still waiting for the load
    open();
    const r = await pending;
    expect(r.ok).toBe(true);
    expect(svc.packages().map((p) => p.name).sort()).toEqual(['Neu', 'Old']);
    expect(svc.linesOf(r.id!).map((l) => [l.source, l.qty])).toEqual([['wish', 2]]);
    expect(alloc()).toEqual(expect.objectContaining({ wished: 3, assigned: 3, free: 0 }));
  });

  it('round 3: a read that answers after a local write never drops it (a new package stays, a deleted one stays gone)', async () => {
    wishFor('medpen', 4);
    await svc.assignWish(medpen, 1, 'new', { name: 'Gone' });
    const gone = pkgNamed('Gone')?.id ?? '';
    const open = holdNextRead();
    const late = svc.reload(); // left before the writes below
    await settle();
    const made = await svc.assignWish(medpen, 2, 'new', { name: 'Neu' });
    expect(made.ok).toBe(true);
    await svc.remove(gone, true);
    open();
    expect(await late).toBe(true);
    expect(svc.packages().map((p) => p.name)).toEqual(['Neu']);
    expect(alloc()).toEqual(expect.objectContaining({ assigned: 2, free: 2 }));
  });

  it('round 3: a removal started before the first load counts against the loaded Operationen', async () => {
    wishFor('medpen', 3);
    await svc.assignWish(medpen, 3, 'new', { name: 'Op' });
    const line = alloc().assignments[0].lineIds[0];
    einsaetze.set([{ id: 'E1', packageId: pkgNamed('Op')?.id ?? '', status: 'planned' }]);
    unload();
    const open = holdNextRead();
    const pending = svc.applyWishRemoval(medpen, 2);
    await settle();
    open();
    const r = await pending;
    expect(r.ok).toBe(true);
    expect(wish.qty('medpen')).toBe(1);
    expect(supplies.line(line)?.qty).toBe(1); // without the wait the lines would have kept 3 above a wish of 1
    expect(alloc()).toEqual(expect.objectContaining({ wished: 1, assigned: 1, free: 0 }));
  });

  describe('round 4: archived Operationen', () => {
    const archivedRow = (id: string, name: string): ServerPkg => ({ id, name, status: 'archived', slot: null, snapshot: {}, archived_at: tick(), deleted_at: null, created_at: tick() });

    it('an open wish line left in an archived Operation is removed on load; the empty Operation goes (no Einsatz) and never takes a slot', async () => {
      server = [archivedRow('A1', 'RSI Polaris'), archivedRow('A2', 'Kept')];
      await svc.reload();
      const polaris = supplies.put({ name: 'RSI Polaris', qty: 1, className: 'rsi_polaris', entityKind: 'ship', packageId: 'A1', source: 'wish' });
      supplies.put({ name: 'Medpen', qty: 2, className: 'medpen', packageId: 'A2', source: 'wish' });
      einsaetze.set([{ id: 'E1', packageId: 'A2', status: 'done' }]);
      wishFor('medpen', 2);
      expect(alloc().assigned).toBe(0); // an archived Operation holds no assignment
      await svc.reconcile();
      expect(supplies.line(polaris)?.deletedAt).not.toBeNull();
      expect(pkgNamed('RSI Polaris')).toBeUndefined();
      // With an Einsatz it stays, archived and empty; the wish stays and is free.
      expect(pkgNamed('Kept')).toEqual(expect.objectContaining({ status: 'archived', slot: null }));
      expect(svc.linesOf('A2').length).toBe(0);
      expect(alloc()).toEqual(expect.objectContaining({ wished: 2, assigned: 0, free: 2 }));
      expect(svc.active().length).toBe(0);
    });

    it('a met line keeps its archived Operation as history (A8)', async () => {
      server = [archivedRow('A3', 'Omnisky')];
      await svc.reload();
      const met = supplies.put({ name: 'Omnisky', qty: 1, className: 'omnisky', packageId: 'A3', source: 'wish_met', done: true });
      await svc.reconcile();
      expect(supplies.line(met)?.deletedAt).toBeNull();
      expect(pkgNamed('Omnisky')?.status).toBe('archived');
    });

    it('a finished Operation archives only after its ticks reached the server', async () => {
      wishFor('medpen', 1);
      await svc.assignWish(medpen, 1, 'new', { name: 'Op' });
      await svc.reconcile();
      supplies.setDone(svc.linesOf(pkgNamed('Op')?.id ?? '')[0].id, true);
      supplies.syncError.set('errors.offline');
      await svc.reconcile();
      expect(pkgNamed('Op')?.status).toBe('active');
      supplies.syncError.set(null);
      await svc.reconcile();
      expect(pkgNamed('Op')?.status).toBe('archived');
    });

    it('the head counter counts open lines of active Operationen only', async () => {
      server = [archivedRow('A4', 'Old')];
      await svc.reload();
      supplies.put({ name: 'Left', qty: 1, className: 'left', packageId: 'A4', source: 'search' });
      supplies.put({ name: 'Loose', qty: 1, className: 'loose', packageId: null, source: 'manual' });
      wishFor('medpen', 1);
      await svc.assignWish(medpen, 1, 'new', { name: 'Live' });
      expect(svc.openActiveLines().map((l) => l.name)).toEqual(['medpen']);
    });
  });

  describe('A11 legacy lines (H3)', () => {
    const wishKind = (kind: string, className: string, qty: number, forClassName = '') =>
      wish.rows.update((rs) => [...rs, { kind, className, name: className, qty, forClassName }]);
    const material = { kind: 'material', className: 'iron', forClassName: null };

    beforeEach(async () => {
      server = [
        { id: 'N1', name: 'Normal', status: 'active', slot: 1, snapshot: {}, archived_at: null, deleted_at: null, created_at: tick() },
        { id: 'E1', name: 'Event', status: 'active', slot: 2, snapshot: {}, type: 'event', archived_at: null, deleted_at: null, created_at: tick() },
      ];
      await svc.reload();
    });

    it('only certain old wish lines are counted back; plain item / ship lines, SCU, quality, stops, events and closed lines stay', async () => {
      wishKind('material', 'iron', 1);
      const old = supplies.put({ name: 'Iron', qty: 3, className: 'iron', entityKind: 'material', packageId: 'N1' });
      const forBp = supplies.put({ name: 'Bolt', qty: 2, className: 'bolt', packageId: 'N1', forClassName: 'bp_gun' });
      const others = [
        supplies.put({ name: 'Medpen', qty: 3, className: 'medpen', packageId: 'N1' }), // a Bestand line without a place looks like this
        supplies.put({ name: 'Polaris', qty: 1, className: 'polaris', entityKind: 'ship', packageId: 'N1' }), // a reward that stayed in a normal one
        supplies.put({ name: 'Ore', qty: 1, className: 'ore', entityKind: 'material', packageId: 'N1', amount: 0.5 }),
        supplies.put({ name: 'Steel', qty: 1, className: 'steel', entityKind: 'material', packageId: 'N1', minQuality: 700 }),
        supplies.put({ name: 'Gold', qty: 2, className: 'gold', entityKind: 'material', packageId: 'N1', stepKind: 'pickup' }),
        supplies.put({ name: 'Rattler', qty: 2, className: 'rattler', entityKind: 'material', packageId: 'N1', done: true }),
        supplies.put({ name: 'Arrow', qty: 1, className: 'arrow', entityKind: 'material', packageId: 'E1' }),
      ];
      expect(await svc.reconcileLegacyWishLines()).toBe(2);
      expect(wish.qty('iron')).toBe(4);
      expect(wish.rows().find((r) => r.className === 'bolt')).toEqual(expect.objectContaining({ kind: 'item', qty: 2, forClassName: 'bp_gun' }));
      expect([old, forBp].map((l) => supplies.line(l)?.source)).toEqual(['wish', 'wish']);
      expect(others.map((l) => supplies.line(l)?.source)).toEqual(others.map(() => 'search'));
      expect(['medpen', 'polaris', 'ore', 'steel', 'gold', 'rattler', 'arrow'].map((c) => wish.qty(c))).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(svc.allocationOf(material)).toEqual(expect.objectContaining({ wished: 4, assigned: 3, free: 1 }));
    });

    it('runs once: a second pass, and a device whose line another device already relabelled, add nothing', async () => {
      wishKind('material', 'iron', 1);
      const a = supplies.put({ name: 'Iron', qty: 3, className: 'iron', entityKind: 'material', packageId: 'N1' });
      expect(await svc.reconcileLegacyWishLines()).toBe(1);
      (svc as unknown as { legacyReconciled: boolean }).legacyReconciled = false;
      expect(await svc.reconcileLegacyWishLines()).toBe(0);
      expect(wish.qty('iron')).toBe(4);

      // Another device won the server row first: this one still holds a stale 'search' copy.
      const b = supplies.put({ name: 'Copper', qty: 2, className: 'copper', entityKind: 'material', packageId: 'N1' });
      supplies.server.set(b, 'wish');
      (svc as unknown as { legacyReconciled: boolean }).legacyReconciled = false;
      expect(await svc.reconcileLegacyWishLines()).toBe(0);
      expect(wish.qty('copper')).toBe(0);
      expect(supplies.line(b)?.source).toBe('wish'); // the local copy adopts the server's label
      expect(supplies.line(a)?.source).toBe('wish');
    });

    it('a failed wishlist write puts the label back, so the retry adds the pieces exactly once; offline changes nothing', async () => {
      wishKind('material', 'iron', 1);
      const a = supplies.put({ name: 'Iron', qty: 3, className: 'iron', entityKind: 'material', packageId: 'N1' });
      supplies.casFails = true;
      expect(await svc.reconcileLegacyWishLines()).toBe(0);
      supplies.casFails = false;
      wish.failOn.add('iron');
      expect(await svc.reconcileLegacyWishLines()).toBe(0);
      expect(supplies.line(a)?.source).toBe('search');
      expect(wish.qty('iron')).toBe(1);
      wish.failOn.clear();
      expect(await svc.reconcileLegacyWishLines()).toBe(1);
      expect(wish.qty('iron')).toBe(4);
    });

    it('the 999 cap: what does not fit on the wish is taken off the lines, never assigned beyond the wish', async () => {
      wishKind('material', 'iron', 997);
      const a = supplies.put({ name: 'Iron', qty: 5, className: 'iron', entityKind: 'material', packageId: 'N1' });
      expect(await svc.reconcileLegacyWishLines()).toBe(1);
      expect(wish.qty('iron')).toBe(999);
      expect(supplies.line(a)?.qty).toBe(2);
      expect(svc.allocationOf(material)).toEqual(expect.objectContaining({ wished: 999, assigned: 2 }));
    });
  });

  describe('H3: delete an archived Operation', () => {
    const archived = (id: string, name: string): ServerPkg => ({ id, name, status: 'archived', slot: null, snapshot: {}, archived_at: tick(), deleted_at: null, created_at: tick() });

    it('removes it with its history lines, moves no wish and no slot; the undo brings it back ARCHIVED', async () => {
      server = [archived('H3A', 'Old'), { id: 'H3N', name: 'Live', status: 'active', slot: 1, snapshot: {}, archived_at: null, deleted_at: null, created_at: tick() }];
      await svc.reload();
      wishFor('medpen', 3);
      const met = supplies.put({ name: 'Medpen', qty: 2, className: 'medpen', packageId: 'H3A', source: 'wish_met', done: true });
      const slotsBefore = svc.packages().filter((p) => p.status === 'active').map((p) => p.slot);
      const r = await svc.removeArchived('H3A');
      expect(r.ok).toBe(true);
      expect(pkgNamed('Old')).toBeUndefined();
      expect(svc.archived()).toEqual([]);
      expect(supplies.items().some((l) => l.id === met)).toBe(false);
      expect(wish.qty('medpen')).toBe(3);
      expect(svc.packages().filter((p) => p.status === 'active').map((p) => p.slot)).toEqual(slotsBefore);
      expect((await r.undo?.())?.ok).toBe(true);
      expect(pkgNamed('Old')?.status).toBe('archived');
      expect(pkgNamed('Old')?.slot).toBeNull();
      expect(supplies.line(met)?.source).toBe('wish_met');
      expect(wish.qty('medpen')).toBe(3);
    });

    it('refuses an active Operation', async () => {
      server = [{ id: 'H3N', name: 'Live', status: 'active', slot: 1, snapshot: {}, archived_at: null, deleted_at: null, created_at: tick() }];
      await svc.reload();
      expect((await svc.removeArchived('H3N')).ok).toBe(false);
      expect(pkgNamed('Live')).toBeDefined();
    });
  });

  describe('H4: plain item / ship lines of old Operationen', () => {
    const OLD = '2026-11-10T10:00:00.000Z';
    const wishKind = (kind: string, className: string, qty: number) => wish.rows.update((rs) => [...rs, { kind, className, name: className, qty, forClassName: '' }]);
    const line = (name: string, className: string, qty: number, extra: Partial<Ln> = {}) => supplies.put({ name, qty, className, packageId: 'P1', createdAt: OLD, ...extra });

    beforeEach(async () => {
      server = [
        { id: 'P1', name: 'Plain', status: 'active', slot: 1, snapshot: {}, archived_at: null, deleted_at: null, created_at: tick() },
        { id: 'E1', name: 'Event', status: 'active', slot: 2, snapshot: {}, type: 'event', archived_at: null, deleted_at: null, created_at: tick() },
      ];
      await svc.reload();
    });

    it('candidates: open plain item / ship search lines made before the cut-off; every other shape is excluded', async () => {
      const a = line('Medpen', 'medpen', 3);
      const b = line('Polaris', 'polaris', 1, { entityKind: 'ship' });
      const out = [
        line('New', 'newer', 1, { createdAt: '2026-11-19T09:00:00.000Z' }),
        line('Blueprint', 'bolt', 1, { forClassName: 'bp_gun' }),
        line('Gather', 'gold', 1, { gather: [{ place: 'X', qty: 1 }] as never }),
        line('Step', 'step', 1, { stepKind: 'pickup' }),
        line('Scu', 'ore', 1, { amount: 0.5 }),
        line('Quality', 'steel', 1, { minQuality: 700 }),
        line('Done', 'done', 1, { done: true }),
        line('Wish', 'wished', 1, { source: 'wish' }),
        line('Manual', 'manual', 1, { source: 'manual' }),
        line('Material', 'iron', 1, { entityKind: 'material' }),
        supplies.put({ name: 'Arrow', qty: 1, className: 'arrow', packageId: 'E1', createdAt: OLD }),
      ];
      expect(svc.plainSearchLinesOf('P1').map((l) => l.id).sort()).toEqual([a, b].sort());
      expect(svc.plainSearchLinesOf('E1')).toEqual([]);
      expect(out.length).toBe(11);
    });

    it('"Als Wünsche führen": only CAS-won lines count, ONE wishlist write per wish; the undo lowers by exactly that and relabels back', async () => {
      wishKind('item', 'medpen', 1);
      const a = line('Medpen', 'medpen', 3);
      const b = line('Medpen', 'medpen', 2, { entityKind: 'item' });
      supplies.server.set(b, 'wish'); // another device already answered this one
      const r = await svc.adoptPlainLines('P1');
      expect(r.ok).toBe(true);
      expect(r.params).toEqual({ count: 1 });
      expect(supplies.line(a)?.source).toBe('wish');
      expect(wish.qty('medpen')).toBe(4);
      expect(svc.plainSearchLinesOf('P1')).toEqual([]);
      expect((await r.undo?.())?.ok).toBe(true);
      expect(supplies.line(a)?.source).toBe('search');
      expect(wish.qty('medpen')).toBe(1);
      expect(svc.plainSearchLinesOf('P1').map((l) => l.id)).toEqual([a]);
    });

    it('a failed wishlist write puts the label back and shows an error; offline changes nothing', async () => {
      wishKind('item', 'medpen', 1);
      const a = line('Medpen', 'medpen', 3);
      supplies.casFails = true;
      expect((await svc.adoptPlainLines('P1')).ok).toBe(false);
      supplies.casFails = false;
      wish.failOn.add('medpen');
      const r = await svc.adoptPlainLines('P1');
      expect(r.ok).toBe(false);
      expect(r.key).toBe('hq.nachschub.wishlistFailed');
      expect(supplies.line(a)?.source).toBe('search');
      expect(wish.qty('medpen')).toBe(1);
    });

    it('the 999 cap: the cut-off pieces are taken off the lines and come back with the undo', async () => {
      wishKind('item', 'medpen', 997);
      const a = line('Medpen', 'medpen', 5);
      const r = await svc.adoptPlainLines('P1');
      expect(wish.qty('medpen')).toBe(999);
      expect(supplies.line(a)?.qty).toBe(2);
      await r.undo?.();
      expect(wish.qty('medpen')).toBe(997);
      expect(supplies.line(a)?.qty).toBe(5);
    });

    it('"So lassen": the lines become manual (hint gone, survives a reload), no wish moves; failure keeps the hint; the undo gives them back', async () => {
      wishKind('item', 'medpen', 1);
      const a = line('Medpen', 'medpen', 3);
      supplies.casFails = true;
      expect((await svc.keepPlainLines('P1')).ok).toBe(false);
      expect(svc.plainSearchLinesOf('P1').length).toBe(1);
      supplies.casFails = false;
      const r = await svc.keepPlainLines('P1');
      expect(r.ok).toBe(true);
      expect(supplies.line(a)?.source).toBe('manual');
      expect(supplies.server.get(a)).toBe('manual');
      expect(svc.plainSearchLinesOf('P1')).toEqual([]);
      expect(wish.qty('medpen')).toBe(1);
      await r.undo?.();
      expect(supplies.line(a)?.source).toBe('search');
    });
  });

  describe('H1: the undo of a removal gives back what it took, by delta', () => {
    it('a change made in between (another tab: the line and the wish went up) survives the undo', async () => {
      wishFor('medpen', 5);
      await svc.assignWish(medpen, 4, 'new', { name: 'A' });
      const lineId = alloc().assignments[0].lineIds[0];
      const r = await svc.applyWishRemoval(medpen, 2); // 1 free piece + 1 piece out of the line (4 -> 3)
      expect(supplies.line(lineId)?.qty).toBe(3);
      expect(wish.qty('medpen')).toBe(3);
      supplies.edit(lineId, { qty: 5 }); // another device raised the line by 2 ...
      wish.rows.update((rs) => rs.map((w) => ({ ...w, qty: 8 }))); // ... and the wish by 5
      const back = await r.undo?.();
      expect(back?.ok).toBe(true);
      expect(supplies.line(lineId)?.qty).toBe(6); // 5 + the 1 this removal took, never the old absolute 4
      expect(wish.qty('medpen')).toBe(10); // 8 + the 2 this removal took
    });

    it('a line met in between is refused (translated error), the wish still comes back, nothing stale is written', async () => {
      wishFor('medpen', 4);
      await svc.assignWish(medpen, 4, 'new', { name: 'A' });
      const lineId = alloc().assignments[0].lineIds[0];
      const r = await svc.applyWishRemoval(medpen, 1);
      expect(supplies.line(lineId)?.qty).toBe(3);
      supplies.edit(lineId, { done: true, source: 'wish_met' });
      const back = await r.undo?.();
      expect(back).toEqual({ ok: false, key: 'errors.generic' });
      expect(supplies.line(lineId)?.qty).toBe(3);
      expect(wish.qty('medpen')).toBe(4);
    });

    it('a line that is gone for good is refused, never re-created from a guess', async () => {
      wishFor('medpen', 2);
      await svc.assignWish(medpen, 2, 'new', { name: 'A' });
      const lineId = alloc().assignments[0].lineIds[0];
      const r = await svc.release(lineId, { surface: 'hq' });
      supplies.rows.update((rs) => rs.filter((x) => x.id !== lineId)); // purged elsewhere
      const back = await r.undo?.();
      expect(back?.ok).toBe(false);
    });

    it('a ship wish taken to 0 comes back with its custom name and notes', async () => {
      ships.set([{ id: 'sh-1', shipClassName: 'cutlass', status: 'wishlist', qty: 1, customName: 'Black Mamba', notes: 'next pledge', selectedSkinId: null, origin: null }]);
      const cutlass = { kind: 'ship', className: 'cutlass', forClassName: null, name: 'Cutlass' };
      const r = await svc.applyWishRemoval(cutlass, 1);
      expect(r.ok).toBe(true);
      expect(ships()).toEqual([]);
      const back = await r.undo?.();
      expect(back?.ok).toBe(true);
      expect(ships()).toEqual([expect.objectContaining({ shipClassName: 'cutlass', status: 'wishlist', qty: 1, customName: 'Black Mamba', notes: 'next pledge' })]);
    });
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
