import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { PageCornerService } from './page-corner.service';

describe('PageCornerService.register', () => {
  const act = (labelKey: string, order?: number) => ({ icon: 'M0 0', labelKey, run: vi.fn(), order });

  it('lists registered actions by order and replaces the same id', () => {
    const corner = TestBed.inject(PageCornerService);
    const offB = corner.register('b', act('x.b', 60));
    corner.register('a', act('x.a', 10));
    expect(corner.actions().map((a) => a.id)).toEqual(['a', 'b']);
    corner.register('b', act('x.b2', 60));
    expect(corner.actions().map((a) => a.labelKey)).toEqual(['x.a', 'x.b2']);
    offB();
    // The stale unregister of the replaced entry must not drop its successor.
    expect(corner.actions().map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('unregister withdraws the action', () => {
    const corner = TestBed.inject(PageCornerService);
    const off = corner.register('share', act('corner.share.aria'));
    expect(corner.actions()).toHaveLength(1);
    off();
    expect(corner.actions()).toHaveLength(0);
  });
});
