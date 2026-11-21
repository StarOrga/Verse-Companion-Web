import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { HqLiveService } from '../now/hq-live.service';
import { HqLiveStore } from '../now/hq-live.store';
import { HqLogbookComponent } from './hq-logbook.component';

const ev = (type: string, minAgo: number, data: Record<string, unknown> = {}) => ({ type, at: new Date(Date.now() - minAgo * 60_000).toISOString(), data });

describe('HqLogbookComponent (#896)', () => {
  async function mount(fetch: () => Promise<unknown[]>, state: Record<string, unknown> | null = { location: 'Lorville' }) {
    TestBed.configureTestingModule({
      imports: [HqLogbookComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: HqLiveService, useValue: { state: signal(state), events: signal([]) } },
        { provide: HqLiveStore, useValue: { fetchEventsOfTypes: vi.fn().mockName('fetch').mockImplementation(fetch) } },
      ],
    });
    const fixture = TestBed.createComponent(HqLogbookComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders one card per session; a session without a quit says so', async () => {
    const el = await mount(async () => [
      ev('session.joined', 300),
      ev('qt.arrived', 290),
      ev('session.quit', 240),
      ev('session.joined', 200),
      ev('incapacitated', 190),
    ]);
    const cards = el.querySelectorAll('.card');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('.c-end')?.textContent).toContain('hq.logbook.end.noQuit');
    expect(cards[1].querySelector('.c-end')).toBeNull();
    expect(cards[0].querySelector('.c-sub')).toBeTruthy();
  });

  it('shows a costs line only on a session with fines, injuries or medbed heals (#1192)', async () => {
    const el = await mount(async () => [
      ev('session.joined', 300),
      ev('crime.fined', 295, { amount: 4500 }),
      ev('injury', 290),
      ev('medbed.healed', 285),
      ev('session.quit', 240),
      ev('session.joined', 200),
      ev('qt.arrived', 190),
      ev('session.quit', 180),
    ]);
    const cards = el.querySelectorAll('.card');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('.c-costs')).toBeNull();
    const costs = cards[1].querySelector('.c-costs')?.textContent ?? '';
    expect(costs).toContain('hq.logbook.costs.label');
    expect(costs).toContain('hq.logbook.costs.fineAmount');
    expect(costs).toContain('hq.logbook.costs.injuries.one');
    expect(costs).toContain('hq.logbook.costs.medbeds.one');
  });

  it('without live sync and without sessions it shows the SCC-App prompt', async () => {
    const el = await mount(async () => [], null);
    expect(el.querySelector('.card')).toBeNull();
    expect(el.querySelector('sc-hq-app-launch')).toBeTruthy();
  });

  it('a failed load is an error state with retry, not the empty state', async () => {
    const el = await mount(async () => {
      throw new Error('boom');
    });
    expect(el.querySelector('[role="alert"]')).toBeTruthy();
    expect(el.querySelector('[role="alert"] button')).toBeTruthy();
    expect(el.querySelector('sc-hq-app-launch')).toBeNull();
  });
});
