import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  EnvironmentInjector,
  NgZone,
  OnDestroy,
  OnInit,
  ViewEncapsulation,
  afterNextRender,
  createComponent,
  inject,
  input,
} from '@angular/core';

/**
 * Popup kinds (concept 20261115-0215, decision `r1-dur`):
 * - `small`    menus, header panels, toasts; grows from its trigger corner.
 * - `dialog`   confirm dialogs and other centred dialogs.
 * - `large`    a full-screen veil with a window inside (the window = `scPopupMotionPlate`, default
 *              the veil's first element child); the veil gets the faint dot-grid scrim.
 * - `panel`    a large window without a veil (the host is the window itself, e.g. the compare tray).
 * - `lightbox` the image viewer: zooms from `scPopupMotionFrom` (the thumbnail), arrives blue-tinted.
 * - `phone`    a phone fullscreen overlay: grows from `scPopupMotionFrom` (the button) if given.
 */
export type PopupMotionKind = 'small' | 'dialog' | 'large' | 'panel' | 'lightbox' | 'phone';
/** Where the motion starts: a trigger corner (anchored popups) or the centre (dialogs, large windows). */
export type PopupMotionOrigin = 'tl' | 'tr' | 'bl' | 'br' | 'center';
/** A click source: the trigger element, or its rect. */
export type PopupMotionSource = Element | DOMRectReadOnly | { left: number; top: number; width: number; height: number } | null | undefined;

export interface PopupMotionTiming {
  /** Open duration in ms. */
  readonly open: number;
  /** Close duration in ms: about half the open, its own collapse, never the open reversed (C4). */
  readonly close: number;
}

/** Open / close per kind (C3, C4, P8). */
export const POPUP_MOTION_TIMING: Readonly<Record<PopupMotionKind, PopupMotionTiming>> = {
  small: { open: 300, close: 160 },
  dialog: { open: 500, close: 250 },
  large: { open: 900, close: 400 },
  panel: { open: 900, close: 400 },
  lightbox: { open: 650, close: 300 },
  phone: { open: 500, close: 250 },
};
/** Row cascade (C5): only the first rows, this far apart. */
export const POPUP_MOTION_ROW_STEP_MS = 30;
export const POPUP_MOTION_STAGGER_ROWS = 6;
/** Rows past this index are off screen in practice and never animate (a 300-row table must not run 300 filters). */
export const POPUP_MOTION_MAX_ROWS = 40;
const MAX_CONTENT = 60;

/** Class on <html> while a large window covers the page (the view-toggle FAB hides under it). */
export const POPUP_LARGE_OPEN_CLASS = 'sc-popup-large-open';
let largeOpen = 0;
function markLargeOpen(on: boolean): void {
  if (typeof document === 'undefined') return;
  largeOpen = Math.max(0, largeOpen + (on ? 1 : -1));
  document.documentElement.classList.toggle(POPUP_LARGE_OPEN_CLASS, largeOpen > 0);
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
/** How long a close of this kind keeps the element (0 under reduced motion: nothing animates, C11). */
export function popupMotionCloseMs(kind: PopupMotionKind, reduced = prefersReducedMotion()): number {
  return reduced ? 0 : POPUP_MOTION_TIMING[kind].close;
}

/** Holds the (global, un-encapsulated) stylesheet; created once, never destroyed so the styles stay. */
@Component({
  selector: 'sc-popup-motion-styles',
  standalone: true,
  template: '',
  styleUrl: './popup-motion.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScPopupMotionStylesComponent {}

/** Keyed by the ApplicationRef: every new application (each TestBed reset) gets its own style host. */
const stylesMounted = new WeakSet<ApplicationRef>();

/**
 * Mount the shared popup stylesheet now instead of with the first popup (inserting a stylesheet
 * re-matches the whole document; doing it in the open's first frame costs a full style pass).
 */
export function ensurePopupMotionStyles(env: EnvironmentInjector): void {
  const app = env.get(ApplicationRef);
  if (stylesMounted.has(app) || typeof document === 'undefined') return;
  stylesMounted.add(app);
  createComponent(ScPopupMotionStylesComponent, { environmentInjector: env });
}

// ---------------------------------------------------------------- keyframes (offsets = share of the duration)

const E_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const E_IO = 'cubic-bezier(0.65, 0, 0.35, 1)';
const E_IN = 'cubic-bezier(0.5, 0, 0.8, 0.4)';
type Edge = 'top' | 'bottom' | 'center';
type Frames = Keyframe[];

/** The outline's clip: the band the line stands in, or the whole box (+ room for the glow). */
function wireBand(edge: Edge): string {
  if (edge === 'top') return 'inset(-14px -14px calc(100% - 3px) -14px)';
  if (edge === 'bottom') return 'inset(calc(100% - 3px) -14px -14px -14px)';
  return 'inset(calc(50% - 1px) -14px calc(50% - 1px) -14px)';
}
const WIRE_FULL = 'inset(-14px -14px -14px -14px)';
const PANEL_FULL = 'inset(-60px -60px -60px -60px)';
function panelBand(edge: Edge): string {
  if (edge === 'top') return 'inset(-2px -60px 100% -60px)';
  if (edge === 'bottom') return 'inset(100% -60px -2px -60px)';
  return 'inset(50% -60px 50% -60px)';
}
/** The fill mask (C1 "fills from the top"): half black, half clear, twice the box's height. */
function fillMask(edge: Edge): { image: string; from: string; to: string } {
  return edge === 'bottom'
    ? { image: 'linear-gradient(0deg, #000 0 46%, transparent 54%)', from: '0 0', to: '0 100%' }
    : { image: 'linear-gradient(180deg, #000 0 46%, transparent 54%)', from: '0 100%', to: '0 0' };
}

/**
 * Open (round-2 pin): the spark builds up first and shrinks while the line grows out of it, so
 * the two never stand at full size together; the line is only the popup's width and fades while
 * the outline unrolls from it (no hard hand-off).
 */
export const POPUP_MOTION_OPEN = {
  spark: (): Frames => [
    { offset: 0, opacity: 0, transform: 'scale(0.3)' },
    { offset: 0.08, opacity: 1, transform: 'scale(1)', easing: E_OUT },
    { offset: 0.24, opacity: 0, transform: 'scale(0.3)' },
    { offset: 1, opacity: 0, transform: 'scale(0.3)' },
  ],
  line: (): Frames => [
    { offset: 0, opacity: 0, transform: 'scaleX(0)' },
    { offset: 0.06, opacity: 0, transform: 'scaleX(0.01)', easing: E_OUT },
    { offset: 0.36, opacity: 1, transform: 'scaleX(1)', easing: E_IO },
    { offset: 0.62, opacity: 0, transform: 'scaleX(1)' },
    { offset: 1, opacity: 0, transform: 'scaleX(1)' },
  ],
  wire: (edge: Edge): Frames => [
    { offset: 0, opacity: 0, clipPath: wireBand(edge) },
    { offset: 0.24, opacity: 0, clipPath: wireBand(edge) },
    { offset: 0.3, opacity: 0.9, clipPath: wireBand(edge), easing: E_OUT },
    { offset: 0.6, opacity: 1, clipPath: WIRE_FULL },
    { offset: 0.76, opacity: 1, clipPath: WIRE_FULL, easing: 'ease-in-out' },
    { offset: 1, opacity: 0.35, clipPath: WIRE_FULL },
  ],
  glow: (edge: Edge): Frames => [
    { offset: 0, opacity: 0, clipPath: wireBand(edge) },
    { offset: 0.24, opacity: 0, clipPath: wireBand(edge) },
    { offset: 0.3, opacity: 0.9, clipPath: wireBand(edge), easing: E_OUT },
    { offset: 0.6, opacity: 1, clipPath: WIRE_FULL },
    { offset: 0.76, opacity: 0.8, clipPath: WIRE_FULL, easing: 'ease-in-out' },
    { offset: 1, opacity: 0, clipPath: WIRE_FULL },
  ],
  fill: (edge: Edge): Frames => {
    const m = fillMask(edge);
    return [
      { offset: 0, maskPosition: m.from },
      { offset: 0.42, maskPosition: m.from, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      { offset: 0.8, maskPosition: m.to },
      { offset: 1, maskPosition: m.to },
    ];
  },
  content: (): Frames => [
    { offset: 0, opacity: 0, filter: 'blur(4px) brightness(1.5)' },
    { offset: 0.62, opacity: 0, filter: 'blur(4px) brightness(1.5)', easing: E_OUT },
    { offset: 0.97, opacity: 1, filter: 'blur(0px) brightness(1)' },
    { offset: 1, opacity: 1, filter: 'blur(0px) brightness(1)' },
  ],
  image: (): Frames => [
    { offset: 0, opacity: 0, filter: 'saturate(0.15) brightness(1.4) blur(3px)' },
    { offset: 0.4, opacity: 1, filter: 'saturate(0.3) brightness(1.3) blur(0px)', easing: 'ease-out' },
    { offset: 1, opacity: 1, filter: 'saturate(1) brightness(1) blur(0px)' },
  ],
  veil: (): Frames => [
    { offset: 0, opacity: 0, easing: 'ease-out' },
    { offset: 0.35, opacity: 1 },
    { offset: 1, opacity: 1 },
  ],
  tint: (): Frames => [
    { offset: 0, opacity: 0.55 },
    { offset: 0.3, opacity: 0.55, easing: 'ease-out' },
    { offset: 1, opacity: 0 },
  ],
  zoom: (from: string): Frames => [
    { offset: 0, transform: from },
    { offset: 0.02, transform: from, easing: E_OUT },
    { offset: 0.7, transform: 'translate(0px, 0px) scale(1, 1)' },
    { offset: 1, transform: 'translate(0px, 0px) scale(1, 1)' },
  ],
};
/** Rows (C5): a soft light edge sweeps across (mask) with a slight blur; own duration and delay. */
const ROW_IN: Frames = [
  { opacity: 0, filter: 'blur(2px) brightness(1.6)', maskPosition: '100% 0' },
  { opacity: 1, filter: 'blur(0px) brightness(1)', maskPosition: '0 0' },
];
const ROW_MASK = 'linear-gradient(90deg, #000 0 40%, transparent 60%)';

/** Close: content out, the window collapses to the line, the line shrinks into the spark. */
export const POPUP_MOTION_CLOSE = {
  content: (): Frames => [
    { offset: 0, opacity: 1, filter: 'blur(0px)', easing: 'ease-in' },
    { offset: 0.3, opacity: 0, filter: 'blur(2px)' },
    { offset: 1, opacity: 0, filter: 'blur(2px)' },
  ],
  panel: (edge: Edge): Frames => [
    { offset: 0, clipPath: PANEL_FULL },
    { offset: 0.2, clipPath: PANEL_FULL, easing: E_IO },
    { offset: 0.7, clipPath: panelBand(edge) },
    { offset: 1, clipPath: panelBand(edge) },
  ],
  wire: (edge: Edge): Frames => [
    { offset: 0, opacity: 0.35, clipPath: WIRE_FULL },
    { offset: 0.15, opacity: 1, clipPath: WIRE_FULL },
    { offset: 0.2, opacity: 1, clipPath: WIRE_FULL, easing: E_IO },
    { offset: 0.7, opacity: 1, clipPath: wireBand(edge) },
    { offset: 0.78, opacity: 0, clipPath: wireBand(edge) },
    { offset: 1, opacity: 0, clipPath: wireBand(edge) },
  ],
  glow: (edge: Edge): Frames => [
    { offset: 0, opacity: 0, clipPath: WIRE_FULL },
    { offset: 0.15, opacity: 1, clipPath: WIRE_FULL },
    { offset: 0.2, opacity: 1, clipPath: WIRE_FULL, easing: E_IO },
    { offset: 0.7, opacity: 1, clipPath: wireBand(edge) },
    { offset: 0.78, opacity: 0, clipPath: wireBand(edge) },
    { offset: 1, opacity: 0, clipPath: wireBand(edge) },
  ],
  line: (): Frames => [
    { offset: 0, opacity: 0, transform: 'scaleX(1)' },
    { offset: 0.55, opacity: 0, transform: 'scaleX(1)', easing: 'ease-out' },
    { offset: 0.68, opacity: 1, transform: 'scaleX(1)' },
    // Ease-out: the line is mostly gone before the spark builds (the pin: never both at full size).
    { offset: 0.7, opacity: 1, transform: 'scaleX(1)', easing: E_OUT },
    { offset: 0.88, opacity: 0.9, transform: 'scaleX(0.01)' },
    { offset: 0.92, opacity: 0, transform: 'scaleX(0)' },
    { offset: 1, opacity: 0, transform: 'scaleX(0)' },
  ],
  spark: (): Frames => [
    { offset: 0, opacity: 0, transform: 'scale(0.3)' },
    { offset: 0.8, opacity: 0, transform: 'scale(0.3)', easing: E_OUT },
    { offset: 0.93, opacity: 1, transform: 'scale(1)' },
    { offset: 1, opacity: 0, transform: 'scale(0.7)' },
  ],
  veil: (): Frames => [
    { offset: 0, opacity: 1 },
    { offset: 0.5, opacity: 1, easing: 'ease-in' },
    { offset: 1, opacity: 0 },
  ],
  tint: (): Frames => [
    { offset: 0, opacity: 0 },
    { offset: 0.6, opacity: 0.55 },
    { offset: 1, opacity: 0.55 },
  ],
  zoom: (to: string): Frames => [
    { offset: 0, transform: 'translate(0px, 0px) scale(1, 1)' },
    { offset: 0.15, transform: 'translate(0px, 0px) scale(1, 1)', easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)' },
    { offset: 0.85, transform: to },
    { offset: 1, transform: to },
  ],
};

interface Geometry {
  rect: DOMRect;
  edge: Edge;
  sparkX: number;
  sparkY: number;
  /** Transform from the click source to the window (zoom kinds with a source), else null. */
  zoom: string | null;
}

function sourceRect(src: PopupMotionSource): { left: number; top: number; width: number; height: number } | null {
  if (!src) return null;
  if (typeof Element !== 'undefined' && src instanceof Element) {
    const r = src.getBoundingClientRect();
    return r.width || r.height ? r : null;
  }
  return src as { left: number; top: number; width: number; height: number };
}

/** How long the slowest animation of a run still plays in its current direction. */
function remaining(run: readonly Animation[]): number {
  let max = 0;
  for (const a of run) {
    const t = Number(a.currentTime ?? 0);
    const rate = a.playbackRate || 1;
    const end = Number(a.effect?.getComputedTiming().endTime ?? 0);
    const left = rate < 0 ? t / -rate : (end - t) / rate;
    if (left > max) max = left;
  }
  return Math.ceil(max);
}

/**
 * `[scPopupMotion]` - the Vektor-Aufriss popup motion (concept 20261115-0215, round 2 `r2d2`).
 *
 * Open: a spark at the origin, a short light line grows out of it (the spark fades while it does),
 * a glowing 1px outline unrolls from the line, the window fills from the top, the content resolves
 * from blur(4px) brightness(1.5); the outline rests as a faint edge (.35). Close (about half the
 * open, its own gesture): content out, the window collapses to the line, the line shrinks into the
 * spark. Rows: the first 6 sweep in with a soft light edge, 30 ms apart. Spark, line and outline
 * are drawn by an overlay frame in <body> above the window (the window itself is masked while it fills).
 *
 * Inputs:
 * - `scPopupMotion`        kind (see {@link PopupMotionKind}; empty = `small`), timings in {@link POPUP_MOTION_TIMING}.
 * - `scPopupMotionOrigin`  `tl` / `tr` / `bl` / `br` / `center`; default `tr` for `small`, `center` otherwise.
 * - `scPopupMotionFrom`    the trigger element (or a rect): anchored popups put the spark under it;
 *                          `lightbox` / `phone` zoom from it (the window's own transform stays, the zoom is added).
 * - `scPopupMotionPlate`   CSS selector of the window inside a veil host (`large` default: first element child).
 * - `scPopupMotionItems`   entries that resolve from blur (menus); everything else resolves as a whole.
 * - `scPopupMotionRows`    rows that sweep in (default `tbody tr, .pm-row-src`).
 * - `scPopupMotionFoot`    footnotes that resolve last.
 *
 * Closing: `exit()` (Promise, resolves when the close is over) or `animate.leave="pm-out"` on an
 * `@if` element. `restart()` during a close reverses it from where it stands (C8); `exit()` during
 * the open reverses the open the same way. Reduced motion: nothing animates, `exit()` resolves at
 * once (C11). Focus, Escape and the scrim rules stay with `[scDialog]`: nothing here hides,
 * disables or delays the window, and the fill is a mask, which never blocks a click (C7).
 */
@Directive({
  selector: '[scPopupMotion]',
  standalone: true,
  exportAs: 'scPopupMotion',
  host: { class: 'pm-host' },
})
export class ScPopupMotionDirective implements OnInit, OnDestroy {
  readonly scPopupMotion = input<PopupMotionKind | ''>('small');
  readonly scPopupMotionOrigin = input<PopupMotionOrigin | ''>('');
  readonly scPopupMotionFrom = input<PopupMotionSource>(null);
  readonly scPopupMotionPlate = input('');
  readonly scPopupMotionRows = input('tbody tr, .pm-row-src');
  readonly scPopupMotionFoot = input('');
  readonly scPopupMotionItems = input('');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private readonly env = inject(EnvironmentInjector);

  private phase: 'idle' | 'opening' | 'open' | 'closing' | 'closed' = 'idle';
  /** What the running animations are: the open (possibly reversed) or the close (possibly reversed). */
  private runOf: 'open' | 'close' = 'open';
  private run: Animation[] = [];
  private frame: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;
  private masked: HTMLElement[] = [];
  private seenRows = new WeakSet<Element>();
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rowObserver: MutationObserver | null = null;
  private sizeObserver: ResizeObserver | null = null;
  private leaveObserver: MutationObserver | null = null;
  private exiting: Promise<void> | null = null;
  private resolveExit: (() => void) | null = null;
  private large = false;

  constructor() {
    ensurePopupMotionStyles(this.env);
    // After the first render, before the first paint: the window is laid out, nothing has shown yet.
    afterNextRender(() => this.zone.runOutsideAngular(() => this.open()));
  }

  get kind(): PopupMotionKind {
    return this.scPopupMotion() || 'small';
  }
  get timing(): PopupMotionTiming {
    return POPUP_MOTION_TIMING[this.kind];
  }
  /** `opening` / `open` / `closing` / `closed` (`idle` before the first render). */
  get state(): string {
    return this.phase;
  }

  ngOnInit(): void {
    this.host.classList.add(`pm-${this.kind}`);
    this.host.style.setProperty('--pmv-close', String(this.timing.close));
    this.setLarge(true);
    if (typeof MutationObserver === 'undefined') return;
    // `animate.leave="pm-out"` sets the class itself (Angular then waits for the host's animations).
    this.leaveObserver = new MutationObserver(() => {
      if (this.phase === 'closing' || this.phase === 'closed' || !this.host.classList.contains('pm-out')) return;
      this.close();
    });
    this.zone.runOutsideAngular(() => this.leaveObserver!.observe(this.host, { attributes: true, attributeFilter: ['class'] }));
  }

  /** Play the close; resolves when it is over (at once under reduced motion). */
  exit(): Promise<void> {
    if (this.exiting) return this.exiting;
    this.exiting = new Promise<void>((resolve) => (this.resolveExit = resolve));
    this.host.classList.add('pm-out');
    this.close();
    return this.exiting;
  }

  /**
   * Re-open while a close is still playing (the host never left the DOM): the close reverses from
   * where it stands, no restart from 0 (C8). A pending `exit()` promise then never resolves.
   */
  restart(): void {
    if (this.phase !== 'closing' && this.phase !== 'closed') return;
    this.exiting = null;
    this.resolveExit = null;
    this.host.classList.remove('pm-out', 'pmv-still');
    this.setLarge(true);
    this.clearTimer();
    if (this.run.length === 0 || prefersReducedMotion()) {
      this.settle();
      return;
    }
    this.phase = 'opening';
    // Set at once (not updatePlaybackRate): the turn must happen in this frame, from this state.
    for (const a of this.run) a.playbackRate = this.runOf === 'open' ? 1 : -1;
    this.later(remaining(this.run) + 20, () => this.settle());
  }

  ngOnDestroy(): void {
    this.stopSizeWatch();
    this.rowObserver?.disconnect();
    this.setLarge(false);
    // With `animate.leave` Angular adds the class after the destroy hooks: watch one more turn.
    const leave = this.leaveObserver;
    if (leave) setTimeout(() => leave.disconnect(), 0);
    if (this.phase !== 'closing') {
      this.clearTimer();
      this.frame?.remove();
      this.frame = null;
    }
    // A running close finishes on its own timer: the frame lives in <body>, outside the host.
  }

  // ------------------------------------------------------------------ open

  private open(): void {
    if (this.phase !== 'idle') return;
    const panel = this.panel();
    this.panelEl = panel;
    if (panel !== this.host) {
      this.host.classList.add('pmv-veil');
      this.layer(this.host, 'pmv-scrim', true);
    }
    if (prefersReducedMotion() || typeof panel.animate !== 'function') {
      this.settle();
      return;
    }
    const geo = this.geometry(panel);
    if (!geo) {
      this.settle();
      return;
    }
    this.phase = 'opening';
    this.runOf = 'open';
    this.startedAt = performance.now();
    const T = this.timing.open;
    const O = POPUP_MOTION_OPEN;
    const opt = (): KeyframeAnimationOptions => ({ duration: T, fill: 'both' });
    const run: Animation[] = [];
    const f = this.buildFrame(geo);
    run.push(f.spark.animate(O.spark(), opt()));
    run.push(f.line.animate(O.line(), opt()));
    run.push(f.wire.animate(O.wire(geo.edge), opt()));
    run.push(f.glow.animate(O.glow(geo.edge), opt()));
    if (f.tint) run.push(f.tint.animate(O.tint(), opt()));
    if (geo.zoom) {
      run.push(f.box.animate(O.zoom(geo.zoom), opt()));
      run.push(panel.animate(O.zoom(geo.zoom), { ...opt(), composite: 'add' }));
    }
    this.setMask(panel, fillMask(geo.edge).image, '100% 200%');
    run.push(panel.animate(O.fill(geo.edge), opt()));
    if (panel !== this.host) run.push(this.host.animate(O.veil(), opt()));
    const { content, rows, foot } = this.targets(panel);
    const resolve = this.kind === 'lightbox' ? O.image : O.content;
    for (const el of content) run.push(el.animate(resolve(), opt()));
    for (const el of foot) run.push(el.animate(O.content(), { duration: T, delay: Math.round(T * 0.12), fill: 'both' }));
    this.run = run;
    rows.forEach((el, i) => this.animateRow(el, i));
    this.watchRows(panel);
    this.watchSize(panel, f);
    const tail = rows.length ? (POPUP_MOTION_STAGGER_ROWS - 1) * POPUP_MOTION_ROW_STEP_MS : 0;
    this.later(T + tail + 30, () => this.settle());
  }

  private animateRow(el: HTMLElement, i: number): void {
    if (this.seenRows.has(el) || i >= POPUP_MOTION_MAX_ROWS) return;
    this.seenRows.add(el);
    const T = this.timing.open;
    const elapsed = performance.now() - this.startedAt;
    const at = T * 0.6 + Math.min(i, POPUP_MOTION_STAGGER_ROWS - 1) * POPUP_MOTION_ROW_STEP_MS;
    this.setMask(el, ROW_MASK, '250% 100%');
    this.run.push(
      el.animate(ROW_IN, { duration: Math.max(160, Math.round(T * 0.25)), delay: Math.max(0, Math.round(at - elapsed)), fill: 'both', easing: E_OUT }),
    );
  }

  /** Rows that arrive while the window opens (a list built across frames) join the cascade. */
  private watchRows(panel: HTMLElement): void {
    if (typeof MutationObserver === 'undefined') return;
    this.rowObserver = new MutationObserver(() => {
      if (this.phase !== 'opening' || this.runOf !== 'open') return;
      panel.querySelectorAll<HTMLElement>(this.scPopupMotionRows()).forEach((el, i) => this.animateRow(el, i));
    });
    this.rowObserver.observe(panel, { childList: true, subtree: true });
  }

  /**
   * A window that lays out its content after the first frame (async data, a table built later)
   * grows while it opens: the overlay frame follows its box, so the line and the outline stay on
   * the window's real edge instead of a stale, smaller rectangle.
   */
  private watchSize(panel: HTMLElement, f: { line: HTMLElement; spark: HTMLElement }): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.sizeObserver = new ResizeObserver(() => {
      if (this.phase !== 'opening' || !this.frame) return;
      const geo = this.geometry(panel);
      if (!geo) return;
      const s = this.frame.style;
      s.left = `${geo.rect.left}px`;
      s.top = `${geo.rect.top}px`;
      s.width = `${geo.rect.width}px`;
      s.height = `${geo.rect.height}px`;
      f.line.style.transformOrigin = `${geo.zoom ? geo.rect.width / 2 : geo.sparkX}px 50%`;
      f.spark.style.left = `${geo.sparkX}px`;
      f.spark.style.top = `${geo.sparkY}px`;
    });
    this.sizeObserver.observe(panel);
  }

  private stopSizeWatch(): void {
    this.sizeObserver?.disconnect();
    this.sizeObserver = null;
  }

  /** Open over: drop every effect (the window is back to its own styles), the faint edge stays. */
  private settle(): void {
    this.timer = null;
    this.stopSizeWatch();
    this.rowObserver?.disconnect();
    this.rowObserver = null;
    this.cancelRun();
    this.frame?.remove();
    this.frame = null;
    (this.panelEl ?? this.host).classList.add('pmv-rest');
    this.phase = 'open';
  }

  // ------------------------------------------------------------------ close

  private close(): void {
    this.setLarge(false);
    this.stopSizeWatch();
    this.rowObserver?.disconnect();
    this.rowObserver = null;
    this.clearTimer();
    const panel = this.panelEl ?? this.panel();
    if (prefersReducedMotion() || typeof panel.animate !== 'function') {
      // Nothing plays, not even the leave timer: animate.leave removes the element at once.
      this.host.classList.add('pmv-still');
      this.cancelRun();
      this.frame?.remove();
      this.frame = null;
      this.finishClose();
      return;
    }
    const C = this.timing.close;
    if (this.phase === 'closing') return;
    if (this.phase === 'opening' && this.runOf === 'open' && this.run.length) {
      // Closed before the open was over: the open runs back from where it stands, at close pace.
      this.phase = 'closing';
      const rate = -(this.timing.open / C);
      for (const a of this.run) a.playbackRate = rate;
      this.later(Math.min(C, remaining(this.run)) + 20, () => this.finishClose());
      return;
    }
    this.cancelRun();
    this.frame?.remove();
    this.frame = null;
    this.phase = 'closing';
    this.runOf = 'close';
    panel.classList.remove('pmv-rest');
    const geo = this.geometry(panel);
    if (!geo) {
      this.finishClose();
      return;
    }
    const X = POPUP_MOTION_CLOSE;
    const opt = (): KeyframeAnimationOptions => ({ duration: C, fill: 'both' });
    const run: Animation[] = [];
    const f = this.buildFrame(geo);
    run.push(f.spark.animate(X.spark(), opt()));
    run.push(f.line.animate(X.line(), opt()));
    run.push(f.wire.animate(X.wire(geo.edge), opt()));
    run.push(f.glow.animate(X.glow(geo.edge), opt()));
    if (f.tint) run.push(f.tint.animate(X.tint(), opt()));
    if (geo.zoom) {
      run.push(f.box.animate(X.zoom(geo.zoom), opt()));
      run.push(panel.animate(X.zoom(geo.zoom), { ...opt(), composite: 'add' }));
    }
    run.push(panel.animate(X.panel(geo.edge), opt()));
    if (panel !== this.host) run.push(this.host.animate(X.veil(), opt()));
    const { content, rows, foot } = this.targets(panel);
    for (const el of [...content, ...rows, ...foot]) run.push(el.animate(X.content(), opt()));
    this.run = run;
    this.later(C + 10, () => this.finishClose());
  }

  /** Close over: the window holds its collapsed state until its owner removes it. */
  private finishClose(): void {
    this.timer = null;
    this.phase = 'closed';
    this.frame?.remove();
    this.frame = null;
    const done = this.resolveExit;
    this.resolveExit = null;
    if (done) this.zone.run(done);
  }

  // ------------------------------------------------------------------ helpers

  private panel(): HTMLElement {
    const sel = this.scPopupMotionPlate();
    if (sel) return this.host.querySelector<HTMLElement>(sel) ?? this.host;
    if (this.kind !== 'large') return this.host;
    return Array.from(this.host.children).find((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('pmv-layer')) ?? this.host;
  }

  private geometry(panel: HTMLElement): Geometry | null {
    const rect = panel.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const kind = this.kind;
    const origin = this.scPopupMotionOrigin() || (kind === 'small' ? 'tr' : 'center');
    const edge: Edge = origin === 'center' ? 'center' : origin[0] === 'b' ? 'bottom' : 'top';
    const src = sourceRect(this.scPopupMotionFrom());
    const w = rect.width;
    const h = rect.height;
    let sparkX = w / 2;
    let sparkY = h / 2;
    let zoom: string | null = null;
    if (edge !== 'center') {
      const inset = Math.min(28, w / 2);
      sparkX = origin[1] === 'r' ? w - inset : inset;
      if (src) sparkX = Math.min(w - 12, Math.max(12, src.left + src.width / 2 - rect.left));
      sparkY = edge === 'top' ? 0 : h;
    } else if (src && (kind === 'lightbox' || kind === 'phone')) {
      const cx = src.left + src.width / 2;
      const cy = src.top + src.height / 2;
      sparkX = cx - rect.left;
      sparkY = cy - rect.top;
      const tx = Math.round(cx - (rect.left + w / 2));
      const ty = Math.round(cy - (rect.top + h / 2));
      const sx = Math.max(0.02, src.width / w);
      const sy = Math.max(0.02, src.height / h);
      // The lightbox keeps the image's proportions; the phone sheet morphs from the button's box.
      const s = kind === 'lightbox' ? Math.max(sx, sy).toFixed(4) : `${sx.toFixed(4)}, ${sy.toFixed(4)}`;
      zoom = `translate(${tx}px, ${ty}px) scale(${s})`;
    }
    return { rect, edge, sparkX, sparkY, zoom };
  }

  private buildFrame(geo: Geometry): { box: HTMLElement; spark: HTMLElement; line: HTMLElement; wire: HTMLElement; glow: HTMLElement; tint: HTMLElement | null } {
    const panel = this.panelEl ?? this.host;
    const frame = document.createElement('div');
    frame.className = `pmv-frame pmv-${this.kind}`;
    frame.setAttribute('aria-hidden', 'true');
    const s = frame.style;
    s.left = `${geo.rect.left}px`;
    s.top = `${geo.rect.top}px`;
    s.width = `${geo.rect.width}px`;
    s.height = `${geo.rect.height}px`;
    s.setProperty('--pmv-r', getComputedStyle(panel).borderRadius || '0');
    const box = this.layer(frame, 'pmv-box');
    const glow = this.layer(box, 'pmv-glow');
    const wire = this.layer(box, 'pmv-wire');
    const tint = this.kind === 'lightbox' ? this.layer(box, 'pmv-tint') : null;
    const line = this.layer(box, `pmv-line pmv-line-${geo.edge}`);
    line.style.transformOrigin = `${geo.zoom ? geo.rect.width / 2 : geo.sparkX}px 50%`;
    const spark = this.layer(frame, 'pmv-spark');
    spark.style.left = `${geo.sparkX}px`;
    spark.style.top = `${geo.sparkY}px`;
    document.body.append(frame);
    this.frame = frame;
    return { box, spark, line, wire, glow, tint };
  }

  private layer(parent: HTMLElement, cls: string, first = false): HTMLElement {
    const el = document.createElement('span');
    el.className = `pmv-layer ${cls}`;
    el.setAttribute('aria-hidden', 'true');
    if (first) parent.prepend(el);
    else parent.append(el);
    return el;
  }

  /** The elements that resolve: items, rows and footnotes as given, every other leaf block as a whole. */
  private targets(panel: HTMLElement): { content: HTMLElement[]; rows: HTMLElement[]; foot: HTMLElement[] } {
    const all = (sel: string): HTMLElement[] => (sel ? Array.from(panel.querySelectorAll<HTMLElement>(sel)) : []);
    const items = all(this.scPopupMotionItems()).slice(0, MAX_CONTENT);
    const rows = all(this.scPopupMotionRows()).slice(0, POPUP_MOTION_MAX_ROWS);
    const foot = all(this.scPopupMotionFoot());
    const claimed = new Set<Element>([...items, ...rows, ...foot]);
    const content: HTMLElement[] = [...items];
    const visit = (el: Element, depth: number): void => {
      for (const child of Array.from(el.children)) {
        if (content.length >= MAX_CONTENT) return;
        if (!(child instanceof HTMLElement) || claimed.has(child) || child.classList.contains('pmv-layer') || child.tagName === 'TR') continue;
        let holds = false;
        for (const c of claimed) {
          if (child.contains(c)) {
            holds = true;
            break;
          }
        }
        if (!holds) content.push(child);
        else if (depth < 4) visit(child, depth + 1);
      }
    };
    visit(panel, 0);
    return { content, rows, foot };
  }

  private setMask(el: HTMLElement, image: string, size: string): void {
    const s = el.style;
    s.setProperty('mask-image', image);
    s.setProperty('mask-size', size);
    s.setProperty('mask-repeat', 'no-repeat');
    this.masked.push(el);
  }

  private cancelRun(): void {
    for (const a of this.run) a.cancel();
    this.run = [];
    for (const el of this.masked) {
      el.style.removeProperty('mask-image');
      el.style.removeProperty('mask-size');
      el.style.removeProperty('mask-repeat');
    }
    this.masked = [];
  }

  private setLarge(on: boolean): void {
    const isLarge = this.kind === 'large' || this.kind === 'panel';
    if (!isLarge || this.large === on) return;
    this.large = on;
    markLargeOpen(on);
  }

  private later(ms: number, fn: () => void): void {
    this.clearTimer();
    this.zone.runOutsideAngular(() => (this.timer = setTimeout(fn, ms)));
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
