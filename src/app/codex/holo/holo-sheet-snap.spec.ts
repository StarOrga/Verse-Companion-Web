import { cycleSnap, dragVisible, releaseVelocity, settleSnap, SnapHeights } from './holo-sheet-snap';

const H: SnapHeights = { peek: 100, half: 400, full: 700 };

describe('holo sheet snap', () => {
  it('a tap cycles peek -> half -> peek', () => {
    expect(cycleSnap('peek')).toBe('half');
    expect(cycleSnap('half')).toBe('peek');
    expect(cycleSnap('full')).toBe('peek');
  });

  it('follows the finger 1:1 between peek and full, damps beyond full, stops at peek', () => {
    expect(dragVisible(100, 150, H)).toBe(250);
    expect(dragVisible(700, 100, H)).toBeCloseTo(730);
    expect(dragVisible(100, -80, H)).toBe(100);
  });

  it('settles on the nearest snap when released slowly', () => {
    expect(settleSnap(240, 0.1, H)).toBe('peek');
    expect(settleSnap(300, 0.1, H)).toBe('half');
    expect(settleSnap(600, -0.2, H)).toBe('full');
    expect(settleSnap(760, 0, H)).toBe('full');
  });

  it('a fling goes to the next snap in its direction, whatever the distance', () => {
    expect(settleSnap(120, 0.9, H)).toBe('half');
    expect(settleSnap(420, 0.9, H)).toBe('full');
    expect(settleSnap(650, -0.9, H)).toBe('half');
    expect(settleSnap(390, -0.9, H)).toBe('peek');
  });

  it('measures the release velocity over the last 80 ms only', () => {
    expect(releaseVelocity([{ t: 0, y: 500 }])).toBe(0);
    expect(releaseVelocity([{ t: 0, y: 900 }, { t: 200, y: 500 }, { t: 240, y: 480 }, { t: 280, y: 460 }])).toBeCloseTo(0.5);
  });
});
