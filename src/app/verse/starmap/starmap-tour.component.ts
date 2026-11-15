import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';

/** The steps of the tour: `[data-tour]` marks the real element a step lights up. */
export const STARMAP_TOUR_STEPS = ['stage', 'patch', 'comet', 'guess', 'rank'] as const;
export type StarmapTourStep = (typeof STARMAP_TOUR_STEPS)[number];

interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Inline tutorial of the star map (shell beta; implement.md §12). It carries every
 * explanation the old Logbuch sheet held (community sky, suns, Kartograph perks,
 * where series and wallpaper went):
 * first three bullets, then a step-by-step walk that rings the REAL elements of the
 * panel (`[data-tour]`). Non-modal `[scDialog]` card - focus moves in, Tab stays on
 * the card, Escape closes and hands focus back to the help button.
 */
@Component({
  selector: 'sc-starmap-tour',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ScActionDirective, ScPopupComponent],
  template: `
    @if (step() >= 0 && box(); as b) {
      <i class="ring" aria-hidden="true"
         [style.top.px]="b.top" [style.left.px]="b.left" [style.width.px]="b.width" [style.height.px]="b.height"></i>
    }
    <sc-popup class="card" kind="panel" initialFocus="container" [returnFocus]="returnTo()" (closed)="closed.emit()"
              [eyebrow]="step() < 0 ? ('starmap.tour.eyebrow' | translate) : ('starmap.tour.progress' | translate: { n: step() + 1, total: steps().length })"
              [title]="step() < 0 ? ('starmap.tour.title' | translate) : ('starmap.tour.step.' + current() + '.title' | translate)">
      @if (step() < 0) {
        <ul class="points">
          <li>{{ 'starmap.tour.p1' | translate }}</li>
          <li>{{ 'starmap.tour.p2' | translate }}</li>
          <li>{{ 'starmap.tour.p3' | translate }}</li>
        </ul>
        <ng-container popupActions>
          <button type="button" scAction tier="primary" (click)="go(0)">{{ 'starmap.tour.start' | translate }}</button>
        </ng-container>
      } @else {
        <p class="text" role="status">{{ 'starmap.tour.step.' + current() + '.text' | translate }}</p>
        <ng-container popupActions>
          @if (step() < steps().length - 1) {
            <button type="button" scAction tier="primary" (click)="go(step() + 1)">{{ 'starmap.tour.next' | translate }}</button>
          } @else {
            <button type="button" scAction tier="primary" (click)="closed.emit()">{{ 'starmap.tour.done' | translate }}</button>
          }
          <button type="button" scAction [disabled]="step() === 0" (click)="go(step() - 1)">{{ 'starmap.tour.back' | translate }}</button>
        </ng-container>
      }
    </sc-popup>
  `,
  styles: [
    `
      :host { position: absolute; inset: 0; z-index: 20; pointer-events: none; }
      .ring { position: absolute; box-sizing: border-box; border-radius: 12px; pointer-events: none;
        border: 2px solid var(--sc-accent); box-shadow: 0 0 0 9999px color-mix(in srgb, var(--sc-bg-0) 62%, transparent), 0 0 24px color-mix(in srgb, var(--sc-accent) 45%, transparent);
        transition: top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease; }
      /* Frame, head, ✕, footer and width come from <sc-popup kind="panel">; only its place
         (bottom right of the sky, a coach mark that must not hide the ringed element). */
      .card { position: absolute; pointer-events: auto; right: var(--sc-space-3, 12px); bottom: var(--sc-space-3, 12px); }
      .points { margin: 0 0 var(--sc-gap-3); padding-left: 1.1rem; display: grid; gap: var(--sc-gap-2); color: var(--sc-fg-1); font-size: 0.9rem; }
      .text { margin: 0 0 var(--sc-gap-3); color: var(--sc-fg-1); font-size: 0.9rem; }
      .count { margin: 0 0 4px; color: var(--sc-fg-2); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
      .points { margin: 0; }
      /* Phone: the scaffold's panel is full screen, which would cover the very element the tour
         rings. The coach mark stays a card at the bottom (scaffold change request: a coach-mark flag). */
      @media (max-width: 720px) {
        .card { position: fixed; inset: auto 8px var(--sc-float-bottom, 8px) 8px; }
        .card ::ng-deep .scp-frame { position: relative; inset: auto; inline-size: 100%; block-size: auto; max-block-size: 70dvh; border: 1px solid var(--sc-border); border-radius: 6px; padding: 0; }
      }
    `,
  ],
})
export class StarmapTourComponent {
  private readonly destroyRef = inject(DestroyRef);

  /** The panel the `[data-tour]` elements live in; the ring is positioned inside it. */
  readonly root = input.required<HTMLElement>();
  /** The help button, focus returns there on close. */
  readonly returnTo = input<HTMLElement | null>(null);
  readonly closed = output<void>();

  /** -1 = the three bullets, then the index into `steps()`. */
  readonly step = signal(-1);
  private readonly tick = signal(0);
  readonly box = signal<Box | null>(null);

  /** Only the steps whose element is on the panel right now (a locked track is skipped). */
  readonly steps = computed<readonly StarmapTourStep[]>(() => {
    this.tick();
    const root = this.root();
    return STARMAP_TOUR_STEPS.filter((s) => !!root.querySelector(`[data-tour="${s}"]`));
  });
  readonly current = computed(() => this.steps()[this.step()] ?? 'stage');

  private scrolledStep = -1;

  constructor() {
    effect(() => {
      const i = this.step();
      this.tick();
      if (i < 0) {
        this.box.set(null);
        return;
      }
      const el = this.target(this.current());
      if (!el) return;
      // Scroll only when the step changes; a resize/scroll tick just re-measures.
      if (this.scrolledStep !== i) {
        this.scrolledStep = i;
        el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
      this.measure(el);
    });
    afterNextRender(() => {
      const root = this.root();
      const redo = () => this.tick.update((n) => n + 1);
      const ro = new ResizeObserver(redo);
      ro.observe(root);
      window.addEventListener('resize', redo);
      this.destroyRef.onDestroy(() => {
        ro.disconnect();
        window.removeEventListener('resize', redo);
      });
    });
  }

  go(i: number): void {
    this.step.set(Math.max(0, Math.min(this.steps().length - 1, i)));
  }

  private target(step: StarmapTourStep): HTMLElement | null {
    return this.root().querySelector<HTMLElement>(`[data-tour="${step}"]`);
  }

  private measure(el: HTMLElement): void {
    const root = this.root().getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const pad = 6;
    this.box.set({ top: r.top - root.top - pad, left: r.left - root.left - pad, width: r.width + 2 * pad, height: r.height + 2 * pad });
  }
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
