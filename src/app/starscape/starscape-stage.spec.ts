import { Wallpaper } from './starscape.service';
import { PHASE_MS, planStage } from './starscape-stage';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const DAY = 86_400_000;

function w(id: string, ageDays: number | null): Wallpaper {
  return {
    imageId: id,
    sourceUrl: `/s/${id}`,
    previewUrl: `/p/${id}`,
    title: id,
    series: null,
    articleUrl: '/a',
    publishedAt: ageDays === null ? null : new Date(NOW - ageDays * DAY).toISOString(),
  };
}

describe('planStage', () => {
  it('runs Neu, then Sammlung, then the rest, with a word only for the two announced phases', () => {
    const plan = planStage([w('n1', 2), w('old', 90), w('c1', 60), w('n2', 13)], new Set(['c1', 'n2']), NOW)!;
    expect(plan.words).toEqual([
      { key: 'starscape.stage.new', at: 0 },
      { key: 'starscape.stage.sammlung', at: PHASE_MS },
    ]);
    // A tile that is new AND collected counts as new.
    expect([...plan.marked].sort()).toEqual(['c1', 'n1', 'n2']);
    const d = (id: string) => plan.delays.get(id)!;
    expect(d('n1')).toBeLessThan(d('n2'));
    expect(d('n2')).toBeLessThan(PHASE_MS);
    expect(d('c1')).toBeGreaterThanOrEqual(PHASE_MS);
    expect(d('old')).toBeGreaterThanOrEqual(2 * PHASE_MS);
    expect(plan.total).toBeGreaterThan(d('old'));
  });

  it('skips a phase with no tiles behind it and closes the timeline up', () => {
    const plan = planStage([w('old', 90), w('c1', 60)], new Set(['c1']), NOW)!;
    expect(plan.words).toEqual([{ key: 'starscape.stage.sammlung', at: 0 }]);
    expect(plan.delays.get('old')).toBe(PHASE_MS);
  });

  it('with nothing new and nothing collected the rest arrives unannounced, staggered and capped', () => {
    const tiles = Array.from({ length: 40 }, (_, i) => w(`t${i}`, null));
    const plan = planStage(tiles, new Set(), NOW)!;
    expect(plan.words).toEqual([]);
    expect(plan.marked.size).toBe(0);
    expect(plan.delays.get('t0')).toBe(0);
    expect(plan.delays.get('t1')).toBeGreaterThan(0);
    expect(Math.max(...plan.delays.values())).toBeLessThanOrEqual(600);
  });

  it('plans nothing for an empty wall', () => {
    expect(planStage([], new Set(), NOW)).toBeNull();
  });
});
