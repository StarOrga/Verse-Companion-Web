import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../../core/analytics.service';
import { CodexService } from '../../codex/codex.service';
import type { CartItem } from '../cart/wish-cart.model';
import { WishCartService } from '../cart/wish-cart.service';
import { HeaderPopoutService } from '../header-popout.service';
import { SearchOpenService } from '../search-open.service';
import { MerklisteComponent } from './merkliste.component';
import { MerklisteService } from './merkliste.service';

const item = (n: number, name: string, over: Partial<CartItem> = {}): CartItem => ({
  key: `weapon:w${n}`, kind: 'weapon', className: `w${n}`, name, qty: 1, forClassName: null, createdAt: '2026-11-0' + (n % 9 + 1),
  manufacturer: 'Behring', shipId: null, ...over,
} as CartItem);

function mount(items: CartItem[]) {
  const all = signal(items);
  const cart = {
    items: all,
    count: () => all().length,
    newest: (n: number) => all().slice(0, n),
    nameOf: (i: CartItem) => i.name ?? i.className,
    open: vi.fn().mockName('open').mockResolvedValue(true),
    setQty: vi.fn().mockName('setQty').mockResolvedValue(true),
    remove: vi.fn().mockName('remove'),
  };
  const svc = { refresh: vi.fn().mockName('refresh'), cartHref: signal('/codex/index?cart=1') };
  const track = vi.fn().mockName('track');
  const searchOpen = { open: vi.fn().mockName('open'), openAfterRender: vi.fn().mockName('openAfterRender') };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AnalyticsService, useValue: { track } },
      { provide: SearchOpenService, useValue: searchOpen },
      provideTranslateService({}),
      { provide: MerklisteService, useValue: svc },
      { provide: WishCartService, useValue: cart },
      { provide: CodexService, useValue: { silhouettes: async () => new Map() } },
    ],
  });
  const fixture = TestBed.createComponent(MerklisteComponent);
  fixture.detectChanges();
  return { fixture, track, searchOpen, el: fixture.nativeElement as HTMLElement, svc, cart, popouts: TestBed.inject(HeaderPopoutService) };
}

const open = (f: ReturnType<typeof mount>) => {
  f.el.querySelector<HTMLButtonElement>('.trigger')!.click();
  f.fixture.detectChanges();
};

const many = (n: number) => Array.from({ length: n }, (_, i) => item(i, `Gun ${i}`));

describe('MerklisteComponent (wishlist popout)', () => {
  it('is an icon-only wishlist trigger: no count, no word until the panel is open', () => {
    const { el } = mount(many(2));
    const trigger = el.querySelector<HTMLButtonElement>('.trigger')!;
    expect(trigger.textContent!.trim()).toBe('');
    expect(trigger.getAttribute('aria-label')).toBe('quick.wish');
    expect(el.querySelector('.panel')).toBeNull();
  });

  it('is the wishlist only: no title, no recent section, at most 7 rows, then the whole-list link', () => {
    const f = mount(many(12));
    open(f);
    expect(f.svc.refresh).toHaveBeenCalled();
    expect(f.el.querySelector('.title')).toBeNull();
    expect(f.el.querySelector('.tiles')).toBeNull();
    expect(f.el.querySelectorAll('.sec').length).toBe(0);
    expect(f.el.querySelectorAll('.qrow').length).toBe(7);
    const all = f.el.querySelector<HTMLAnchorElement>('a.all')!;
    expect(all.textContent).toContain('quick.allWish');
    // The count is footer status text on the right, not part of the action label.
    expect(all.textContent).not.toContain('quick.allWishCount');
    expect(f.el.querySelector('.scp-st .all-count')?.textContent).toContain('quick.allWishCount');
    expect(all.getAttribute('href')).toBe('/codex/index?cart=1');
    // A plain click opens the cart in place.
    all.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(f.cart.open).toHaveBeenCalledTimes(1);
  });

  it('draws the name as a real anchor and the move-into-Nachschub link with exactly this pick', () => {
    const f = mount([item(1, 'Arrowhead', { qty: 3 })]);
    open(f);
    expect(f.el.querySelector<HTMLAnchorElement>('a.open')!.getAttribute('href')).toBe('/codex/weapon/w1');
    const move = f.el.querySelector<HTMLAnchorElement>('a.move')!;
    expect(move.getAttribute('href')).toContain('/hq?pick=');
    expect(decodeURIComponent(move.getAttribute('href')!)).toContain('weapon:w1~3');
    expect(move.getAttribute('href')).toContain('#planen');
  });

  it('removes a position and steps its quantity', () => {
    const f = mount([item(1, 'Arrowhead', { qty: 2 })]);
    open(f);
    const [less, more] = Array.from(f.el.querySelectorAll<HTMLButtonElement>('.step button'));
    more.click();
    expect(f.cart.setQty).toHaveBeenLastCalledWith(expect.objectContaining({ className: 'w1' }), 3);
    less.click();
    expect(f.cart.setQty).toHaveBeenLastCalledWith(expect.objectContaining({ className: 'w1' }), 1);
    f.el.querySelector<HTMLButtonElement>('button.del')!.click();
    expect(f.cart.remove).toHaveBeenCalledWith([expect.objectContaining({ className: 'w1' })]);
  });

  it('disables "less" at quantity 1', () => {
    const f = mount([item(1, 'Arrowhead', { qty: 1 })]);
    open(f);
    expect(f.el.querySelector<HTMLButtonElement>('.step button')!.disabled).toBe(true);
  });

  it('tracks the popout opening with the popout surface, once per opening', () => {
    const f = mount(many(1));
    expect(f.track).not.toHaveBeenCalled();
    open(f);
    expect(f.track).toHaveBeenCalledWith('hq:wishlist_open', { surface: 'popout' });
    expect(f.track).toHaveBeenCalledTimes(1);
  });

  it('empty: night sky, headline, text and the one primary action, and no footer (no "Alle Wünsche", no count)', () => {
    const f = mount([]);
    open(f);
    const empty = f.el.querySelector('sc-wish-empty')!;
    expect(empty).not.toBeNull();
    // Order: sky, headline, text, action.
    const order = Array.from(empty.querySelectorAll('sc-wish-sky, .we-t, .we-x, button.we-go'));
    const name = (e: Element) => (e.tagName === 'SC-WISH-SKY' ? 'sky' : e.classList.contains('we-t') ? 'title' : e.classList.contains('we-x') ? 'text' : 'action');
    expect(order.map(name)).toEqual(['sky', 'title', 'text', 'action']);
    expect(empty.querySelector('sc-wish-sky')!.getAttribute('aria-hidden')).toBe('true');
    expect(empty.querySelector('.we-t')!.textContent).toContain('cart.empty');
    expect(empty.querySelector('button.we-go svg path')).not.toBeNull();
    expect(f.el.querySelectorAll('.sc-action--primary').length).toBe(1);
    const footer = f.el.querySelector('.scp-f');
    expect(!footer || getComputedStyle(footer).display === 'none', 'the footer is not shown').toBe(true);
    expect(f.el.querySelector('a.all')).toBeNull();
    expect(f.el.querySelector('.all-count')).toBeNull();
    expect(f.el.querySelector('.qrow')).toBeNull();
  });

  it('"Wunsch suchen" tracks the popout surface, folds the popout away and opens the page search', () => {
    const f = mount([]);
    open(f);
    f.el.querySelector<HTMLButtonElement>('button.we-go')!.click();
    f.fixture.detectChanges();
    expect(f.track).toHaveBeenCalledWith('hq:wish_search_open', { surface: 'popout' });
    // After the next render, never in the same tick: as a phone sheet the popout holds the page inert while it stands.
    expect(f.searchOpen.openAfterRender).toHaveBeenCalledTimes(1);
    expect(f.searchOpen.open).not.toHaveBeenCalled();
    expect(f.popouts.active()).toBeNull();
    // The popup closes before the search opens (the popup's focus return must not win over the field).
    const closedAt = f.fixture.componentInstance as unknown as { open: () => boolean };
    expect(closedAt.open()).toBe(false);
  });

  it('filled: every thumbnail carries the star dot and the footer shows "Alle Wünsche" and the count', () => {
    const f = mount(many(3));
    open(f);
    expect(f.el.querySelector('sc-wish-empty')).toBeNull();
    expect(f.el.querySelectorAll('.qrow .rimg.sc-wish-dot').length).toBe(3);
    expect(f.el.querySelector('a.all')).not.toBeNull();
    expect(f.el.querySelector('.all-count')!.textContent).toContain('quick.allWishCount');
  });

  it('draws the trigger with the four paths of the shooting star', () => {
    const { el } = mount(many(1));
    expect(el.querySelectorAll('.trigger svg path').length).toBe(4);
  });

  it('claims the header popout slot and folds away when another popout takes it', () => {
    const f = mount(many(1));
    open(f);
    expect(f.popouts.active()).toBe('wishlist');
    f.popouts.claim('apps');
    f.fixture.detectChanges();
    expect(f.el.querySelector('.panel')).toBeNull();
  });

  it('closes on Escape and frees the slot', () => {
    const f = mount(many(1));
    open(f);
    f.el.querySelector('.panel .scp-frame')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.fixture.detectChanges();
    expect(f.el.querySelector('.panel')).toBeNull();
    expect(f.popouts.active()).toBeNull();
  });
});
