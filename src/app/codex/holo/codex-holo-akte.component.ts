import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AnalyticsService } from '../../core/analytics.service';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import type { BuyOption } from '../uex-shop.service';
import type { WikeloNeed } from './codex-holo-buy';
import { CodexHoloBuyTabComponent } from './codex-holo-buy-tab.component';

/** One fact line of the Akte (label key + the value as shown). */
export interface AkteFact {
  readonly labelKey: string;
  readonly value: string;
}

/** One livery tile: a paint of this very record (ship_skins). */
export interface AkteLivery {
  readonly id: string;
  readonly label: string;
  /** The livery's icon render; null = no picture (the Akte then shows the hologram look). */
  readonly imageUrl: string | null;
}

/** One edition tile: the same hull under another record or marketing name — a real anchor to that record. */
export interface AkteEdition {
  readonly classNameSlug: string;
  readonly label: string;
}

/** A leading "Label: value" line of a CIG description ("Hersteller: Aegis Dynamics", "Focus: Light Fighter"). */
const META_LINE = /^[ \t]*[^\s:][^:\n]{0,30}:[ \t]*[^\n]{0,60}\n+/;

/**
 * The Akte's prose (C20): CIG descriptions open with data lines — maker, focus, item type —
 * that the facts already show. Those leading "Label: value" lines go; the prose stays. A text
 * that is nothing but such lines is kept as it is.
 */
export function akteProse(raw: string): string {
  const all = (raw ?? '').replace(/\r\n?/g, '\n').trim();
  let s = all;
  for (let i = 0; i < 6; i++) {
    const m = META_LINE.exec(s);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  // Only data lines, or the last one without a line end: nothing to strip them from.
  return META_LINE.exec(s + '\n') && !s.includes('\n') && s.length <= 92 ? all : s.trim() || all;
}

/** Id of the factory paint in ship_skins: the official RSI image belongs to it. */
export const AKTE_STANDARD_LIVERY = 'standard';

/** The three tabs of the Akte's head; the last pick is remembered for every ship (one global preference). */
export type AkteTab = 'sheet' | 'text' | 'buy';
const AKTE_TABS: readonly AkteTab[] = ['sheet', 'text', 'buy'];
export const AKTE_TAB_PREF_KEY = 'sc.codex.holo.akteTab';

/**
 * The Akte view of the Holotisch (concept holotisch-feinschliff r4 d1, C20/C21; batch-galerie-akte-login-upload
 * B2): the official RSI / CIG image as it is (cover) — the hologram look when there is none — and on it ONE
 * fixed-size card top left (the same size whatever tab is open). Its head carries the tabs Datenblatt |
 * Beschreibung | Kaufen and the "Nur Bild" icon. Datenblatt: the facts, the Lackierung tiles, and in one row
 * "Vergleichen" + "Bei RSI ansehen ↗". Beschreibung: the prose, scrolling inside. Kaufen: where and for how much
 * (UEX), Wikelo, "Auf die Wunschliste". A livery tile swaps the image; an edition tile is a link to that record.
 */
@Component({
  selector: 'sc-codex-holo-akte',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ScTooltipDirective, ScActionDirective, CodexHoloBuyTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ak-bg" [class.holo]="!imageSrc()">
      @if (imageSrc(); as src) {
        <img class="ak-img" [src]="src" alt="" (error)="onImageError()" />
      }
    </div>
    <div class="ak-card" [class.shut]="!textOpen()">
      <div class="ak-head">
        @if (textOpen()) {
          <div class="ak-tabs" role="tablist" [attr.aria-label]="'codex.holo.akte.tabsAria' | translate" (keydown)="onTabKey($event)">
            @for (t of tabs; track t.id) {
              <button type="button" role="tab" class="ak-tab" [id]="'ak-tab-' + t.id" [class.on]="tab() === t.id"
                      [attr.aria-selected]="tab() === t.id" [attr.aria-controls]="'ak-panel'" [attr.tabindex]="tab() === t.id ? 0 : -1"
                      (click)="pickTab(t.id)">{{ t.key | translate }}</button>
            }
          </div>
        }
        <button scAction tier="tertiary" type="button" class="ak-tg" [attr.aria-pressed]="!textOpen()"
                [scTooltip]="(textOpen() ? 'codex.holo.akte.imageOnly' : 'codex.holo.akte.showText') | translate" scTooltipTier="label"
                [attr.aria-label]="(textOpen() ? 'codex.holo.akte.imageOnly' : 'codex.holo.akte.showText') | translate"
                (click)="textOpen.set(!textOpen())">
          <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 16l5-5 4 4 3-3 6 6" /></svg>
        </button>
      </div>
      @if (textOpen()) {
        <div class="ak-panel" id="ak-panel" role="tabpanel" [attr.aria-labelledby]="'ak-tab-' + tab()">
          @switch (tab()) {
            @case ('sheet') {
              <div class="ak-body">
                @if (facts().length) {
                  <dl class="ak-facts">
                    @for (f of facts(); track f.labelKey) {
                      <div><dt>{{ f.labelKey | translate }}</dt><dd>{{ f.value }}</dd></div>
                    }
                  </dl>
                }
                @if (liveries().length > 1 || editions().length > 1) {
                  <div class="ak-sws" role="group" [attr.aria-label]="'codex.holo.akte.liveries' | translate">
                    <span class="gl">{{ 'codex.holo.akte.liveries' | translate }}</span>
                    @if (liveries().length > 1) {
                      @for (l of liveries(); track l.id) {
                        <button type="button" class="ak-sw" [class.on]="activeLivery() === l.id" [attr.aria-pressed]="activeLivery() === l.id"
                                [scTooltip]="l.id === standardId ? ('codex.holo.akte.standard' | translate) : l.label" scTooltipTier="label" scTooltipPlacement="above" (click)="pickLivery(l.id)">
                          <span class="t">@if (l.imageUrl) { <img [src]="l.imageUrl" alt="" loading="lazy" /> } @else { <i></i> }</span>
                          <small>{{ l.id === standardId ? ('codex.holo.akte.standard' | translate) : l.label }}</small>
                        </button>
                      }
                    }
                    @for (e of editionTiles(); track e.classNameSlug) {
                      <a class="ak-sw ed" [routerLink]="['/codex', 'ship', e.classNameSlug]" [scTooltip]="e.label" scTooltipTier="label" scTooltipPlacement="above">
                        <span class="t"><i></i></span>
                        <small>{{ e.label }}</small>
                      </a>
                    }
                  </div>
                }
              </div>
              <div class="ak-foot">
                <ng-content />
                <a class="ak-rsi" [href]="rsiHref()" target="_blank" rel="noopener noreferrer nofollow">
                  {{ 'codex.detail.viewOnRsi' | translate }} <span aria-hidden="true">↗</span>
                </a>
              </div>
            }
            @case ('text') {
              <div class="ak-body ak-txt" tabindex="0" [attr.aria-label]="'codex.holo.akte.descriptionAria' | translate">
                @if (text()) { <p>{{ text() }}</p> } @else { <p class="muted">{{ 'codex.holo.akte.noDescription' | translate }}</p> }
              </div>
            }
            @case ('buy') {
              <sc-codex-holo-buy-tab class="ak-buy"
                [options]="buyOptions()" [loading]="buyLoading()" [error]="buyError()"
                [kind]="'ship'" [className]="currentSlug()" [name]="itemName()"
                [wikelo]="wikelo()" [wikeloNeeds]="wikeloNeeds()" (retry)="buyRetry.emit()" />
            }
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { position: relative; display: flex; flex-direction: column; align-items: flex-start; width: 100%; height: 100%; min-height: 0; }
    .ak-bg { position: absolute; inset: 0; z-index: 0; overflow: hidden; border-radius: 14px; }
    .ak-bg.holo { background:
      radial-gradient(ellipse 55% 45% at 60% 55%, color-mix(in srgb, var(--sc-accent) 16%, transparent), transparent 70%),
      repeating-linear-gradient(0deg, color-mix(in srgb, var(--sc-accent) 5%, transparent) 0 1px, transparent 1px 4px); }
    /* The CIG/RSI image is a plain image: shown as it is, cover — a livery render the same way, under the same card. */
    .ak-img { display: block; width: 100%; height: 100%; object-fit: cover; }
    /* ONE size for every tab (B2.4): smaller than the old card so the ship stays visible; the body scrolls inside. */
    .ak-card { position: relative; z-index: 1; box-sizing: border-box; width: min(400px, 100%); height: min(100%, 420px);
      display: flex; flex-direction: column; gap: 10px; padding: 10px 14px 12px;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 38%, transparent); border-radius: 14px;
      background: color-mix(in srgb, var(--sc-bg-0) 82%, transparent); backdrop-filter: blur(6px); }
    /* "Nur Bild": the card shrinks to its head, the image is free. */
    .ak-card.shut { width: auto; height: auto; padding: 6px; border-radius: 22px; }
    .ak-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: 0 0 auto; }
    .ak-tabs { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--sc-border); border-radius: 16px; background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); min-width: 0; }
    .ak-tab { min-height: 28px; padding: 0 11px; border: 0; border-radius: 14px; background: none; color: var(--sc-fg-1); font: inherit; font-size: max(12px, var(--sc-fs-floor)); white-space: nowrap; cursor: pointer; }
    .ak-tab:hover { color: var(--sc-fg-0); }
    .ak-tab.on { background: color-mix(in srgb, var(--sc-accent) 20%, transparent); color: var(--sc-accent); }
    .ak-tab:focus-visible, .ak-sw:focus-visible, .ak-rsi:focus-visible, .ak-txt:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    .ak-panel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
    .ak-body { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
    .ak-txt { display: block; }
    .ak-txt p { margin: 0; color: var(--sc-fg-0); font-size: max(13.5px, var(--sc-fs-floor)); line-height: 1.55; max-width: var(--sc-measure, 68ch); }
    .ak-txt p.muted { color: var(--sc-fg-2); }
    /* Label above value, two to a row: every value keeps one line ("Aegis Dynamics", "19,69 × 17,4 × 5,14 m"). */
    .ak-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; margin: 0; }
    .ak-facts div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .ak-facts dt { color: var(--sc-fg-2); font-size: max(10.5px, var(--sc-fs-floor)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ak-facts dd { margin: 0; min-width: 0; color: var(--sc-fg-0); font-family: var(--sc-font-mono, monospace); font-weight: 600; font-size: max(12px, var(--sc-fs-floor)); white-space: nowrap; }
    /* Vergleichen + Bei RSI ansehen: one row at the bottom of the Datenblatt. */
    .ak-foot { flex: 0 0 auto; display: flex; align-items: center; flex-wrap: nowrap; gap: 8px; padding-top: 8px; border-top: 1px solid var(--sc-border); }
    .ak-sws { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 6px; min-width: 0; }
    .gl { width: 100%; font-size: max(9px, var(--sc-fs-floor)); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-fg-2); }
    /* Image tiles, not chips: a small picture with the name under it (the filters are pills). */
    .ak-sw { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 64px; padding: 0; border: 0; background: none; font: inherit; cursor: pointer; text-decoration: none; }
    .ak-sw .t { position: relative; display: block; width: 58px; height: 34px; border-radius: 5px; overflow: hidden;
      border: 1px solid var(--sc-border); background: linear-gradient(170deg, var(--sc-bg-1), color-mix(in srgb, var(--sc-accent) 18%, var(--sc-bg-1))); }
    .ak-sw .t img { display: block; width: 100%; height: 100%; object-fit: contain; background: var(--sc-bg-0); }
    .ak-sw .t i { position: absolute; inset: 22% 30%; background: color-mix(in srgb, var(--sc-accent) 55%, transparent);
      clip-path: polygon(50% 0, 60% 29%, 100% 62%, 100% 73%, 65% 65%, 62% 86%, 72% 95%, 72% 100%, 50% 96%, 28% 100%, 28% 95%, 38% 86%, 35% 65%, 0 73%, 0 62%, 40% 29%); }
    .ak-sw small { max-width: 64px; overflow: hidden; text-align: center; line-height: 1.2; overflow-wrap: anywhere; hyphens: auto;
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; font-size: max(9px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .ak-sw:hover .t { border-color: color-mix(in srgb, var(--sc-accent) 60%, var(--sc-border)); }
    .ak-sw.on .t { border-color: var(--sc-accent); box-shadow: 0 0 0 1.5px var(--sc-accent); }
    .ak-sw.on small { color: var(--sc-fg-0); }
    .ak-rsi { margin-inline-start: auto; display: inline-flex; align-items: center; gap: 4px; min-height: 28px; padding: 0 12px; border-radius: 14px;
      border: 1px solid var(--sc-border); color: var(--sc-fg-1); text-decoration: none; font-size: max(12px, var(--sc-fs-floor)); white-space: nowrap; }
    .ak-rsi:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .ak-buy { flex: 1 1 auto; min-height: 0; }
    @media (pointer: coarse) { .ak-tab { min-height: 44px; } .ak-rsi { min-height: 48px; } .ak-sw { min-height: 48px; } }
    @media (max-width: 640px) { .ak-card { width: 100%; height: min(100%, 460px); } .ak-facts dd { white-space: normal; } }
  `],
})
export class CodexHoloAkteComponent {
  /** The record's description (already localized). */
  readonly description = input('');
  readonly facts = input<readonly AkteFact[]>([]);
  /** The official RSI / store render candidates, best first (the page's heroArt). */
  readonly heroArt = input<readonly string[]>([]);
  /** The datamined silhouette that may trail heroArt — not an official image, never the Akte background. */
  readonly previewSilhouette = input<string | null>(null);
  readonly liveries = input<readonly AkteLivery[]>([]);
  /** The edition family incl. the current record; tiles show only when there is more than one. */
  readonly editions = input<readonly AkteEdition[]>([]);
  readonly currentSlug = input('');
  readonly rsiHref = input('https://robertsspaceindustries.com/en/pledge/ships');
  /** Kaufen tab: the UEX purchase options of the record and the state of that lookup (the page owns it). */
  readonly buyOptions = input<readonly BuyOption[]>([]);
  readonly buyLoading = input(false);
  readonly buyError = input(false);
  /** Display name of the record (the wishlist entry's name). */
  readonly itemName = input('');
  /** The record is a Wikelo trade item; the parts the trade asks for, when the Codex knows them. */
  readonly wikelo = input(false);
  readonly wikeloNeeds = input<readonly WikeloNeed[]>([]);
  readonly buyRetry = output<void>();

  private readonly analytics = inject(AnalyticsService);
  protected readonly tabs: readonly { id: AkteTab; key: string }[] = [
    { id: 'sheet', key: 'codex.holo.akte.tabSheet' },
    { id: 'text', key: 'codex.holo.akte.tabText' },
    { id: 'buy', key: 'codex.holo.akte.tabBuy' },
  ];
  /** The open tab; the last pick is the start for every ship. */
  readonly tab = signal<AkteTab>(CodexHoloAkteComponent.readTabPref());

  protected readonly standardId = AKTE_STANDARD_LIVERY;
  /** The description without its leading data lines (maker and focus are facts already). */
  protected readonly text = computed(() => akteProse(this.description()));
  readonly textOpen = signal(true);
  readonly activeLivery = signal<string>(AKTE_STANDARD_LIVERY);
  private readonly failed = signal(0);

  private readonly official = computed(() => this.heroArt().filter((u) => !!u && u !== this.previewSilhouette()));
  /** The image on the Akte: the picked livery's render, else the official image (the next one when one fails). */
  readonly imageSrc = computed<string | null>(() => {
    const id = this.activeLivery();
    if (id !== AKTE_STANDARD_LIVERY) return this.liveries().find((l) => l.id === id)?.imageUrl ?? null;
    return this.official()[this.failed()] ?? null;
  });
  protected readonly showsOfficial = computed(() => this.activeLivery() === AKTE_STANDARD_LIVERY);
  /** Other records of the same hull; the current one is already the page. */
  protected readonly editionTiles = computed(() =>
    this.editions().length > 1 ? this.editions().filter((e) => e.classNameSlug !== this.currentSlug()) : [],
  );

  constructor() {
    if (this.tab() === 'buy') this.analytics.track('codex:buy_open', { kind: 'ship', tab_remembered: true });
    // A new record starts on its factory paint and its first image.
    effect(() => {
      this.currentSlug();
      this.activeLivery.set(AKTE_STANDARD_LIVERY);
      this.failed.set(0);
    });
  }

  pickTab(id: AkteTab): void {
    if (id === this.tab()) return;
    this.tab.set(id);
    try {
      localStorage.setItem(AKTE_TAB_PREF_KEY, id);
    } catch {
      // storage blocked: the pick just is not remembered
    }
    if (id === 'buy') this.analytics.track('codex:buy_open', { kind: 'ship', tab_remembered: false });
  }

  /** Arrow keys move along the tabs (roving tabindex), Home/End jump to the ends. */
  protected onTabKey(e: KeyboardEvent): void {
    const i = AKTE_TABS.indexOf(this.tab());
    const next = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -1;
    if (next < 0) return;
    e.preventDefault();
    this.pickTab(AKTE_TABS[next]);
    (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role=tab]')[next]?.focus();
  }

  private static readTabPref(): AkteTab {
    try {
      const v = localStorage.getItem(AKTE_TAB_PREF_KEY);
      return AKTE_TABS.includes(v as AkteTab) ? (v as AkteTab) : 'sheet';
    } catch {
      return 'sheet';
    }
  }

  pickLivery(id: string): void {
    this.activeLivery.set(id);
  }

  onImageError(): void {
    if (this.showsOfficial()) this.failed.update((n) => n + 1);
    else this.activeLivery.set(AKTE_STANDARD_LIVERY);
  }
}
