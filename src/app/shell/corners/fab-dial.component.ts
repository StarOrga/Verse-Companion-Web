import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, input, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { AnalyticsService } from '../../core/analytics.service';
import { BETA_AREAS, BetaArea } from '../../core/beta.service';
import { FeedbackFabPrefsService } from '../../core/feedback-fab-prefs.service';
import { ViewportModeService } from '../../core/viewport-mode';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { BetaPanelComponent } from './beta-panel.component';
import { PageCornerService } from './page-corner.service';

/** The page scrolls this far (px) while the dial is open: it folds itself away. */
const SCROLL_CLOSE_PX = 12;

interface DialItem {
  readonly id: string;
  readonly labelKey: string;
  /** 24x24 stroked path data; `beta` draws the β mark instead. */
  readonly icon: string | null;
  readonly collab?: boolean;
  readonly run: () => void;
}

const VIEW_TO_CLASSIC = 'M4 5h7v14H4zM14 5h6v6h-6zM14 14h6v5h-6z';
const VIEW_TO_HOLO = 'M12 4l7 4-7 4-7-4 7-4zM5 8v6l7 4 7-4V8M3 20h18';

/**
 * The Tools dial (phone, compact landscape and coarse tablet): the β switch, the page's view switch and whatever else a
 * page registered through `PageCornerService.register()` (share ...) folded into ONE 44px button above the
 * feedback launcher, instead of three more floating discs. Closed it is a single quiet circle; open, up to
 * three items fan upward with a label chip each. On tablet and desktop it is not drawn: there the β FAB and
 * the page's own FABs stay as they were (`html[data-sc-phone|compact]` hides those, styles.scss).
 *
 * Folds on: an item pick, a pointer outside, Escape, a page scroll beyond 12px, a route change. It hides
 * while a bottom sheet is above its peek (`html[data-sc-sheet]`), a large popup is open or a stage is
 * immersive, and in compact it follows the header away on scroll-down (`html[data-sc-chrome='hidden']`).
 * Motion is opacity + `translate` only; stagger 40ms x item; instant under reduced motion.
 */
@Component({
  selector: 'sc-fab-dial',
  standalone: true,
  imports: [TranslatePipe, ScPopupComponent, ScTooltipDirective, BetaPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown()) {
      <aside class="dial" [class.open]="open()" role="group" [attr.aria-label]="'corner.dial.group' | translate">
        <ul class="items" [attr.inert]="open() ? null : ''">
          @for (it of items(); track it.id; let i = $index) {
            <li [style.--i]="items().length - 1 - i">
              <span class="chip">{{ it.labelKey | translate }}</span>
              <button type="button" class="item" [class.collab]="it.collab"
                      [attr.aria-label]="it.labelKey | translate" (click)="pick(it)">
                @if (it.icon; as d) {
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="d" /></svg>
                } @else {
                  <span class="mark" aria-hidden="true">β</span>
                }
              </button>
            </li>
          }
        </ul>
        <button type="button" class="main" [attr.aria-expanded]="open()"
                [attr.aria-label]="(open() ? 'corner.dial.close' : 'corner.dial.open') | translate"
                [scTooltip]="(open() ? 'corner.dial.close' : 'corner.dial.open') | translate" scTooltipTier="label"
                (click)="toggle()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" />
          </svg>
        </button>
        @if (betaOpen()) {
          <div class="panel">
            <sc-popup kind="panel" size="menu" [title]="'beta.chip.title' | translate" [access]="staff() ? 'collab' : null"
                      [backClose]="false" (closed)="betaOpen.set(false)">
              <sc-beta-panel [areas]="betaAreas()" [staff]="staff()" />
            </sc-popup>
          </div>
        }
      </aside>
    }
  `,
  styles: [`
    :host { display: contents; }
    .dial {
      position: fixed; z-index: 59; /* with the β FAB it replaces: above page furniture, below the modal band */
      inset-inline-end: calc(var(--sc-lane-right) + (var(--sc-fab-size) - var(--sc-fab-mini)) / 2);
      bottom: var(--sc-dial-bottom);
      display: flex; flex-direction: column; align-items: flex-end; gap: var(--sc-space-2);
      transition: opacity var(--sc-t-base) var(--sc-e-out), translate var(--sc-t-base) var(--sc-e-out);
    }
    /* Out of the way (bottom sheet above peek, large popup, immersive stage, chrome scrolled away in compact): styles.scss, "MOBILE CHROME" (global, :host-context is not in every engine). */
    .main, .item {
      display: inline-grid; place-items: center; box-sizing: border-box;
      width: var(--sc-fab-mini); height: var(--sc-fab-mini); min-width: var(--sc-fab-mini); min-height: var(--sc-fab-mini);
      border-radius: 50%; padding: 0; cursor: pointer; font: inherit;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1); color: var(--sc-accent);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    }
    .main[aria-expanded='true'], .item:hover { background: color-mix(in srgb, var(--sc-accent) 14%, var(--sc-bg-1)); border-color: var(--sc-accent); }
    /* Elevated access, a colour and never words: the β switch is for staff only (collab copper). */
    .item.collab { color: var(--sc-accent-collab); border-color: color-mix(in srgb, var(--sc-accent-collab) 55%, var(--sc-border)); }
    .item.collab:hover { background: color-mix(in srgb, var(--sc-accent-collab) 14%, var(--sc-bg-1)); border-color: var(--sc-accent-collab); }
    .main:focus-visible, .item:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .main svg { fill: currentColor; stroke: none; }
    .mark { font-family: var(--sc-font-display); font-weight: 700; font-size: 1.1rem; }
    .items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; align-items: flex-end; gap: var(--sc-space-2); }
    .items li {
      display: flex; align-items: center; gap: var(--sc-space-2);
      opacity: 0; translate: 0 12px; pointer-events: none;
      transition: opacity var(--sc-t-base) var(--sc-e-out), translate var(--sc-t-base) var(--sc-e-out);
    }
    .open .items li { opacity: 1; translate: 0 0; pointer-events: auto; transition-delay: calc(var(--i) * 40ms); }
    .chip {
      padding: 6px 10px; border-radius: 999px; font-size: max(13px, var(--sc-fs-floor)); line-height: 1.2; white-space: nowrap;
      background: var(--sc-bg-1); color: var(--sc-fg-0); border: 1px solid var(--sc-border);
    }
    .panel { display: block; }
    @media (prefers-reduced-motion: reduce) {
      .dial, .items li { transition: none; }
      .open .items li { transition-delay: 0s; }
    }
  `],
})
export class FabDialComponent {
  private readonly corner = inject(PageCornerService);
  private readonly roles = inject(RoleService);
  private readonly fabPrefs = inject(FeedbackFabPrefsService);
  private readonly analytics = inject(AnalyticsService);
  private readonly mode = inject(ViewportModeService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The area the reader is in (`betaArea()` of the shell); viewers get only that switch. */
  readonly area = input<BetaArea | null>(null);
  protected readonly open = signal(false);
  protected readonly betaOpen = signal(false);
  protected readonly staff = computed(() => this.roles.isCollaborator());
  protected readonly betaAreas = computed<readonly BetaArea[]>(() => {
    if (this.staff()) return this.fabPrefs.show() ? BETA_AREAS : [];
    const a = this.area();
    return a ? [a] : [];
  });

  protected readonly items = computed<readonly DialItem[]>(() => {
    const list: DialItem[] = [];
    const view = this.corner.view();
    if (view) {
      const holo = view.holo();
      list.push({ id: 'view', labelKey: holo ? 'corner.view.toClassic' : 'corner.view.toHolo', icon: holo ? VIEW_TO_CLASSIC : VIEW_TO_HOLO, run: () => view.toggle() });
    }
    for (const a of this.corner.actions()) {
      if ((a.order ?? 50) < 100) list.push({ id: a.id, labelKey: a.labelKey, icon: a.icon, run: a.run });
    }
    if (this.betaAreas().length) {
      list.push({ id: 'beta', labelKey: 'corner.dial.beta', icon: null, collab: this.staff(), run: () => this.betaOpen.set(!this.betaOpen()) });
    }
    for (const a of this.corner.actions()) {
      if ((a.order ?? 50) >= 100) list.push({ id: a.id, labelKey: a.labelKey, icon: a.icon, run: a.run });
    }
    return list;
  });

  /** Drawn on a phone and on a phone on its side, and only with something to offer. */
  protected readonly shown = computed(() => (this.mode.phone() || this.mode.compact() || this.mode.tablet()) && this.items().length > 0);

  private scrollStart = 0;

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) this.fold();
    });
    // Nothing left to show: fold, so it does not come back open.
    effect(() => {
      if (!this.shown()) this.fold();
    });
    if (typeof window !== 'undefined') {
      const onScroll = () => {
        if (this.open() && Math.abs(window.scrollY - this.scrollStart) > SCROLL_CLOSE_PX) this.fold();
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      inject(DestroyRef).onDestroy(() => window.removeEventListener('scroll', onScroll));
    }
  }

  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.scrollStart = typeof window === 'undefined' ? 0 : window.scrollY;
      this.analytics.track('app:tools_dial_open', { mode: this.mode.compact() ? 'compact' : this.mode.tablet() ? 'tablet' : 'phone', actions: this.items().length });
    }
  }

  protected pick(it: DialItem): void {
    it.run();
    // β keeps its panel open; every other item folds the fan.
    if (it.id !== 'beta') this.fold();
    else this.open.set(false);
  }

  private fold(): void {
    if (this.open()) this.open.set(false);
    if (this.betaOpen()) this.betaOpen.set(false);
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onOutside(ev: Event): void {
    if (!this.open() && !this.betaOpen()) return;
    const root = this.host.nativeElement.querySelector('.dial');
    if (root && !root.contains(ev.target as Node)) this.fold();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.open()) return;
    this.fold();
    (this.host.nativeElement.querySelector('.main') as HTMLElement | null)?.focus();
  }
}
