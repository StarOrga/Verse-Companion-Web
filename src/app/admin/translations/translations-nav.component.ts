import { ChangeDetectionStrategy, Component, DestroyRef, NgZone, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BetaService } from '../../core/beta.service';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { pageScrollY } from '../../core/page-scroll-y';
import { onScrollTick } from '../../core/scroll-tick';
import { SectionRailComponent, SectionRailGo, SectionRailItem } from '../../shared/section-rail/section-rail.component';
import { translateTick } from '../../shared/section-rail/translate-tick';

export type TranslationsTab = 'overview' | 'cards' | 'sources' | 'outreach' | 'alerts' | 'glossary';
export const TRANSLATIONS_TABS: readonly TranslationsTab[] = ['overview', 'cards', 'sources', 'outreach', 'alerts', 'glossary'];

/** Icons of the six sections (24x24, stroked) — the concept's rail (karteikarten-neu r5). */
export const TRANSLATIONS_TAB_ICONS: Readonly<Record<TranslationsTab, string>> = {
  overview: 'M4 4h7v7H4z M13 4h7v4h-7z M13 10h7v10h-7z M4 13h7v7H4z',
  cards: 'M8 4h10a2 2 0 0 1 2 2v11 M5 8h10a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 15 20H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 8z',
  sources: 'M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  outreach: 'M4 13l2.5-8h11l2.5 8 M4 13v6h16v-6 M4 13h5l1 2h4l1-2h5',
  alerts: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 20a2 2 0 0 0 4 0',
  glossary: 'M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5z M5 20.5A2.5 2.5 0 0 1 7.5 18H19v3H7.5',
};

/** Real URL of a section: the overview is the bare page, every other section a `?tab=` deep link. */
export function translationsTabHref(tab: TranslationsTab): string {
  return tab === 'overview' ? '/admin/translations' : `/admin/translations?tab=${tab}`;
}

/** The tab a `?tab=` value names; anything unknown is the overview. */
export function parseTranslationsTab(v: string | null | undefined): TranslationsTab {
  return (TRANSLATIONS_TABS as readonly string[]).includes(v ?? '') ? (v as TranslationsTab) : 'overview';
}

/** A plain left click stays in the page (router); modified clicks keep the browser's own behaviour. */
function goTo(router: Router, ev: MouseEvent, tab: TranslationsTab): void {
  if (!isPlainLeftClick(ev)) return;
  ev.preventDefault();
  void router.navigateByUrl(translationsTabHref(tab));
}

/**
 * The six sections of /admin/translations as the shared section rail at the left screen edge — the same rail as
 * HQ (concept karteikarten-neu r2 pin „mach dieses menü genau links am seitenrand wie in hq“). Desktop only
 * (≥ 1024 px); narrower viewports get {@link TranslationsPageBarComponent}. Admin-only page: the section in view is
 * marked in the elevated-access colour (`--sc-accent-hot`), never with words.
 */
@Component({
  selector: 'sc-translations-rail',
  standalone: true,
  imports: [TranslatePipe, SectionRailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<sc-section-rail [items]="items()" [ariaLabel]="'admin.translations.rail.label' | translate" (go)="onGo($event)" />`,
  styles: [
    `
      :host { display: none; --sc-accent: var(--sc-accent-hot); }
      @media (min-width: 1024px) { :host { display: block; } }
    `,
  ],
})
export class TranslationsRailComponent {
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  readonly active = input<TranslationsTab>('overview');
  private readonly lang = translateTick(this.translate);

  protected readonly items = computed<SectionRailItem[]>(() => {
    this.lang();
    return TRANSLATIONS_TABS.map((t) => {
      const name = this.translate.instant('admin.translations.tabs.' + t) as string;
      return {
        id: t,
        href: translationsTabHref(t),
        label: name,
        icon: TRANSLATIONS_TAB_ICONS[t],
        active: this.active() === t,
        ariaLabel: this.translate.instant('admin.translations.rail.goto', { page: name }) as string,
        current: 'page' as const,
      };
    });
  });

  protected onGo(ev: SectionRailGo): void {
    goTo(this.router, ev.event, ev.item.id as TranslationsTab);
  }
}

/** Scroll distance (px) in one direction before the bar follows it (as the HQ page bar). */
const BAR_SLACK_PX = 12;

/**
 * Phone / tablet bottom bar of the six sections (below 1024 px), modelled on the HQ page bar: icon + short label
 * anchors in a `.sc-dock-phone` bar clear of the safe area and the feedback launcher's lane; hides on scroll down,
 * returns on scroll up. On narrow phones only the current section keeps its name.
 */
@Component({
  selector: 'sc-translations-page-bar',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.hidden]': 'hidden()', '[class.above-bar]': 'shellOn()' },
  template: `
    <nav class="bar sc-dock-phone" [attr.aria-label]="'admin.translations.rail.label' | translate">
      @for (t of tabs; track t) {
        <a class="tab" [href]="href(t)" (click)="go($event, t)" [attr.data-test]="'bar-' + t"
           [attr.aria-label]="'admin.translations.tabs.' + t | translate"
           [attr.aria-current]="active() === t ? 'page' : null">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons[t]" /></svg>
          <span>{{ 'admin.translations.tabs.' + t | translate }}</span>
        </a>
      }
    </nav>
  `,
  styles: [
    `
      :host { display: none; }
      @media (max-width: 1023px) {
        :host {
          display: block; position: sticky; bottom: calc(12px + var(--sc-safe-bottom, 0px)); z-index: 4;
          margin-top: var(--sc-space-4, 16px); margin-inline-end: var(--sc-fab-clear-inline, 0px);
          pointer-events: none; transition: translate 0.25s ease;
        }
        :host(.hidden) { translate: 0 calc(100% + var(--sc-float-bottom, 12px) + 12px); }
      }
      .bar {
        position: static; pointer-events: auto; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: var(--sc-space-1, 4px);
        padding: var(--sc-space-1, 4px); border: 1px solid var(--sc-border); border-radius: 14px;
        background: color-mix(in srgb, var(--sc-bg-1) 96%, transparent);
      }
      .tab {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-width: 0; min-height: 48px;
        padding: 4px 2px; border-radius: 10px; color: var(--sc-fg-2); text-decoration: none; font-size: max(0.7rem, var(--sc-fs-floor));
      }
      .tab span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tab svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .tab[aria-current='page'] { color: var(--sc-accent-hot); background: color-mix(in srgb, var(--sc-accent-hot) 12%, transparent); }
      .tab:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring-inset); }
      @media (max-width: 720px) {
        :host(.above-bar) { bottom: calc(var(--sc-float-bottom, 12px) + var(--sc-bar-h, 56px) + var(--sc-space-2, 8px)); margin-inline-end: 0; }
        :host(.above-bar) .bar { margin-inline-end: 0; }
        :host(.above-bar.hidden) { translate: 0 calc(100% + var(--sc-float-bottom, 12px) + var(--sc-bar-h, 56px) + var(--sc-space-2, 8px) + 12px); }
      }
      /* Six labels do not fit a phone row: only the current section keeps its name (the aria-label names the rest). */
      @media (max-width: 600px) {
        .bar { display: flex; }
        .tab { flex: 1 1 0; padding-inline: 2px; }
        .tab span { display: none; }
        .tab[aria-current='page'] { flex: 0 0 auto; padding-inline: 8px; }
        .tab[aria-current='page'] span { display: inline; overflow: visible; }
      }
      @media (orientation: landscape) and (max-height: 500px) {
        :host, :host(.above-bar) { position: static; translate: 0 0; margin-inline-end: 0; }
        .bar { display: flex; overflow-x: auto; scrollbar-width: none; }
        .tab { flex: 1 0 auto; flex-direction: row; gap: 6px; min-height: 44px; padding-inline: 12px; }
        .tab span { display: inline !important; }
      }
      @media (prefers-reduced-motion: reduce) { :host { transition: none; } }
    `,
  ],
})
export class TranslationsPageBarComponent {
  private readonly router = inject(Router);
  readonly active = input<TranslationsTab>('overview');
  readonly hidden = signal(false);
  protected readonly shellOn = inject(BetaService).isEnabled('shell');
  protected readonly tabs = TRANSLATIONS_TABS;
  protected readonly icons = TRANSLATIONS_TAB_ICONS;
  protected readonly href = translationsTabHref;

  constructor() {
    const zone = inject(NgZone);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      let last = pageScrollY();
      let run = 0;
      const onScroll = () => {
        const y = pageScrollY();
        const dy = y - last;
        last = y;
        run = Math.sign(dy) === Math.sign(run) ? run + dy : dy;
        if (y < BAR_SLACK_PX) {
          if (this.hidden()) zone.run(() => this.hidden.set(false));
        } else if (run > BAR_SLACK_PX && !this.hidden()) {
          zone.run(() => this.hidden.set(true));
        } else if (run < -BAR_SLACK_PX && this.hidden()) {
          zone.run(() => this.hidden.set(false));
        }
      };
      destroyRef.onDestroy(onScrollTick({ read: onScroll }));
    });
  }

  protected go(ev: MouseEvent, tab: TranslationsTab): void {
    goTo(this.router, ev, tab);
  }
}
