import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, afterNextRender, inject, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { VerseBodiesService } from '../verse/pages/briefing/bodies/body.directive';

/**
 * When the living planet joins the scene: after the intro (motion spec B3.2, phase 8), so the body
 * engine's worker / shader warm-up never competes with the arrival take for the GPU.
 */
export const LOGIN_PLANET_ATTACH_MS = 1800;

/**
 * `<sc-login-scene>` — the "Brücke" stage behind the signed-out landing page (concept
 * 20261115-2122, screen d3-zwei; motion spec in that concept's parity.md, "B3.2 motion spec").
 *
 * The visitor arrives on a ship's bridge above microTech: stars come out of the black, the planet
 * rises into the canopy, a light sweep crosses the glass and the HUD locks on. All of it is CSS
 * keyframes whose resting styles are the final frame, so `prefers-reduced-motion` simply drops
 * the animations. The planet itself is the Verse hub's living body (the shared WebGL engine,
 * `VerseBodiesService`, rendered off the main thread) laid over a cheap CSS disc that carries the
 * intro and stays as the fallback without WebGL. Purely decorative: `aria-hidden`, no focusables.
 */
@Component({
  selector: 'sc-login-scene',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <div class="ls-sky">
      <i class="ls-nebula"></i>
      <i class="ls-stars ls-stars-a"></i>
      <i class="ls-stars ls-stars-b"></i>
    </div>
    <div class="ls-stage">
      <div class="ls-world">
        <i class="ls-atm"></i>
        <i class="ls-disc"></i>
        <canvas #planet class="ls-gl"></canvas>
        <i class="ls-shade"></i>
      </div>
      <i class="ls-ring"></i>
      <i class="ls-sweep"></i>
      <div class="ls-hud">
        <i class="ls-corner tl"></i><i class="ls-corner tr"></i><i class="ls-corner bl"></i><i class="ls-corner br"></i>
        <p class="ls-readout"><b>{{ 'auth.landing.scene.approach' | translate }}</b><span>{{ 'auth.landing.scene.target' | translate }}</span></p>
      </div>
    </div>
    <i class="ls-vignette"></i>
  `,
  styles: [`
    :host {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      background: linear-gradient(180deg, #050f18 0%, #03080e 60%, #02060a 100%);
      --ls-expo: cubic-bezier(0.16, 1, 0.3, 1);
      --ls-io: cubic-bezier(0.65, 0, 0.35, 1);
    }
    i { display: block; font-style: normal; }
    .ls-sky, .ls-nebula, .ls-stars, .ls-vignette { position: absolute; inset: 0; }
    .ls-nebula {
      background:
        radial-gradient(60% 45% at 30% 30%, rgba(40, 120, 160, 0.22), transparent 70%),
        radial-gradient(40% 35% at 75% 80%, rgba(194, 122, 90, 0.10), transparent 70%),
        radial-gradient(30% 25% at 12% 85%, rgba(60, 90, 160, 0.14), transparent 70%);
    }
    .ls-stars-a {
      background-image:
        radial-gradient(1px 1px at 12% 22%, #cfeaff, transparent),
        radial-gradient(1px 1px at 32% 68%, #9fd2ea, transparent),
        radial-gradient(1.5px 1.5px at 58% 18%, #e7f6ff, transparent),
        radial-gradient(1px 1px at 78% 52%, #9fd2ea, transparent),
        radial-gradient(1px 1px at 88% 82%, #cfeaff, transparent),
        radial-gradient(1px 1px at 46% 88%, #9fd2ea, transparent);
      background-size: 260px 260px;
    }
    .ls-stars-b {
      background-image:
        radial-gradient(1px 1px at 20% 40%, #e7f6ff, transparent),
        radial-gradient(1.5px 1.5px at 70% 15%, #ffffff, transparent),
        radial-gradient(1px 1px at 40% 75%, #cfeaff, transparent),
        radial-gradient(2px 2px at 85% 60%, rgba(220, 245, 255, 0.9), transparent);
      background-size: 410px 410px;
      opacity: 0.8;
    }

    /* The stage is the part of the canopy beside the console (the page sets --ls-console). */
    .ls-stage { position: absolute; inset: 0 var(--ls-console, 0px) 0 0; }

    .ls-world {
      position: absolute;
      left: 74%;
      top: 44%;
      width: min(100vh, 82%);
      aspect-ratio: 1;
      translate: -50% -50%;
    }
    .ls-disc, .ls-gl, .ls-shade, .ls-atm { position: absolute; inset: 0; border-radius: 50%; }
    .ls-disc {
      /* microTech's ice, lit from the upper right like the living planet that replaces it. */
      background: radial-gradient(circle at 68% 28%, #f2f8fb 0%, #c4d9e4 12%, #7f9fb2 30%, #3b5a6d 48%, #13283a 66%, #050d15 82%);
    }
    .ls-gl { width: 100%; height: 100%; opacity: 0; transition: opacity 0.7s ease; }
    .ls-gl.on { opacity: 1; }
    /* Night side: keeps the hero copy (bottom left) on a dark ground, WebGL or not. */
    .ls-shade { background: radial-gradient(circle at 64% 30%, transparent 46%, rgba(2, 8, 14, 0.55) 72%, rgba(2, 8, 14, 0.9) 100%); }
    .ls-atm {
      inset: -3%;
      background: radial-gradient(circle, transparent 64%, rgba(120, 210, 245, 0.30) 69%, rgba(82, 193, 230, 0.10) 74%, transparent 78%);
      filter: blur(2px);
    }
    .ls-ring {
      position: absolute;
      left: 74%;
      top: 44%;
      width: min(150vh, 124%);
      aspect-ratio: 5 / 1;
      translate: -50% -50%;
      rotate: -14deg;
      border-radius: 50%;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 32%, transparent);
      border-top-color: transparent;
      opacity: 0.8;
      mask-image: linear-gradient(90deg, transparent 8%, #000 52%);
    }
    .ls-sweep {
      position: absolute;
      inset: -20%;
      background: linear-gradient(105deg, transparent 42%, rgba(190, 238, 255, 0.14) 49%, rgba(255, 255, 255, 0.22) 50%, rgba(190, 238, 255, 0.14) 51%, transparent 58%);
      opacity: 0;
      mix-blend-mode: screen;
    }
    .ls-hud { position: absolute; inset: clamp(72px, 12vh, 104px) 5% clamp(40px, 7vh, 72px) 5%; }
    .ls-corner { position: absolute; width: 34px; height: 34px; border: 0 solid color-mix(in srgb, var(--sc-accent) 55%, transparent); }
    .ls-corner.tl { top: 0; left: 0; border-top-width: 1px; border-left-width: 1px; }
    .ls-corner.tr { top: 0; right: 0; border-top-width: 1px; border-right-width: 1px; }
    .ls-corner.bl { bottom: 0; left: 0; border-bottom-width: 1px; border-left-width: 1px; }
    .ls-corner.br { bottom: 0; right: 0; border-bottom-width: 1px; border-right-width: 1px; }
    .ls-readout {
      position: absolute;
      top: 12px;
      left: 16px;
      margin: 0;
      display: flex;
      gap: 12px;
      font: 500 max(0.66rem, var(--sc-fs-floor, 11px)) / 1 var(--sc-font-display);
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .ls-readout b { color: var(--sc-accent); font-weight: 500; }
    .ls-vignette {
      background:
        linear-gradient(90deg, rgba(2, 6, 10, 0.72) 0%, rgba(2, 6, 10, 0.35) 32%, transparent 52%),
        radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(1, 5, 9, 0.75) 100%);
    }

    @media (prefers-reduced-motion: no-preference) {
      .ls-stars, .ls-nebula { animation: ls-void 0.9s var(--ls-expo) both; }
      .ls-stars-a { animation: ls-void 0.9s var(--ls-expo) both, ls-twinkle 5s ease-in-out 0.9s infinite alternate; }
      .ls-stars-b { animation: ls-void 0.9s var(--ls-expo) both, ls-twinkle 7s ease-in-out 0.9s infinite alternate-reverse; }
      .ls-world { animation: ls-rise 1.4s var(--ls-expo) 0.15s both; }
      .ls-atm { animation: ls-breathe 9s ease-in-out 1.6s infinite alternate; }
      .ls-ring { animation: ls-draw 1.1s var(--ls-io) 0.6s both; }
      .ls-sweep { animation: ls-sweep 0.9s var(--ls-io) 0.75s both; }
      .ls-hud { animation: ls-lock 0.5s ease-out 0.9s both; }
    }
    @keyframes ls-void { from { opacity: 0; transform: scale(1.06); } }
    @keyframes ls-twinkle { to { opacity: 0.45; } }
    @keyframes ls-rise { from { opacity: 0; transform: translateY(22%) scale(0.9); filter: brightness(0.4); } }
    @keyframes ls-breathe { to { opacity: 0.6; } }
    @keyframes ls-draw { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
    @keyframes ls-sweep {
      0% { opacity: 0; transform: translateX(-120%); }
      40% { opacity: 0.9; }
      100% { opacity: 0; transform: translateX(120%); }
    }
    @keyframes ls-lock {
      0% { opacity: 0; transform: scale(1.08); }
      55% { opacity: 1; }
      65% { opacity: 0.35; }
      100% { opacity: 1; transform: none; }
    }

    /* Phones: a band on top — the planet fills its right, the HUD stays out. */
    @media (max-width: 860px) {
      .ls-world { left: 82%; top: 64%; width: min(118vw, 520px); }
      .ls-ring { left: 82%; top: 64%; width: 190vw; }
      .ls-hud { display: none; }
    }
  `],
})
export class LoginSceneComponent {
  private readonly planet = viewChild.required<ElementRef<HTMLCanvasElement>>('planet');

  constructor() {
    const bodies = inject(VerseBodiesService);
    const zone = inject(NgZone);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const canvas = this.planet().nativeElement;
      let detach: (() => void) | null = null;
      const attach = (): void => {
        detach = bodies.attach(canvas, 'microtech', () => canvas.classList.add('on'), () => canvas.classList.remove('on'));
      };
      const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Outside the zone: a pending attach must not hold the app unstable through the intro.
      const timer = still ? null : zone.runOutsideAngular(() => setTimeout(attach, LOGIN_PLANET_ATTACH_MS));
      if (still) attach();
      destroyRef.onDestroy(() => {
        if (timer !== null) clearTimeout(timer);
        detach?.();
      });
    });
  }
}
