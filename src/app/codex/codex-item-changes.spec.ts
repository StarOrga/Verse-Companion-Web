import { describe, expect, it } from 'vitest';
import { diffItemPayloads, higherIsBetter } from './codex-item-changes';

describe('diffItemPayloads', () => {
  it('lists changed numeric stats old to new and nothing for equal or one-sided ones', () => {
    const before = { stats: { damage: 10, recoil: 2, same: 5 }, gone: 1 };
    const after = { stats: { damage: 12, recoil: 3, same: 5 }, added: 9 };
    const out = diffItemPayloads(before, after);
    expect(out.map((c) => c.path)).toEqual(['stats.damage', 'stats.recoil']);
    expect(out[0]).toMatchObject({ from: 10, to: 12, tone: 'better' });
    expect(out[1]).toMatchObject({ from: 2, to: 3, tone: 'worse' });
  });

  it('is empty for identical payloads and ignores arrays', () => {
    expect(diffItemPayloads({ a: 1, l: [1] }, { a: 1, l: [2] })).toEqual([]);
    expect(diffItemPayloads(null, { a: 1 })).toEqual([]);
  });

  it('gives an unknown stat no polarity', () => {
    expect(higherIsBetter('zzzQuux')).toBeNull();
    expect(diffItemPayloads({ zzzQuux: 1 }, { zzzQuux: 2 })[0].tone).toBe('neutral');
  });
});
