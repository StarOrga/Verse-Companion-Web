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
  computed,
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

/**
 * Pure: how far the band pulls itself up at the page top so it hangs on the subheader's bottom edge
 * from the first frame (the page frame's top padding and an empty crumb row sit between them).
 * `top` is the band's viewport top with its current pull `pull` applied, `stickTop` where it parks.
 */
export function attachPull(top: number, pull: number, stickTop: number): number {
  return Math.max(0, Math.round(top + pull - stickTop));
}

/**
 * Where the band would start without its pull and without sticking: the parent's content edge when the band
 * is its first child (both hosts are flex columns, so the negative margin never collapses through the parent),
 * else null. The band's own rect cannot tell: once the pull is too large, sticky clamps the band to its stick
 * line, the rect reads `stickTop` and the over-pull keeps itself forever — the band then lies over the
 * holotable's first row and the panel's tab pill (v0.282.0 report).
 */
export function naturalTop(host: HTMLElement): number | null {
  let child: HTMLElement = host;
  let parent = host.parentElement;
  // A display:contents wrapper (the ship's head region, slotted into the detail shell) has no box of its own:
  // the box it stands in is the parent that counts.
  while (parent && parent.firstElementChild === child && getComputedStyle(parent).display === 'contents') {
    child = parent;
    parent = parent.parentElement;
  }
  if (!parent || parent.firstElementChild !== child) return null;
  const cs = getComputedStyle(parent);
  return parent.getBoundingClientRect().top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
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
          <!-- Cut off (long names, slim band, phone): the full name is the tooltip. -->
          <h1 class="ht-name" tabindex="0" [scTooltip]="nameTip()" scTooltipTier="label"
              (pointerenter)="checkCut($event)" (focus)="checkCut($event)">{{ n }}</h1>
        </div>
      }
      <!-- slot [headExtra]: models, kind tag, class chip … — full band only. -->
      <div class="ht-extra"><ng-content select="[headExtra]" /></div>
    </div>
    <!-- Always in the grid, empty or not: the own pills stay in the right column on every kind. -->
    <div class="ht-centre"><ng-content select="[headCentre]" /></div>
    <div class="ht-right"><ng-content select="[headOwn]" /></div>
  `,
  styles: [
    `
      /* One pill language for every control in the band (Einsatz, hangar, ownership): the
         controls read these tokens, the slim band only changes the tokens.
         Family (1920, beta shell): subheader capsule 60 px (r 20) · slim band 56 px (r 14) · strip row 64 px
         (r 18). The slim band holds 32 px pills with 12 px above and below — the capsule's own inner
         rhythm — so it reads as the capsule's lower step, one 8 px step under the strip row. */
      :host {
        --hb-slim-h: max(56px, calc(var(--sc-tap-min, 0px) + 12px));
        --hb-pill-h: max(34px, var(--sc-tap-min, 0px));
        --hb-pill-r: 999px;
        --hb-pill-bd: color-mix(in srgb, var(--sc-accent) 30%, transparent);
        --hb-pill-bg: color-mix(in srgb, var(--sc-bg-0) 52%, transparent);
        --hb-pill-meta: inline;
        position: sticky;
        /* Hangs on the capsule's visible bottom edge: --sc-topbar-h counts the bar host's 4 px bottom
           padding, the band starts above it. Phone: below the route line (--sc-route-h holds the safe area). */
        top: calc(var(--sc-imp-banner-h, 0px) + max(0px, var(--sc-topbar-h, 0px) - 4px) + max(var(--sc-route-h, 0px), env(safe-area-inset-top, 0px)));
        /* Over the page (stage z 6, sticky strip), under the shell bar (z 20) and its search panel. */
        z-index: 12;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, max-content);
        align-items: end;
        gap: 6px 16px;
        box-sizing: border-box;
        margin-inline: 10px;
        padding: 14px 18px 12px;
        /* Glass without a top edge: it continues the subheader instead of starting a second box. */
        border: 1px solid color-mix(in srgb, var(--sc-accent) 16%, transparent);
        border-top: 0;
        border-radius: 0 0 14px 14px;
        background: linear-gradient(180deg, color-mix(in srgb, var(--sc-bg-0) 70%, transparent), color-mix(in srgb, var(--sc-bg-0) 34%, transparent));
        /* The soft cyan glow under the band (d2 mock), below the hairline. */
        box-shadow: 0 16px 28px -22px color-mix(in srgb, var(--sc-accent) 70%, transparent);
        -webkit-backdrop-filter: blur(10px) saturate(1.15);
        backdrop-filter: blur(10px) saturate(1.15);
        /* No height transition: the flow below keeps the full height only through the slim margin, so a band that
           grew back over 220 ms at the page top pulled the whole page up and pushed it down again (scroll jump). */
      }
      /* The cyan hairline the band rests on, with its own light. */
      :host::after {
        content: '';
        position: absolute;
        inset-inline: 18px;
        bottom: -1px;
        height: 1px;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sc-accent) 75%, transparent), transparent);
        box-shadow: 0 0 10px 1px color-mix(in srgb, var(--sc-accent) 35%, transparent);
      }
      .ht-left { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .ht-title { position: relative; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .ht-name {
        margin: 0; min-width: 0; font-weight: 500; font-size: clamp(20px, 1.25vw, 24px); line-height: 1.15; letter-spacing: 0.16em;
        text-transform: uppercase; color: var(--sc-fg-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        animation: name-in 520ms cubic-bezier(0.16, 0.84, 0.24, 1) backwards;
      }
      .ht-name:focus-visible { outline: 1px solid transparent; border-radius: 4px; box-shadow: var(--sc-focus-ring); }
      .ht-kicker { min-width: 0; font-size: max(11px, var(--sc-fs-floor)); letter-spacing: 0.04em; color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ht-extra { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; min-width: 0; }
      .ht-extra:empty { display: none; }
      .ht-centre { justify-self: center; min-width: 0; }
      .ht-right { justify-self: end; display: flex; justify-content: flex-end; align-items: center; gap: 10px; min-width: 0; max-width: 100%; flex-wrap: wrap; }
      /* Touch: the focusable title reaches the tap minimum (full band; the slim row stays one line). */
      @media (pointer: coarse) { :host(:not(.slim)) .ht-name { min-height: var(--sc-tap-min); line-height: var(--sc-tap-min); } }
      @keyframes name-in { from { opacity: 0; clip-path: inset(0 100% 0 0); } }

      /* The docking scan (shell beta, motion allowed): the title scans open with a light line under it.
         The line hangs on the title box, so the name keeps its ellipsis while it plays. */
      :host(.scan) .ht-name { animation: dk-scan 760ms cubic-bezier(0.16, 0.84, 0.24, 1) 120ms backwards; }
      :host(.scan:not(.slim)) .ht-title::after {
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

      /* ── Slim (scrolled): one row; the flow keeps the full height (margin-bottom makes up the
         difference), so nothing below the band moves when it shrinks. ── */
      :host(.slim) {
        --hb-pill-h: max(32px, var(--sc-tap-min, 0px));
        --hb-pill-meta: none;
        --hb-pill-slim: 1;
        grid-template-columns: minmax(0, max-content) auto minmax(0, 1fr);
        align-items: center;
        gap: 16px;
        height: var(--hb-slim-h);
        padding: 0 18px;
        margin-bottom: max(0px, calc(var(--hb-full, 0px) - var(--hb-slim-h)));
      }
      :host(.slim) .ht-title { flex-direction: row-reverse; justify-content: flex-end; align-items: baseline; gap: 10px; }
      /* The animation stays as it is: switching it to none and back replayed the name's scan on every return to the top. */
      :host(.slim) .ht-name { font-size: max(15px, var(--sc-fs-floor)); letter-spacing: 0.14em; }
      :host(.slim) .ht-kicker { flex: none; font-size: max(10.5px, var(--sc-fs-floor)); }
      :host(.slim) .ht-extra { display: none; }
      :host(.slim) .ht-centre { justify-self: start; }

      /* Phone on its side: one slim row (no maker kicker, smaller name) so the stage below keeps the height. */
      @media (orientation: landscape) and (max-height: 500px) {
        :host(:not(.slim)) { padding-block: 4px; align-items: center; }
        :host(:not(.slim)) .ht-kicker { display: none; }
        :host(:not(.slim)) .ht-name { font-size: max(16px, var(--sc-fs-floor)); letter-spacing: 0.14em; }
        :host(:not(.slim)) .ht-extra { display: none; }
        /* The name keeps its full width, the mission pill takes what is left and shrinks first, the hangar pill keeps its own. */
        :host(:not(.slim)) { grid-template-columns: minmax(0, max-content) minmax(0, 1fr) minmax(0, max-content); gap: 6px 12px; }
        :host(:not(.slim)) .ht-centre { justify-self: stretch; }
        :host(:not(.slim)) .ht-centre > * { max-inline-size: 100%; min-inline-size: 0; }
      }
      @media (max-width: 640px) {
        :host { grid-template-columns: minmax(0, 1fr) auto; margin-inline: 0; padding: 10px 12px; }
        .ht-left { grid-column: 1 / -1; }
        .ht-centre { justify-self: start; }
        .ht-centre:empty { display: none; }
        /* Its own row: beside the Einsatz pill the hangar pill ran past a 375 px phone. */
        .ht-right { grid-column: 1 / -1; }
        :host(.slim) { --hb-pill-text: none; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; padding: 0 10px; }
        :host(.slim) .ht-left, :host(.slim) .ht-right { grid-column: auto; }
        :host(.slim) .ht-kicker { display: none; }
        :host(.slim) .ht-centre { justify-self: end; }
      }
      @media (prefers-reduced-motion: reduce) {
        .ht-name, :host(.scan) .ht-name, :host(.scan) .ht-title::after { animation: none; }
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
  /** The name is cut off right now (checked when the pointer or focus reaches it). */
  protected readonly cut = signal(false);
  protected readonly nameTip = computed(() => {
    const tip = this.tooltip();
    if (!this.cut()) return tip;
    return tip ? `${this.name()} · ${tip}` : this.name();
  });

  protected checkCut(ev: Event): void {
    const el = ev.currentTarget as HTMLElement;
    this.cut.set(el.scrollWidth > el.clientWidth + 1);
  }

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      let next = false;
      let full = 0;
      let pull = 0;
      let nextPull = 0;
      // At the page top the band pulls itself up onto the capsule's edge (H1/H3: no gap, no jump once it sticks).
      const readPull = (): void => {
        if (window.scrollY > 0.5) return;
        const stickTop = parseFloat(getComputedStyle(host).top) || 0;
        const natural = naturalTop(host);
        nextPull = natural === null ? attachPull(host.getBoundingClientRect().top, pull, stickTop) : attachPull(natural, 0, stickTop);
      };
      const writePull = (): void => {
        if (nextPull === pull) return;
        pull = nextPull;
        host.style.marginTop = pull ? `${-pull}px` : '';
      };
      const settle = (): void => { readPull(); writePull(); };
      const off = onScrollTick({
        read: () => {
          readPull();
          const stickTop = parseFloat(getComputedStyle(host).top) || 0;
          const stuck = host.getBoundingClientRect().top <= stickTop + 1;
          next = nextSlim(this.slim(), window.scrollY, stuck);
          if (!this.slim()) full = host.offsetHeight;
        },
        write: () => {
          writePull();
          if (!this.slim() && full > 0) host.style.setProperty('--hb-full', `${full}px`);
          if (next !== this.slim()) this.slim.set(next);
        },
      });
      // What stands above the band (page header, banner) can settle after the first frame.
      let raf = requestAnimationFrame(settle);
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(settle); }) : null;
      if (ro && host.parentElement) ro.observe(host.parentElement);
      // A skeleton or banner above leaving moves the band's parent without resizing it: watch the page frame too.
      const frame = host.closest('main') ?? document.body;
      if (ro && frame !== host.parentElement) ro.observe(frame);
      window.addEventListener('resize', settle, { passive: true });
      destroyRef.onDestroy(() => {
        off();
        cancelAnimationFrame(raf);
        ro?.disconnect();
        window.removeEventListener('resize', settle);
      });
    });
  }
}
