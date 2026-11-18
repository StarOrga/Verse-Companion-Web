import { ChangeDetectionStrategy, Component, input, linkedSignal, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AssignTargets } from '../../hq/nachschub/nachschub.service';
import { HQ_ROOT } from '../../hq/hq-routes';
import { ScPopupComponent } from '../popup/sc-popup.component';
import { PATH_ICONS } from './path-icons';

/** At most this many progress marks; a longer Operation fills them by share. */
const MAX_MARKS = 10;

/** The Einsatz progress marks of an Operation (B4, B7): one per Einsatz up to {@link MAX_MARKS}, `true` = done. */
export function progressMarks(done: number, total: number): boolean[] {
  if (total <= 0) return [];
  const n = Math.min(total, MAX_MARKS);
  const on = Math.round((Math.min(done, total) / total) * n);
  return Array.from({ length: n }, (_, i) => i < on);
}

/** Where the picker's caret sits: on top when the picker hangs under its button, at the bottom when it opened above. */
export type AssignCaret = 'top' | 'bottom';

/** What the reader picked: an Operation id or 'new', and how many free pieces. */
export interface AssignPick {
  target: string | 'new';
  qty: number;
}

/**
 * `sc-item-path-assign`: the picker of "Zuordnen" in the wish station (concept 20261117-1110-pfad-stationen, B6/B7,
 * mock rounds/04.html `pfad-zuordnen`). A light `sc-popup` panel with a caret that points at its button: how many
 * (preset to every free piece), the active Operationen newest first with their Einsatz progress, "Neue Operation" last
 * (the name is proposed by the service; Einsätze are planned in the HQ afterwards) and the footer with the slots and
 * the link to Planen. The parent positions it (CDK overlay under the button; in the flow on phones) and writes.
 */
@Component({
  selector: 'sc-item-path-assign',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScPopupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.inline]': 'inline()', '[attr.data-caret]': 'caret()' },
  template: `
    <span class="ap-caret" aria-hidden="true"></span>
    <sc-popup class="ap-pop" kind="panel" [float]="true" [backdrop]="false" [backClose]="false"
              [title]="'pathCtl.assign.title' | translate" [eyebrow]="name()" [returnFocus]="returnFocus()" (closed)="closed.emit()">
      <div class="ap-qty">
        <span class="mut">{{ 'pathCtl.assign.howMany' | translate }}</span>
        <span class="st" role="group" [attr.aria-label]="'pathCtl.assign.howMany' | translate">
          <button type="button" [attr.aria-label]="'pathCtl.less' | translate" [disabled]="busy() || qty() <= 1" (click)="step(-1)">−</button>
          <b aria-live="polite">{{ qty() }}</b>
          <button type="button" [attr.aria-label]="'pathCtl.more' | translate" [disabled]="busy() || qty() >= free()" (click)="step(1)">+</button>
        </span>
        <span class="mut">{{ (assigned() > 0 ? 'pathCtl.assign.ofFree' : 'pathCtl.assign.ofWished') | translate: { n: free() } }}</span>
      </div>
      @if (busyKey(); as k) {
        <!-- Nothing can be assigned in this phase (the Operationen load, or a write is under way): the rows are off and say why. -->
        <p class="ap-busy" role="status"><i class="ap-spin" aria-hidden="true"></i>{{ k | translate }}</p>
      }
      <ul class="ap-list" [attr.aria-busy]="busy() ? 'true' : null">
        @for (t of targets().operations; track t.id; let first = $first) {
          <li>
            <button type="button" class="ap-row" data-target="op" [disabled]="busy()" (click)="pick(t.id)">
              <svg class="ap-i" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.nachschub; track $index) { <path [attr.d]="d" /> }</svg>
              <span class="ap-pn">
                <b>{{ t.name }}</b>
                @if (first) { <small>{{ 'pathCtl.assign.newest' | translate }}</small> }
              </span>
              @if (t.einsaetzeTotal > 0) {
                <span class="mut" aria-hidden="true">{{ t.einsaetzeDone }}/{{ t.einsaetzeTotal }}</span>
                <span class="seg" aria-hidden="true">@for (m of marks(t.einsaetzeDone, t.einsaetzeTotal); track $index) { <i [class.on]="m"></i> }</span>
                <span class="sc-sr-only">{{ 'pathCtl.assign.progress' | translate: { done: t.einsaetzeDone, total: t.einsaetzeTotal } }}</span>
              } @else {
                <span class="mut">{{ 'pathCtl.assign.noEinsatz' | translate }}</span>
              }
            </button>
          </li>
        }
        <li>
          <button type="button" class="ap-row new" data-target="new" [disabled]="busy() || !targets().canCreate" (click)="pick('new')">
            <svg class="ap-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            <span class="ap-pn">
              <b>{{ 'pathCtl.assign.new' | translate }}</b>
              @if (!targets().canCreate && targets().blockKey; as why) {
                <small class="why">{{ why | translate }}</small>
              } @else {
                <small class="hint">{{ 'pathCtl.assign.newHint' | translate }}</small>
              }
            </span>
          </button>
        </li>
      </ul>
      <p class="mut ap-foot">
        {{ 'pathCtl.assign.slots' | translate: { used: targets().slotsUsed, max: targets().slotsMax } }} ·
        {{ 'pathCtl.assign.planHint' | translate }}
        <a class="ap-link" [routerLink]="hqRoot" fragment="planen" (click)="leave.emit($event)">{{ 'pathCtl.assign.inHq' | translate }}</a>
      </p>
    </sc-popup>
  `,
  styles: [`
    :host { position: relative; display: block; inline-size: min(360px, calc(100vw - 16px)); }
    /* Phones: in the flow under the button, as wide as the station (B10). */
    :host(.inline) { inline-size: 100%; margin-block-start: 10px; }
    .ap-pop { display: block; }
    .ap-pop ::ng-deep .scp-frame { inline-size: 100%; }
    /* The caret hangs the picker on "Zuordnen" (B6): the frame's own fill and rule, drawn over its edge. */
    .ap-caret {
      position: absolute; z-index: 1; inset-inline-start: 18px; inline-size: 12px; block-size: 12px; transform: rotate(45deg);
      background: var(--sc-sub-fill, var(--sc-bg-1)); border: 1px solid var(--sc-sub-rule, var(--sc-border));
      pointer-events: none;
    }
    :host([data-caret='top']) .ap-caret { inset-block-start: -6px; border-inline-end-color: transparent; border-block-end-color: transparent; }
    :host([data-caret='bottom']) .ap-caret { inset-block-end: -6px; border-inline-start-color: transparent; border-block-start-color: transparent; }

    .mut { color: var(--sc-fg-2); font-size: 0.75rem; }
    .ap-qty { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; margin-block-end: 10px; }
    .st { display: inline-flex; align-items: center; gap: 2px; flex: none; }
    .st button {
      inline-size: max(28px, var(--sc-tap-min, 0px)); block-size: max(28px, var(--sc-tap-min, 0px)); padding: 0; cursor: pointer; font: inherit;
      border: 1px solid var(--sc-border); border-radius: 7px; background: none; color: var(--sc-fg-1);
    }
    .st button:hover:not(:disabled) { color: var(--sc-accent); border-color: var(--sc-accent); }
    .st button:disabled { opacity: 0.4; cursor: default; }
    .st b { min-inline-size: 28px; text-align: center; font-weight: 500; color: var(--sc-fg-0); font-variant-numeric: tabular-nums; }

    .ap-list { display: flex; flex-direction: column; gap: 6px; margin: 0 0 10px; padding: 0; list-style: none; }
    .ap-row {
      display: flex; align-items: center; gap: 10px; inline-size: 100%; min-block-size: max(38px, var(--sc-tap-min, 0px)); padding: 6px 10px;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 18%, var(--sc-border)); border-radius: 8px; background: none;
      color: var(--sc-fg-1); font: inherit; text-align: start; cursor: pointer;
    }
    .ap-row:hover:not(:disabled) { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .ap-row:disabled { cursor: default; opacity: 0.6; }
    .ap-row.new { border-style: dashed; }
    .ap-busy { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; color: var(--sc-fg-1); font-size: 0.75rem; }
    .ap-spin { inline-size: 12px; block-size: 12px; flex: none; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--sc-accent) 25%, transparent);
      border-block-start-color: var(--sc-accent); animation: ap-spin 0.8s linear infinite; }
    @keyframes ap-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .ap-spin { animation: none; } }
    .ap-i { inline-size: 16px; block-size: 16px; flex: none; fill: none; stroke: var(--sc-accent); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .ap-pn { display: flex; flex-direction: column; flex: 1 1 auto; min-inline-size: 0; }
    /* Names wrap, never cut (B10; a name is at most 28 characters). */
    .ap-pn b { font-weight: 500; color: var(--sc-fg-0); line-height: 1.25; overflow-wrap: anywhere; }
    .ap-pn small { color: var(--sc-fg-2); font-size: 0.6875rem; line-height: 1.2; }
    .ap-pn small.why { color: var(--sc-warning); }
    .seg { display: inline-flex; align-items: center; gap: 3px; flex: none; }
    .seg i { display: block; inline-size: 12px; block-size: 5px; border-radius: 3px; background: color-mix(in srgb, var(--sc-accent) 20%, transparent); }
    .seg i.on { background: var(--sc-accent); }
    .ap-foot { margin: 0; font-size: 0.71875rem; }
    .ap-link { color: var(--sc-accent); text-decoration: none; }
    .ap-link:hover { text-decoration: underline; text-underline-offset: 3px; }
    .ap-row:focus-visible, .st button:focus-visible, .ap-link:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }

    @media (max-width: 720px) {
      .ap-row.new .hint { display: none; }
    }
  `],
})
export class ItemPathAssignComponent {
  readonly name = input('');
  /** Free pieces of the wish: the stepper's top and its preset (R2: "immer das maximale vorgeschlagne"). */
  readonly free = input.required<number>();
  /** Pieces already assigned: the caption says "von N freien" then instead of "von N gewünschten". */
  readonly assigned = input(0);
  readonly targets = input.required<AssignTargets>();
  readonly busy = input(false);
  /** Why the rows are off right now (`pathCtl.assign.loading` / `.working`); null = nothing to say. */
  readonly busyKey = input<string | null>(null);
  readonly inline = input(false);
  readonly caret = input<AssignCaret>('top');
  readonly returnFocus = input<HTMLElement | null>(null);

  readonly assign = output<AssignPick>();
  readonly closed = output<void>();
  /** The "im HQ" link was clicked (the parent closes the picker on a plain click). */
  readonly leave = output<MouseEvent>();

  readonly icons = PATH_ICONS;
  readonly hqRoot = [HQ_ROOT];
  readonly qty = linkedSignal(() => Math.max(1, this.free()));

  marks(done: number, total: number): boolean[] {
    return progressMarks(done, total);
  }

  step(delta: number): void {
    this.qty.set(Math.min(Math.max(1, this.qty() + delta), Math.max(1, this.free())));
  }

  pick(target: string | 'new'): void {
    if (this.busy()) return;
    this.assign.emit({ target, qty: this.qty() });
  }
}
