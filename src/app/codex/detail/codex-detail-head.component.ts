// The head band of every beta detail page (concept batch-holotisch-kopf-vorlage r1 d2 "Kommandoleiste"):
// a light glass band that grows out of the shell subheader's bottom edge, sticks right under it while the
// page scrolls and, once scrolled, shrinks to one row (name + small maker | centre | own). Ship and item
// pages share it through the detail shell, so a change here improves both (T1/T2).
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  signal,
} from '@angular/core';

import { onScrollTick } from '../../core/scroll-tick';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';

/** Scrolled past this many px (and stuck under the subheader) the band turns slim. */
export const HEAD_SLIM_AT = 32;
/** Back to full only near the very top: the gap between the two keeps the band from flickering. */
export const HEAD_FULL_AT = 8;

/** Pure: the band's next state from the scroll offset and whether it is stuck under the subheader. */
export function nextSlim(slim: boolean, scrollY: number, stuck: boolean): boolean {
  if (!stuck) return false;
  return slim ? scrollY > HEAD_FULL_AT : scrollY > HEAD_SLIM_AT;
}

@Component({
  selector: 'sc-codex-detail-head',
  standalone: true,
  imports: [ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.slim]': 'slim()', '[class.scan]': 'scan()' },
  template: `
    <div class="ht-left">
      <!-- Keyed on the name: a hull switch re-enters the title with it. -->
      @for (n of [name()]; track n) {
        <div class="ht-title">
          @if (kicker(); as k) { <span class="ht-kicker">{{ k }}</span> }
          <h1 class="ht-name" tabindex="0" [scTooltip]="tooltip()" scTooltipTier="label">{{ n }}</h1>
        </div>
      }
      <!-- slot [headExtra]: models, kind tag, class chip … — full band only. -->
      <div class="ht-extra"><ng-content select="[headExtra]" /></div>
    </div>
    <div class="ht-centre"><ng-content select="[headCentre]" /></div>
    <div class="ht-right"><ng-content select="[headOwn]" /></div>
  `,
  styles: [
    `
      /* One pill language for every control in the band (Einsatz, hangar, ownership): the
         controls read these tokens, the slim band only changes the tokens. */
      :host {
        --hb-slim-h: max(48px, calc(var(--sc-tap-min, 0px) + 10px));
        --hb-pill-h: max(34px, var(--sc-tap-min, 0px));
        --hb-pill-r: 999px;
        --hb-pill-bd: color-mix(in srgb, var(--sc-accent) 30%, transparent);
        --hb-pill-bg: color-mix(in srgb, var(--sc-bg-0) 52%, transparent);
        --hb-pill-meta: inline;
        position: sticky;
        top: calc(var(--sc-imp-banner-h, 0px) + var(--sc-topbar-h, 0px) + env(safe-area-inset-top, 0px));
        z-index: 20;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
        align-items: end;
        gap: 6px 16px;
        box-sizing: border-box;
        margin-inline: 10px;
        padding: 14px 18px 12px;
        /* Glass without a top edge: it continues the subheader instead of starting a second box. */
        border: 1px solid color-mix(in srgb, var(--sc-accent) 16%, transparent);
        border-top: 0;
        border-radius: 0 0 18px 18px;
        background: linear-gradient(180deg, color-mix(in srgb, var(--sc-bg-0) 70%, transparent), color-mix(in srgb, var(--sc-bg-0) 34%, transparent));
        -webkit-backdrop-filter: blur(10px) saturate(1.15);
        backdrop-filter: blur(10px) saturate(1.15);
        transition: padding 220ms ease, min-height 220ms ease;
      }
      /* The soft cyan hairline the band rests on. */
      :host::after {
        content: '';
        position: absolute;
        inset-inline: 18px;
        bottom: -1px;
        height: 1px;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sc-accent) 70%, transparent), transparent);
      }
      .ht-left { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .ht-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .ht-name {
        position: relative; margin: 0; font-weight: 500; font-size: clamp(20px, 1.25vw, 24px); line-height: 1.15; letter-spacing: 0.16em;
        text-transform: uppercase; color: var(--sc-fg-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        animation: name-in 520ms cubic-bezier(0.16, 0.84, 0.24, 1) backwards;
        transition: font-size 220ms ease, letter-spacing 220ms ease;
      }
      .ht-name:focus-visible { outline: 1px solid transparent; border-radius: 4px; box-shadow: var(--sc-focus-ring); }
      .ht-kicker { min-width: 0; font-size: max(11px, var(--sc-fs-floor)); letter-spacing: 0.04em; color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ht-extra { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; min-width: 0; }
      .ht-extra:empty { display: none; }
      .ht-centre { justify-self: center; min-width: 0; }
      .ht-centre:empty { display: none; }
      .ht-right { justify-self: end; display: flex; justify-content: flex-end; align-items: center; gap: 10px; min-width: 0; max-width: 100%; flex-wrap: wrap; }
      /* Touch: the focusable title reaches the tap minimum (full band; the slim row stays one line). */
      @media (pointer: coarse) { :host(:not(.slim)) .ht-name { min-height: var(--sc-tap-min); line-height: var(--sc-tap-min); } }
      @keyframes name-in { from { opacity: 0; clip-path: inset(0 100% 0 0); } }

      /* The docking scan (shell beta, motion allowed): the title scans open with a light line under it. */
      :host(.scan) .ht-name { overflow: visible; animation: dk-scan 760ms cubic-bezier(0.16, 0.84, 0.24, 1) 120ms backwards; }
      :host(.scan) .ht-name::after {
        content: ''; position: absolute; left: 0; right: 0; bottom: -4px; height: 2px; transform-origin: left; pointer-events: none;
        background: linear-gradient(90deg, var(--sc-accent), transparent); box-shadow: 0 0 10px var(--sc-accent);
        animation: dk-scan-line 1000ms cubic-bezier(0.16, 0.84, 0.24, 1) 120ms both;
      }
      @keyframes dk-scan {
        0% { clip-path: inset(-40% 100% -40% 0); opacity: 1; filter: brightness(2.2) drop-shadow(0 0 0 var(--sc-accent)); }
        55% { clip-path: inset(-40% -10% -40% 0); filter: brightness(1.6) drop-shadow(0 0 10px var(--sc-accent)); }
        100% { clip-path: inset(-40% -10% -40% 0); filter: none; }
      }
      @keyframes dk-scan-line { 0% { transform: scaleX(0); opacity: 0; } 12% { opacity: 1; } 58% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(1); opacity: 0; } }

      /* ── Slim (scrolled): one row, as high as the KPI strip's row; the flow keeps the full height
         (margin-bottom makes up the difference), so nothing below the band moves when it shrinks. ── */
      :host(.slim) {
        --hb-pill-h: max(30px, var(--sc-tap-min, 0px));
        --hb-pill-meta: none;
        grid-template-columns: auto auto minmax(0, 1fr);
        align-items: center;
        gap: 16px;
        height: var(--hb-slim-h);
        padding: 0 16px;
        margin-bottom: max(0px, calc(var(--hb-full, 0px) - var(--hb-slim-h)));
      }
      :host(.slim) .ht-title { flex-direction: row-reverse; justify-content: flex-end; align-items: baseline; gap: 10px; }
      :host(.slim) .ht-name { font-size: max(15px, var(--sc-fs-floor)); letter-spacing: 0.14em; animation: none; }
      :host(.slim) .ht-name::after { display: none; }
      :host(.slim) .ht-kicker { font-size: max(10.5px, var(--sc-fs-floor)); }
      :host(.slim) .ht-extra { display: none; }
      :host(.slim) .ht-centre { justify-self: start; }

      @media (max-width: 640px) {
        :host { grid-template-columns: minmax(0, 1fr) auto; margin-inline: 0; padding: 10px 12px; border-radius: 0 0 14px 14px; }
        .ht-left { grid-column: 1 / -1; }
        .ht-centre { justify-self: start; }
        /* Its own row: beside the Einsatz pill the hangar pill ran past a 375 px phone. */
        .ht-right { grid-column: 1 / -1; }
        :host(.slim) { grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; padding: 0 10px; }
        :host(.slim) .ht-left, :host(.slim) .ht-right { grid-column: auto; }
        :host(.slim) .ht-kicker { display: none; }
        :host(.slim) .ht-centre { justify-self: end; }
      }
      @media (prefers-reduced-motion: reduce) {
        :host, .ht-name { transition: none; }
        .ht-name, :host(.scan) .ht-name, :host(.scan) .ht-name::after { animation: none; }
      }
    `,
  ],
})
export class CodexDetailHeadComponent {
  /** The page's only h1. */
  readonly name = input.required<string>();
  /** Small line over the name (maker, "Behring · Sturmgewehr"); null = none. */
  readonly kicker = input<string | null>(null);
  readonly tooltip = input<string | null>(null);
  /** Plays the docking scan on the name (shell beta, motion allowed). */
  readonly scan = input(false);

  readonly slim = signal(false);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      let next = false;
      let full = 0;
      const off = onScrollTick({
        read: () => {
          const stickTop = parseFloat(getComputedStyle(host).top) || 0;
          const stuck = host.getBoundingClientRect().top <= stickTop + 1;
          next = nextSlim(this.slim(), window.scrollY, stuck);
          if (!this.slim()) full = host.offsetHeight;
        },
        write: () => {
          if (!this.slim() && full > 0) host.style.setProperty('--hb-full', `${full}px`);
          if (next !== this.slim()) this.slim.set(next);
        },
      });
      destroyRef.onDestroy(off);
    });
  }
}
