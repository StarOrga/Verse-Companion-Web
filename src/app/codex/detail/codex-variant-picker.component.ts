import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, computed, inject, input, signal, viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { CodexKind } from '../codex.service';

/** One pickable record of a skin or edition family. */
export interface VariantPickerOption {
  classNameSlug: string;
  /** Livery / edition name, or null for the base record ("Standard"). */
  label: string | null;
}

let nextId = 0;

/**
 * The skin picker (feedback d5e39f86) and the edition picker (feedback
 * 77ecad2a) of the codex detail page, extracted from codex-detail (AUD-090,
 * AUD-116) where the same block stood six times: hero body, tool row and the
 * Holotable drawer, once per variant.
 *
 * The list is a native popover in the top layer (#376). It used to be a
 * child of a details fold, so in the stage action row it hung below the row
 * and was cut off by what came after it or by the viewport edge. In the top
 * layer no ancestor overflow or stacking context can clip it; on open it is
 * placed under the trigger, flips above it when there is more room there,
 * and stays inside the viewport with its own scroll. The browser handles
 * Escape, the outside click and focus return. Every option is a real anchor
 * to that record's own detail route, so a livery keeps a shareable URL and a
 * middle click still opens a tab. The parent keeps the "more than one
 * option" gate and the order per place; this component only renders.
 *
 * Host is display:contents so the trigger sits in the parent's flex row
 * exactly as before. In the tool row the parent sets the host class
 * in-toolrow, which switches on the compact tool-row sizing.
 */
@Component({
  selector: 'sc-codex-variant-picker',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="picker" [class.edition-picker]="variant() === 'edition'" [class.skin-picker]="variant() === 'skin'">
      <button #trigger type="button" class="sp-trigger" [attr.popovertarget]="listId"
              [attr.aria-expanded]="open()" [attr.aria-controls]="listId">
        <span class="sp-label">{{ (prefix() + '.label') | translate }}</span>
        <span class="sp-current">{{ current() ?? ((prefix() + '.standard') | translate) }}</span>
        <span class="sp-count">{{ (prefix() + '.count') | translate: { count: options().length } }}</span>
      </button>
      <ul #list class="sp-list" popover="auto" [id]="listId" (toggle)="onToggle($event)">
        @for (o of options(); track o.classNameSlug) {
          <li>
            <a class="sp-opt"
               [class.current]="o.classNameSlug === currentSlug()"
               [attr.aria-current]="o.classNameSlug === currentSlug() ? 'true' : null"
               [routerLink]="['/codex', kind(), o.classNameSlug]"
               (click)="close()">
              {{ o.label ?? ((prefix() + '.standard') | translate) }}
            </a>
          </li>
        }
      </ul>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .picker { margin-top: 10px; max-width: 320px; }
    .sp-trigger {
      display: flex; align-items: center; gap: 8px; cursor: pointer; width: 100%;
      padding: 7px 12px; border-radius: 8px; font: inherit; color: inherit; text-align: start;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      transition: border-color 0.16s;
    }
    .sp-trigger::after { content: '▾'; margin-left: auto; color: var(--sc-fg-2); }
    .sp-trigger[aria-expanded='true']::after { content: '▴'; }
    .sp-trigger:hover { border-color: var(--sc-accent); }
    .sp-trigger:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    .sp-label { font-size: max(0.6rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .sp-current { font-size: max(0.82rem, var(--sc-fs-floor)); color: var(--sc-fg-0); }
    .sp-count { font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    /* Top layer: the UA centres a popover (inset 0, margin auto); place()
       sets top/left/width/max-height from the trigger instead. */
    .sp-list {
      position: fixed; inset: auto; margin: 0; box-sizing: border-box;
      list-style: none; padding: 4px; max-height: 260px; overflow-y: auto; overscroll-behavior: contain;
      border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      color: var(--sc-fg-1); box-shadow: 0 10px 28px color-mix(in srgb, var(--sc-bg-0) 70%, transparent);
    }
    .sp-opt {
      display: block; padding: 7px 10px; border-radius: 6px;
      color: var(--sc-fg-1); text-decoration: none; font-size: max(0.82rem, var(--sc-fs-floor));
    }
    .sp-opt:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); }
    .sp-opt.current { color: var(--sc-accent); font-weight: 600; }

    /* Tool row (WERKZEUGZEILE): the concept has no picker of its own; its
       dropdown vocabulary is the mock select (part-02:193 select.m-sel): a 3px
       rectangle, 10.5px type, .25rem/.4rem of padding. The 48px touch floor
       stays for coarse pointers and only a mouse gets the drawn height. */
    :host(.in-toolrow) .picker { margin-top: 0; max-width: 260px; }
    :host(.in-toolrow) .sp-trigger { min-height: 48px; padding: 3px 6px; gap: 6px; border-radius: 3px; }
    @media (pointer: fine) {
      :host(.in-toolrow) .sp-trigger { min-height: 24px; }
    }
    :host(.in-toolrow) .sp-label,
    :host(.in-toolrow) .sp-current,
    :host(.in-toolrow) .sp-count { font-size: max(10.5px, var(--sc-fs-floor)); }
  `],
})
export class CodexVariantPickerComponent {
  readonly variant = input.required<'edition' | 'skin'>();
  readonly kind = input.required<CodexKind>();
  readonly currentSlug = input.required<string>();
  readonly options = input.required<readonly VariantPickerOption[]>();
  /** The open record's label, or null while the base record is open. */
  readonly current = input<string | null>(null);

  /** i18n prefix: codex.editionPicker.* or codex.skinPicker.* */
  protected readonly prefix = computed(() =>
    this.variant() === 'edition' ? 'codex.editionPicker' : 'codex.skinPicker',
  );

  protected readonly listId = `sc-variant-list-${++nextId}`;
  protected readonly open = signal(false);

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly list = viewChild.required<ElementRef<HTMLUListElement>>('list');
  private readonly zone = inject(NgZone);
  private readonly follow = (): void => this.place();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.unfollow();
      this.close();
    });
  }

  protected onToggle(ev: Event): void {
    const opened = (ev as ToggleEvent).newState === 'open';
    this.open.set(opened);
    if (!opened) {
      this.unfollow();
      return;
    }
    this.place();
    // The page scrolls under an open list (the shell's content box or the
    // window): keep the list on its trigger instead of floating free.
    this.zone.runOutsideAngular(() => {
      window.addEventListener('scroll', this.follow, { capture: true, passive: true });
      window.addEventListener('resize', this.follow, { passive: true });
    });
  }

  protected close(): void {
    const el = this.list().nativeElement;
    if (el.matches(':popover-open')) el.hidePopover();
  }

  /** Under the trigger, or above it when there is more room there; inside the viewport either way. */
  private place(): void {
    const list = this.list().nativeElement;
    const r = this.trigger().nativeElement.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const edge = 8;
    const gap = 4;
    const cap = 260;
    const width = Math.min(Math.max(r.width, 240), 320, vw - 2 * edge);
    const left = Math.min(Math.max(r.left, edge), vw - width - edge);
    list.style.width = `${width}px`;
    list.style.left = `${left}px`;
    list.style.maxHeight = `${cap}px`;
    const natural = Math.min(list.scrollHeight + 2, cap);
    const below = vh - r.bottom - gap - edge;
    const above = r.top - gap - edge;
    const down = natural <= below || below >= above;
    const room = Math.max(down ? below : above, 120);
    const height = Math.min(natural, room);
    list.style.maxHeight = `${Math.min(cap, room)}px`;
    list.style.top = `${down ? r.bottom + gap : r.top - gap - height}px`;
  }

  private unfollow(): void {
    window.removeEventListener('scroll', this.follow, { capture: true });
    window.removeEventListener('resize', this.follow);
  }
}
