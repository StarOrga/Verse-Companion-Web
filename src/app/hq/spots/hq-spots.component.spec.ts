import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../../core/analytics.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { HqSpotsComponent } from './hq-spots.component';
import { HqSpot, HqSpotsService } from './hq-spots.service';

const spot = (id: string, name: string): HqSpot => ({
  id,
  name,
  system_code: 'STANTON',
  parent_body: 'Crusader',
  note: 'Wreck behind the ridge',
  created_at: '2026-11-01T10:00:00.000Z',
  updated_at: '2026-11-01T10:00:00.000Z',
});

describe('HqSpotsComponent', () => {
  const state = {
    spots: signal<readonly HqSpot[]>([]),
    loaded: signal(true),
    loading: signal(false),
    loadError: signal<string | null>(null),
    writeError: signal<string | null>(null),
  };
  const svc = { ...state, load: vi.fn(), rename: vi.fn(), remove: vi.fn() };
  const confirm = vi.fn();
  const track = vi.fn();

  function setup() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HqSpotsComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: HqSpotsService, useValue: svc },
        { provide: ScConfirmService, useValue: { confirm } },
        { provide: AnalyticsService, useValue: { track, flags: () => ({}), flagsPending: () => false } },
      ],
    });
    const fixture = TestBed.createComponent(HqSpotsComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    state.spots.set([spot('a', 'Alpha wreck'), spot('b', 'Beta cave')]);
    state.loaded.set(true);
    state.loadError.set(null);
    state.writeError.set(null);
    svc.rename.mockResolvedValue(true);
    svc.remove.mockResolvedValue(true);
  });

  it('lists the spots with name, location and note', () => {
    const el: HTMLElement = setup().nativeElement;
    expect(el.querySelectorAll('li').length).toBe(2);
    expect(el.querySelector('.name')?.textContent).toContain('Alpha wreck');
    expect(el.querySelector('.loc')?.textContent).toContain('STANTON');
    expect(el.querySelector('.note')?.textContent).toContain('Wreck behind the ridge');
  });

  it('shows the empty state pointing to the desktop app', () => {
    state.spots.set([]);
    const el: HTMLElement = setup().nativeElement;
    expect(el.querySelector('li')).toBeNull();
    expect(el.textContent).toContain('hq.spots.empty');
  });

  it('shows an error state with retry, not the empty state, on a load failure', () => {
    state.loaded.set(false);
    state.loadError.set('errors.network');
    const fixture = setup();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('errors.network');
    expect(el.textContent).not.toContain('hq.spots.empty');
    el.querySelector<HTMLButtonElement>('.state button')!.click();
    expect(svc.load).toHaveBeenCalledTimes(2); // constructor + retry
  });

  it('renames inline and tracks it', async () => {
    const fixture = setup();
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('.acts button')!.click();
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('form input')!;
    input.value = 'Renamed';
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(svc.rename).toHaveBeenCalledWith('a', 'Renamed');
    expect(track).toHaveBeenCalledWith('hq:spot_rename');
  });

  it('asks before deleting and deletes only on yes', async () => {
    const fixture = setup();
    const el: HTMLElement = fixture.nativeElement;
    const del = () => el.querySelectorAll<HTMLButtonElement>('.acts button')[1];
    confirm.mockResolvedValueOnce(false);
    del().click();
    await fixture.whenStable();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
    expect(svc.remove).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce(true);
    del().click();
    await fixture.whenStable();
    expect(svc.remove).toHaveBeenCalledWith('a');
    expect(track).toHaveBeenCalledWith('hq:spot_delete');
  });
});
