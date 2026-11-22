import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { ScPopupComponent } from '../shared/popup/sc-popup.component';
import {
  CRAFT_QUALITY_DEFAULT,
  CRAFT_QUALITY_MAX,
  CRAFT_QUALITY_MIN,
  CRAFT_QUALITY_PRESETS,
  CraftRecipe,
  CraftStat,
  clampQuality,
  craftMultipliers,
  craftStatLabelKey,
  craftStatLowerIsBetter,
  overallQuality,
  rangeModifier,
} from './codex-crafting';
import { humanizeClassName } from './codex-format';

/** What the ship page hands the dialog for one card. */
export interface CraftDialogEntry {
  /** every hardpoint key the card stands for (a 3× row crafts all three). */
  slotKeys: string[];
  name: string;
  /** null while the recipe loads; a recipe-less item never opens the dialog. */
  recipe: CraftRecipe | null;
  /** the current slot qualities, or null for a stock (uncrafted) item. */
  qualities: readonly number[] | null;
  loadFailed?: boolean;
}

/**
 * Crafting quality of one component (erkul's calculator idea, in our own
 * frame): one slider per recipe slot (0 … 1000, the range the game files
 * give), the material it takes, and what that slot's quality does to the
 * item — live, before anything is applied. "Übernehmen" sets the qualities on
 * the card; the ship page then runs every number (KPI band, analysis, energy)
 * through them. "Werkszustand" returns the item to stock.
 */
@Component({
  selector: 'sc-codex-craft-dialog',
  standalone: true,
  imports: [TranslatePipe, ScPopupComponent, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (entry(); as e) {
      <sc-popup kind="dialog" [title]="e.name" [eyebrow]="'codex.craft.eyebrow' | translate" (closed)="closed.emit()">
        <div class="cd-body">
          @if (e.loadFailed) {
            <p class="cd-note">{{ 'errors.generic' | translate }}</p>
          } @else if (!e.recipe) {
            <p class="cd-note">{{ 'codex.craft.loading' | translate }}</p>
          } @else {
            <div class="cd-head">
              <span class="cd-q-l">{{ 'codex.craft.quality' | translate }}</span>
              <span class="cd-q">{{ overall() }}</span>
              @if (e.slotKeys.length > 1) {
                <span class="cd-n">{{ 'codex.craft.appliesTo' | translate: { n: e.slotKeys.length } }}</span>
              }
            </div>
            <div class="cd-presets" role="group" [attr.aria-label]="'codex.craft.presets' | translate">
              @for (p of presets; track p) {
                <button type="button" class="cd-preset" [class.on]="allAt(p)" (click)="setAll(p)">
                  {{ p === min ? ('codex.craft.min' | translate) : p === max ? ('codex.craft.max' | translate) : p }}
                </button>
              }
            </div>
            @for (slot of e.recipe.slots; track $index; let i = $index) {
              <section class="cd-slot">
                <div class="cd-slot-h">
                  <span class="cd-slot-n">{{ slotName(slot.name) }}</span>
                  <span class="cd-mat">
                    @for (ing of slot.ingredients; track ing.className) {
                      {{ material(ing.className) }} · {{ ing.unit === 'scu' ? fmt(ing.quantity, 2) + ' SCU' : '×' + fmt(ing.quantity, 0) }}
                    }
                  </span>
                </div>
                <div class="cd-row">
                  <input type="range" [min]="min" [max]="max" step="10" [value]="q()[i]"
                         [attr.aria-label]="slotName(slot.name)"
                         (input)="setSlot(i, $any($event.target).value)" />
                  <input type="number" class="cd-num" [min]="min" [max]="max" step="10" [value]="q()[i]"
                         [attr.aria-label]="slotName(slot.name)"
                         (change)="setSlot(i, $any($event.target).value)" />
                </div>
                @for (r of slot.ranges; track $index) {
                  <div class="cd-eff">
                    <span>{{ statLabel(r.stat) | translate }}</span>
                    <span class="cd-pct" [class.up]="good(r.stat, rangeModifier(r, q()[i]))" [class.down]="bad(r.stat, rangeModifier(r, q()[i]))">
                      {{ pct(rangeModifier(r, q()[i])) }}
                    </span>
                  </div>
                }
              </section>
            }
            @if (totals().length > 0) {
              <section class="cd-total">
                <h3>{{ 'codex.craft.effect' | translate }}</h3>
                @for (t of totals(); track t.stat) {
                  <div class="cd-eff">
                    <span>{{ statLabel(t.stat) | translate }}</span>
                    <span class="cd-pct" [class.up]="good(t.stat, t.m)" [class.down]="bad(t.stat, t.m)">{{ pct(t.m) }}</span>
                  </div>
                }
              </section>
            }
          }
        </div>
        <ng-container popupActions>
          @if (e.recipe) {
            <button type="button" scAction tier="primary" (click)="apply.emit(q())">{{ 'codex.craft.apply' | translate }}</button>
          }
          @if (e.qualities) {
            <button type="button" scAction tier="secondary" (click)="resetToStock.emit()">{{ 'codex.craft.stock' | translate }}</button>
          }
          <button type="button" scAction tier="secondary" (click)="closed.emit()">{{ 'codex.craft.cancel' | translate }}</button>
        </ng-container>
      </sc-popup>
    }
  `,
  styles: [`
    .cd-body { display: flex; flex-direction: column; gap: 12px; min-width: min(460px, 86vw); }
    .cd-note { margin: 0; color: var(--sc-fg-2); }
    .cd-head { display: flex; align-items: baseline; gap: 10px; }
    .cd-q-l { font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
    .cd-q { font-size: 1.6rem; color: var(--sc-accent); font-variant-numeric: tabular-nums; }
    .cd-n { font-size: 0.8rem; color: var(--sc-fg-2); }
    .cd-presets { display: flex; flex-wrap: wrap; gap: 6px; }
    .cd-preset { font: inherit; font-size: 0.8rem; padding: 3px 10px; border-radius: 999px; cursor: pointer;
      background: transparent; color: var(--sc-fg-1); border: 1px solid var(--sc-border); }
    .cd-preset.on { color: var(--sc-accent); border-color: var(--sc-accent); }
    .cd-preset:focus-visible { box-shadow: var(--sc-focus-ring); outline: none; }
    .cd-slot { border: 1px solid var(--sc-border); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
    .cd-slot-h { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .cd-slot-n { color: var(--sc-fg-0); }
    .cd-mat { font-size: 0.78rem; color: var(--sc-fg-2); }
    .cd-row { display: flex; gap: 10px; align-items: center; }
    .cd-row input[type=range] { flex: 1; accent-color: var(--sc-accent); }
    .cd-num { width: 5.5em; font: inherit; color: var(--sc-fg-0); background: transparent; border: 1px solid var(--sc-border);
      border-radius: 6px; padding: 2px 6px; text-align: right; }
    .cd-num:focus-visible { box-shadow: var(--sc-focus-ring); outline: none; }
    .cd-eff { display: flex; justify-content: space-between; font-size: 0.82rem; color: var(--sc-fg-1); }
    .cd-pct { font-variant-numeric: tabular-nums; }
    .cd-pct.up { color: var(--sc-accent); }
    .cd-pct.down { color: var(--sc-warning); }
    .cd-total h3 { margin: 0 0 4px; font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); font-weight: 400; }
  `],
})
export class CodexCraftDialogComponent {
  readonly entry = input<CraftDialogEntry | null>(null);
  readonly apply = output<number[]>();
  readonly resetToStock = output<void>();
  readonly closed = output<void>();

  readonly min = CRAFT_QUALITY_MIN;
  readonly max = CRAFT_QUALITY_MAX;
  readonly presets = CRAFT_QUALITY_PRESETS;
  readonly rangeModifier = rangeModifier;

  /** The working qualities (not applied until "Übernehmen"). */
  readonly q = signal<number[]>([]);

  constructor() {
    effect(() => {
      const e = this.entry();
      const n = e?.recipe?.slots.length ?? 0;
      this.q.set(Array.from({ length: n }, (_, i) => clampQuality(e?.qualities?.[i] ?? CRAFT_QUALITY_DEFAULT)));
    });
  }

  readonly overall = computed(() => overallQuality(this.q(), this.q().length));

  readonly totals = computed(() => {
    const r = this.entry()?.recipe;
    if (!r) return [];
    return [...craftMultipliers(r, this.q())].map(([stat, m]) => ({ stat, m }));
  });

  setSlot(i: number, v: unknown): void {
    const next = [...this.q()];
    next[i] = clampQuality(v);
    this.q.set(next);
  }

  setAll(v: number): void {
    this.q.set(this.q().map(() => clampQuality(v)));
  }

  allAt(v: number): boolean {
    const q = this.q();
    return q.length > 0 && q.every((x) => x === v);
  }

  statLabel(stat: CraftStat): string {
    return craftStatLabelKey(stat);
  }

  good(stat: CraftStat, m: number): boolean {
    return craftStatLowerIsBetter(stat) ? m < 1 - 1e-9 : m > 1 + 1e-9;
  }

  bad(stat: CraftStat, m: number): boolean {
    return craftStatLowerIsBetter(stat) ? m > 1 + 1e-9 : m < 1 - 1e-9;
  }

  pct(m: number): string {
    const p = Math.round((m - 1) * 1000) / 10;
    if (Math.abs(p) < 0.05) return '±0 %';
    return `${p > 0 ? '+' : '−'}${Math.abs(p).toLocaleString(undefined, { maximumFractionDigits: 1 })} %`;
  }

  fmt(v: number | null, digits: number): string {
    return v === null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: digits });
  }

  /** `REINFORCED FRAME` → `Reinforced Frame` (game data, shown as the game names it). */
  slotName(raw: string): string {
    return raw.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  material(className: string): string {
    return humanizeClassName(className.replace(/^Harvestable_Mineral_\w\w_/, '').replace(/_/g, ' '));
  }
}
