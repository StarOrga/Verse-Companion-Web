import { describe, expect, it } from 'vitest';
import { foldText, fuzzyFilter, fuzzyScore, osaDistance } from './codex-holo-fuzzy';

describe('holo fuzzy search', () => {
  it('folds case, diacritics and apostrophes', () => {
    expect(foldText('Teach’s Ship Shop')).toBe('teachs ship shop');
    expect(foldText('Área 18')).toBe('area 18');
  });

  it('counts a transposition as one edit', () => {
    expect(osaDistance('lorvlile', 'lorville')).toBe(1);
    expect(osaDistance('abc', 'xyz', 1)).toBeGreaterThan(1);
  });

  it('ranks exact > prefix > substring > typo', () => {
    const s = (h: string) => fuzzyScore('area 18', h);
    expect(s('Area 18')).toBeGreaterThan(s('Area 18 Landing'));
    expect(fuzzyScore('lorv', 'Lorville')).toBeGreaterThan(fuzzyScore('orvil', 'Lorville'));
    expect(fuzzyScore('lorvile', 'Lorville Hurston')).toBeGreaterThan(0);
  });

  it('survives typical typos and rejects unrelated text', () => {
    const shops = ['New Deal · Lorville · Hurston', 'Astro Armada · Area 18 · ArcCorp', 'Teach’s Ship Shop · Levski · Delamar'];
    expect(fuzzyFilter('lorvlile', shops, (x) => x)[0]).toBe(shops[0]);
    expect(fuzzyFilter('astro armda', shops, (x) => x)[0]).toBe(shops[1]);
    expect(fuzzyFilter('teechs', shops, (x) => x)[0]).toBe(shops[2]);
    expect(fuzzyFilter('microtech', shops, (x) => x)).toEqual([]);
  });

  it('keeps everything for an empty query', () => {
    expect(fuzzyFilter('  ', ['a', 'b'], (x) => x)).toEqual(['a', 'b']);
  });
});
