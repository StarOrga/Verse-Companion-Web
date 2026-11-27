import { analysisCardOffsets, canSyncAnalysis, monotonicAnchors, type SyncCard, type SyncFrame } from './analysis-scroll-sync';

// Column-local layout used throughout: the loadout has Bewaffnung + Raketen
// from 20 to 800, Schildgeneratoren from 812, Antrieb & Systeme from 1100,
// column 2000 high. Cards: Offensive 300, Verteidigung 400 (taller than the
// shield block, so it sticks out), Schiff 300.
const cards: SyncCard[] = [
  { natural: 20, height: 300, anchor: null },
  { natural: 332, height: 400, anchor: 812 },
  { natural: 744, height: 300, anchor: 1100 },
];
const frame = (stickTop: number, over: Partial<SyncFrame> = {}): SyncFrame => ({
  stickTop,
  viewBottom: stickTop + 5000,
  columnHeight: 2000,
  gap: 12,
  catchUp: true,
  ...over,
});
/** Absolute card tops (natural + offset). */
const tops = (f: SyncFrame, c: SyncCard[] = cards) => analysisCardOffsets(c, f).map((dy, i) => c[i].natural + dy);

describe('analysisCardOffsets (#409)', () => {
  it('puts each card on its block before the page scrolls', () => {
    // Stick line above the column: nothing is pinned yet.
    const [off, def, ship] = tops(frame(-200));
    expect(off).toBe(20);
    expect(def).toBe(812);
    // Verteidigung (812 + 400) sticks out past 1100, so Schiff follows it.
    expect(ship).toBe(812 + 400 + 12);
  });

  it('pins Offensive under the strip until its end meets the missiles end', () => {
    expect(tops(frame(300))[0]).toBe(300);
    // Range ends at 812 - 12 = 800, so the card's top stops at 500.
    expect(tops(frame(700))[0]).toBe(500);
    expect(tops(frame(900))[0]).toBe(500);
  });

  it('lifts the cards above so Schiff meets Antrieb at the stick line', () => {
    // Overflow = 1224 - 1100 = 124: lifting starts 124px before the anchor.
    expect(tops(frame(1100 - 124))[2]).toBe(1224);
    const mid = tops(frame(1100 - 62));
    expect(mid[2]).toBe(1224 - 62);
    expect(mid[1]).toBe(812 - 62);
    expect(tops(frame(1100))[2]).toBe(1100);
    // Past the anchor it is a sticky card again.
    expect(tops(frame(1300))[2]).toBe(1300);
  });

  it('moves continuously while scrolling', () => {
    let prev = tops(frame(-200));
    for (let s = -199; s <= 2000; s++) {
      const next = tops(frame(s));
      next.forEach((y, i) => expect(Math.abs(y - prev[i])).toBeLessThanOrEqual(2));
      prev = next;
    }
  });

  it('never runs past the column end nor overlaps', () => {
    const t = tops(frame(5000));
    expect(t[2] + 300).toBeLessThanOrEqual(2000);
    expect(t[1] + 400 + 12).toBeLessThanOrEqual(t[2]);
    expect(t[0] + 300 + 12).toBeLessThanOrEqual(t[1]);
  });

  it('keeps the strict push without catch-up (reduced motion)', () => {
    expect(tops(frame(1100, { catchUp: false }))[2]).toBe(1224);
  });

  it('parks a card taller than the viewport with its bottom at the edge', () => {
    // stickTop 300, viewBottom 500: a 300px card can only pin at 200.
    expect(tops(frame(300, { viewBottom: 500 }))[0]).toBe(200);
  });

  it('lets an un-anchored card follow the one above', () => {
    const c: SyncCard[] = [cards[0], { ...cards[1], anchor: null }, cards[2]];
    const t = tops(frame(-200), c);
    expect(t[1]).toBe(332);
  });
});

describe('canSyncAnalysis', () => {
  it('only syncs when the cards fit beside the loadout', () => {
    expect(canSyncAnalysis(cards, 2000, 12)).toBe(true);
    expect(canSyncAnalysis(cards, 1000, 12)).toBe(false);
    expect(canSyncAnalysis([], 2000, 12)).toBe(false);
  });
});

describe('monotonicAnchors', () => {
  it('drops an anchor that would run up the column', () => {
    expect(monotonicAnchors([null, 900, 400])).toEqual([null, 900, null]);
    expect(monotonicAnchors([null, 400, 900])).toEqual([null, 400, 900]);
  });
});
