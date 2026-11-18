import { allocate, dissolvedBy, planRemoval, sharesByPackage, takeFromLines, withSplit, type RemovalHolder } from './nachschub.model';

/* The pure rules of wishes assigned to an Operation (concept 20261117-1110-pfad-stationen, A3-A7). */
describe('wish assignment rules', () => {
  const holder = (packageId: string, max: number, assignedAt: string, over: Partial<RemovalHolder> = {}): RemovalHolder => ({
    packageId, packageName: packageId, max, assignedAt, otherOpen: 0, einsaetze: 0, ...over,
  });

  it('A3: assigned never exceeds wished; free is the rest', () => {
    expect(allocate(5, [{ qty: 2 }, { qty: 1 }])).toEqual({ wished: 5, assigned: 3, free: 2 });
    expect(allocate(2, [{ qty: 3 }])).toEqual({ wished: 2, assigned: 2, free: 0 });
    expect(allocate(0, [])).toEqual({ wished: 0, assigned: 0, free: 0 });
  });

  it('groups lines per Operation, most recently assigned first', () => {
    const shares = sharesByPackage([
      { lineId: 'a', packageId: 'P', key: 'k', qty: 1, assignedAt: '1' },
      { lineId: 'b', packageId: 'Q', key: 'k', qty: 2, assignedAt: '3' },
      { lineId: 'c', packageId: 'P', key: 'k', qty: 2, assignedAt: '2' },
    ]);
    expect(shares.map((s) => [s.packageId, s.qty, s.lineIds])).toEqual([['Q', 2, ['b']], ['P', 3, ['c', 'a']]]);
  });

  it('A4: free pieces go first and need no question', () => {
    const plan = planRemoval(5, [holder('P', 3, '1')], 2);
    expect(plan).toEqual(expect.objectContaining({ remove: 2, free: 2, needsConfirm: false }));
    expect(plan.parts.map((p) => p.qty)).toEqual([0]);
  });

  it('A5/A6: the rest comes from the most recently assigned Operation first; the quantity is clamped to the wish', () => {
    const plan = planRemoval(5, [holder('Old', 2, '1'), holder('New', 2, '2')], 9);
    expect(plan.remove).toBe(5);
    expect(plan.free).toBe(1);
    expect(plan.needsConfirm).toBe(true);
    expect(plan.parts.map((p) => [p.packageId, p.qty])).toEqual([['New', 2], ['Old', 2]]);
  });

  it('A6: a split must add up, stay within each Operation and name only known ones', () => {
    const hs = [holder('Old', 2, '1'), holder('New', 2, '2')];
    const plan = planRemoval(4, hs, 3);
    expect(withSplit(plan, hs, { Old: 2, New: 1 })?.parts.map((p) => p.qty)).toEqual([1, 2]);
    expect(withSplit(plan, hs, { Old: 1 })).toBeNull();
    expect(withSplit(plan, hs, { Old: 3, New: 0 })).toBeNull();
    expect(withSplit(plan, hs, { Old: 1.5, New: 1.5 })).toBeNull();
    expect(withSplit(plan, hs, { Old: 2, New: 1, X: 0 })).toBeNull();
  });

  it('A7: the last wish of an Operation without Einsatz dissolves it; with Einsätze only when ticked', () => {
    const hs = [holder('Empty', 1, '2'), holder('Busy', 1, '1', { einsaetze: 2 }), holder('Full', 1, '0', { otherOpen: 4 })];
    const plan = planRemoval(3, hs, 3);
    expect(plan.parts.map((p) => [p.packageId, p.lastWish, p.dissolves])).toEqual([['Empty', true, true], ['Busy', true, false], ['Full', false, false]]);
    expect(dissolvedBy(plan)).toEqual(['Empty']);
    expect(dissolvedBy(plan, ['Busy', 'Full'])).toEqual(['Empty', 'Busy']);
  });

  it('takes pieces from lines in the order given', () => {
    expect([...takeFromLines([{ id: 'a', qty: 2 }, { id: 'b', qty: 3 }], 3)]).toEqual([['a', 0], ['b', 2]]);
    expect([...takeFromLines([{ id: 'a', qty: 2 }], 0)]).toEqual([]);
  });
});
