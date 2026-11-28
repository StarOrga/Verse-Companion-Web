import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AccountPrefsService } from '../core/account-prefs.service';
import { ITEM_ART_KEY, ItemArtPrefsService } from './item-art-prefs.service';

describe('ItemArtPrefsService', () => {
  const prefs = signal<Record<string, unknown> | null>(null);
  const writes: [string, unknown][] = [];

  beforeEach(() => {
    prefs.set(null);
    writes.length = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AccountPrefsService,
          useValue: { prefs, set: (k: string, v: unknown) => writes.push([k, v]) },
        },
      ],
    });
  });

  it('defaults to the model renders, signed out too', () => {
    const svc = TestBed.inject(ItemArtPrefsService);
    expect(svc.art()).toBe('renders');
    expect(svc.renders()).toBe(true);
    prefs.set({});
    expect(svc.art()).toBe('renders');
  });

  it('reads the stored icons choice', () => {
    prefs.set({ [ITEM_ART_KEY]: 'icons' });
    const svc = TestBed.inject(ItemArtPrefsService);
    expect(svc.art()).toBe('icons');
    expect(svc.renders()).toBe(false);
  });

  it('stores icons and clears the key for the default', () => {
    const svc = TestBed.inject(ItemArtPrefsService);
    svc.set('icons');
    svc.set('renders');
    expect(writes).toEqual([
      [ITEM_ART_KEY, 'icons'],
      [ITEM_ART_KEY, null],
    ]);
  });
});
