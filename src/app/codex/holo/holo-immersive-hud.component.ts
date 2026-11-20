import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HoloPerspectiveView } from './codex-holo-perspectives.component';

export type ImmersiveSurface = 'simple' | '3d' | 'top';
type HudMode = 'holo' | '3d' | 'schema';

/** Idle time before the controls fade; any touch on the stage brings them back. */
export const HUD_IDLE_MS = 3500;

const SURFACES: readonly { id: ImmersiveSurface; mode: HudMode; labelKey: string }[] = [
  { id: 'simple', mode: 'holo', labelKey: 'codex.holo.stage.viewHull' },
  { id: 'top', mode: 'schema', labelKey: 'codex.holo.stage.viewSchema' },
  { id: '3d', mode: '3d', labelKey: 'codex.holo.stage.view3d' },
];

/**
 * The immersive stage's controls (concept mobile spec 4.2): top row with the view switch, the model's
 * name and reset / close; a slim rail with one headline value per perspective; a side panel that opens
 * from the rail. The controls fade after 3.5 s idle (opacity only, a still page just toggles them),
 * the rail stays at 60 %. Purely presentational — the table owns the state and the stage resolves the values.
 */
@Component({
  selector: 'sc-holo-immersive-hud',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.hud-off]': '!visible()', '[class.panel-open]': 'openTile() !== null', '(focusin)': 'poke()', '(keydown.escape)': 'onEscape($event)' },
  template: `
    <div class="top">
      <div class="seg" role="radiogroup" [attr.aria-label]="'codex.holo.stage.viewsAria' | translate">
        @for (s of surfaces; track s.id) {
          <button type="button" role="radio" class="seg-btn" [class.on]="mode() === s.mode" [attr.aria-checked]="mode() === s.mode"
                  (click)="surfacePick.emit(s.id); poke()">{{ s.labelKey | translate }}</button>
        }
      </div>
      <p class="cap">{{ caption() }}</p>
      @if (showReset()) {
        <button type="button" class="ic reset" [class.dim]="!zoomed()" [attr.aria-label]="'codex.holo.stage.resetView' | translate" (click)="resetView.emit(); poke()">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>
        </button>
      }
      <button type="button" class="ic close" [attr.aria-label]="'codex.holo.stage.fullscreenExit' | translate" (click)="exit.emit()">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>

    <div class="rail" role="group" [attr.aria-label]="'codex.holo.stage.statsAria' | translate">
      @for (t of stats(); track t.id) {
        <button type="button" class="rail-btn" [attr.data-p]="t.id" [class.on]="openTile() === t.id" [attr.aria-expanded]="openTile() === t.id"
                [attr.aria-label]="(t.titleKey | translate) + ': ' + (t.leadText ?? '–')" (click)="toggleTile(t.id)">
          <i class="dot" aria-hidden="true"></i>
          <span class="rv">{{ t.leadText ?? '–' }}</span>
        </button>
      }
    </div>

    <aside class="panel" role="region" [attr.aria-label]="'codex.holo.stage.statsAria' | translate" [attr.inert]="open() ? null : ''">
      @if (open(); as t) {
        <header class="ph">
          <h2>{{ t.titleKey | translate }}</h2>
          <button type="button" class="ic" [attr.aria-label]="'codex.holo.stage.statsClose' | translate" (click)="openTile.set(null)">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </header>
        @if (t.say) { <p class="say">{{ t.say }}</p> }
        <dl class="subs">
          @for (s of t.subs; track s.key) {
            <div><dt>{{ s.shortKey | translate }}</dt><dd>{{ s.text }}</dd></div>
          }
        </dl>
      }
    </aside>
    <p class="rotate-hint" aria-hidden="true">{{ 'codex.holo.stage.rotateHint' | translate }}</p>
  `,
  styles: [`
    :host { position: absolute; inset: 0; z-index: 6; pointer-events: none; display: block;
      --t: var(--sc-t-base, var(--holo-t-base, 280ms)); --e: var(--sc-e-out, var(--holo-e-out, cubic-bezier(0.2, 0.7, 0.2, 1))); --tap: 48px;
      --p-offensive: var(--holo-p-offensive, var(--sc-accent)); --p-defensive: var(--holo-p-defensive, var(--sc-accent));
      --p-movement: var(--holo-p-movement, var(--sc-accent)); --p-signature: var(--holo-p-signature, var(--sc-accent)); }
    .top { position: absolute; display: flex; align-items: center; gap: 8px; transition: opacity var(--t) var(--e);
      inset-block-start: calc(8px + env(safe-area-inset-top, 0px));
      inset-inline: calc(8px + env(safe-area-inset-left, 0px)) calc(8px + env(safe-area-inset-right, 0px)); }
    .top > * { pointer-events: auto; }
    :host(.hud-off) .top { opacity: 0; }
    :host(.hud-off) .top > * { pointer-events: none; }
    .glass { background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    .seg, .ic, .rail-btn, .panel { background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    .seg { display: flex; border-radius: 24px; overflow: hidden; flex: none; }
    .seg-btn { min-block-size: 44px; min-inline-size: 64px; padding: 0 14px; background: transparent; border: 0; color: var(--sc-fg-1); cursor: pointer;
      font-family: var(--sc-font-display); font-size: max(12px, var(--sc-fs-floor, 12px)); letter-spacing: 0.12em; text-transform: uppercase; }
    .seg-btn.on { color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
    .cap { flex: 1; min-inline-size: 0; margin: 0; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--sc-fg-1);
      font-size: max(12px, var(--sc-fs-floor, 12px)); text-shadow: 0 1px 6px var(--sc-bg-0); }
    .ic { inline-size: var(--tap); block-size: var(--tap); flex: none; display: grid; place-items: center; padding: 0; cursor: pointer; border-radius: 50%; color: var(--sc-fg-0); }
    .ic.reset { inline-size: 44px; block-size: 44px; }
    .ic.reset.dim { color: var(--sc-fg-2); }
    .seg-btn:focus-visible, .ic:focus-visible, .rail-btn:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    .rail { position: absolute; display: flex; flex-direction: column; gap: 8px; pointer-events: none; opacity: 1; transition: opacity var(--t) var(--e);
      inset-inline-start: calc(8px + env(safe-area-inset-left, 0px)); inset-block-start: 50%; translate: 0 -50%; }
    :host(.hud-off) .rail { opacity: 0.6; }
    .rail-btn { pointer-events: auto; inline-size: 56px; min-block-size: var(--tap); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
      padding: 4px 2px; border-radius: 12px; color: var(--sc-fg-0); cursor: pointer; font-variant-numeric: tabular-nums; }
    .rail-btn .dot { inline-size: 8px; block-size: 8px; border-radius: 50%; background: var(--pc, var(--sc-accent)); }
    .rail-btn[data-p='offensive'] { --pc: var(--p-offensive); } .rail-btn[data-p='defensive'] { --pc: var(--p-defensive); }
    .rail-btn[data-p='movement'] { --pc: var(--p-movement); } .rail-btn[data-p='signature'] { --pc: var(--p-signature); }
    .rail-btn .rv { font-family: var(--font-monospace, 'Share Tech Mono', monospace); font-size: max(12px, var(--sc-fs-floor, 12px)); }
    .rail-btn.on { border-color: var(--pc); background: color-mix(in srgb, var(--pc) 16%, var(--sc-bg-0)); }
    .panel { position: absolute; pointer-events: auto; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; border-radius: 14px;
      inset-block: calc(64px + env(safe-area-inset-top, 0px)) calc(8px + env(safe-area-inset-bottom, 0px));
      inset-inline-end: calc(8px + env(safe-area-inset-right, 0px)); inline-size: min(320px, 45vw); padding: 12px 14px;
      translate: calc(100% + 24px) 0; visibility: hidden; transition: translate var(--t) var(--e), visibility 0s linear var(--t); }
    :host(.panel-open) .panel { translate: 0 0; visibility: visible; transition: translate var(--t) var(--e), visibility 0s; }
    .ph { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .ph h2 { margin: 0; font-family: var(--sc-font-display); font-size: max(13px, var(--sc-fs-floor, 12px)); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-accent); }
    .say { margin: 6px 0 10px; color: var(--sc-fg-1); font-size: 13px; }
    .subs { margin: 0; display: grid; gap: 4px; }
    .subs div { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; min-block-size: 36px; align-items: center;
      border-block-end: 1px solid var(--sc-border); font-size: 13px; }
    .subs dt { color: var(--sc-fg-2); } .subs dd { margin: 0; font-family: var(--font-monospace, 'Share Tech Mono', monospace); color: var(--sc-fg-0); font-variant-numeric: tabular-nums; }
    .rotate-hint { display: none; margin: 0; }
    /* Upright phone: the rail lies along the bottom, the panel is a sheet over it. */
    @media (orientation: portrait) {
      .rail { inset-block-start: auto; inset-block-end: calc(8px + env(safe-area-inset-bottom, 0px)); inset-inline: calc(8px + env(safe-area-inset-left, 0px)) calc(8px + env(safe-area-inset-right, 0px));
        translate: none; flex-direction: row; justify-content: space-between; }
      .rail-btn { flex: 1; inline-size: auto; }
      .panel { inset-block: auto calc(72px + env(safe-area-inset-bottom, 0px)); inset-inline: calc(8px + env(safe-area-inset-left, 0px)) calc(8px + env(safe-area-inset-right, 0px));
        inline-size: auto; max-block-size: 45dvh; translate: 0 calc(100% + 96px); }
      .cap { display: none; }
      .top { justify-content: space-between; }
      .rotate-hint { display: block; position: absolute; inset-inline: 0; margin-inline: auto; inline-size: max-content; max-inline-size: 90%; text-align: center;
        inset-block-start: calc(64px + env(safe-area-inset-top, 0px)); padding: 12px 18px; min-block-size: 44px; box-sizing: border-box; border-radius: 22px;
        background: color-mix(in srgb, var(--sc-bg-0) 80%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent);
        color: var(--sc-fg-0); font-size: 13px; animation: rh-out 4s var(--e) forwards; }
    }
    @keyframes rh-out { 0%, 75% { opacity: 1; } 100% { opacity: 0; visibility: hidden; } }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
      .rotate-hint { display: none !important; }
    }
  `],
})
export class HoloImmersiveHudComponent {
  readonly caption = input('');
  readonly mode = input<HudMode>('holo');
  readonly stats = input<readonly HoloPerspectiveView[]>([]);
  readonly zoomed = input(false);
  readonly showReset = input(true);
  readonly still = input(false);
  readonly exit = output<void>();
  readonly resetView = output<void>();
  readonly surfacePick = output<ImmersiveSurface>();

  protected readonly surfaces = SURFACES;
  protected readonly visible = signal(true);
  protected readonly openTile = signal<string | null>(null);
  protected readonly open = computed(() => this.stats().find((t) => t.id === this.openTile()) ?? null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.arm();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  /** Any interaction: the controls come back and the idle timer restarts. */
  poke(): void {
    this.visible.set(true);
    this.arm();
  }

  /** A tap on empty stage flips the controls. */
  toggle(): void {
    if (this.visible()) { this.visible.set(false); clearTimeout(this.timer); } else this.poke();
  }

  private arm(): void {
    clearTimeout(this.timer);
    // A hand on a control, an open panel or keyboard focus keep the HUD up; reduced motion = no timed fade at all.
    this.timer = setTimeout(() => {
      if (this.still() || this.openTile() !== null || this.host.contains(document.activeElement) && document.activeElement !== this.host) { this.arm(); return; }
      this.visible.set(false);
    }, HUD_IDLE_MS);
  }

  protected toggleTile(id: string): void {
    this.openTile.update((c) => (c === id ? null : id));
    this.poke();
  }

  protected onEscape(ev: Event): void {
    if (this.openTile() !== null) { ev.stopPropagation(); this.openTile.set(null); }
  }
}
