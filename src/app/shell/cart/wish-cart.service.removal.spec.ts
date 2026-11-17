import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { CodexService } from '../../codex/codex.service';
import { WishNamesService } from '../../codex/search/wish-names.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqInventoryService } from '../../hq/data/hq-inventory.service';
import { WishlistStore, type WishRow } from '../../hq/data/wishlist.store';
import { NachschubService } from '../../hq/nachschub/nachschub.service';
import { WishRemovalFlowService } from '../../hq/nachschub/wish-removal-flow.service';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import type { CartItem } from './wish-cart.model';
import { WishCartService } from './wish-cart.service';

const row = (className: string, qty: number): WishRow => ({
  kind: 'weapon', className, name: className.toUpperCase(), manufacturer: null, rsiUrl: null, notes: null, qty, forClassName: '', createdAt: '2026-11-07T10:00:00Z',
});

function setup(assigned: number) {
  const lower = vi.fn().mockName('lower').mockResolvedValue({ ok: true, key: 'hq.nachschub.done.wishRemoved', undo: async () => ({ ok: true, key: 'x' }) });
  const announce = vi.fn().mockName('announce');
  const store = { rows: signal([row('karna', 3)]), ensureLoaded: () => Promise.resolve(), setQty: vi.fn().mockName('setQty').mockResolvedValue(true), remove: vi.fn().mockName('remove').mockResolvedValue(true) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      provideTranslateService({}),
      { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
      { provide: WishlistStore, useValue: store },
      { provide: NachschubService, useValue: { allocationOf: () => ({ key: 'k', wished: 3, assigned, free: 3 - assigned, assignments: [] }) } },
      { provide: WishRemovalFlowService, useValue: { lower, announce } },
      { provide: HangarService, useValue: { ships: signal([]) } },
      { provide: HqInventoryService, useValue: { items: signal([]) } },
      { provide: WishNamesService, useValue: { request: () => undefined, nameOf: () => null } },
      { provide: CodexService, useValue: {} },
    ],
  });
  const cart = TestBed.inject(WishCartService);
  return { cart, lower, announce, store, item: cart.items()[0] as CartItem };
}

describe('WishCartService removal (C6, D3)', () => {
  it('a step down goes through the removal flow, shows the undo toast and lights the counter', async () => {
    const { cart, lower, announce, store, item } = setup(0);
    expect(await cart.setQty(item, 2)).toBe(true);
    expect(lower).toHaveBeenCalledWith(expect.objectContaining({ className: 'karna', name: 'KARNA' }), 1, 'wishlist');
    expect(announce).toHaveBeenCalledOnce();
    expect(store.setQty).not.toHaveBeenCalled();
    expect(cart.flashed()).toBe(item.key);
  });

  it('a step up writes straight to the list', async () => {
    const { cart, lower, store, item } = setup(0);
    await cart.setQty(item, 4);
    expect(lower).not.toHaveBeenCalled();
    expect(store.setQty).toHaveBeenCalled();
  });

  it('the bin of a position with assigned pieces asks through the flow; one without keeps the delayed delete', async () => {
    const held = setup(2);
    held.cart.remove([held.item]);
    await vi.waitFor(() => expect(held.lower).toHaveBeenCalledWith(expect.anything(), 3, 'wishlist'));
    expect(TestBed.inject(UndoToastService).current()).toBeNull();
    TestBed.resetTestingModule();

    const plain = setup(0);
    plain.cart.remove([plain.item]);
    expect(plain.lower).not.toHaveBeenCalled();
    expect(TestBed.inject(UndoToastService).current()?.messageKey).toBe('cart.removed');
    TestBed.inject(UndoToastService).undo();
  });

  it('a cancelled dialog changes nothing and lights nothing', async () => {
    const { cart, lower, announce, item } = setup(2);
    lower.mockResolvedValueOnce(null);
    expect(await cart.setQty(item, 1)).toBe(false);
    expect(announce).not.toHaveBeenCalled();
    expect(cart.flashed()).toBeNull();
  });
});
