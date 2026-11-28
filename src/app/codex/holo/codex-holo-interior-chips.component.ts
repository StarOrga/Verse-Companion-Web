import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import type { ShipInteriorGroup } from '../codex.types';
import { GLYPH_PATHS, GROUP_GLYPH, INTERIOR_GROUPS } from './holo-interior';

/**
 * The interior's element groups above the holotable (concept 20261117-1810 B8):
 * multi-select chips in the groups' colours, the role preset they opened on
 * („Voreinstellung Fregatte“) and its reset. Nothing here is remembered.
 */
@Component({
  selector: 'sc-codex-holo-interior-chips',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ig" role="group" [attr.aria-label]="'codex.holo.interior.groupsAria' | translate">
      <div class="ig-row">
        @for (g of chips; track g.id) {
          <button type="button" class="ig-chip" [attr.data-g]="g.id" [class.on]="groups().has(g.id)"
                  [attr.aria-pressed]="groups().has(g.id)" (click)="groupToggle.emit(g.id)">
            <svg class="ig-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" class="ic-bg" /><path [attr.d]="g.glyph.d" [class.fill]="g.glyph.fill" /></svg>
            {{ g.labelKey | translate }}
          </button>
        }
      </div>
      <span class="ig-tag" [scTooltip]="('codex.holo.interior.presetTag' | translate) + ' ' + presetLabel()">{{ 'codex.holo.interior.presetTag' | translate }} <b>{{ presetLabel() }}</b></span>
      <button type="button" scAction tier="secondary" class="ig-reset" [attr.aria-disabled]="untouched() ? true : null"
              [scTooltip]="('codex.holo.interior.presetTag' | translate) + ' ' + presetLabel()" (click)="presetReset.emit()">
        <svg class="ig-ri" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>
        <span class="ig-rl">{{ 'codex.holo.interior.presetReset' | translate }}</span></button>
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; container: ig / inline-size; }
  .ig { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }
  .ig-reset { position: relative; z-index: 1; margin-inline-start: 2px; }
  .ig-row { display: flex; gap: 5px; min-width: 0; flex: 0 1 auto; overflow-x: auto; overscroll-behavior-x: contain; padding: 2px 24px 4px 0;
  mask-image: linear-gradient(90deg, #000 calc(100% - 24px), transparent); }
  .ig-tag, .ig-reset { flex: none; }
  /* The row scrolls to a snap point instead of stopping mid-chip, and the reset sits outside its flow (T3). */
  .ig-row { scroll-snap-type: x proximity; scroll-padding-inline: 4px; }
  .ig-chip { scroll-snap-align: start; }
  .ig-ri { display: none; }
  /* Not room for every chip and the preset line (a 1440 px desktop): the preset folds into the reset icon (its name is the
     tooltip) instead of pushing the last chips under the fade. */
  @container ig (max-width: 1119px) {
    .ig-row { flex: 1 1 auto; }
    .ig-tag { display: none; }
    .ig-reset { inline-size: 32px; min-inline-size: 32px; block-size: 32px; min-block-size: 32px; padding: 0; border-radius: 50%; justify-content: center; }
    .ig-ri { display: block; width: 18px; height: 18px; }
    .ig-rl { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  }
  /* Phone: preset tag and reset fold into one 44px icon button at the row end (the preset name is its tooltip, the word stays for screen readers). */
  @media (max-width: 640px), (orientation: landscape) and (max-height: 500px) {
    .ig-tag { display: none; }
    .ig-reset { inline-size: 44px; min-inline-size: 44px; block-size: 44px; min-block-size: 44px; padding: 0; border-radius: 50%; justify-content: center; }
    .ig-ri { display: block; }
    .ig-rl { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  }
  .ig-reset { min-height: 26px; padding-block: 0; font-size: max(11.5px, var(--f)); }
  @media (pointer: coarse) { .ig-reset { min-height: var(--sc-tap-min, 44px); min-inline-size: var(--sc-tap-min, 44px); } }
  .ig-chip { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px 0 4px; border: 1px solid var(--l1); border-radius: 13px;
  background: none; color: var(--sc-fg-2); font: inherit; font-size: max(11.5px, var(--f)); white-space: nowrap; cursor: pointer;
  transition: color 160ms ease, border-color 160ms ease, background 160ms ease; --g: var(--sc-accent); }
  .ig-chip[data-g='cargo'] { --g: var(--sc-int-cargo); }
  .ig-chip[data-g='ways'] { --g: var(--sc-int-ways); }
  .ig-chip[data-g='med'] { --g: var(--sc-int-med); }
  .ig-chip[data-g='weapons'] { --g: var(--sc-int-weapons); }
  .ig-chip[data-g='lockers'] { --g: var(--sc-int-lockers); }
  .ig-chip[data-g='fire'] { --g: var(--sc-int-fire); }
  .ig-chip[data-g='tech'] { --g: var(--sc-int-tech); }
  .ig-chip[data-g='living'] { --g: var(--sc-int-living); }
  .ig-chip[data-g='doors'] { --g: var(--sc-int-doors); }
  .ig-ic { width: 18px; height: 18px; flex: none; color: var(--g); opacity: 0.55; }
  .ig-ic .ic-bg { fill: var(--sc-bg-0); stroke: currentColor; stroke-width: 1.6px; }
  .ig-ic path { fill: none; stroke: currentColor; stroke-width: 1.8px; }
  .ig-ic path.fill { fill: currentColor; stroke: none; }
  .ig-chip.on { color: var(--sc-fg-0); border-color: color-mix(in srgb, var(--g) 70%, transparent); background: color-mix(in srgb, var(--g) 14%, transparent); }
  .ig-chip.on .ig-ic { opacity: 1; }
  .ig-chip:hover { color: var(--sc-fg-0); border-color: var(--l2); }
  .ig-chip:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
  .ig-tag { font-size: max(11px, var(--f)); color: var(--sc-fg-2); white-space: nowrap; }
  .ig-tag b { color: var(--sc-fg-0); font-weight: 600; }
  @media (pointer: coarse) { .ig-chip { height: var(--sc-tap-min, 44px); } }
  /* A phone on its side: the chips row is exactly one tap high (44 px) with 3 px above and below, the hull gets the rest. */
  @media (orientation: landscape) and (max-height: 500px) { .ig-chip { height: 44px; min-height: 44px; } .ig-row { padding-block: 3px; } }
  /* Narrow: the chips take their own line and scroll; the preset and its reset sit under them. */
  /* Narrow screens keep ONE line: the chips scroll sideways and the preset tag shortens with an ellipsis. A wrapped
     second line changed the row height with every view/deck switch and moved the stage (v0.282.0 report). */
  @media (prefers-reduced-motion: reduce) {
    .ig-chip { transition: none; }
  }
  @media (max-width: 1000px) {
    .ig-row { flex: 1 1 auto; }
    .ig-tag { flex: 0 1 auto; min-width: 0; max-width: 34%; overflow: hidden; text-overflow: ellipsis; }
  }
  `],
})
export class CodexHoloInteriorChipsComponent {
  readonly groups = input<ReadonlySet<ShipInteriorGroup>>(new Set());
  readonly presetLabel = input('');
  /** The preset is on as it opened: the reset has nothing to do. */
  readonly untouched = input(true);
  readonly groupToggle = output<ShipInteriorGroup>();
  readonly presetReset = output<void>();

  readonly chips = INTERIOR_GROUPS.map((id) => ({ id, labelKey: `codex.holo.interior.group.${id}`, glyph: GLYPH_PATHS[GROUP_GLYPH[id]] }));
}
