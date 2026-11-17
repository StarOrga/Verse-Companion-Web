import { Injectable, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { humanizeClassName } from '../../codex/codex-format';
import { AnalyticsService } from '../../core/analytics.service';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqSupplyPackageRow } from '../data/hq-db.types';
import { newClientId } from '../data/hq-supplies-sync';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { HqInventoryService } from '../data/hq-inventory.service';
import { WishlistStore } from '../data/wishlist.store';
import { AddedLine, HqSuppliesService, SupplyItem } from '../hq-supplies.service';
import { NachschubNamingService } from './nachschub-naming';
import { PathGroupSurface, trackPathGroupAssign, trackPathGroupRelease } from './path-group-analytics';
import { stockQtyOf } from './nachschub-stock';
import {
  Allocation,
  AssignedLine,
  EvalLine,
  Evaluation,
  NACHSCHUB_NAME_MAX,
  Nachschub,
  OpenLine,
  RisePool,
  WISH_QTY_MAX,
  WishPick,
  WishPosition,
  allocate,
  archive,
  clampName,
  clearNachschub,
  dissolvedBy,
  evaluateNachschub,
  freeSlot,
  NACHSCHUB_MAX_SLOTS,
  newNachschubBlock,
  planRemoval,
  positionKey,
  reactivate,
  sharesByPackage,
  takeFromLines,
  takeFromWishlist,
  withSplit,
  type NachschubLineInput,
  type RemovalHolder,
  type RemovalPlan,
  type NachschubType,
  parseSellGoal,
} from './nachschub.model';
import { archiveAtEventEnd, clearEventNachschub, isEventNachschub, rewardWishes, wishlistAfterClaim } from '../events/event-nachschub';
import type { EventReward } from '../events/event-sheet';
import type { ResolvedEnd } from '../events/event-logic';

/** Outcome of a Nachschub write. `key` is an i18n key (`hq.nachschub.done.*` on success, `errors.*` / `hq.nachschub.*` on failure). */
export interface NachschubResult {
  readonly ok: boolean;
  readonly key: string;
  readonly id?: string;
  readonly params?: Record<string, string | number>;
  /** A success that comes with a caveat the reader must see (a wish capped at 999, lines that did not fit). */
  readonly warn?: { readonly key: string; readonly params?: Record<string, string | number> };
  /** Present where the checklist asks for an undo. Resolves to the result of the undo. */
  readonly undo?: () => Promise<NachschubResult>;
}

/** Binds a new Nachschub to an event (type event with rewards, sightseeing without). */
export interface EventBinding {
  readonly type: Exclude<NachschubType, 'normal'>;
  readonly eventId: string;
  readonly name: string;
  readonly rewards: readonly { name: string; className: string; ship: boolean }[];
}

const fail = (key: string): NachschubResult => ({ ok: false, key });
const UNDONE: NachschubResult = { ok: true, key: 'hq.nachschub.done.undone' };

/** What a package write came to: `conflict` = unique violation (the slot was taken elsewhere), `gone` = the row is deleted. */
type Outcome = 'ok' | 'conflict' | 'gone' | 'failed';

/** One wishlist change that really happened (`delta` is what the position's quantity moved by). */
interface Shift {
  readonly p: WishPosition;
  readonly delta: number;
}

interface ShiftResult {
  readonly ok: boolean;
  /** Wished quantity that did not fit under the 999 cap (merging back to the wishlist). */
  readonly lost: number;
  /** The changes made - the exact inverse of these is the undo. */
  readonly applied: readonly Shift[];
}

/** A wishlist position that became (or grew) a line. */
interface AddedPick {
  readonly p: WishPosition;
  readonly line: AddedLine;
}

const asPicks = (lines: readonly AddedLine[]): Pick<AddedPick, 'line'>[] => lines.map((line) => ({ line }));
const capWarn = (lost: number): NachschubResult['warn'] => (lost > 0 ? { key: 'hq.nachschub.wishCapped', params: { count: lost } } : undefined);
const NO_SHIFT: ShiftResult = { ok: true, lost: 0, applied: [] };
const inverse = (applied: readonly Shift[]): Shift[] => [...applied].reverse().map((a) => ({ p: a.p, delta: -a.delta }));

/**
 * The Nachschub slots (`hq_supply_packages`) and every transition between wishlist, Nachschub and stock
 * (concept 20261107-1410-nachschub-hq). Rules live in `nachschub.model.ts`; this service reads the stores, calls them
 * and persists the outcome. Owner-only RLS, up to 7 active slots (a partial unique index backs that up server-side).
 *
 *   ensureLoaded()                          load the user's Nachschuebe once; reload() refreshes them
 *   createFromWishlist({ picks, name? })    assign FREE wish pieces (all by default, split allowed) to a new Nachschub
 *   rename(id, name) / reactivate(id)
 *   empty(id, backToWishlist) / remove(id, backToWishlist)   a wish line's wish stays (free again) or goes with it;
 *                                           other open lines are counted up on the wishlist or dropped
 *   allocationOf / assignTargets / assignWish / planWishRemoval / applyWishRemoval / releaseInfo / release
 *                                           wishes assigned to a Nachschub ("Operation", concept 20261117-1110-pfad-stationen)
 *   reconcile()                             close lines whose stock rose vs the snapshot, archive finished Nachschuebe
 *   evaluation(id)                          status per line / progress of one Nachschub
 *
 * Rules every write follows (audit bundle B2):
 *  - Wishlist changes are DELTAS (take out what moved, add back what returned), never "restore the old full list", so
 *    an undo only reverts its own change and a wish added meanwhile survives. A failed wishlist write rolls the rest back.
 *  - A package write sends only the columns that changed and never revives a deleted row; a stale tab learns about it
 *    ('gone') instead of resurrecting the row. A slot taken elsewhere (unique violation) is retried with the next free one.
 *  - A baseline is never taken from stock that has not loaded; reconcile waits for it.
 */
@Injectable({ providedIn: 'root' })
export class NachschubService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly supplies = inject(HqSuppliesService);
  private readonly wish = inject(WishlistStore);
  private readonly inventory = inject(HqInventoryService);
  private readonly hangar = inject(HangarService);
  private readonly naming = inject(NachschubNamingService);
  private readonly einsatzSvc = inject(HqEinsatzService);
  private readonly injector = inject(Injector);

  constructor() {
    // Tell the Einsatz service which Nachschübe exist (only once the list is loaded), so an Einsatz of a deleted one
    // is gone for every consumer (Start tile, live ticks, counts). Rows are only hidden, never deleted from here: an
    // empty read (e.g. an expired session answered as anon) must never cost the reader data.
    effect(() => {
      const ids = this.loaded() ? new Set(this.packages().map((p) => p.id)) : null;
      untracked(() => this.einsatzSvc.setKnownPackages(ids));
    });
  }

  private readonly searchWish = inject(SearchWishlistService);

  readonly packages = signal<readonly Nachschub[]>([]);
  readonly loaded = signal(false);
  /** i18n key of the last failed load, never raw text. */
  readonly error = signal<string | null>(null);

  readonly active = computed(() =>
    this.packages().filter((n) => n.status === 'active').sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99)),
  );
  readonly archived = computed(() =>
    this.packages().filter((n) => n.status === 'archived').sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')),
  );
  /** i18n key explaining why "Neuer Nachschub" is blocked, else null. */
  readonly newBlock = computed(() => newNachschubBlock(this.packages()));

  /** Status of every active Nachschub, evaluated oldest first with ONE shared rise pool (a stock gain closes one line per class). */
  private readonly evals = computed(() => {
    const out = new Map<string, Evaluation>();
    const pool: RisePool = new Map();
    const oldestFirst = [...this.active()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const n of oldestFirst) out.set(n.id, evaluateNachschub(this.linesOf(n.id).map(toEvalLine), n.snapshot, (l) => this.ownedOf(l), pool));
    return out;
  });

  private loadedFor: string | null = null;
  private inFlight: Promise<void> | null = null;
  private stockOk = false;
  private stockLoad: Promise<boolean> | null = null;
  private reconciling = false;
  private reconcileAgain = false;

  ensureLoaded(): Promise<void> {
    const uid = this.auth.user()?.id ?? null;
    if (!uid) {
      this.packages.set([]);
      this.loadedFor = null;
      this.loaded.set(false);
      return Promise.resolve();
    }
    if (this.loadedFor === uid) return this.inFlight ?? Promise.resolve();
    this.loadedFor = uid;
    this.inFlight = (async () => {
      try {
        if (!(await this.fetchPackages(uid, true)) && this.loadedFor === uid) this.loadedFor = null;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  /** Pull the user's Nachschuebe again (another tab or device may have changed them). False when it failed; the list stays as it was. */
  reload(): Promise<boolean> {
    const uid = this.auth.user()?.id ?? null;
    return uid ? this.fetchPackages(uid, false) : Promise.resolve(false);
  }

  private async fetchPackages(uid: string, reportError: boolean): Promise<boolean> {
    try {
      const { data, error } = await this.sb.client
        .from('hq_supply_packages' as never)
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (this.auth.user()?.id !== uid) return false;
      if (error) throw error;
      this.packages.set(((data ?? []) as unknown as HqSupplyPackageRow[]).map(fromRow));
      this.loaded.set(true);
      this.error.set(null);
      return true;
    } catch (err) {
      logWarn('nachschub', 'load failed', err);
      if (reportError) this.error.set(toErrorKey('nachschub', 'load', err));
      return false;
    }
  }

  /**
   * Inventar and Hangar loaded without an error. A baseline taken from stock that is not there yet would be 0 and
   * the line would close the moment the stock arrives, so every baseline (and reconcile) waits for this.
   */
  ensureStock(): Promise<boolean> {
    if (this.stockOk) return Promise.resolve(true);
    this.stockLoad ??= (async () => {
      try {
        await Promise.all([this.inventory.load(), this.hangar.loadAll()]);
        this.stockOk = this.inventory.loaded() && !this.inventory.error() && !this.hangar.error();
        return this.stockOk;
      } catch (err) {
        logWarn('nachschub', 'stock load failed', err);
        return false;
      } finally {
        this.stockLoad = null;
      }
    })();
    return this.stockLoad;
  }

  // ------------------------------------------------------------------------------------------------ reading

  /** Everything on the wishlist as model positions: store rows plus the Hangar's wished ships. */
  wishPositions(): readonly WishPosition[] {
    const rows: WishPosition[] = this.wish.rows().map((r) => ({
      kind: r.kind,
      className: r.className,
      name: r.name,
      qty: r.qty,
      forClassName: r.forClassName || null,
    }));
    for (const s of this.hangar.ships()) {
      if (s.status === 'wishlist') rows.push({ kind: 'ship', className: s.shipClassName, name: s.customName, qty: s.qty ?? 1 });
    }
    return rows;
  }

  linesOf(id: string): SupplyItem[] {
    return this.supplies.linesOfPackage(id);
  }

  /** Status per line, baselines and progress of one Nachschub against the current stock. */
  evaluation(id: string): Evaluation | null {
    const shared = this.evals().get(id);
    if (shared) return shared;
    const n = this.packages().find((p) => p.id === id);
    return n ? evaluateNachschub(this.linesOf(id).map(toEvalLine), n.snapshot, (l) => this.ownedOf(l)) : null;
  }

  /** Inventar quantity of a class over all places (see {@link stockQtyOf}), or Hangar copies for a ship line. */
  ownedOf(l: Pick<EvalLine, 'ship' | 'className'>): number {
    const cls = (l.className ?? '').toLowerCase();
    if (!cls) return 0;
    if (l.ship) {
      const s = this.hangar.ships().find((x) => x.shipClassName.toLowerCase() === cls);
      return s && s.status === 'owned' ? (s.qty ?? 1) : 0;
    }
    return stockQtyOf(this.inventory.items(), cls);
  }

  // ------------------------------------------------------------------------------------------------ writing

  /**
   * "Neuer Nachschub": assign wishlist positions to a fresh Nachschub in the lowest free slot. A pick without `qty`
   * takes every FREE piece; a smaller `qty` splits. The wish keeps its quantity (A1): the 'wish' line is the
   * assignment. With no line at all nothing is saved. Undo removes the Nachschub and its lines.
   */
  async createFromWishlist(opts: { picks: readonly WishPick[]; name?: string; event?: EventBinding }): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    if (!uid) return fail('errors.generic');
    await this.ensureLoaded();
    await this.reload(); // another tab may have taken a slot or freed one
    const slot = freeSlot(this.packages());
    if (slot === null) return fail('hq.nachschub.slotsFull');
    // A1: only FREE pieces can be assigned; the wish keeps its quantity, the line is the assignment. An event
    // Nachschub keeps the old rule (M3): its picks leave the wishlist and its lines are no assignments.
    const moveOff = !!opts.event;
    const { taken } = takeFromWishlist(this.freeWishPositions(), opts.picks);
    if (!taken.length && !opts.event) return fail('hq.nachschub.nothingPicked');
    const stock = await this.ensureStock();

    const id = newClientId();
    const label = (p: WishPosition): string => p.name?.trim() || humanizeClassName(p.className);
    const name = clampName(opts.name?.trim() || (await this.naming.nachschubName(taken.map((p) => ({ name: label(p), qty: p.qty })), opts.event?.name)), NACHSCHUB_NAME_MAX);

    const lines: AddedPick[] = [];
    const snapshot: Record<string, number> = {};
    let skipped = 0;
    for (const p of taken) {
      const added = this.addPick(p, id, label(p), moveOff ? 'search' : 'wish');
      if (!added) {
        skipped++;
        continue;
      }
      lines.push(added);
      // No baseline from unloaded stock: a line without one is filled by the first reconcile after the stock loaded.
      if (stock) snapshot[added.line.id] = this.ownedOf({ ship: p.kind === 'ship', className: p.className });
    }
    // Rewards of the chosen event are lines of their own (they close when the claimed reward lands in Bestand).
    const rewardLines = this.addRewardLines(opts.event?.rewards ?? [], id, snapshot, stock);
    // Nothing fit (the line list is full): no empty Nachschub that would hold a slot for ever. An event Nachschub
    // may have no line at all (sightseeing, or only rewards).
    if (taken.length && !lines.length && !rewardLines.length) return fail('hq.nachschub.linesFull');
    const lineIds = [...lines.map((x) => x.line.id), ...rewardLines.map((l) => l.id)];

    const now = new Date().toISOString();
    const saved = await this.insertNew(
      { id, name, status: 'active', slot, snapshot, createdAt: now, archivedAt: null, ...(opts.event ? { type: opts.event.type, eventId: opts.event.eventId } : {}) },
      uid,
    );
    if (!saved) {
      this.undoPicks([...lines, ...asPicks(rewardLines)]);
      return fail(this.error() ?? 'errors.generic');
    }
    const took = moveOff ? await this.shiftWishes(lines.map((x) => ({ p: x.p, delta: -x.p.qty }))) : NO_SHIFT;
    if (!took.ok) {
      this.undoPicks([...lines, ...asPicks(rewardLines)]);
      await this.drop(id, uid);
      return fail('hq.nachschub.wishlistFailed');
    }
    return {
      ok: true,
      key: 'hq.nachschub.done.created',
      id,
      params: { name },
      warn: skipped > 0 ? { key: 'hq.nachschub.partial', params: { count: skipped } } : undefined,
      undo: async () => {
        if (!(await this.drop(id, uid))) return fail(this.error() ?? 'errors.generic');
        this.supplies.removeMany(lineIds);
        const back = await this.shiftWishes(inverse(took.applied));
        return back.ok ? { ...UNDONE, warn: capWarn(back.lost) } : fail('hq.nachschub.wishlistFailed');
      },
    };
  }

  /**
   * "Bearbeiten" > add: take more wishlist positions into an existing active Nachschub (same rules as
   * {@link createFromWishlist}). A pick that lands on a line already there raises it and keeps its baseline; undo
   * lowers it back to its previous quantity and only removes lines this call created.
   */
  async addFromWishlist(id: string, picks: readonly WishPick[], eventRewards: EventBinding['rewards'] = []): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    const n = this.packages().find((p) => p.id === id && p.status === 'active');
    if (!uid || !n) return fail('errors.generic');
    // M3: into an event / sightseeing Nachschub (or one bound to an event in this edit) picks leave the wishlist as before.
    const moveOff = (n.type ?? 'normal') !== 'normal' || eventRewards.length > 0;
    const { taken } = takeFromWishlist(this.freeWishPositions(), picks);
    if (!taken.length && !eventRewards.length) return fail('hq.nachschub.nothingPicked');
    const stock = await this.ensureStock();
    const label = (p: WishPosition): string => p.name?.trim() || humanizeClassName(p.className);
    const lines: AddedPick[] = [];
    const snapshot: Record<string, number> = { ...n.snapshot };
    let skipped = 0;
    let newBaselines = false;
    for (const p of taken) {
      const added = this.addPick(p, id, label(p), moveOff ? 'search' : 'wish');
      if (!added) {
        skipped++;
        continue;
      }
      lines.push(added);
      // Only a NEW line gets a baseline; a line that was already there keeps its own (its progress stays).
      if (added.line.prevQty === 0 && stock) {
        snapshot[added.line.id] = this.ownedOf({ ship: p.kind === 'ship', className: p.className });
        newBaselines = true;
      }
    }
    // Rewards of an event added while editing become reward lines too, exactly like on creation.
    const rewardLines = this.addRewardLines(eventRewards, id, snapshot, stock);
    if (rewardLines.length && stock) newBaselines = true;
    const all = [...lines, ...asPicks(rewardLines)];
    if (taken.length && !lines.length && !rewardLines.length) return fail('hq.nachschub.linesFull');
    const took = moveOff ? await this.shiftWishes(lines.map((x) => ({ p: x.p, delta: -x.p.qty }))) : NO_SHIFT;
    if (!took.ok) {
      this.undoPicks(all);
      return fail('hq.nachschub.wishlistFailed');
    }
    if (newBaselines) {
      if ((await this.patch(id, uid, { snapshot })) !== 'ok') {
        this.undoPicks(all);
        await this.shiftWishes(inverse(took.applied));
        return fail(this.error() ?? 'errors.generic');
      }
      this.packages.update((ps) => ps.map((p) => (p.id === id ? { ...p, snapshot } : p)));
    }
    return {
      ok: true,
      key: 'hq.nachschub.done.added',
      id,
      warn: skipped > 0 ? { key: 'hq.nachschub.partial', params: { count: skipped } } : undefined,
      undo: async () => {
        const back = await this.shiftWishes(inverse(took.applied));
        if (!back.ok) return fail('hq.nachschub.wishlistFailed');
        this.undoPicks(all);
        return { ...UNDONE, warn: capWarn(back.lost) };
      },
    };
  }

  // ------------------------------------------------------------------------------------------ from the Bestand (D4-D6)

  /**
   * "Abholen planen" / "Verkaufen" in the Bestand: puts `lines` into the existing active Nachschub `target` (as often
   * as you like - each call adds more, a line already there for the same item grows and its pick-up places merge), or
   * into a NEW normal Nachschub with `'new'`. A line with `stops` is a gather line (route ordered by amount, tickable
   * per stop). No cross-Nachschub merging: the lines stay in the one Nachschub you named. Undo takes back exactly what
   * this call added.
   */
  async addToNachschub(target: string | 'new', lines: readonly NachschubLineInput[], opts: { name?: string } = {}): Promise<NachschubResult> {
    if (target === 'new') return this.createWithLines(lines, { name: opts.name });
    const n = this.packages().find((p) => p.id === target && p.status === 'active');
    if (!n) return fail('errors.generic');
    return this.putLines(n.id, lines, 'hq.nachschub.done.added');
  }

  /**
   * "Geld verdienen": a new Nachschub of type `verkauf` with an aUEC goal and `lines` from the Bestand (the items to
   * sell, each with the places they lie at). Progress comes from sales the app reports ({@link reportSale}) or is set
   * by hand ({@link setSellProgress}). `goalAuec` must be a whole aUEC amount of at least 1.
   */
  async createSellNachschub(goalAuec: number, lines: readonly NachschubLineInput[], opts: { name?: string } = {}): Promise<NachschubResult> {
    const goal = parseSellGoal(goalAuec);
    if (goal === null) return fail('hq.nachschub.sellGoalInvalid');
    return this.createWithLines(lines, { name: opts.name, sell: goal });
  }

  /** Sets the earned aUEC of a Verkauf Nachschub by hand (never below 0). */
  async setSellProgress(id: string, earnedAuec: number): Promise<boolean> {
    const uid = this.auth.user()?.id;
    const n = this.packages().find((p) => p.id === id && p.type === 'verkauf');
    if (!uid || !n || !Number.isFinite(earnedAuec) || earnedAuec < 0) return false;
    const earned = Math.round(earnedAuec);
    if ((await this.patch(id, uid, { progress_auec: earned })) !== 'ok') return false;
    this.packages.update((ps) => ps.map((p) => (p.id === id ? { ...p, progressAuec: earned } : p)));
    return true;
  }

  /**
   * A sale the app reported: adds `auec` to the Verkauf Nachschub atomically (`hq_nachschub_report_sale`); `ref` (the
   * sale's log event id) makes a re-sent report a no-op. Returns the new progress, null when nothing matched.
   */
  async reportSale(id: string, auec: number, ref: string | null = null): Promise<number | null> {
    try {
      const { data, error } = await this.sb.client.rpc('hq_nachschub_report_sale' as never, { p_package_id: id, p_auec: auec, p_ref: ref } as never);
      if (error) throw error;
      const next = data === null || data === undefined ? null : Number(data);
      if (next === null || !Number.isFinite(next)) return null;
      this.packages.update((ps) => ps.map((p) => (p.id === id ? { ...p, progressAuec: next } : p)));
      return next;
    } catch (err) {
      logWarn('nachschub', 'report sale failed', err);
      return null;
    }
  }

  private async createWithLines(lines: readonly NachschubLineInput[], opts: { name?: string; sell?: number }): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    if (!uid) return fail('errors.generic');
    if (!lines.length) return fail('hq.nachschub.nothingPicked');
    await this.ensureLoaded();
    await this.reload();
    const slot = freeSlot(this.packages());
    if (slot === null) return fail('hq.nachschub.slotsFull');
    const id = newClientId();
    const items = lines.map((l) => ({ name: l.name, qty: Math.max(1, Math.round(l.amount)) }));
    const name = clampName(opts.name?.trim() || (await this.naming.nachschubName(items)) || '', NACHSCHUB_NAME_MAX);
    const now = new Date().toISOString();
    const base: Nachschub = { id, name, status: 'active', slot, snapshot: {}, createdAt: now, archivedAt: null };
    const saved = await this.insertNew(opts.sell ? { ...base, type: 'verkauf', goalAuec: opts.sell, progressAuec: 0 } : base, uid);
    if (!saved) return fail(this.error() ?? 'errors.generic');
    const put = await this.putLines(id, lines, 'hq.nachschub.done.created', { name });
    if (!put.ok) {
      await this.drop(id, uid);
      return put;
    }
    const undoLines = put.undo;
    return {
      ...put,
      undo: async () => {
        if (!(await this.drop(id, uid))) return fail(this.error() ?? 'errors.generic');
        await undoLines?.();
        return UNDONE;
      },
    };
  }

  /** Adds the lines to Nachschub `id` with baselines; undo restores quantities / gather and removes the lines it created. */
  private async putLines(id: string, lines: readonly NachschubLineInput[], key: string, params?: Record<string, string | number>): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    const n = this.packages().find((p) => p.id === id);
    if (!uid || !n) return fail('errors.generic');
    const stock = await this.ensureStock();
    const before = new Map(this.supplies.linesOfPackage(id).map((l) => [l.id, l]));
    const snapshot: Record<string, number> = { ...n.snapshot };
    const added: AddedLine[] = [];
    let skipped = 0;
    for (const l of lines) {
      const stops = l.stops?.length ? l.stops : undefined;
      const scu = l.unit === 'scu';
      const line = this.supplies.addLine(l.name, scu ? 1 : Math.max(1, Math.round(l.amount)), {
        entityKind: 'item',
        className: l.className,
        packageId: id,
        source: 'search',
        ...(scu ? { amount: l.amount, unit: 'scu' as const } : {}),
        ...(stops ? { gather: stops, stepKind: 'pickup' as const } : {}),
        ...(l.minQuality ? { minQuality: l.minQuality } : {}),
      });
      if (!line) {
        skipped++;
        continue;
      }
      added.push(line);
      if (line.prevQty === 0 && stock) snapshot[line.id] = this.ownedOf({ ship: false, className: l.className ?? '' });
    }
    if (!added.length) return fail('hq.nachschub.linesFull');
    if (JSON.stringify(snapshot) !== JSON.stringify(n.snapshot)) {
      if ((await this.patch(id, uid, { snapshot })) !== 'ok') {
        this.revertLines(added, before);
        return fail(this.error() ?? 'errors.generic');
      }
      this.packages.update((ps) => ps.map((p) => (p.id === id ? { ...p, snapshot } : p)));
    }
    return {
      ok: true,
      key,
      id,
      params,
      warn: skipped > 0 ? { key: 'hq.nachschub.partial', params: { count: skipped } } : undefined,
      undo: async () => {
        this.revertLines(added, before);
        return UNDONE;
      },
    };
  }

  private revertLines(added: readonly AddedLine[], before: ReadonlyMap<string, SupplyItem>): void {
    const fresh = added.filter((a) => a.prevQty === 0).map((a) => a.id);
    if (fresh.length) this.supplies.removeMany(fresh);
    for (const a of added) {
      if (a.prevQty === 0) continue;
      this.supplies.setLine(a.id, a.prevQty, a.prevAmount);
      const g = before.get(a.id)?.gather;
      if (g) this.supplies.setGather(a.id, g);
    }
  }

  /** Reward lines of chosen events: one line per reward; they close when the claimed reward lands in Bestand. */
  private addRewardLines(rewards: EventBinding['rewards'], packageId: string, snapshot: Record<string, number>, stock: boolean): AddedLine[] {
    const out: AddedLine[] = [];
    for (const r of rewards) {
      const added = this.supplies.addLine(r.name, 1, { entityKind: r.ship ? 'ship' : 'item', className: r.className, packageId, source: 'search' });
      if (!added) continue;
      out.push(added);
      // Same rule as a wish line: no baseline from unloaded stock, the first reconcile after the load sets it.
      if (stock) snapshot[added.id] = this.ownedOf({ ship: r.ship, className: r.className });
    }
    return out;
  }

  /**
   * "Bearbeiten" > remove one line. A wish line (A9) is released: its wish stays and is free again, or - without
   * `backToWishlist` - is lowered by the line's pieces too. Any other line goes back to the wishlist (counted up there)
   * or is dropped, as before. Never dissolves the Nachschub (the edit flow is still open on it).
   */
  async removeLine(lineId: string, backToWishlist: boolean): Promise<NachschubResult> {
    const l = this.supplies.items().find((x) => x.id === lineId);
    if (!l) return fail('errors.generic');
    if (isWishLine(l)) {
      const r = await this.releaseLine(lineId, { alsoRemoveWish: !backToWishlist }, false);
      return r.ok ? { ...r, key: 'hq.nachschub.done.lineRemoved' } : r;
    }
    const owner = this.packages().find((p) => p.id === l.packageId);
    // A line of an event Nachschub never goes back to the wishlist.
    const toWishlist = backToWishlist && !(owner && isEventNachschub(owner));
    const goes =
      toWishlist && !l.done && l.className
        ? [{ kind: l.entityKind ?? 'item', className: l.className, name: l.name, qty: l.qty, forClassName: l.forClassName }]
        : [];
    const put = await this.shiftWishes(goes.map((p) => ({ p, delta: +p.qty })));
    if (!put.ok) return fail('hq.nachschub.wishlistFailed');
    this.supplies.removeMany([l.id]);
    return {
      ok: true,
      key: 'hq.nachschub.done.lineRemoved',
      warn: capWarn(put.lost),
      undo: async () => {
        const back = await this.shiftWishes(inverse(put.applied));
        if (!back.ok) return fail('hq.nachschub.wishlistFailed');
        this.supplies.restore(l.id);
        return UNDONE;
      },
    };
  }

  async rename(id: string, name: string): Promise<boolean> {
    const uid = this.auth.user()?.id;
    const n = this.packages().find((p) => p.id === id);
    const clean = clampName(name, NACHSCHUB_NAME_MAX);
    if (!uid || !n || !clean) return false;
    if ((await this.patch(id, uid, { name: clean })) !== 'ok') return false;
    this.packages.update((ps) => ps.map((p) => (p.id === id ? { ...p, name: clean } : p)));
    return true;
  }

  /** Bring an archived Nachschub back when a slot is free (the slots are read fresh; a slot taken meanwhile is retried). */
  async reactivate(id: string): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    if (!uid) return fail('errors.generic');
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.reload();
      const back = reactivate(this.packages(), id);
      if (!back) return fail(this.packages().some((p) => p.id === id) ? 'hq.nachschub.slotsFull' : 'hq.nachschub.gone');
      const out = await this.patch(id, uid, { status: 'active', slot: back.slot, archived_at: null });
      if (out === 'ok') {
        this.packages.update((ps) => ps.map((p) => (p.id === id ? back : p)));
        return { ok: true, key: 'hq.nachschub.done.reactivated', id };
      }
      if (out !== 'conflict') return fail(this.error() ?? 'errors.generic');
    }
    return fail('hq.nachschub.slotsFull');
  }

  /** "Nachschub leeren": open lines leave (back to the wishlist when asked), closed ones stay as history. */
  async empty(id: string, backToWishlist: boolean): Promise<NachschubResult> {
    const plan = this.planClear(id, backToWishlist);
    if (!plan) return fail('errors.generic');
    const put = await this.shiftWishes(plan.shifts);
    if (!put.ok) return fail('hq.nachschub.wishlistFailed');
    this.supplies.removeMany(plan.removeIds);
    return {
      ok: true,
      key: 'hq.nachschub.done.emptied',
      id,
      warn: capWarn(put.lost),
      undo: async () => {
        const back = await this.shiftWishes(inverse(put.applied));
        if (!back.ok) return fail('hq.nachschub.wishlistFailed');
        for (const l of plan.removeIds) this.supplies.restore(l);
        return UNDONE;
      },
    };
  }

  /**
   * Delete a Nachschub with its open lines; with `backToWishlist` they are counted up on the wishlist first. The
   * wishlist is written first and rolled back when the delete fails, so no empty Nachschub is left behind.
   */
  async remove(id: string, backToWishlist: boolean): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    const plan = this.planClear(id, backToWishlist);
    if (!uid || !plan) return fail('errors.generic');
    const n = plan.n;
    const put = await this.shiftWishes(plan.shifts);
    if (!put.ok) return fail('hq.nachschub.wishlistFailed');
    if (!(await this.drop(id, uid))) {
      await this.shiftWishes(inverse(put.applied));
      return fail(this.error() ?? 'errors.generic');
    }
    // The closed lines of a deleted Nachschub go too (they belong to it).
    const all = this.linesOf(id).map((l) => l.id);
    this.supplies.removeMany(all);
    return {
      ok: true,
      key: 'hq.nachschub.done.removed',
      id,
      warn: capWarn(put.lost),
      undo: async () => {
        // The slot may have been taken meanwhile: the Nachschub comes back in the next free one, or not at all.
        const back = await this.restorePackage(n, uid);
        if (!back) return fail(this.error() ?? 'errors.generic');
        const out = await this.shiftWishes(inverse(put.applied));
        if (!out.ok) {
          await this.drop(id, uid);
          return fail('hq.nachschub.wishlistFailed');
        }
        for (const l of all) this.supplies.restore(l);
        return UNDONE;
      },
    };
  }

  /** Persist a changed Nachschub (the event services use this). */
  async update(next: Nachschub): Promise<boolean> {
    const uid = this.auth.user()?.id;
    if (!uid) return false;
    const out = await this.patch(next.id, uid, {
      name: next.name,
      status: next.status,
      slot: next.slot,
      snapshot: next.snapshot,
      archived_at: next.archivedAt,
      type: next.type ?? 'normal',
      event_id: next.eventId ?? null,
    });
    if (out !== 'ok') return false;
    this.packages.update((ps) => ps.map((p) => (p.id === next.id ? next : p)));
    return true;
  }

  /** An event Nachschub archives itself at its OFFICIAL end (C12); an estimate never does. */
  async applyEventEnds(ends: ReadonlyMap<string, ResolvedEnd>, nowMs: number, idsOf?: (n: Nachschub) => readonly string[]): Promise<void> {
    const at = new Date(nowMs).toISOString();
    const next = archiveAtEventEnd(this.packages(), ends, nowMs, at, idsOf);
    for (const n of next) {
      const before = this.packages().find((p) => p.id === n.id);
      if (before && before !== n) await this.update(n);
    }
  }

  /**
   * One pass over all active Nachschuebe: lines whose stock rose past the snapshot are ticked, baselines are stored
   * (and lowered when the stock fell below them), a Nachschub with every line closed archives itself and frees its slot.
   * Call after inventory / hangar changes. Waits for the stock to be loaded: a missing baseline (a migrated line) is
   * filled from the stock as it is at the FIRST pass after load - never from an unloaded stock, and not from the
   * purchase that happens to trigger a later pass, because the first pass runs when the stock loads.
   */
  async reconcile(): Promise<void> {
    const uid = this.auth.user()?.id;
    if (!uid || !this.loaded()) return;
    if (this.reconciling) {
      this.reconcileAgain = true;
      return;
    }
    this.reconciling = true;
    try {
      do {
        this.reconcileAgain = false;
        if (!(await this.ensureStock())) return;
        await this.reconcileLegacyWishLines();
        await this.reconcileOnce(uid);
        await this.fulfilWishLines();
        await this.trimOverAssigned(true);
      } while (this.reconcileAgain);
    } finally {
      this.reconciling = false;
    }
  }

  private async reconcileOnce(uid: string): Promise<void> {
    const evals = this.evals();
    for (const n of this.active()) {
      const ev = evals.get(n.id);
      if (!ev) continue;
      for (const lid of ev.closeIds) this.supplies.setDone(lid, true);
      let next: Nachschub = ev.snapshotChanged ? { ...n, snapshot: ev.snapshot } : n;
      if (ev.finished) next = archive(next, new Date().toISOString());
      if (next === n) continue;
      const cols: Record<string, unknown> = {};
      if (next.snapshot !== n.snapshot) cols['snapshot'] = next.snapshot;
      if (next.status !== n.status) Object.assign(cols, { status: next.status, slot: next.slot, archived_at: next.archivedAt });
      if ((await this.patch(n.id, uid, cols)) === 'ok') this.packages.update((ps) => ps.map((p) => (p.id === n.id ? next : p)));
    }
  }

  /**
   * An event reward landed: only a wish that IS this reward (exact class) shrinks, never the base item (C11).
   * Returns 1 when a wish was touched, 0 when nothing was wished.
   */
  async fulfilEventReward(reward: Pick<EventReward, 'className'>, gained: number): Promise<number> {
    const before = this.wishPositions();
    const wished = rewardWishes(before, reward);
    if (!wished.length) return 0;
    const after = wishlistAfterClaim(before, reward, gained);
    const shifts = wished.map((p) => ({ p, delta: (after.find((a) => positionKey(a) === positionKey(p))?.qty ?? 0) - p.qty }));
    await this.shiftWishes(shifts);
    return 1;
  }

  // ------------------------------------------------------------------- wishes assigned to an Operation (A1-A11)

  /**
   * Wish lines of every active NORMAL Nachschub (event / sightseeing / verkauf lines are never assignments, M3) with
   * their full quantity: a line counts as assigned until it is met; then {@link fulfilWishLines} lowers the wish by
   * the whole line once and the line leaves this list (source 'wish_met'). `assignedAt` is the line's creation time
   * (stable, M4).
   */
  readonly assignedLines = computed<readonly AssignedLine[]>(() => {
    const out: AssignedLine[] = [];
    for (const n of this.active()) {
      if ((n.type ?? 'normal') !== 'normal') continue;
      for (const l of this.linesOf(n.id)) {
        if (!isWishLine(l) || l.qty <= 0) continue;
        out.push({ lineId: l.id, packageId: n.id, key: lineKey(l), qty: l.qty, assignedAt: l.createdAt ?? l.updatedAt });
      }
    }
    return out;
  });

  /** Planned / done Einsätze of one Nachschub (done = status 'done'). */
  einsatzProgress(packageId: string): { done: number; total: number } {
    const es = this.einsatzSvc.ofPackage(packageId);
    return { done: es.filter((e) => e.status === 'done').length, total: es.length };
  }

  /**
   * Wished / assigned / free of one wish position and where its assigned pieces sit, most recently assigned first
   * (A2/A3: the wished quantity is the wishlist's, assigned pieces still count as wished). Reactive when read inside
   * a computed.
   */
  allocationOf(ref: WishRef): WishAllocation {
    const key = positionKey(ref);
    const lines = this.assignedLines().filter((l) => l.key === key);
    const alloc = allocate(this.wishQtyOf({ ...ref, name: null, qty: 0 }), lines);
    const assignments = sharesByPackage(lines).map((s): WishAssignment => {
      const n = this.packages().find((p) => p.id === s.packageId);
      const prog = this.einsatzProgress(s.packageId);
      return {
        packageId: s.packageId,
        packageName: n?.name ?? '',
        qty: s.qty,
        assignedAt: s.assignedAt,
        createdAt: n?.createdAt ?? '',
        einsaetzeDone: prog.done,
        einsaetzeTotal: prog.total,
        lineIds: s.lineIds,
      };
    });
    return { key, ...alloc, assignments };
  }

  /** The wishlist with only the FREE pieces of every position (what can still be assigned); fully assigned ones drop out. */
  freeWishPositions(): readonly WishPosition[] {
    const out: WishPosition[] = [];
    for (const w of this.wishPositions()) {
      const k = positionKey(w);
      const taken = this.assignedLines().reduce((n, l) => (l.key === k ? n + l.qty : n), 0);
      const free = Math.max(0, w.qty - taken);
      if (free > 0) out.push({ ...w, qty: free });
    }
    return out;
  }

  /**
   * The picker (B7): active NORMAL Nachschuebe newest first with their Einsatz progress, the slots in use and whether
   * a new one can be made (`blockKey` = the i18n reason when not).
   */
  readonly assignTargets = computed<AssignTargets>(() => {
    const active = this.active();
    const operations = active
      .filter((n) => (n.type ?? 'normal') === 'normal')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n): AssignTarget => {
        const prog = this.einsatzProgress(n.id);
        return { id: n.id, name: n.name, createdAt: n.createdAt, einsaetzeDone: prog.done, einsaetzeTotal: prog.total };
      });
    const blockKey = this.newBlock();
    return { operations, slotsUsed: active.length, slotsMax: NACHSCHUB_MAX_SLOTS, canCreate: blockKey === null, blockKey };
  });

  /** Name proposal for a new Nachschub made for `qty` pieces of one wish (the naming service, clamped to the limit). */
  async proposeName(label: string, qty: number): Promise<string> {
    return clampName((await this.naming.nachschubName([{ name: label, qty }])) || label, NACHSCHUB_NAME_MAX);
  }

  /**
   * Assign `qty` free pieces of a wish to the active Nachschub `target`, or to a new one (`'new'`, `name` optional:
   * the naming service proposes one). The wish keeps its quantity (A1); more than the free pieces are never assigned
   * (A3). Undo takes the assignment back (and a Nachschub this call created). With `surface` the success is tracked
   * as `hq:path_group_assign`.
   */
  async assignWish(ref: WishRef, qty: number, target: string | 'new', opts: { name?: string; surface?: PathGroupSurface } = {}): Promise<NachschubResult> {
    if (this.allocationOf(ref).free <= 0) return fail('hq.nachschub.nothingFree');
    const picks = [{ key: positionKey(ref), qty: Math.max(1, Math.round(qty)) }];
    const r = target === 'new' ? await this.createFromWishlist({ picks, name: opts.name }) : await this.addFromWishlist(target, picks);
    if (r.ok && opts.surface) trackPathGroupAssign(this.injector.get(AnalyticsService), opts.surface, target === 'new');
    return r;
  }

  /** What a removal of `removeQty` pieces of a wish would do (A4-A7), with the preset split. Changes nothing. */
  planWishRemoval(ref: WishRef, removeQty: number): RemovalPlan {
    return planRemoval(this.wishQtyOf({ ...ref, name: null, qty: 0 }), this.holdersOf(ref), removeQty);
  }

  /**
   * The plan with the user's own split over the Operationen (packageId -> pieces), for the removal dialog's per-Operation
   * steppers: the last-wish / dissolve flags follow the split. Null when the split does not add up. Changes nothing.
   */
  planWishRemovalWithSplit(ref: WishRef, removeQty: number, split: Readonly<Record<string, number>>): RemovalPlan | null {
    return withSplit(this.planWishRemoval(ref, removeQty), this.holdersOf(ref), split);
  }

  /**
   * Remove `removeQty` pieces of a wish: free pieces first (A4), the rest out of the Nachschuebe - the preset (most
   * recently assigned first) or the caller's `split` (packageId -> pieces, must add up). A Nachschub left without an
   * open line is dissolved when it has no Einsatz, or when its id is in `dissolve` (A7). One undo brings back the wish
   * quantity, the lines and every dissolved Nachschub with its name and slot (A10). Call it only after the UI asked
   * when the plan `needsConfirm` (A5) - the service does not ask.
   */
  async applyWishRemoval(
    ref: WishRef & { readonly name?: string | null },
    removeQty: number,
    opts: { split?: Readonly<Record<string, number>>; dissolve?: readonly string[]; surface?: PathGroupSurface } = {},
  ): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    if (!uid) return fail('errors.generic');
    const holders = this.holdersOf(ref);
    const planned = planRemoval(this.wishQtyOf({ ...ref, name: null, qty: 0 }), holders, removeQty);
    const plan = opts.split ? withSplit(planned, holders, opts.split) : planned;
    if (!plan) return fail('hq.nachschub.splitInvalid');
    if (plan.remove <= 0) return fail('hq.nachschub.nothingPicked');
    const label = ref.name?.trim() || humanizeClassName(ref.className);
    const p: WishPosition = { kind: ref.kind, className: ref.className, name: ref.name ?? null, qty: plan.remove, forClassName: ref.forClassName ?? null };
    const took = await this.shiftWishes([{ p, delta: -plan.remove }]);
    if (!took.ok) return fail('hq.nachschub.wishlistFailed');

    const dissolve = dissolvedBy(plan, opts.dissolve);
    const key = positionKey(ref);
    const changed: LineChange[] = [];
    const lowerPart = (part: { packageId: string; qty: number }): void => {
      const lines = this.openAssigned(key).filter((l) => l.packageId === part.packageId);
      changed.push(...this.lowerLines(lines.map((l) => ({ id: l.lineId, qty: l.qty })), part.qty));
    };
    for (const part of plan.parts) {
      if (part.qty > 0 && !dissolve.includes(part.packageId)) lowerPart(part);
    }
    const gone = await this.dissolveAll(dissolve, uid);
    // M1: a Nachschub that could not be dissolved keeps its lines - lower them, or assigned would exceed the wish.
    for (const part of plan.parts) {
      if (part.qty > 0 && gone.failedIds.includes(part.packageId)) lowerPart(part);
    }
    const pieces = plan.remove - plan.free;
    if (pieces > 0 && opts.surface) trackPathGroupRelease(this.injector.get(AnalyticsService), opts.surface, pieces, gone.done.length > 0);
    return {
      ok: true,
      key: 'hq.nachschub.done.wishRemoved',
      params: { name: label, count: plan.remove, dissolved: gone.done.length },
      warn: gone.failed ? { key: 'hq.nachschub.dissolveFailed' } : undefined,
      undo: async () => {
        if (!(await this.undoDissolve(gone.done, uid))) return fail(this.error() ?? 'errors.generic');
        this.revertLineChanges(changed);
        const back = await this.shiftWishes(inverse(took.applied));
        // The wish may have changed meanwhile: the restored lines never stay above it.
        await this.trimOverAssigned(false, key);
        return back.ok ? UNDONE : fail('hq.nachschub.wishlistFailed');
      },
    };
  }

  /**
   * Before "Lösen" in the HQ (C7): the open wish line's pieces, whether releasing it leaves its Nachschub without an
   * open line, its Einsätze, and whether it would be dissolved along by default (empty and no Einsatz). Null when
   * `lineId` is no open wish line of an active Nachschub.
   */
  releaseInfo(lineId: string): ReleaseInfo | null {
    const l = this.supplies.items().find((x) => x.id === lineId);
    const n = l?.packageId ? this.active().find((p) => p.id === l.packageId && (p.type ?? 'normal') === 'normal') : undefined;
    if (!l || !n || !isWishLine(l)) return null;
    const pieces = this.piecesLeft(l);
    if (pieces <= 0) return null;
    const others = this.linesOf(n.id).some((x) => x.id !== l.id && this.piecesLeft(x) > 0);
    const einsaetze = this.einsatzSvc.ofPackage(n.id).length;
    return { lineId, packageId: n.id, packageName: n.name, pieces, emptiesPackage: !others, einsaetze, dissolvesAlong: !others && einsaetze === 0 };
  }

  /**
   * "Lösen" in the HQ (A9): the wish line leaves its Nachschub; the wish stays on the wishlist and is free again, or
   * with `alsoRemoveWish` its pieces leave the wishlist too. A Nachschub left empty is dissolved when it has no
   * Einsatz, or with `dissolve` (A7). One undo restores everything (A10).
   */
  release(lineId: string, opts: { alsoRemoveWish?: boolean; dissolve?: boolean; surface?: PathGroupSurface } = {}): Promise<NachschubResult> {
    return this.releaseLine(lineId, opts, true);
  }

  private async releaseLine(lineId: string, opts: { alsoRemoveWish?: boolean; dissolve?: boolean; surface?: PathGroupSurface }, autoDissolve: boolean): Promise<NachschubResult> {
    const uid = this.auth.user()?.id;
    const info = this.releaseInfo(lineId);
    const l = this.supplies.items().find((x) => x.id === lineId);
    if (!uid || !info || !l) return fail('errors.generic');
    const p: WishPosition = { kind: l.entityKind ?? 'item', className: l.className ?? '', name: l.name, qty: info.pieces, forClassName: l.forClassName };
    const took = opts.alsoRemoveWish ? await this.shiftWishes([{ p, delta: -info.pieces }]) : { ok: true, lost: 0, applied: [] };
    if (!took.ok) return fail('hq.nachschub.wishlistFailed');
    const dissolve = info.emptiesPackage && ((autoDissolve && info.dissolvesAlong) || !!opts.dissolve) ? [info.packageId] : [];
    if (!dissolve.length) this.supplies.removeMany([lineId]);
    const gone = await this.dissolveAll(dissolve, uid);
    if (gone.failed) this.supplies.removeMany([lineId]);
    if (opts.surface) trackPathGroupRelease(this.injector.get(AnalyticsService), opts.surface, info.pieces, gone.done.length > 0);
    return {
      ok: true,
      key: 'hq.nachschub.done.released',
      params: { name: l.name, count: info.pieces, dissolved: gone.done.length },
      warn: gone.failed ? { key: 'hq.nachschub.dissolveFailed' } : undefined,
      undo: async () => {
        if (!(await this.undoDissolve(gone.done, uid))) return fail(this.error() ?? 'errors.generic');
        this.supplies.restore(lineId);
        const back = await this.shiftWishes(inverse(took.applied));
        await this.trimOverAssigned(false, lineKey(l));
        return back.ok ? UNDONE : fail('hq.nachschub.wishlistFailed');
      },
    };
  }

  private legacyReconciled = false;

  /**
   * A11, one time: wish lines made before wishes stayed wishes had their quantity moved OFF the wishlist. Only lines
   * that are CERTAINLY old wish lines are counted back (H3 - a phantom wish is worse than an old line left plain):
   * open `search` lines in active NORMAL Nachschuebe without stops, step, SCU amount or minimum quality, whose kind is
   * neither `item` nor `ship` or that carry a blueprint (`forClassName`). Bestand lines are always plain `item` lines
   * and reward lines `item` / `ship`, so a plain item or ship line stays as it is (it simply is no assignment).
   * Exactly once per line, also with two devices or a retry: per wish the lines are first relabelled ON THE SERVER
   * with a compare-and-set (`search` -> `wish`, {@link HqSuppliesService.casSource}); only the lines this call won
   * count, with ONE wishlist write; when that write fails the label goes back so a later pass retries. Pieces the
   * 999 cap cuts off are taken off the lines too (never assigned beyond the wish). Returns the lines relabelled.
   */
  async reconcileLegacyWishLines(): Promise<number> {
    if (this.legacyReconciled || !this.loaded() || !this.storesReady()) return 0;
    const groups = new Map<string, SupplyItem[]>();
    for (const n of this.active()) {
      if ((n.type ?? 'normal') !== 'normal') continue;
      for (const l of this.linesOf(n.id)) {
        if (!isLegacyWishLine(l)) continue;
        const k = lineKey(l);
        groups.set(k, [...(groups.get(k) ?? []), l]);
      }
    }
    let count = 0;
    for (const lines of groups.values()) {
      const won = await this.supplies.casSource(lines.map((l) => l.id), 'search', 'wish');
      if (won === null) return count; // offline / failed: nothing changed for this wish, the next pass retries
      if (!won.length) continue; // another device or an earlier pass got there first
      const mine = lines.filter((l) => won.includes(l.id)).sort((a, b) => (b.createdAt ?? b.updatedAt).localeCompare(a.createdAt ?? a.updatedAt));
      const l0 = mine[0];
      const p: WishPosition = { kind: l0.entityKind ?? 'item', className: l0.className ?? '', name: l0.name, qty: 0, forClassName: l0.forClassName };
      const qty = mine.reduce((n, l) => n + l.qty, 0);
      const have = this.wishQtyOf(p);
      const add = Math.min(qty, Math.max(0, WISH_QTY_MAX - have));
      if (add > 0 && !(await this.setWishQty(p, have + add))) {
        await this.supplies.casSource(won, 'wish', 'search');
        return count;
      }
      if (add < qty) this.lowerLines(mine.map((l) => ({ id: l.id, qty: l.qty })), qty - add);
      count += won.length;
    }
    this.legacyReconciled = true;
    return count;
  }

  /**
   * A8 / H2, every pass: a wish line that was reached (ticked by hand, by the stock rise or by a whole live purchase)
   * lowers its wish by the whole line, exactly once: the line is moved `wish` -> `wish_met` with a compare-and-set
   * on the server first, and only the lines this call won move the wish (ONE write per wish; the label goes back when
   * it fails). A `wish_met` line that is open again (undo, unticked) gives the pieces back the same way. The line
   * stays in its Operation, ticked as reached. Arrivals in between never touch the wish: the line answers them.
   */
  private async fulfilWishLines(): Promise<void> {
    if (!this.storesReady()) return;
    const met = new Map<string, SupplyItem[]>();
    const reopened = new Map<string, SupplyItem[]>();
    for (const n of this.packages()) {
      if ((n.type ?? 'normal') !== 'normal') continue;
      for (const l of this.linesOf(n.id)) {
        if (!l.className) continue;
        const into = l.source === 'wish' && l.done ? met : l.source === 'wish_met' && !l.done ? reopened : null;
        if (into) into.set(lineKey(l), [...(into.get(lineKey(l)) ?? []), l]);
      }
    }
    const move = async (groups: Map<string, SupplyItem[]>, from: 'wish' | 'wish_met', to: 'wish' | 'wish_met', sign: 1 | -1): Promise<void> => {
      for (const lines of groups.values()) {
        const won = await this.supplies.casSource(lines.map((l) => l.id), from, to);
        if (!won?.length) continue;
        const mine = lines.filter((l) => won.includes(l.id));
        const l0 = mine[0];
        const p: WishPosition = { kind: l0.entityKind ?? 'item', className: l0.className ?? '', name: l0.name, qty: 0, forClassName: l0.forClassName };
        const have = this.wishQtyOf(p);
        const next = Math.min(WISH_QTY_MAX, Math.max(0, have + sign * mine.reduce((n, l) => n + l.qty, 0)));
        if (next !== have && !(await this.setWishQty(p, next))) await this.supplies.casSource(won, to, from);
      }
    };
    await move(met, 'wish', 'wish_met', -1);
    await move(reopened, 'wish_met', 'wish', 1);
  }

  /**
   * Safety net of A3 (M2): wishlist writes that bypass the removal flow (cart, list page, undo of other actions, a
   * deleted wish) can leave more pieces assigned than wished. Per wish the open lines are lowered to the wish, the most
   * recently assigned first; a line of a wish that is gone is removed (it was an assignment of nothing). With `fresh`
   * the wishlist is read again first and nothing is trimmed when that fails, so a stale list in a tab left open never
   * costs lines. Ship wishes are left out of the reconcile pass (their Hangar half is not re-read); `onlyKey` limits
   * the pass to one wish (the undo of a removal re-checks its own wish with the list it just wrote).
   */
  private async trimOverAssigned(fresh: boolean, onlyKey?: string): Promise<void> {
    if (!this.storesReady()) return;
    if (fresh) {
      const reload = (this.wish as Partial<WishlistStore>).reload;
      if (!reload || !(await reload.call(this.wish))) return;
    }
    const byKey = new Map<string, { kind: string; lines: AssignedLine[] }>();
    for (const l of this.openAssignedAll()) {
      if (onlyKey !== undefined && l.key !== onlyKey) continue;
      const kind = l.key.slice(0, l.key.indexOf(':'));
      if (fresh && (kind === 'ship' || kind === 'upcoming')) continue;
      byKey.set(l.key, { kind, lines: [...(byKey.get(l.key)?.lines ?? []), l] });
    }
    for (const [key, g] of byKey) {
      const wished = this.wishPositions().find((w) => positionKey(w) === key)?.qty ?? 0;
      const assigned = this.assignedLines().filter((l) => l.key === key).reduce((n, l) => n + l.qty, 0);
      if (assigned <= wished) continue;
      this.lowerLines(g.lines.map((l) => ({ id: l.lineId, qty: l.qty })), assigned - wished);
    }
  }

  /** Open (not yet reached) wish lines of one wish, most recently assigned first - what a removal or release can take. */
  private openAssigned(key: string): AssignedLine[] {
    return this.openAssignedAll().filter((l) => l.key === key);
  }

  private openAssignedAll(): AssignedLine[] {
    const done = new Set(this.supplies.items().filter((i) => i.done).map((i) => i.id));
    return this.assignedLines()
      .filter((l) => !done.has(l.lineId))
      .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
  }

  /** Supplies pulled and wishlist loaded (fakes in specs that lack the flags count as ready). */
  private storesReady(): boolean {
    const sr = (this.supplies as Partial<HqSuppliesService>).ready;
    const wl = (this.wish as Partial<WishlistStore>).loaded;
    return (!sr || sr()) && (!wl || wl());
  }

  /** Pieces an open line stands for (its quantity); 0 for a line that is ticked or closed by the stock rise. */
  private piecesLeft(l: SupplyItem): number {
    if (l.done) return 0;
    const st = l.packageId ? this.evaluation(l.packageId)?.statuses.get(l.id) : undefined;
    return st?.closed ? 0 : Math.max(0, Math.round(l.qty));
  }

  /** The NORMAL Nachschuebe holding open pieces of a wish, for the removal planner (never an event one, M3). */
  private holdersOf(ref: WishRef): RemovalHolder[] {
    const key = positionKey(ref);
    const lines = this.openAssigned(key);
    return sharesByPackage(lines).map((s) => {
      const mine = new Set(s.lineIds);
      const otherOpen = this.linesOf(s.packageId).reduce((n, l) => (mine.has(l.id) ? n : n + this.piecesLeft(l)), 0);
      return {
        packageId: s.packageId,
        packageName: this.packages().find((p) => p.id === s.packageId)?.name ?? '',
        max: s.qty,
        assignedAt: s.assignedAt,
        otherOpen,
        einsaetze: this.einsatzSvc.ofPackage(s.packageId).length,
      };
    });
  }

  /** Lower wish lines by `n` pieces in the order given; a line left with nothing to get goes. Returns what changed. */
  private lowerLines(lines: readonly { id: string; qty: number }[], n: number): LineChange[] {
    const out: LineChange[] = [];
    for (const [id, left] of takeFromLines(lines, n)) {
      const l = this.supplies.items().find((x) => x.id === id);
      if (!l) continue;
      const taken = (lines.find((x) => x.id === id)?.qty ?? 0) - left;
      const next = l.qty - taken;
      out.push({ id, qty: l.qty, amount: l.amount, removed: next <= 0 });
      if (next <= 0) this.supplies.removeMany([id]);
      else this.supplies.setLine(id, next, l.amount);
    }
    return out;
  }

  private revertLineChanges(changed: readonly LineChange[]): void {
    for (const c of [...changed].reverse()) {
      if (c.removed) this.supplies.restore(c.id);
      else this.supplies.setLine(c.id, c.qty, c.amount);
    }
  }

  /** Dissolve Nachschuebe with every line (tombstones). `failed` = at least one delete did not go through. */
  private async dissolveAll(ids: readonly string[], uid: string): Promise<{ done: Dissolved[]; failed: boolean; failedIds: string[] }> {
    const done: Dissolved[] = [];
    const failedIds: string[] = [];
    for (const id of ids) {
      // Only a normal Nachschub is ever dissolved by a wish (M3).
      const n = this.packages().find((p) => p.id === id && (p.type ?? 'normal') === 'normal');
      if (!n) continue;
      const lineIds = this.linesOf(id).map((l) => l.id);
      if (!(await this.drop(id, uid))) {
        failedIds.push(id);
        continue;
      }
      this.supplies.removeMany(lineIds);
      done.push({ n, lineIds });
    }
    return { done, failed: failedIds.length > 0, failedIds };
  }

  /** Undo of {@link dissolveAll}: the Nachschub comes back with its name (its slot if still free) and its lines. */
  private async undoDissolve(done: readonly Dissolved[], uid: string): Promise<boolean> {
    for (const d of [...done].reverse()) {
      if (!(await this.restorePackage(d.n, uid))) return false;
      for (const l of d.lineIds) this.supplies.restore(l);
    }
    return true;
  }

  // ------------------------------------------------------------------------------------------------ internals

  /** Put one wishlist position onto a line of the Nachschub `packageId`. */
  private addPick(p: WishPosition, packageId: string, label: string, source: 'wish' | 'search'): AddedPick | null {
    const line = this.supplies.addLine(label, p.qty, {
      entityKind: p.kind,
      className: p.className,
      forClassName: p.forClassName ?? null,
      packageId,
      // 'wish': the line IS the assignment of the wish (A1). 'search': an event Nachschub's pick, moved off the list (M3).
      source,
    });
    return line ? { p, line } : null;
  }

  /** Revert {@link addPick}s: a line that existed before goes back to its quantity, a line created by them is removed. */
  private undoPicks(lines: readonly Pick<AddedPick, 'line'>[]): void {
    for (const { line } of [...lines].reverse()) {
      if (line.prevQty === 0) this.supplies.remove(line.id);
      else this.supplies.setLine(line.id, line.prevQty, line.prevAmount);
    }
  }

  /**
   * Which lines leave a Nachschub and how the wishlist moves (nothing is changed yet). A wish line's wish is already
   * on the wishlist (A1): with `backToWishlist` it just becomes free, without it its pieces leave the wishlist too.
   * Any other open line is counted up on the wishlist with `backToWishlist`, as before. Event Nachschuebe never touch it.
   */
  private planClear(id: string, backToWishlist: boolean): { n: Nachschub; removeIds: readonly string[]; shifts: readonly Shift[] } | null {
    const n = this.packages().find((p) => p.id === id);
    if (!n) return null;
    const ev = this.evaluation(id);
    const open: (OpenLine & { wish: boolean; left: number })[] = this.linesOf(id)
      .filter((l) => l.className)
      .map((l) => ({
        id: l.id,
        kind: l.entityKind ?? 'item',
        className: l.className ?? '',
        name: l.name,
        qty: l.qty,
        forClassName: l.forClassName,
        closed: l.done || (ev?.statuses.get(l.id)?.closed ?? false),
        wish: isWishLine(l),
        left: this.piecesLeft(l),
      }));
    // An event Nachschub keeps its progress and NEVER sends lines back to the wishlist (C9).
    const isEvent = isEventNachschub(n);
    const out = isEvent ? clearEventNachschub(open, []) : clearNachschub(open, [], false);
    const gone = new Set(out.removeIds);
    const shifts: Shift[] = [];
    if (!isEvent) {
      for (const l of open) {
        if (!gone.has(l.id)) continue;
        const p: WishPosition = { kind: l.kind, className: l.className, name: l.name, qty: l.qty, forClassName: l.forClassName };
        if (!l.wish && backToWishlist) shifts.push({ p, delta: +l.qty });
        else if (l.wish && !backToWishlist && l.left > 0) shifts.push({ p, delta: -l.left });
      }
    }
    return { n, removeIds: out.removeIds, shifts };
  }

  private wishQtyOf(p: WishPosition): number {
    const k = positionKey(p);
    return this.wishPositions().find((w) => positionKey(w) === k)?.qty ?? 0;
  }

  /**
   * Move wishlist positions by a delta each (never to an absolute copy of an older list). Anything above 999 is
   * reported as `lost`. A failed write puts the already changed positions back and reports `ok: false`.
   */
  private async shiftWishes(items: readonly Shift[]): Promise<ShiftResult> {
    const applied: Shift[] = [];
    let lost = 0;
    for (const { p, delta } of items) {
      const have = this.wishQtyOf(p);
      const raw = have + delta;
      const next = Math.min(WISH_QTY_MAX, Math.max(0, raw));
      if (raw > WISH_QTY_MAX) lost += raw - WISH_QTY_MAX;
      if (next === have) continue;
      if (!(await this.setWishQty(p, next))) {
        for (const a of [...applied].reverse()) await this.setWishQty(a.p, Math.max(0, this.wishQtyOf(a.p) - a.delta));
        return { ok: false, lost: 0, applied: [] };
      }
      applied.push({ p, delta: next - have });
    }
    return { ok: true, lost, applied };
  }

  /**
   * Set a wishlist position to an absolute quantity (0 removes it), whichever store holds it. False when the write
   * failed.
   */
  private async setWishQty(p: WishPosition, qty: number): Promise<boolean> {
    // Ship wishes live in two places (a not-owned ship's hangar row, an owned ship's extra copies in the store);
    // SearchWishlistService knows which and 0 removes the wish.
    if (p.kind === 'ship') return this.searchWish.setQty('ship', p.className, p.name, qty);
    return this.wish.setQty({ kind: p.kind, className: p.className, name: p.name, forClassName: p.forClassName }, qty);
  }

  /** Insert a new Nachschub; a slot taken elsewhere (unique violation) is retried with the next free one. */
  private async insertNew(n: Nachschub, uid: string): Promise<Nachschub | null> {
    let cur = n;
    for (let attempt = 0; attempt < 3; attempt++) {
      const out = await this.write(
        {
          user_id: uid,
          id: cur.id,
          name: cur.name,
          status: cur.status,
          slot: cur.slot,
          snapshot: cur.snapshot,
          archived_at: cur.archivedAt,
          type: cur.type ?? 'normal',
          event_id: cur.eventId ?? null,
          ...(cur.type === 'verkauf' ? { goal_auec: cur.goalAuec ?? null, progress_auec: cur.progressAuec ?? 0 } : {}),
          deleted_at: null,
          updated_at: new Date().toISOString(),
        },
        'save',
      );
      if (out === 'ok') {
        this.packages.update((ps) => [...ps.filter((p) => p.id !== cur.id), cur]);
        return cur;
      }
      if (out !== 'conflict') return null;
      await this.reload();
      const slot = freeSlot(this.packages());
      if (slot === null) {
        this.error.set('hq.nachschub.slotsFull');
        return null;
      }
      cur = { ...cur, slot };
    }
    return null;
  }

  /** Bring a deleted Nachschub back (undo of "Loeschen"): its old slot if still free, else the next one, else not at all. */
  private async restorePackage(n: Nachschub, uid: string): Promise<Nachschub | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.reload();
      let slot: number | null = null;
      if (n.status === 'active') {
        const taken = this.packages().some((p) => p.status === 'active' && p.slot === n.slot);
        slot = !taken && n.slot !== null ? n.slot : freeSlot(this.packages());
        if (slot === null) {
          this.error.set('hq.nachschub.slotsFull');
          return null;
        }
      }
      const back: Nachschub = { ...n, slot };
      const out = await this.patch(n.id, uid, { name: back.name, status: back.status, slot: back.slot, snapshot: back.snapshot, archived_at: back.archivedAt, type: back.type ?? 'normal', event_id: back.eventId ?? null }, true);
      if (out === 'ok') {
        this.packages.update((ps) => [...ps.filter((p) => p.id !== back.id), back]);
        return back;
      }
      if (out !== 'conflict') return null;
    }
    return null;
  }

  /**
   * Update ONLY `cols` of a live row. A row that was deleted on another device is not revived (a stale rename must not
   * bring a deleted Nachschub back): the call reports 'gone' and the local copy is dropped. `revive` clears the
   * tombstone on purpose (undo of a delete).
   */
  private async patch(id: string, uid: string, cols: Record<string, unknown>, revive = false): Promise<Outcome> {
    try {
      const now = new Date().toISOString();
      const base = this.sb.client
        .from('hq_supply_packages' as never)
        .update({ ...cols, ...(revive ? { deleted_at: null } : {}), updated_at: now } as never)
        .eq('user_id', uid)
        .eq('id', id);
      const { data, error } = await (revive ? base : base.is('deleted_at', null)).select('id');
      if (error) throw error;
      if (!(data as unknown[] | null)?.length) {
        this.packages.update((ps) => ps.filter((p) => p.id !== id));
        this.error.set('hq.nachschub.gone');
        return 'gone';
      }
      return 'ok';
    } catch (err) {
      return this.failed(err, 'save');
    }
  }

  private async write(row: Record<string, unknown>, op: string): Promise<Outcome> {
    try {
      const { error } = await this.sb.client.from('hq_supply_packages' as never).upsert(row as never, { onConflict: 'user_id,id' });
      if (error) throw error;
      return 'ok';
    } catch (err) {
      return this.failed(err, op);
    }
  }

  private failed(err: unknown, op: string): Outcome {
    logWarn('nachschub', `${op} failed`, err);
    const e = (err ?? {}) as { code?: unknown; message?: unknown };
    const code = typeof e.code === 'string' ? e.code : '';
    if (code === '23505') return 'conflict';
    // The server's per-user row cap (hq_enforce_cap): say so instead of a generic failure.
    const capped = code === '23514' && /row limit/i.test(typeof e.message === 'string' ? e.message : '');
    this.error.set(capped ? 'hq.nachschub.capReached' : toErrorKey('nachschub', op, err));
    return 'failed';
  }

  /** Tombstone a Nachschub (the row stays for the purge job and other devices). False when the write failed. */
  private async drop(id: string, uid: string): Promise<boolean> {
    try {
      const now = new Date().toISOString();
      const { error } = await this.sb.client
        .from('hq_supply_packages' as never)
        .update({ deleted_at: now, updated_at: now } as never)
        .eq('user_id', uid)
        .eq('id', id);
      if (error) throw error;
      this.packages.update((ps) => ps.filter((p) => p.id !== id));
      return true;
    } catch (err) {
      logWarn('nachschub', 'delete failed', err);
      this.error.set(toErrorKey('nachschub', 'delete', err));
      return false;
    }
  }
}

function toEvalLine(l: SupplyItem): EvalLine {
  return { id: l.id, need: l.amount ?? l.qty, ticked: l.done, ship: l.entityKind === 'ship', className: l.className };
}

function fromRow(r: HqSupplyPackageRow): Nachschub {
  const snap: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.snapshot ?? {})) if (typeof v === 'number' && Number.isFinite(v)) snap[k] = v;
  return {
    id: r.id,
    name: r.name,
    status: r.status === 'archived' ? 'archived' : 'active',
    slot: r.status === 'archived' ? null : r.slot,
    snapshot: snap,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
    type: r.type === 'event' || r.type === 'sightseeing' || r.type === 'verkauf' ? r.type : 'normal',
    eventId: r.event_id ?? null,
    ...(r.type === 'verkauf' ? { goalAuec: r.goal_auec ?? null, progressAuec: Number(r.progress_auec ?? 0) } : {}),
  };
}

/** A wish position as the assignment API names it (the wishlist key: kind + class [+ blueprint]). */
export type WishRef = Pick<WishPosition, 'kind' | 'className' | 'forClassName'>;

/** Where a wish's assigned pieces sit: one Nachschub ("Operation") and its Einsatz progress. */
export interface WishAssignment {
  readonly packageId: string;
  readonly packageName: string;
  /** Pieces of the wish assigned there, still to come. */
  readonly qty: number;
  /** Last time pieces were assigned there (ISO); the newest gives first on a removal (A6). */
  readonly assignedAt: string;
  /** The Nachschub's creation time (ISO). */
  readonly createdAt: string;
  readonly einsaetzeDone: number;
  readonly einsaetzeTotal: number;
  /** The wish lines behind it, most recently assigned first (release one with {@link NachschubService.release}). */
  readonly lineIds: readonly string[];
}

/** {@link Allocation} of one wish position plus its assignments, most recently assigned first. */
export interface WishAllocation extends Allocation {
  readonly key: string;
  readonly assignments: readonly WishAssignment[];
}

/** One row of the picker (B7). */
export interface AssignTarget {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly einsaetzeDone: number;
  readonly einsaetzeTotal: number;
}

export interface AssignTargets {
  /** Active normal Nachschuebe, newest first. */
  readonly operations: readonly AssignTarget[];
  /** Active slots in use (every type) of {@link slotsMax}. */
  readonly slotsUsed: number;
  readonly slotsMax: number;
  readonly canCreate: boolean;
  /** i18n key of the reason a new one cannot be made, else null. */
  readonly blockKey: string | null;
}

/** What "Lösen" of one wish line would do (C7, A7). */
export interface ReleaseInfo {
  readonly lineId: string;
  readonly packageId: string;
  readonly packageName: string;
  readonly pieces: number;
  /** The Nachschub holds no other open line afterwards. */
  readonly emptiesPackage: boolean;
  /** Its Einsätze, planned or done. */
  readonly einsaetze: number;
  /** Empty and without an Einsatz: dissolved along without asking for it. */
  readonly dissolvesAlong: boolean;
}

interface LineChange {
  readonly id: string;
  readonly qty: number;
  readonly amount: number | null;
  readonly removed: boolean;
}

interface Dissolved {
  readonly n: Nachschub;
  readonly lineIds: readonly string[];
}

/** A line that is the assignment of a wish (A1): source 'wish' with a class. */
export function isWishLine(l: Pick<SupplyItem, 'source' | 'className'>): boolean {
  return l.source === 'wish' && !!l.className;
}

/**
 * A line written by the old "move off the wishlist" contract that is CERTAINLY a wish line (H3): open, from the
 * search, no stops / step / SCU amount / minimum quality, and a kind no Bestand or reward line has (anything but
 * `item` and `ship`) or a blueprint group (`forClassName`).
 */
export function isLegacyWishLine(l: SupplyItem): boolean {
  if (l.source !== 'search' || l.done || !l.className || !l.entityKind) return false;
  if (l.gather?.length || l.stepKind || l.amount !== null || l.minQuality) return false;
  return (l.entityKind !== 'item' && l.entityKind !== 'ship') || !!l.forClassName;
}

/** {@link positionKey} of the wish a line answers. */
function lineKey(l: Pick<SupplyItem, 'entityKind' | 'className' | 'forClassName'>): string {
  return positionKey({ kind: l.entityKind ?? 'item', className: l.className ?? '', forClassName: l.forClassName });
}
