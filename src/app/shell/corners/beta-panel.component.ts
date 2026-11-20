import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { BETA_AREAS, BetaArea, BetaService } from '../../core/beta.service';

/**
 * The β switches (one row per area) — the body of the β FAB's popup on the desk and of the Tools dial's
 * Beta item on a phone. Staff (admin / collaborator) see it in `--sc-accent-collab`; the rows themselves
 * keep the cyan state colour of every switch.
 */
@Component({
  selector: 'sc-beta-panel',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pbody">
      @for (a of areas(); track a) {
        <button type="button" role="switch" class="sw"
                [attr.aria-checked]="beta.state()[a]"
                [disabled]="beta.locked()[a]"
                (click)="beta.toggle(a)">
          <span class="label">{{ ('beta.area.' + a) | translate }}
            @if (staff() && a === 'shell') { <span class="sc-sr-only">{{ 'beta.staffOnly' | translate }}</span> }
          </span>
          <span class="knob-track" aria-hidden="true"><span class="knob"></span></span>
        </button>
      }
      @if (staff()) { <p class="sc-sr-only">{{ 'beta.chip.note' | translate }}</p> }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pbody { display: flex; flex-direction: column; gap: var(--sc-space-1); }
    .sw {
      display: flex; align-items: center; justify-content: space-between; gap: var(--sc-space-3);
      min-height: var(--sc-tap-min); padding: 0 var(--sc-space-2); border: 0; border-radius: 8px;
      background: none; color: var(--sc-fg-1); font: inherit; cursor: pointer; text-align: start;
    }
    .sw:hover { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .sw:disabled { opacity: 0.45; cursor: not-allowed; }
    .sw:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    .label { font-size: max(0.82rem, var(--sc-fs-floor)); }
    .knob-track { position: relative; flex: none; width: 38px; height: 22px; border-radius: 999px;
      background: var(--sc-bg-2); border: 1px solid var(--sc-border); transition: background 0.16s; }
    .knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
      background: var(--sc-fg-2); transition: transform 0.16s, background 0.16s; }
    .sw[aria-checked='true'] .knob-track { background: color-mix(in srgb, var(--sc-accent) 35%, transparent); border-color: var(--sc-accent); }
    .sw[aria-checked='true'] .knob { transform: translateX(16px); background: var(--sc-accent); }
    @media (prefers-reduced-motion: reduce) { .knob, .knob-track { transition: none; } }
  `],
})
export class BetaPanelComponent {
  protected readonly beta = inject(BetaService);
  readonly areas = input<readonly BetaArea[]>(BETA_AREAS);
  readonly staff = input(false);
}
