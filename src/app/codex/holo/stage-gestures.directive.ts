import { DestroyRef, Directive, ElementRef, NgZone, inject, input, output, signal } from '@angular/core';

export const GESTURE_MIN_SCALE = 1;
export const GESTURE_MAX_SCALE = 4;
/** Movement under this (px) and a press under TAP_MS is a tap, not a drag. */
export const TAP_SLOP = 8;
export const TAP_MS = 300;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_DIST = 24;

export interface StageView { x: number; y: number; s: number }

export const IDENTITY: StageView = { x: 0, y: 0, s: 1 };

export function clampScale(s: number): number {
  return Math.min(GESTURE_MAX_SCALE, Math.max(GESTURE_MIN_SCALE, s));
}

/** Keeps the zoomed content on its frame: at scale s it may move (s - 1) / 2 of the frame, plus a quarter as slack. */
export function clampPan(v: StageView, w: number, h: number): StageView {
  if (v.s <= GESTURE_MIN_SCALE + 0.001) return IDENTITY;
  const mx = ((v.s - 1) * w) / 2 + w * 0.25;
  const my = ((v.s - 1) * h) / 2 + h * 0.25;
  return { s: v.s, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
}

/** Pinch: the content point under the starting midpoint stays under the (moving) midpoint. Coordinates relative to the frame centre. */
export function pinchView(start: StageView, startMid: { x: number; y: number }, startDist: number, mid: { x: number; y: number }, dist: number): StageView {
  const s = clampScale(start.s * (dist / Math.max(1, startDist)));
  const k = s / start.s;
  return { s, x: mid.x - (startMid.x - start.x) * k, y: mid.y - (startMid.y - start.y) * k };
}

/**
 * Touch / pen gestures of the hull stage, one directive for the whole surface: one finger pans, two fingers
 * pinch (about their midpoint) and pan, a double tap resets. The view goes out as CSS custom properties
 * (`--zx`, `--zy`, `--z`) on the host, written once per animation frame; the stage's CSS applies them to
 * ONE wrapper and counter-scales the pins so they keep their size. Mouse input is left alone (desktop
 * keeps its parallax). A press that has not moved past the slop is never captured, so pin taps keep priority.
 */
@Directive({
  selector: '[scStageGestures]',
  exportAs: 'scStageGestures',
  host: {
    '[class.gesturing]': 'gesturing()',
    '[class.zoomed]': 'zoomed()',
    '[class.zoom-anim]': 'animating()',
  },
})
export class StageGesturesDirective {
  /** Off = the directive does nothing (3D view brings its own camera). */
  readonly scStageGestures = input(true);
  readonly scStageGesturesStill = input(false);
  /** The current zoom factor changed (1 = identity). */
  readonly zoomChange = output<number>();

  readonly gesturing = signal(false);
  readonly animating = signal(false);
  readonly zoomed = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private view: StageView = IDENTITY;
  private raf = 0;
  private animTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private startView: StageView = IDENTITY;
  private startMid = { x: 0, y: 0 };
  private startDist = 1;
  private startPt = { x: 0, y: 0 };
  private downAt = 0;
  private moved = false;
  private multi = false;
  private lastTap: { t: number; x: number; y: number } | null = null;
  private swallowClick = false;
  private lastEmitted = 1;

  constructor() {
    const el = this.host;
    const opts = { passive: true } as const;
    const down = (e: PointerEvent) => this.onDown(e);
    const move = (e: PointerEvent) => this.onMove(e);
    const up = (e: PointerEvent) => this.onUp(e);
    const click = (e: MouseEvent) => {
      if (this.swallowClick) { this.swallowClick = false; e.stopPropagation(); e.preventDefault(); }
    };
    this.zone.runOutsideAngular(() => {
      el.addEventListener('pointerdown', down, opts);
      el.addEventListener('pointermove', move, opts);
      el.addEventListener('pointerup', up, opts);
      el.addEventListener('pointercancel', up, opts);
      el.addEventListener('click', click, true);
    });
    inject(DestroyRef).onDestroy(() => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('click', click, true);
      cancelAnimationFrame(this.raf);
      clearTimeout(this.animTimer);
      clearTimeout(this.idleTimer);
    });
  }

  /** Back to the identity view; animated unless motion is reduced. */
  reset(): void {
    if (this.view.s === 1 && this.view.x === 0 && this.view.y === 0) return;
    this.view = IDENTITY;
    if (!this.scStageGesturesStill()) {
      this.zone.run(() => this.animating.set(true));
      clearTimeout(this.animTimer);
      this.animTimer = setTimeout(() => this.zone.run(() => this.animating.set(false)), 320);
    }
    this.write();
  }

  /** The current view (for tests). */
  current(): StageView { return this.view; }

  private rel(p: { x: number; y: number }): { x: number; y: number } {
    const r = this.host.getBoundingClientRect();
    return { x: p.x - (r.left + r.width / 2), y: p.y - (r.top + r.height / 2) };
  }

  private onDown(e: PointerEvent): void {
    if (!this.scStageGestures() || e.pointerType === 'mouse') return;
    clearTimeout(this.idleTimer);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.downAt = performance.now();
      this.moved = false;
      this.multi = false;
      this.startPt = { x: e.clientX, y: e.clientY };
      this.startView = this.view;
    } else {
      this.beginPinch();
    }
  }

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    this.multi = true;
    this.moved = true;
    this.startView = this.view;
    this.startMid = this.rel({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    this.startDist = Math.hypot(a.x - b.x, a.y - b.y);
    this.setGesturing(true);
    for (const id of this.pointers.keys()) this.capture(id);
  }

  private capture(id: number): void {
    try { this.host.setPointerCapture(id); } catch { /* the pointer is gone */ }
  }

  private onMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.scStageGestures()) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const r = this.host.getBoundingClientRect();
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const mid = this.rel({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      this.view = clampPan(pinchView(this.startView, this.startMid, this.startDist, mid, Math.hypot(a.x - b.x, a.y - b.y)), r.width, r.height);
      this.schedule();
      return;
    }
    const dx = e.clientX - this.startPt.x;
    const dy = e.clientY - this.startPt.y;
    if (!this.moved) {
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      this.moved = true;
      this.setGesturing(true);
      this.capture(e.pointerId);
    }
    // One finger pans only a zoomed view: at scale 1 there is nothing to pan, the drag stays a plain swipe.
    if (this.startView.s > 1.001 || this.view.s > 1.001) {
      this.view = clampPan({ s: this.startView.s, x: this.startView.x + dx, y: this.startView.y + dy }, r.width, r.height);
      this.schedule();
    }
  }

  private onUp(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 1) {
      // Pinch to pan: the remaining finger carries on from here.
      const [rest] = [...this.pointers.values()];
      this.startPt = { x: rest.x, y: rest.y };
      this.startView = this.view;
      return;
    }
    if (this.pointers.size > 0) return;
    const wasTap = !this.moved && !this.multi && e.type === 'pointerup' && performance.now() - this.downAt < TAP_MS;
    if (this.moved) {
      // A drag that began on a pin must not press it on release.
      if (e.type === 'pointerup') this.swallowClick = true;
      setTimeout(() => (this.swallowClick = false), 0);
    }
    if (wasTap && !(e.target as Element | null)?.closest?.('button, a, [data-no-gesture]')) {
      const now = performance.now();
      const t = this.lastTap;
      if (t && now - t.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - t.x, e.clientY - t.y) < DOUBLE_TAP_DIST) {
        this.lastTap = null;
        this.reset();
      } else {
        this.lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    }
    if (this.view.s <= 1.001) this.view = IDENTITY;
    this.write();
    clearTimeout(this.idleTimer);
    // will-change stays on for 200 ms after the last finger, then the layer is given back.
    this.idleTimer = setTimeout(() => this.setGesturing(false), 200);
  }

  private setGesturing(on: boolean): void {
    if (this.gesturing() === on) return;
    this.zone.run(() => this.gesturing.set(on));
  }

  private schedule(): void {
    this.raf ||= requestAnimationFrame(() => { this.raf = 0; this.write(); });
  }

  private write(): void {
    const { x, y, s } = this.view;
    const st = this.host.style;
    st.setProperty('--zx', `${x.toFixed(1)}px`);
    st.setProperty('--zy', `${y.toFixed(1)}px`);
    st.setProperty('--z', s.toFixed(3));
    const z = s > 1.001;
    if (z !== this.zoomed()) this.zone.run(() => this.zoomed.set(z));
    if (Math.abs(s - this.lastEmitted) > 0.01) {
      this.lastEmitted = s;
      this.zone.run(() => this.zoomChange.emit(s));
    }
  }
}
