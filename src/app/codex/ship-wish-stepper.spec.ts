import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ItemPathService } from '../hq/data/item-path.service';
import { WishRemovalFlowService } from '../hq/nachschub/wish-removal-flow.service';
import { WishCartService } from '../shell/cart/wish-cart.service';
import { fakeItemPath } from '../shared/item-path/item-path.testing';
import { ItemPathComponent } from '../shared/item-path/item-path.component';
import { UndoToastService } from '../shared/undo-toast/undo-toast.service';

/**
 * AUD-13: the ship detail page's wish box is the primary path level (as the item page's), so a wished ship has the
 * same quantity stepper as an item. Up sets the quantity; down (to 0 = the wish goes) runs through the ONE removal flow
 * (C6, concept 20261117-1110-pfad-stationen), which asks only when assigned pieces are hit.
 */
describe('ship detail wish stepper (AUD-13)', () => {
  afterEach(() => TestBed.inject(UndoToastService).flush());

  function mount(wishQty: number) {
    const path = fakeItemPath({ wished: wishQty > 0, wishQty, free: wishQty });
    const flow = { lower: vi.fn().mockName('lower').mockResolvedValue(null), announce: vi.fn().mockName('announce') };
    TestBed.configureTestingModule({
      imports: [ItemPathComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: ItemPathService, useValue: path },
        { provide: WishCartService, useValue: { open: () => Promise.resolve(true) } },
        { provide: WishRemovalFlowService, useValue: flow },
      ],
    });
    const fixture = TestBed.createComponent(ItemPathComponent);
    fixture.componentRef.setInput('kind', 'ship');
    fixture.componentRef.setInput('className', 'ARGO_RAFT');
    fixture.componentRef.setInput('name', 'Argo RAFT');
    fixture.componentRef.setInput('level', 'primary');
    fixture.detectChanges();
    return { path, flow, fixture, buttons: () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.stop .st button')) };
  }

  it('steps a wished ship up and down', async () => {
    const t = mount(2);
    const [less, more] = t.buttons();
    more.click();
    await new Promise((r) => setTimeout(r));
    expect(t.path.setWishQty).toHaveBeenCalledWith('ship', 'ARGO_RAFT', 'Argo RAFT', 3);
    less.click();
    await new Promise((r) => setTimeout(r));
    expect(t.flow.lower).toHaveBeenCalledWith({ kind: 'ship', className: 'ARGO_RAFT', forClassName: null, name: 'Argo RAFT' }, 1, 'codex');
    expect(t.path.setWishQty).toHaveBeenCalledTimes(1);
  });

  it('steps down from 1 to 0 through the removal flow (it removes the wish, with undo)', async () => {
    const t = mount(1);
    t.buttons()[0].click();
    await new Promise((r) => setTimeout(r));
    expect(t.flow.lower).toHaveBeenCalledWith({ kind: 'ship', className: 'ARGO_RAFT', forClassName: null, name: 'Argo RAFT' }, 1, 'codex');
    expect(t.path.setWishQty).not.toHaveBeenCalled();
  });
});
