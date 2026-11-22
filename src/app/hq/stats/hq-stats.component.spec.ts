import type { Mock } from 'vitest';
import { HqLiveService } from '../now/hq-live.service';
import { HqLiveStore } from '../now/hq-live.store';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HqStatsComponent } from './hq-stats.component';

const liveState = signal<Record<string, unknown> | null>(null);

describe('HqStatsComponent', () => {
  function mount(rpc: Mock) {
    TestBed.configureTestingModule({
      imports: [HqStatsComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: SupabaseClientProvider, useValue: { client: { rpc } } },
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: HqLiveService, useValue: { state: liveState, events: () => [] } },
        { provide: HqLiveStore, useValue: { fetchEventsOfTypes: async () => [] } },
      ],
    });
    const fixture = TestBed.createComponent(HqStatsComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => liveState.set(null));

  it('offers no app start in the overlay once the VC app reports game data', async () => {
    liveState.set({ location: 'Lorville' });
    const fixture = mount(vi.fn().mockName('rpc').mockResolvedValue({ data: {}, error: null }));
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.overlay')).toBeTruthy();
    expect(el.querySelector('.overlay sc-hq-app-launch')).toBeNull();
  });

  describe('contract completion tile', () => {
    async function tile(data: Record<string, unknown>): Promise<HTMLElement> {
      const fixture = mount(vi.fn().mockName('rpc').mockResolvedValue({ data, error: null }));
      await fixture.whenStable();
      fixture.detectChanges();
      const tiles: HTMLElement[] = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button.tile'));
      return tiles.find((t) => t.textContent?.includes('hq.stats.tile.contracts.name')) as HTMLElement;
    }

    it('shows the rate and stays neutral while completed contracts outweigh the rest', async () => {
      const t = await tile({ missions: { total: 3, series: [] }, contracts: { failed: 1, abandoned: 0, series: [] } });
      expect(t.querySelector('.t-value')?.textContent).toBe('75 %');
      expect(t.classList.contains('warn')).toBe(false);
    });

    it('warns when failed and abandoned contracts exceed the completed ones', async () => {
      const t = await tile({ missions: { total: 1, series: [] }, contracts: { failed: 1, abandoned: 1, series: [] } });
      expect(t.querySelector('.t-value')?.textContent).toBe('33 %');
      expect(t.classList.contains('warn')).toBe(true);
    });

    it('shows no rate without a finished contract', async () => {
      const t = await tile({ auec: { earned: 10, spent: 0, net: 10, series: [] } });
      expect(t.querySelector('.t-value')?.textContent).toBe('–');
      expect(t.classList.contains('zero')).toBe(true);
    });
  });

  describe('fines and fuel tiles (#1191)', () => {
    async function tiles(data: Record<string, unknown>): Promise<HTMLElement[]> {
      const fixture = mount(vi.fn().mockName('rpc').mockResolvedValue({ data, error: null }));
      await fixture.whenStable();
      fixture.detectChanges();
      return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button.tile'));
    }
    const pick = (ts: HTMLElement[], id: string) => ts.find((t) => t.textContent?.includes(`hq.stats.tile.${id}.name`)) as HTMLElement;

    it('shows the fine count with the paid aUEC and the fuel warnings', async () => {
      const ts = await tiles({ fines: { total: 2, amount: 4500, series: [] }, fuel: { total: 3, series: [] } });
      const fines = pick(ts, 'fines');
      expect(fines.querySelector('.t-value')?.textContent).toBe('2');
      expect(fines.textContent).toContain('hq.stats.tile.fines.sub');
      expect(pick(ts, 'fuel').querySelector('.t-value')?.textContent).toBe('3');
    });

    it('a fine without an amount says so instead of 0 aUEC; no events show zero, never an error', async () => {
      const ts = await tiles({ fines: { total: 1, amount: 0, series: [] }, missions: { total: 1, series: [] } });
      expect(pick(ts, 'fines').textContent).toContain('hq.stats.tile.fines.subNoAmount');
      const fuel = pick(ts, 'fuel');
      expect(fuel.querySelector('.t-value')?.textContent).toBe('0');
      expect(fuel.classList.contains('zero')).toBe(true);
    });
  });

  it('shows marked, inert preview tiles under an app overlay for empty data - no wall of zeros, no error', async () => {
    const fixture = mount(vi.fn().mockName('rpc').mockResolvedValue({ data: {}, error: null }));
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const ghost = el.querySelector('.tiles.ghost') as HTMLElement;
    expect(ghost).toBeTruthy();
    expect(ghost.hasAttribute('inert')).toBe(true);
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.querySelectorAll('.tile').length).toBe(9);
    expect(ghost.querySelectorAll('.stamp').length).toBe(9);
    expect(el.querySelectorAll('button.tile').length).toBe(0);
    expect(el.querySelector('.overlay sc-hq-app-launch')).toBeTruthy();
    expect(el.querySelector('.overlay a[href="/apps"]')).toBeNull();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelector('#hq-stats-title')).toBeTruthy();
  });

  it('renders figures for full data and opens a detail dialog', async () => {
    const fixture = mount(
      vi.fn().mockName('rpc').mockResolvedValue({
        data: {
          bucket: 'day',
          auec: { earned: 1000, spent: 400, net: 600, series: [] },
          missions: { total: 5, series: [] },
          deaths_claims: { deaths: 2, claims: 1, series: [] },
        },
        error: null,
      }),
    );
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('600');
    expect(el.querySelector('.overlay')).toBeNull();
    (el.querySelector('.tile') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('shows an error state with retry when the load fails', async () => {
    const fixture = mount(vi.fn().mockName('rpc').mockResolvedValue({ data: null, error: new Error('boom') }));
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role="alert"]')).toBeTruthy();
    expect(el.querySelector('.tile')).toBeNull();
  });
});
