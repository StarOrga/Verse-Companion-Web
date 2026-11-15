import { ChangeDetectionStrategy, Component, signal, viewChildren } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  POPUP_LARGE_OPEN_CLASS,
  POPUP_MOTION_CLOSE,
  POPUP_MOTION_ROW_STEP_MS,
  POPUP_MOTION_TIMING,
  PopupMotionKind,
  ScPopupMotionDirective,
  popupMotionCloseMs,
} from './sc-popup-motion.directive';

@Component({
  standalone: true,
  imports: [ScPopupMotionDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <button #trig class="trig" style="position: fixed; left: 40px; top: 4px; width: 32px; height: 32px">t</button>
    @if (showSmall()) {
      <div class="small" style="position: fixed; left: 20px; top: 40px; width: 240px; height: 160px"
           scPopupMotion="small" scPopupMotionItems=".e" scPopupMotionOrigin="tl" [scPopupMotionFrom]="trig">
        <header class="hd">head</header>
        <a class="e" href="#a">1</a><a class="e" href="#b">2</a>
        <button class="btn" type="button">go</button>
      </div>
    }
    @if (showDialog()) {
      <div class="dialog" style="position: fixed; left: 300px; top: 100px; width: 320px; height: 200px" [scPopupMotion]="dialogKind()">
        <p class="txt">question</p>
      </div>
    }
    @if (showLarge()) {
      <div class="veil" style="position: fixed; inset: 0" scPopupMotion="large" scPopupMotionPlate=".win" scPopupMotionFoot=".foot">
        <article class="win" style="position: absolute; left: 100px; top: 100px; width: 600px; height: 400px">
          <header>head</header>
          <table><thead><tr><th>h</th></tr></thead><tbody>@for (r of rows; track r) { <tr><td>{{ r }}</td></tr> }</tbody></table>
          <footer class="foot">foot</footer>
        </article>
      </div>
    }
  `,
})
class HostComponent {
  readonly rows = Array.from({ length: 60 }, (_, i) => i);
  readonly showSmall = signal(true);
  readonly showDialog = signal(false);
  readonly showLarge = signal(false);
  readonly dialogKind = signal<PopupMotionKind>('dialog');
  readonly motions = viewChildren(ScPopupMotionDirective);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => document.querySelector<HTMLElement>('.pmv-frame');
const durationOf = (a: Animation) => Number(a.effect?.getTiming().duration);

describe('ScPopupMotionDirective (Vektor-Aufriss)', () => {
  let reduced = false;
  beforeEach(() => {
    reduced = false;
    const real = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) =>
      q.includes('prefers-reduced-motion') ? ({ matches: reduced, media: q } as MediaQueryList) : real(q),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('.pmv-frame').forEach((f) => f.remove());
  });

  function mount(set?: (c: HostComponent) => void) {
    const fixture = TestBed.createComponent(HostComponent);
    set?.(fixture.componentInstance);
    fixture.detectChanges();
    return fixture;
  }
  function motionOf(f: ReturnType<typeof mount>, sel: string): ScPopupMotionDirective {
    const el = f.nativeElement.querySelector(sel);
    return f.componentInstance.motions().find((m) => (m as unknown as { host: HTMLElement }).host === el)!;
  }

  it('C3/C4/P8: open and close per kind, the close about half the open', () => {
    expect(POPUP_MOTION_TIMING).toEqual({
      small: { open: 300, close: 160 },
      dialog: { open: 500, close: 250 },
      large: { open: 900, close: 400 },
      panel: { open: 900, close: 400 },
      lightbox: { open: 650, close: 300 },
      phone: { open: 500, close: 250 },
    });
    for (const t of Object.values(POPUP_MOTION_TIMING)) expect(t.close / t.open).toBeGreaterThan(0.4);
    expect(popupMotionCloseMs('dialog', false)).toBe(250);
    expect(popupMotionCloseMs('dialog', true)).toBe(0);
  });

  it('C1/P1-P5: small opens with spark, line, outline, a top fill and blurred content, all in 300 ms', async () => {
    const f = mount();
    await f.whenStable();
    const el = f.nativeElement.querySelector('.small') as HTMLElement;
    const fr = frame()!;
    expect(fr).not.toBeNull();
    for (const cls of ['pmv-spark', 'pmv-line', 'pmv-wire', 'pmv-glow']) expect(fr.querySelector(`.${cls}`)).not.toBeNull();
    expect(fr.getBoundingClientRect().width).toBeCloseTo(240, 0);
    const own = el.getAnimations();
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((a) => durationOf(a) === 300)).toBe(true);
    // The top-down fill: 180deg is the default direction, so the browser drops it from the value.
    expect(el.style.getPropertyValue('mask-image')).toMatch(/^linear-gradient\(rgb\(0, 0, 0\)/);
    // Items and the header resolve from blur.
    expect(el.querySelector('.e')!.getAnimations().length).toBe(1);
    expect(el.querySelector('.hd')!.getAnimations().length).toBe(1);
    // No old Kamera-Welt layers.
    expect(document.querySelector('.pm-ring, .pm-beam, .pm-limb, .pm-stars, .pm-horizon')).toBeNull();
  });

  it('P1/C2: the spark builds first, and is gone by the time the line stands at full length', () => {
    const f = mount();
    const spark = frame()!.querySelector('.pmv-spark')!.getAnimations()[0];
    const line = frame()!.querySelector('.pmv-line')!.getAnimations()[0];
    const kf = (a: Animation) => (a.effect as KeyframeEffect).getKeyframes();
    const lineFull = kf(line).find((k) => String(k['transform']) === 'scaleX(1)')!.computedOffset;
    const sparkPeak = kf(spark).find((k) => Number(k['opacity']) === 1)!.computedOffset;
    const sparkGone = kf(spark).find((k, i) => i > 0 && Number(k['opacity']) === 0)!.computedOffset;
    expect(sparkPeak).toBeLessThan(lineFull);
    expect(sparkGone).toBeLessThan(lineFull);
    f.destroy();
  });

  it('C6: an anchored popup puts the spark under its trigger, a dialog at its centre', async () => {
    const f = mount((c) => c.showSmall.set(true));
    await f.whenStable();
    const spark = frame()!.querySelector<HTMLElement>('.pmv-spark')!;
    // Trigger centre x = 56, popup left = 20 → 36px into the popup, on its top edge.
    expect(parseFloat(spark.style.left)).toBeCloseTo(36, 0);
    expect(parseFloat(spark.style.top)).toBe(0);
    f.destroy();
    const g = mount((c) => { c.showSmall.set(false); c.showDialog.set(true); });
    await g.whenStable();
    const s2 = frame()!.querySelector<HTMLElement>('.pmv-spark')!;
    expect(parseFloat(s2.style.left)).toBeCloseTo(160, 0);
    expect(parseFloat(s2.style.top)).toBeCloseTo(100, 0);
    expect(frame()!.querySelector('.pmv-line-center')).not.toBeNull();
    expect(g.nativeElement.querySelector('.dialog')!.getAnimations().every((a: Animation) => durationOf(a) === 500)).toBe(true);
  });

  it('C5/C13/P6/P11: large veil gets the dot-grid scrim, 900 ms, and only the first 6 rows cascade 30 ms apart', async () => {
    const root = document.documentElement;
    const f = mount((c) => { c.showSmall.set(false); c.showLarge.set(true); });
    await f.whenStable();
    const veil = f.nativeElement.querySelector('.veil') as HTMLElement;
    expect(veil.querySelector(':scope > .pmv-scrim')).not.toBeNull();
    expect(veil.classList.contains('pmv-veil')).toBe(true);
    expect(veil.getAnimations().every((a) => durationOf(a) === 900)).toBe(true);
    const rows = Array.from(veil.querySelectorAll('tbody tr'));
    const delay = (i: number) => Number(rows[i].getAnimations()[0]?.effect?.getTiming().delay);
    for (let i = 1; i < 6; i++) expect(delay(i) - delay(i - 1)).toBeCloseTo(POPUP_MOTION_ROW_STEP_MS, -1);
    // Rows past the sixth start with it (delays are offset by the ms already elapsed, hence ±5).
    expect(Math.abs(delay(10) - delay(5))).toBeLessThanOrEqual(5);
    expect(rows[50].getAnimations().length).toBe(0);
    expect(root.classList.contains(POPUP_LARGE_OPEN_CLASS)).toBe(true);
    expect(root.classList.contains('sc-scene-pushin')).toBe(false);
    void motionOf(f, '.veil').exit();
    expect(root.classList.contains(POPUP_LARGE_OPEN_CLASS)).toBe(false);
    f.destroy();
  });

  it('C2: a window that grows while it opens keeps the frame on its real box', async () => {
    const f = mount((c) => { c.showSmall.set(false); c.showLarge.set(true); });
    await f.whenStable();
    const win = f.nativeElement.querySelector('.win') as HTMLElement;
    expect(frame()?.getBoundingClientRect().height).toBeCloseTo(400, 0);
    win.style.height = '700px';
    await sleep(60);
    const box = frame()!.getBoundingClientRect();
    expect(box.height).toBeCloseTo(700, 0);
    expect(box.top).toBeCloseTo(win.getBoundingClientRect().top, 0);
    f.destroy();
  });

  it('destroyed mid-open: the frame goes and every running effect is released', async () => {
    const f = mount((c) => { c.showSmall.set(false); c.showDialog.set(true); });
    await f.whenStable();
    const el = f.nativeElement.querySelector('.dialog') as HTMLElement;
    const running = el.getAnimations({ subtree: true });
    expect(running.length).toBeGreaterThan(0);
    f.destroy();
    expect(frame()).toBeNull();
    expect(running.every((a) => a.playState === 'idle')).toBe(true);
  });

  it('C2: on close the line is nearly gone before the spark builds', () => {
    const line = POPUP_MOTION_CLOSE.line();
    const spark = POPUP_MOTION_CLOSE.spark();
    const sparkStart = spark.find((k) => Number(k['opacity']) === 0 && Number(k.offset) > 0.5)!.offset!;
    const lineGone = line.find((k) => String(k['transform']).includes('0.01'))!.offset!;
    expect(Number(sparkStart)).toBeGreaterThanOrEqual(0.8);
    expect(Number(lineGone)).toBeLessThanOrEqual(0.9);
    // The ease-out shrink has the line well below half length when the spark starts.
    expect(line.find((k) => k.offset === 0.7)?.easing).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
  });

  it('settles after the open: every effect is gone, the faint resting edge stays', async () => {
    const f = mount();
    const el = f.nativeElement.querySelector('.small') as HTMLElement;
    await sleep(POPUP_MOTION_TIMING.small.open + 120);
    expect(el.getAnimations({ subtree: true }).length).toBe(0);
    expect(el.style.getPropertyValue('mask-image')).toBe('');
    expect(frame()).toBeNull();
    expect(el.classList.contains('pmv-rest')).toBe(true);
    expect(motionOf(f, '.small').state).toBe('open');
  });

  it('C4/P7: exit() plays its own collapse in the close time and resolves once, then', async () => {
    const f = mount();
    await sleep(POPUP_MOTION_TIMING.small.open + 120);
    const m = motionOf(f, '.small');
    const el = f.nativeElement.querySelector('.small') as HTMLElement;
    let done = false;
    const p = m.exit().then(() => (done = true));
    expect(m.exit()).toBe(m.exit());
    expect(el.classList.contains('pm-out')).toBe(true);
    expect(el.classList.contains('pmv-rest')).toBe(false);
    expect(el.getAnimations().filter((a) => !(a as CSSAnimation).animationName).every((a) => durationOf(a) === 160)).toBe(true);
    const line = frame()!.querySelector('.pmv-line')!.getAnimations()[0];
    expect((line.effect as KeyframeEffect).getKeyframes().at(-1)!['transform']).toBe('scaleX(0)');
    await sleep(100);
    expect(done).toBe(false);
    await p;
    expect(done).toBe(true);
    expect(frame()).toBeNull();
  });

  it('C8: restart() during a close reverses it from where it stands, no restart from 0', async () => {
    const f = mount();
    await sleep(POPUP_MOTION_TIMING.small.open + 120);
    const m = motionOf(f, '.small');
    const el = f.nativeElement.querySelector('.small') as HTMLElement;
    void m.exit();
    await sleep(80);
    const before = el.getAnimations().find((a) => !(a as CSSAnimation).animationName)!;
    const t = Number(before.currentTime);
    m.restart();
    expect(el.classList.contains('pm-out')).toBe(false);
    expect(before.playbackRate).toBe(-1);
    expect(Number(before.currentTime)).toBeGreaterThan(t * 0.5);
    await sleep(t + 80);
    expect(m.state).toBe('open');
    expect(el.classList.contains('pmv-rest')).toBe(true);
  });

  it('C8: exit() during the open runs the open back from its current state', async () => {
    const f = mount((c) => { c.showSmall.set(false); c.showDialog.set(true); });
    await f.whenStable();
    const m = motionOf(f, '.dialog');
    const el = f.nativeElement.querySelector('.dialog') as HTMLElement;
    const a = el.getAnimations()[0];
    await a.ready;
    // Pin the open mid-way instead of sleeping: a loaded test machine may not advance it in time.
    for (const x of el.getAnimations({ subtree: true })) x.currentTime = 250;
    const t = Number(a.currentTime);
    expect(t).toBeGreaterThan(100);
    const p = m.exit();
    expect(a.playbackRate).toBeLessThan(0);
    expect(Number(a.currentTime)).toBeGreaterThan(t * 0.5);
    await p;
    expect(m.state).toBe('closed');
  });

  it('animate.leave: the pm-out class alone starts the close', async () => {
    const f = mount();
    await sleep(POPUP_MOTION_TIMING.small.open + 120);
    const el = f.nativeElement.querySelector('.small') as HTMLElement;
    el.classList.add('pm-out');
    await sleep(0);
    expect(motionOf(f, '.small').state).toBe('closing');
    expect(frame()).not.toBeNull();
    // The CSS timer Angular's animate.leave waits for lasts the close.
    const hold = el.getAnimations().find((a) => (a as CSSAnimation).animationName === 'pmv-hold');
    expect(hold && durationOf(hold)).toBe(160);
  });

  it('C7: focus and clicks work from the first frame', () => {
    const f = mount();
    const btn = f.nativeElement.querySelector('.btn') as HTMLButtonElement;
    btn.focus();
    expect(document.activeElement).toBe(btn);
    const r = btn.getBoundingClientRect();
    expect(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)).toBe(btn);
  });

  it('C11: reduced motion animates nothing and exit() resolves at once', async () => {
    reduced = true;
    const f = mount((c) => c.showLarge.set(true));
    await f.whenStable();
    const el = f.nativeElement.querySelector('.small') as HTMLElement;
    expect(frame()).toBeNull();
    expect(el.getAnimations({ subtree: true }).length).toBe(0);
    expect(f.nativeElement.querySelector('.veil').getAnimations({ subtree: true }).length).toBe(0);
    let done = false;
    void motionOf(f, '.small').exit().then(() => (done = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
    expect(el.getAnimations().length).toBe(0);
  });

  it('removing the window mid-open drops its frame', async () => {
    const f = mount();
    expect(frame()).not.toBeNull();
    f.componentInstance.showSmall.set(false);
    f.detectChanges();
    await sleep(0);
    expect(frame()).toBeNull();
  });
});
