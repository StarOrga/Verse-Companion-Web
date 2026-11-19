import { blueprintsOf, type BlueprintIndex } from './blueprint-link';

describe('blueprintsOf', () => {
  const index: BlueprintIndex = new Map([['iron', new Set(['bp_a', 'bp_b'])]]);

  it('lists every blueprint that uses or produces the item', () => {
    expect(blueprintsOf('iron', index)).toEqual(['bp_a', 'bp_b']);
  });

  it('is empty (unknown) for an unlinked, empty or missing class name', () => {
    expect(blueprintsOf('gold', index)).toEqual([]);
    expect(blueprintsOf('', index)).toEqual([]);
    expect(blueprintsOf(null, index)).toEqual([]);
    expect(blueprintsOf(undefined, index)).toEqual([]);
  });
});
