import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** One star: where it stands (percent of the sky) and when its twinkle starts (0.37 s apart, like the mock). */
export interface WishSkyDot {
  readonly left: number;
  readonly top: number;
  readonly delay: number;
}

/** The ten dots of the concept's night sky (design d3 "Sternschnuppe"), positions and stagger as mocked. */
export const WISH_SKY_DOTS: readonly WishSkyDot[] = [
  [12, 30], [24, 62], [38, 22], [52, 70], [63, 34], [74, 58], [86, 24], [91, 72], [18, 82], [46, 44],
].map(([left, top], i) => ({ left, top, delay: Math.round(i * 0.37 * 100) / 100 }));

/**
 * `<sc-wish-sky>` - the night sky of the wishes: ten twinkling dots and two shooting stars, purely decorative
 * (`aria-hidden`). `variant="hero"` is the 136 px picture of the empty state, `variant="backdrop"` fills its positioned host behind the content (the empty state and the cart's top, batch note #6), `variant="strip"` the 84 px strip above
 * the groups of the large window. The sky is dark blues mixed from `--sc-accent` and `--sc-bg-0`, the stars neutral
 * white and the accent: no colour of its own. `prefers-reduced-motion: reduce` keeps the dots lit and drops the streaks.
 */
@Component({
  selector: 'sc-wish-sky',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[attr.data-variant]': 'variant()' },
  template: `
    <div class="sky">
      @for (d of dots; track $index) {
        <span class="dot" [style.left.%]="d.left" [style.top.%]="d.top" [style.animation-delay.s]="d.delay"></span>
      }
      <span class="shoot"></span>
      <span class="shoot shoot2"></span>
    </div>
  `,
  styles: [
    `
      :host { display: block; position: relative; width: 100%; height: 136px; border-radius: 8px; overflow: hidden; }
      :host([data-variant='strip']) { height: 84px; }
      /* Backdrop (batch note #6): the sky lies behind the panel content instead of standing as its own box. It fills
         its positioned host, has no frame and fades out downwards so text and actions stay readable. */
      :host([data-variant='backdrop']) { position: absolute; inset: 0; z-index: 0; width: auto; height: auto; border-radius: inherit; pointer-events: none; }
      :host([data-variant='backdrop']) .sky {
        border: 0; border-radius: inherit;
        background: radial-gradient(ellipse 90% 70% at 78% 0, color-mix(in srgb, var(--sc-accent) 20%, transparent), transparent 72%);
        -webkit-mask-image: linear-gradient(180deg, black 45%, transparent);
        mask-image: linear-gradient(180deg, black 45%, transparent);
      }
      :host([data-variant='backdrop']) .dot { opacity: 0.5; }
      .sky {
        position: absolute; inset: 0; box-sizing: border-box; overflow: hidden; border-radius: 8px;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 18%, transparent);
        background: radial-gradient(ellipse at 72% 0, color-mix(in srgb, var(--sc-accent) 30%, var(--sc-bg-0)), color-mix(in srgb, var(--sc-accent) 7%, var(--sc-bg-0)) 72%);
      }
      .dot {
        position: absolute; width: 2px; height: 2px; border-radius: 50%;
        background: color-mix(in srgb, white 88%, var(--sc-accent)); animation: wish-tw 3.2s ease-in-out infinite;
      }
      .shoot {
        position: absolute; right: 6%; top: 6%; width: 96px; height: 2px; border-radius: 2px; opacity: 0;
        background: linear-gradient(90deg, white, color-mix(in srgb, var(--sc-accent) 65%, transparent) 30%, transparent);
        animation: wish-shoot 5s ease-in infinite;
      }
      .shoot2 { right: 38%; top: -4%; width: 64px; animation-delay: 2.6s; }
      @keyframes wish-tw { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
      @keyframes wish-shoot {
        0% { opacity: 0; transform: translate(70px, -32px) rotate(-24deg); }
        6% { opacity: 1; }
        26% { opacity: 0; transform: translate(-330px, 146px) rotate(-24deg); }
        100% { opacity: 0; transform: translate(-330px, 146px) rotate(-24deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .dot { animation: none; opacity: 0.85; }
        .shoot { animation: none; display: none; }
      }
    `,
  ],
})
export class WishSkyComponent {
  protected readonly dots = WISH_SKY_DOTS;
  readonly variant = input<'hero' | 'strip' | 'backdrop'>('hero');
}
