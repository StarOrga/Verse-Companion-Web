import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import type { ShipInterior, ShipInteriorGroup } from '../codex.types';
import { formatNumber } from '../codex-format';
import {
  GLYPH_PATHS,
  GROUP_GLYPH,
  GROUP_OF_CAT,
  InteriorGlyph,
  InteriorGroupBlock,
  InteriorPick,
  InteriorRow,
  RoomContents,
  SearchEntry,
  firstOfRow,
  interiorOverview,
  glyphOf,
  relayLabel,
  searchEntries,
  searchScopeOf,
} from './holo-interior';

/** A room as the panel names it. */
export interface InteriorRoomRef {
  key: string;
  deck: string;
  label: string;
}

/** The picked room (B5): where it is, what powers it, what it holds. */
export interface InteriorRoomCard extends InteriorRoomRef {
  deckLabel: string;
  floorZ: number | null;
  height: number | null;
  poweredBy: string | null;
  contents: RoomContents | null;
}

/** An exterior part the search can find (B7). */
export interface OuterPartRef {
  port: string;
  label: string;
  terms: readonly string[];
  /** Parts of the same name (eleven turrets of one kind) are one hit. */
  count: number;
}

type SearchTarget =
  | { type: 'part'; port: string }
  | { type: 'room'; room: InteriorRoomRef }
  | { type: 'row'; row: InteriorRow };

/**
 * The Bauteile tab's interior half (concept 20261117-1810 B5–B7, r2d3 „Bauteile
 * & Suche"): the mini search over outside parts and inside elements, rooms and
 * doors; the picked room with its contents and relay; the picked element; and
 * the overview of every element by type with counts — for the deck on the
 * table, or the whole ship. Purely presentational: the stage holds the picks.
 */
@Component({
  selector: 'sc-codex-holo-interior',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="srch">
      <span class="sc-sr-only">{{ 'codex.holo.interior.searchLabel' | translate }}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
      <input type="search" [value]="query()" (input)="onQuery($any($event.target).value)" (keydown.escape)="onQuery('')"
             autocomplete="off" spellcheck="false" enterkeyhint="search"
             [placeholder]="(interior() ? 'codex.holo.interior.searchPlaceholder' : 'codex.holo.interior.searchPlaceholderOuter') | translate" />
    </label>

    @if (searching()) {
      <section class="grp hits" [attr.aria-label]="'codex.holo.interior.hitsAria' | translate">
        <h4>{{ 'codex.holo.interior.hits' | translate: { q: query().trim(), n: hits().length } }}</h4>
        @for (h of hits(); track h.id) {
          <button type="button" class="row" [attr.data-side]="h.side" (click)="openHit(h)">
            <span class="side" aria-hidden="true">{{ (h.side === 'outer' ? 'codex.holo.interior.sideOuter' : 'codex.holo.interior.sideInner') | translate }}</span>
            <span class="l">{{ h.label }}</span>
            @if (h.count > 1) { <i>{{ h.count }}</i> }
          </button>
        } @empty {
          <p class="note">{{ 'codex.holo.interior.noHits' | translate: { q: query().trim() } }}</p>
        }
      </section>
    } @else if (interior(); as int) {
      @if (pickCard(); as c) {
        <div class="card" role="region" [attr.aria-label]="c.title">
          <button type="button" class="back" (click)="pickClear.emit()">‹ {{ backLabel() }}</button>
          <h3>
            <svg class="ic" viewBox="0 0 24 24" aria-hidden="true" [attr.data-g]="c.group">
              <circle cx="12" cy="12" r="10.5" class="ic-bg" /><path [attr.d]="glyph[c.glyph].d" [class.fill]="glyph[c.glyph].fill" />
            </svg>
            {{ c.title }}
          </h3>
          <p class="meta">{{ c.meta }}</p>
          @if (c.facts.length) {
            <dl class="kv">
              @for (f of c.facts; track f.k) { <div><dt>{{ f.k | translate }}</dt><dd>{{ f.v }}</dd></div> }
            </dl>
          }
          @if (c.cls) { <p class="cls">{{ c.cls }}</p> }
        </div>
      } @else if (room(); as r) {
        <div class="card" role="region" [attr.aria-label]="r.label">
          <button type="button" class="back" (click)="roomClear.emit()">‹ {{ backLabel() }}</button>
          <h3>{{ r.label }}</h3>
          <p class="meta">{{ roomMeta(r) }}</p>
          @if (r.contents && r.contents.scu > 0) {
            <p class="kv1"><b class="scu">{{ fmt(r.contents.scu) }} SCU</b> {{ 'codex.holo.interior.inGrids' | translate: { n: r.contents.grids.length } }}</p>
          }
          @if (r.poweredBy) {
            <h4>{{ 'codex.holo.interior.poweredBy' | translate }}</h4>
            <p class="row static"><span class="l">{{ 'codex.holo.interior.relay' | translate: { name: relay(r.poweredBy) } }}</span></p>
          }
          @if (r.contents && r.contents.blocks.length) {
            <h4>{{ 'codex.holo.interior.inRoom' | translate }}</h4>
            <ng-container *ngTemplateOutlet="blocksTpl; context: { $implicit: r.contents.blocks, dim: false }" />
          } @else {
            <p class="note">{{ 'codex.holo.interior.roomEmpty' | translate }}</p>
          }
        </div>
      } @else {
        <p class="note scope">{{ scopeNote() }}</p>
        @if (gap(); as g) {
          <p class="gap" tabindex="0" [scTooltip]="'codex.holo.interior.gapHint' | translate" scTooltipTier="label">
            {{ 'codex.holo.interior.gap' | translate: { located: fmt(g.located), total: fmt(g.total) } }}
          </p>
        }
        @if (activeBlocks().length) {
          <h4 class="gh">{{ presetTitle() }}</h4>
          <ng-container *ngTemplateOutlet="blocksTpl; context: { $implicit: activeBlocks(), dim: false }" />
        }
        @if (otherBlocks().length) {
          <h4 class="gh">{{ 'codex.holo.interior.othersOff' | translate }}</h4>
          <ng-container *ngTemplateOutlet="blocksTpl; context: { $implicit: otherBlocks(), dim: true }" />
        }
        @if (deckRooms().length) {
          <h4 class="gh">{{ 'codex.holo.interior.roomsOfDeck' | translate: { n: deckRooms().length } }}</h4>
          <div class="rooms">
            @for (r of deckRooms(); track r.key) {
              <button type="button" class="room" (click)="roomSelect.emit(r)">{{ r.label }}</button>
            }
          </div>
        }
      }
    }

    <ng-template #blocksTpl let-blocks let-dim="dim">
      @for (b of $any(blocks); track b.group) {
        <div class="grp" [class.dim]="dim" [attr.data-g]="b.group">
          @for (row of b.rows; track row.id) {
            <button type="button" class="row" [class.on]="rowOn(row)" (click)="openRow(row)">
              <svg class="ic" viewBox="0 0 24 24" aria-hidden="true" [attr.data-g]="b.group">
                <circle cx="12" cy="12" r="10.5" class="ic-bg" /><path [attr.d]="glyph[rowGlyph(row)].d" [class.fill]="glyph[rowGlyph(row)].fill" />
              </svg>
              <span class="l">{{ rowLabel(row) }}</span>
              <i>@if (row.cat === 'grid') {<span class="scu">{{ fmt(row.scu) }} SCU</span> · }{{ row.items.length }}</i>
            </button>
          }
        </div>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: grid; gap: var(--sc-space-2); align-content: start; min-width: 0; --f: var(--sc-fs-floor); }
    .srch { position: relative; display: flex; align-items: center; }
    .srch svg { position: absolute; inset-inline-start: 10px; width: 15px; height: 15px; fill: none; stroke: var(--sc-fg-2); stroke-width: 1.8; pointer-events: none; }
    .srch input { width: 100%; box-sizing: border-box; min-height: 32px; padding: 0 12px 0 32px; border: 1px solid var(--sc-border); border-radius: 16px;
      background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); color: var(--sc-fg-0); font: inherit; font-size: max(12.5px, var(--f)); }
    .srch input::-webkit-search-cancel-button { appearance: none; }
    .srch input:focus { border-color: color-mix(in srgb, var(--sc-accent) 60%, var(--sc-border)); }
    .srch input:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
    h4 { margin: var(--sc-space-2) 0 0; font-size: max(10.5px, var(--f)); letter-spacing: 0.12em; text-transform: uppercase; color: var(--sc-fg-2); font-weight: 600; }
    .note { margin: 0; font-size: max(11.5px, var(--f)); color: var(--sc-fg-2); }
    .gap { margin: 0; justify-self: start; font-size: max(11.5px, var(--f)); color: var(--sc-warning);
      border: 1px solid color-mix(in srgb, var(--sc-warning) 45%, transparent); border-radius: 999px; padding: 2px 10px; }
    .gap:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
    .grp { display: grid; gap: var(--sc-space-1); }
    .grp.dim .row { opacity: 0.62; }
    .row { display: flex; align-items: center; gap: 8px; min-height: max(32px, var(--sc-tap-min, 0px)); padding: 3px 8px; border: 1px solid transparent; border-radius: 7px;
      background: none; color: var(--sc-fg-1); font: inherit; font-size: max(12.5px, var(--f)); text-align: start; cursor: pointer; min-width: 0; }
    .row:hover { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); color: var(--sc-fg-0); }
    .row.on { border-color: color-mix(in srgb, var(--sc-accent) 55%, transparent); color: var(--sc-fg-0); }
    .row.static { cursor: default; }
    .row.static:hover { background: none; }
    .row .l { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .row i { font-style: normal; font-family: var(--font-monospace, monospace); color: var(--sc-fg-2); white-space: nowrap; }
    .row .side { flex: none; font-size: max(10px, var(--f)); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2);
      border: 1px solid var(--sc-border); border-radius: 4px; padding: 0 5px; }
    .row[data-side='inner'] .side { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    .scu { color: var(--sc-int-cargo); }
    .row:focus-visible, .back:focus-visible, .room:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    .ic { width: 18px; height: 18px; flex: none; color: var(--sc-accent); }
    .ic .ic-bg { fill: var(--sc-bg-0); stroke: currentColor; stroke-width: 1.6px; }
    .ic path { fill: none; stroke: currentColor; stroke-width: 1.8px; }
    .ic path.fill { fill: currentColor; stroke: none; }
    .ic[data-g='cargo'] { color: var(--sc-int-cargo); }
    .ic[data-g='ways'] { color: var(--sc-int-ways); }
    .ic[data-g='med'] { color: var(--sc-int-med); }
    .ic[data-g='weapons'] { color: var(--sc-int-weapons); }
    .ic[data-g='lockers'] { color: var(--sc-int-lockers); }
    .ic[data-g='fire'] { color: var(--sc-int-fire); }
    .ic[data-g='tech'] { color: var(--sc-int-tech); }
    .ic[data-g='living'] { color: var(--sc-int-living); }
    .ic[data-g='doors'] { color: var(--sc-int-doors); }
    .card { display: grid; gap: 6px; min-width: 0; }
    .card h3 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; color: var(--sc-fg-0); overflow-wrap: anywhere; }
    .card h3 .ic { width: 22px; height: 22px; }
    .meta { margin: 0; font-size: max(12px, var(--f)); color: var(--sc-fg-2); }
    .kv1 { margin: 0; font-size: max(12.5px, var(--f)); color: var(--sc-fg-1); }
    .kv { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 10px; }
    .kv div { display: grid; gap: 1px; min-width: 0; }
    .kv dt { font-size: max(10px, var(--f)); color: var(--sc-fg-2); }
    .kv dd { margin: 0; font-size: max(13px, var(--f)); color: var(--sc-fg-0); overflow-wrap: anywhere; }
    .cls { margin: 0; font-family: var(--font-monospace, monospace); font-size: max(10.5px, var(--f)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .back { justify-self: start; background: none; border: 0; border-radius: 5px; color: var(--sc-accent); cursor: pointer; font: inherit;
      font-size: max(12.5px, var(--f)); padding: 3px 9px 3px 6px; min-height: var(--sc-tap-min, 26px); }
    .back:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .rooms { display: flex; flex-wrap: wrap; gap: 4px; }
    .room { min-height: max(28px, var(--sc-tap-min, 0px)); padding: 2px 10px; border-radius: 6px; border: 1px solid var(--sc-border); background: transparent;
      color: var(--sc-fg-1); font: inherit; font-size: max(11.5px, var(--f)); cursor: pointer; }
    .room:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    @media (pointer: coarse) { .srch input, .row, .room, .back { min-height: 48px; } }
  `],
})
export class CodexHoloInteriorComponent {
  private readonly translate = inject(TranslateService);

  readonly interior = input<ShipInterior | null>(null);
  /** The deck on the table; null = the whole ship (the hull, or every deck). */
  readonly deck = input<string | null>(null);
  readonly deckLabels = input<ReadonlyMap<string, string>>(new Map());
  readonly rooms = input<readonly InteriorRoomRef[]>([]);
  readonly room = input<InteriorRoomCard | null>(null);
  readonly pick = input<InteriorPick | null>(null);
  readonly groups = input<ReadonlySet<ShipInteriorGroup>>(new Set());
  /** "Voreinstellung Kampfschiff" — the preset's name for the active block's title. */
  readonly presetName = input<string>('');
  readonly gap = input<{ located: number; total: number } | null>(null);
  readonly parts = input<readonly OuterPartRef[]>([]);

  readonly pickChange = output<InteriorPick>();
  readonly pickClear = output<void>();
  readonly roomSelect = output<InteriorRoomRef>();
  readonly roomClear = output<void>();
  readonly partSelect = output<string>();
  /** A settled search: which sides its hits came from and how many (no search terms ever leave). */
  readonly searched = output<{ scope: 'outer' | 'inner' | 'both'; hits: number }>();

  readonly glyph = GLYPH_PATHS;
  readonly query = signal('');
  readonly searching = computed(() => this.query().trim().length >= 2);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReported = '';

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
  }

  private lang(): string {
    return this.translate.getCurrentLang() || 'de';
  }

  fmt(n: number): string {
    return formatNumber(n, this.lang() === 'de' ? 'de-DE' : 'en-US', 1);
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  rowLabel(row: InteriorRow): string {
    if (row.cat === 'grid') return this.t('codex.holo.interior.cat.grid');
    if (row.doorKind) return this.t(`codex.holo.interior.door.${row.doorKind}`);
    return this.t(`codex.holo.interior.cat.${row.cat}`);
  }

  rowGlyph(row: InteriorRow): InteriorGlyph {
    return row.cat === 'grid' ? GROUP_GLYPH.cargo : glyphOf(row.cat);
  }

  /** The overview of the deck on the table (or the ship), groups that are on first. */
  readonly blocks = computed<InteriorGroupBlock[]>(() => interiorOverview(this.interior(), this.deck()));
  readonly activeBlocks = computed(() => this.blocks().filter((b) => this.groups().has(b.group)));
  readonly otherBlocks = computed(() => this.blocks().filter((b) => !this.groups().has(b.group)));
  readonly deckRooms = computed(() => {
    const deck = this.deck();
    if (!deck) return [];
    const seen = new Set<string>();
    return this.rooms()
      .filter((r) => r.deck === deck && r.label.trim() && (seen.has(r.label) ? false : (seen.add(r.label), true)))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  readonly scopeNote = computed(() => {
    const deck = this.deck();
    const n = this.blocks().reduce((s, b) => s + b.count, 0);
    return deck
      ? this.t('codex.holo.interior.scopeDeck', { deck: this.deckLabels().get(deck) ?? deck, n })
      : this.t('codex.holo.interior.scopeShip', { n, decks: this.deckLabels().size });
  });
  readonly presetTitle = computed(() => this.presetName() || this.t('codex.holo.interior.groupsOn'));
  readonly backLabel = computed(() => {
    const deck = this.deck();
    return deck ? this.deckLabels().get(deck) ?? deck : this.t('codex.holo.interior.overview');
  });

  rowOn(row: InteriorRow): boolean {
    const p = this.pick();
    return !!p && (p.kind === 'grid') === (row.cat === 'grid') && row.items.includes(p.index);
  }

  /** A row: the first of its elements (on the deck on the table), the next one on each further press. */
  openRow(row: InteriorRow): void {
    const int = this.interior();
    if (!int) return;
    const p = this.pick();
    const kind = row.cat === 'grid' ? 'grid' : 'poi';
    if (p && p.kind === kind) {
      const at = row.items.indexOf(p.index);
      if (at >= 0 && row.items.length > 1) {
        this.pickChange.emit({ kind, index: row.items[(at + 1) % row.items.length] });
        return;
      }
    }
    const first = firstOfRow(int, row, this.deck());
    if (first) this.pickChange.emit(first);
  }

  relay(port: string): string {
    return relayLabel(port);
  }

  roomMeta(r: InteriorRoomCard): string {
    const parts = [r.deckLabel];
    if (r.floorZ !== null) parts.push(this.t('codex.holo.interior.floorAt', { z: (r.floorZ >= 0 ? '+' : '') + this.fmt(Math.round(r.floorZ * 10) / 10) }));
    if (r.height !== null) parts.push(this.t('codex.holo.interior.roomHeight', { h: this.fmt(Math.round(r.height * 10) / 10) }));
    return parts.join(' · ');
  }

  /** The picked element in words (B6): type, deck and room, the door's facts, a grid's size. */
  readonly pickCard = computed(() => {
    const int = this.interior();
    const p = this.pick();
    if (!int || !p) return null;
    const roomLabel = (key?: string) => (key ? this.rooms().find((r) => r.key === key)?.label ?? null : null);
    const deckLabel = (key: string) => this.deckLabels().get(key) ?? key;
    if (p.kind === 'grid') {
      const g = int.cargoGrids[p.index];
      if (!g) return null;
      const meta = [deckLabel(g.deck), roomLabel(g.room)].filter(Boolean).join(' · ');
      return {
        title: this.t('codex.holo.interior.one.grid'),
        group: 'cargo' as ShipInteriorGroup,
        glyph: GROUP_GLYPH.cargo,
        meta,
        facts: [
          { k: 'codex.holo.interior.fact.scu', v: `${this.fmt(g.scu)} SCU` },
          { k: 'codex.holo.interior.fact.dims', v: g.dims.map((d) => this.fmt(d)).join(' × ') + ' m' },
        ],
        cls: g.cls || g.port,
      };
    }
    const poi = int.pois[p.index];
    if (!poi) return null;
    const row: InteriorRow = { id: '', group: 'ways', cat: poi.cat, doorKind: poi.cat === 'door' ? poi.door?.kind ?? 'room' : null, items: [p.index], scu: 0 };
    const facts: { k: string; v: string }[] = [];
    if (poi.door) {
      facts.push({ k: 'codex.holo.interior.fact.breachable', v: this.t(poi.door.breachable ? 'codex.holo.interior.yes' : 'codex.holo.interior.no') });
      facts.push({ k: 'codex.holo.interior.fact.panel', v: this.t(poi.door.panel ? 'codex.holo.interior.yes' : 'codex.holo.interior.no') });
    }
    if (poi.connects?.length) facts.push({ k: 'codex.holo.interior.fact.connects', v: poi.connects.map(deckLabel).join(' → ') });
    const z = poi.pos[2];
    facts.push({ k: 'codex.holo.interior.fact.height', v: `${z >= 0 ? '+' : ''}${this.fmt(z)} m` });
    return {
      title: this.t(row.doorKind ? `codex.holo.interior.oneDoor.${row.doorKind}` : `codex.holo.interior.one.${poi.cat}`),
      group: GROUP_OF_CAT[poi.cat],
      glyph: glyphOf(poi.cat),
      meta: [deckLabel(poi.deck), roomLabel(poi.room)].filter(Boolean).join(' · '),
      facts,
      cls: poi.cls ?? poi.port ?? null,
    };
  });

  // ── Search (B7) ──────────────────────────────────────────────────────────

  /** Everything the search can find: outside parts, inside element types (doors by kind), rooms. */
  readonly entries = computed<SearchEntry<SearchTarget>[]>(() => {
    const out: SearchEntry<SearchTarget>[] = [];
    for (const part of this.parts()) {
      out.push({ id: `p:${part.port}`, side: 'outer', label: part.label, terms: [part.label, ...part.terms], count: part.count, target: { type: 'part', port: part.port } });
    }
    const int = this.interior();
    if (int) {
      for (const block of interiorOverview(int, null)) {
        for (const row of block.rows) {
          const label = this.rowLabel(row);
          const classes = row.cat === 'grid'
            ? row.items.map((i) => int.cargoGrids[i]?.cls ?? '')
            : row.items.slice(0, 40).map((i) => int.pois[i]?.cls ?? '');
          const groupName = this.t(`codex.holo.interior.group.${block.group}`);
          out.push({ id: `r:${row.id}`, side: 'inner', label, terms: [label, groupName, ...new Set(classes.filter(Boolean))], count: row.items.length, target: { type: 'row', row } });
        }
      }
      // One hit per room name and deck (an Idris has four "Turret Access" on one deck).
      const seen = new Map<string, SearchEntry<SearchTarget>>();
      for (const room of this.rooms()) {
        if (!room.label.trim()) continue;
        const deck = this.deckLabels().get(room.deck) ?? room.deck;
        const label = `${room.label} · ${deck}`;
        const had = seen.get(label);
        if (had) {
          had.count += 1;
          continue;
        }
        const entry: SearchEntry<SearchTarget> = { id: `m:${room.key}`, side: 'inner', label, terms: [room.label, room.key], count: 1, target: { type: 'room', room } };
        seen.set(label, entry);
        out.push(entry);
      }
    }
    return out;
  });

  readonly hits = computed(() => searchEntries(this.query(), this.entries()));

  onQuery(v: string): void {
    this.query.set(v);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (!this.searching()) return;
    // One event per settled search, never per keystroke; the words typed stay here.
    this.searchTimer = setTimeout(() => this.report(), 900);
  }

  private report(): void {
    const q = this.query().trim().toLowerCase();
    if (!q || q === this.lastReported) return;
    this.lastReported = q;
    const hits = this.hits();
    this.searched.emit({ scope: searchScopeOf(hits.length ? hits : [{ side: this.interior() ? 'inner' : 'outer' }]), hits: hits.length });
  }

  openHit(h: SearchEntry<SearchTarget>): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.report();
    const t = h.target;
    if (t.type === 'part') this.partSelect.emit(t.port);
    else if (t.type === 'room') this.roomSelect.emit(t.room);
    else {
      const int = this.interior();
      const first = int ? firstOfRow(int, t.row, this.deck()) : null;
      if (first) this.pickChange.emit(first);
    }
    this.query.set('');
  }
}
