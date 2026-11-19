import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { vi } from 'vitest';
import { AnalyticsService } from '../../core/analytics.service';
import { HqInventoryService } from '../../hq/data/hq-inventory.service';
import { ItemPathService, PLACE_WITH_ME } from '../../hq/data/item-path.service';
import { WishlistStore } from '../../hq/data/wishlist.store';
import type { BuyOption } from '../uex-shop.service';
import { CodexHoloBuyTabComponent } from './codex-holo-buy-tab.component';

const opt = (terminal: string, place: string, planet: string, system: string, price: number): BuyOption => ({
  price, priceAvg: null, terminal, location: `${place}, ${planet}, ${system}`, system, planet, place,
});
const OPTIONS: BuyOption[] = [
  opt('New Deal', 'Lorville', 'Hurston', 'Stanton', 1312000),
  opt('Astro Armada', 'Area 18', 'ArcCorp', 'Stanton', 1338000),
  opt('Teach’s Ship Shop', 'Levski', 'Delamar', 'Nyx', 1364000),
  opt('Omega Pro', 'Everus Harbor', 'Hurston', 'Stanton', 1400000),
];

describe('CodexHoloBuyTabComponent', () => {
  let fixture: ComponentFixture<CodexHoloBuyTabComponent>;
  const rowsSig = signal<{ kind: string; className: string; name: string | null; notes: string | null }[]>([]);
  const wishlist = {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    find: (kind: string, className: string) => rowsSig().find((r) => r.kind === kind && r.className === className) ?? null,
    setNotes: vi.fn(async (e: { kind: string; className: string; name: string }, notes: string | null) => {
      rowsSig.set([{ kind: e.kind, className: e.className, name: e.name, notes }]);
      return true;
    }),
    remove: vi.fn(async () => { rowsSig.set([]); return true; }),
  };
  const track = vi.fn();
  let place = PLACE_WITH_ME;
  let last: { name: string; system: string | null } | null = null;
  const q = (sel: string) => fixture.nativeElement.querySelector(sel) as HTMLElement | null;
  const all = (sel: string) => Array.from(fixture.nativeElement.querySelectorAll(sel)) as HTMLElement[];

  function setup(inputs: Record<string, unknown> = {}): void {
    TestBed.configureTestingModule({
      imports: [CodexHoloBuyTabComponent],
      providers: [
        provideTranslateService({}),
        { provide: WishlistStore, useValue: wishlist },
        { provide: ItemPathService, useValue: { currentPlaceDefault: () => place } },
        { provide: HqInventoryService, useValue: { load: vi.fn().mockResolvedValue(undefined), lastKnownLocation: vi.fn().mockImplementation(async () => last), items: signal([{ class_name: 'irradiated_pearl', qty: 2 }]) } },
        { provide: AnalyticsService, useValue: { track } },
      ],
    });
    fixture = TestBed.createComponent(CodexHoloBuyTabComponent);
    fixture.componentRef.setInput('options', OPTIONS);
    fixture.componentRef.setInput('className', 'aegs_gladius');
    fixture.componentRef.setInput('name', 'Gladius');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
  }

  beforeEach(() => {
    rowsSig.set([]);
    place = PLACE_WITH_ME;
    last = null;
    track.mockClear();
    wishlist.setNotes.mockClear();
  });

  it('without a known position lists every place grouped by system and planet', () => {
    setup();
    expect(all('.gh.sub').map((e) => e.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Nyx · Delamar', 'Stanton · ArcCorp', 'Stanton · Hurston']);
    expect(all('.row').length).toBe(4);
  });

  it('with a live position shows the three nearest first and the rest behind "all"', () => {
    place = 'Area 18';
    setup();
    const names = all('.row .who b').map((e) => e.textContent);
    expect(names).toHaveLength(3);
    expect(names[0]).toBe('Astro Armada');
    q('.more')!.click();
    fixture.detectChanges();
    expect(all('.row').length).toBe(4);
  });

  it('finds a place through a typo in the mini search', () => {
    setup();
    const input = q('.srch input') as HTMLInputElement;
    input.value = 'lorvlile';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(all('.row .who b').map((e) => e.textContent)).toEqual(['New Deal']);
  });

  it('writes the chosen shop as the wish source and tracks it', async () => {
    setup();
    const btn = all('.row').find((r) => r.textContent!.includes('Astro Armada'))!.querySelector('button') as HTMLElement;
    btn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(wishlist.setNotes).toHaveBeenCalledWith({ kind: 'ship', className: 'aegs_gladius', name: 'Gladius' }, 'Astro Armada · Area 18 · ArcCorp');
    expect(track).toHaveBeenCalledWith('codex:wish_add', { kind: 'ship', source: 'shop' });
    expect(q('.row.done')).not.toBeNull();
  });

  it('shows the Wikelo row with the needed parts and how many the reader holds', () => {
    setup({ wikelo: true, wikeloNeeds: [{ className: 'Irradiated_Pearl', name: 'Irradiated Pearl', qty: 3 }] });
    const wk = q('.row.wk')!;
    expect(wk.textContent).toContain('3 × Irradiated Pearl');
    expect(wk.querySelector('.need li')!.textContent).toContain('codex.holo.akte.buy.wikeloHave');
  });

  it('shows an error state with retry, never the empty state', () => {
    setup({ error: true });
    const retry = vi.fn();
    fixture.componentInstance.retry.subscribe(retry);
    expect(q('[role=alert]')).not.toBeNull();
    (q('[role=alert] button') as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalled();
  });
});
