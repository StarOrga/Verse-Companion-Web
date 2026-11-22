// #354 storage search (concept d83b72d8, round 4 a): the small Standort button right of the tab bar.
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HqHereService } from './hq-here.service';
import { placeSuggestions } from './hq-stock-search.model';

@Component({
  selector: 'sc-hq-here-button',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'outside($event)' },
  template: `
    <button #trigger type="button" class="here" [class.app]="here.current()?.source === 'app'" [class.manual]="here.current()?.source === 'manual'"
            aria-haspopup="dialog" [attr.aria-expanded]="open()"
            [scTooltip]="tip() | translate: { place: here.current()?.label ?? '' }" scTooltipTier="info" (click)="toggle()">
      <i class="dot" aria-hidden="true"></i>
      <span class="nm">{{ here.current()?.label ?? ('hq.bestand.here.none' | translate) }}</span>
    </button>
    @if (open()) {
      <div class="pop" role="dialog" [attr.aria-label]="'hq.bestand.here.title' | translate" (keydown.escape)="close(true)">
        @if (here.current()?.source === 'app') { <p class="note">{{ 'hq.bestand.here.appWins' | translate }}</p> }
        <input #field class="field" type="text" [value]="text()" (input)="text.set(field.value)" (keydown.enter)="pickFirst()"
               [attr.aria-label]="'hq.bestand.here.field' | translate" [placeholder]="'hq.bestand.here.field' | translate" autocomplete="off" />
        <ul class="list" role="listbox" [attr.aria-label]="'hq.bestand.here.title' | translate">
          @for (s of options(); track s) {
            <li role="option" [attr.aria-selected]="here.manual() === s"><button type="button" (click)="pick(s)">{{ s }}</button></li>
          }
          <li role="option" [attr.aria-selected]="!here.manual()"><button type="button" class="none" (click)="pick(null)">{{ 'hq.bestand.here.clear' | translate }}</button></li>
        </ul>
      </div>
    }
  `,
  styles: [
    `
      :host { position: relative; display: inline-flex; flex: 0 0 auto; }
      /* ds-ok: fixed max width so a long place name never pushes the tab bar (concept round 4 a). */
      .here { display: inline-flex; align-items: center; gap: var(--sc-space-2, 8px); max-width: 180px; min-height: 34px; padding: 0 12px; border: 1px solid var(--sc-border); border-radius: 999px; background: var(--sc-bg-0); color: var(--sc-fg-2); font: inherit; font-size: 0.82rem; cursor: pointer; }
      .here:hover { color: var(--sc-fg); }
      .here:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
      .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
      .dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--sc-fg-2); box-sizing: border-box; }
      .app .dot { background: var(--sc-success, #4ade80); border-color: var(--sc-success, #4ade80); }
      .manual .dot { background: var(--sc-accent); border-color: var(--sc-accent); }
      .app, .manual { color: var(--sc-fg); }
      .pop { position: absolute; z-index: 20; top: calc(100% + 6px); right: 0; width: 260px; padding: var(--sc-space-2, 8px); border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-1); box-shadow: 0 12px 32px rgb(0 0 0 / 0.5); display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .note { margin: 0; color: var(--sc-fg-2); font-size: 0.82rem; }
      .field { min-height: 36px; padding: 0 10px; border: 1px solid var(--sc-border); border-radius: 4px; background: var(--sc-bg-0); color: var(--sc-fg); font: inherit; }
      .field:focus-visible { outline: 1px solid transparent; border-color: var(--sc-accent); box-shadow: var(--sc-focus-ring); }
      .list { margin: 0; padding: 0; list-style: none; max-height: 260px; overflow-y: auto; }
      .list button { display: flex; width: 100%; min-height: 36px; align-items: center; padding: 0 10px; border: 0; border-radius: 4px; background: transparent; color: var(--sc-fg); font: inherit; text-align: start; cursor: pointer; }
      .list button:hover, .list [aria-selected='true'] button { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
      .list button:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring-inset); }
      .list .none { color: var(--sc-fg-2); }
      @media (pointer: coarse) { .here, .list button { min-height: 48px; } }
    `,
  ],
})
export class HqHereButtonComponent {
  protected readonly here = inject(HqHereService);
  private readonly host = inject(ElementRef<HTMLElement>);
  /** Locations the reader's stock names, so their own places are suggested too. */
  readonly known = input<readonly string[]>([]);
  protected readonly open = signal(false);
  protected readonly text = signal('');
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly options = computed(() => placeSuggestions(this.known(), this.text(), { placesOnly: true, max: 12 }));
  protected readonly tip = computed(() => {
    const c = this.here.current();
    return !c ? 'hq.bestand.here.tipNone' : c.source === 'app' ? 'hq.bestand.here.tipApp' : 'hq.bestand.here.tipManual';
  });

  protected toggle(): void {
    if (this.open()) return this.close(false);
    this.text.set('');
    this.open.set(true);
    setTimeout(() => this.field()?.nativeElement.focus());
  }

  protected close(refocus: boolean): void {
    this.open.set(false);
    if (refocus) this.trigger()?.nativeElement.focus();
  }

  protected pick(name: string | null): void {
    this.here.setManual(name);
    this.close(true);
  }

  protected pickFirst(): void {
    const first = this.options()[0];
    if (first) this.pick(first);
  }

  protected outside(e: Event): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }
}
