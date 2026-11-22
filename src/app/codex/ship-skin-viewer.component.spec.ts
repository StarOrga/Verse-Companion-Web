import type { Mock } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ShipSkinViewerComponent, holoFitZoom } from './ship-skin-viewer.component';
import { ShipSkin, ShipSkinsService } from './ship-skins.service';

function skin(over: Partial<ShipSkin>): ShipSkin {
  return {
    shipId: 'DRAK_Cutlass_Black',
    skinId: 'a',
    name: 'A',
    description: '',
    source: 'store',
    nameVerified: false,
    modelPath: null,
    iconPath: 'DRAK_Cutlass_Black/a.webp',
    modelBytes: null,
    sort: 100,
    ...over,
  };
}

describe('ShipSkinViewerComponent', () => {
  let listSkins: Mock;

  async function setup(skins: ShipSkin[], shipId = 'DRAK_Cutlass_Black') {
    listSkins = vi.fn().mockName('listSkins').mockResolvedValue({ skins, error: false });
    const svc: Partial<ShipSkinsService> = {
      listSkins,
      assetUrl: (p?: string | null) => (p ? `http://assets/${p}` : null),
    };
    await TestBed.configureTestingModule({
      imports: [ShipSkinViewerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ShipSkinsService, useValue: svc },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ShipSkinViewerComponent);
    fixture.componentRef.setInput('shipId', shipId);
    // One CD runs the shipId effect (which calls listSkins). We intentionally do
    // NOT run a second detectChanges after whenStable: that would render the
    // <model-viewer> custom element and spin up a WebGL context in headless
    // Chrome (flaky teardown). These tests assert signal state, not the 3D DOM.
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing when the ship has no skins', async () => {
    const fixture = await setup([]);
    expect(fixture.nativeElement.querySelector('.skins')).toBeNull();
    expect(fixture.componentInstance.catalogError()).toBe(false);
  });

  it('surfaces a retry affordance when the catalog query fails (not silent)', async () => {
    listSkins = vi.fn().mockName('listSkins').mockResolvedValue({ skins: [], error: true });
    await TestBed.configureTestingModule({
      imports: [ShipSkinViewerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ShipSkinsService, useValue: { listSkins, assetUrl: () => null } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ShipSkinViewerComponent);
    fixture.componentRef.setInput('shipId', 'DRAK_Cutlass_Black');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.catalogError()).toBe(true);
    expect(fixture.nativeElement.querySelector('.catalog-error')).not.toBeNull();
  });

  it('loads skins for the shipId and auto-selects the first one with a 3D model', async () => {
    const skins = [
      skin({ skinId: 'standard', modelPath: 'DRAK_Cutlass_Black/standard.glb', sort: 10 }),
      skin({ skinId: 'event_only', modelPath: null, sort: 20 }),
    ];
    const fixture = await setup(skins);
    const c = fixture.componentInstance;
    expect(listSkins).toHaveBeenCalledWith('DRAK_Cutlass_Black');
    expect(c.current()?.skinId).toBe('standard');
    expect(c.mode()).toBe('3d');
    expect(c.modelLoading()).toBe(true); // glb is loading until <model-viewer> fires (load)
  });

  // AUD-188: the source tag is a translated word, never the raw enum.
  it('renders the source tag through i18n, not the raw pu_npc enum', async () => {
    // No 3D model on purpose: paint mode keeps <model-viewer> out of the DOM.
    const fixture = await setup([
      skin({ skinId: 'npc', source: 'pu_npc', modelPath: null }),
      skin({ skinId: 'odd', source: 'mystery', modelPath: null, sort: 200 }),
    ]);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('codex.skins.sourceTag.pu_npc');
    expect(text).not.toMatch(/(^|\s)pu_npc(\s|$)/);
    expect(fixture.componentInstance.sourceKey('mystery')).toBe('codex.skins.sourceTag.other');
  });

  it('falls back to paint mode when no skin has a 3D model', async () => {
    const fixture = await setup([skin({ skinId: 'event_only', modelPath: null })]);
    expect(fixture.componentInstance.mode()).toBe('paint');
  });

  it('select() switches current skin and resets mode by 3D availability', async () => {
    const skins = [
      skin({ skinId: 'standard', modelPath: 'm.glb' }),
      skin({ skinId: 'paintonly', modelPath: null }),
    ];
    const fixture = await setup(skins);
    const c = fixture.componentInstance;
    c.select(skins[1]);
    expect(c.current()?.skinId).toBe('paintonly');
    expect(c.mode()).toBe('paint');
  });

  it('setMode() refuses 3D when the current skin has no model', async () => {
    const fixture = await setup([skin({ skinId: 'paintonly', modelPath: null })]);
    const c = fixture.componentInstance;
    c.setMode('3d');
    expect(c.mode()).toBe('paint');
  });

  it('onKey() activates a skin on Enter (keyboard a11y)', async () => {
    const skins = [skin({ skinId: 'standard', modelPath: 'm.glb' }), skin({ skinId: 'b' })];
    const fixture = await setup(skins);
    const c = fixture.componentInstance;
    const ev = new KeyboardEvent('keydown', { key: 'Enter' });
    vi.spyOn(ev, 'preventDefault').mockReturnValue(undefined as never);
    c.onKey(ev, skins[1]);
    expect(c.current()?.skinId).toBe('b');
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('onModelError() surfaces an error state; onModelLoad() clears loading', async () => {
    const fixture = await setup([skin({ skinId: 'standard', modelPath: 'm.glb' })]);
    const c = fixture.componentInstance;
    c.onModelError();
    expect(c.modelError()).toBe(true);
    c.onModelLoad();
    expect(c.modelError()).toBe(false);
    expect(c.modelLoading()).toBe(false);
  });

  it('reloads and replaces skins when the shipId input changes (race-safe)', async () => {
    const fixture = await setup([skin({ skinId: 'cutlass_a', modelPath: 'm.glb' })]);
    const c = fixture.componentInstance;
    expect(c.current()?.skinId).toBe('cutlass_a');

    listSkins.mockResolvedValue({
      skins: [skin({ shipId: 'AEGS_Gladius', skinId: 'gladius_a' })],
      error: false,
    });
    fixture.componentRef.setInput('shipId', 'AEGS_Gladius');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(listSkins).toHaveBeenCalledWith('AEGS_Gladius');
    expect(c.skins().length).toBe(1);
    expect(c.current()?.skinId).toBe('gladius_a');
  });

  describe('glb head read', () => {
    interface Reader { readLocators(url: string | null): void }
    let fetchSpy: Mock;

    beforeEach(() => {
      // Never answers — the read stays in flight until something aborts it.
      fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));
    });

    function signalOf(call: number): AbortSignal {
      return (vi.mocked(fetchSpy).mock.calls[call][1] as RequestInit).signal as AbortSignal;
    }

    it('aborts the running read when the model changes', async () => {
      const fixture = await setup([]);
      const reader = fixture.componentInstance as unknown as Reader;
      fetchSpy.mockClear();
      reader.readLocators('http://assets/a.glb');
      reader.readLocators('http://assets/b.glb');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(signalOf(0).aborted).toBe(true);
      expect(signalOf(1).aborted).toBe(false);
    });

    it('aborts the running read on destroy', async () => {
      const fixture = await setup([]);
      const reader = fixture.componentInstance as unknown as Reader;
      fetchSpy.mockClear();
      reader.readLocators('http://assets/a.glb');
      fixture.destroy();
      expect(signalOf(0).aborted).toBe(true);
    });
  });
});

describe('holoFitZoom (#392)', () => {
  // An ellipsoid hull of X × Y × Z, relative to its centre, as (rho, y) pairs.
  function hull(x: number, y: number, z: number) {
    return (visit: (rho: number, y: number) => void) => {
      for (let a = 0; a < 64; a++) {
        for (let b = 0; b < 32; b++) {
          const t = (a / 64) * 2 * Math.PI;
          const p = (b / 31) * Math.PI;
          visit(Math.hypot((x / 2) * Math.sin(p) * Math.cos(t), (z / 2) * Math.sin(p) * Math.sin(t)), (y / 2) * Math.cos(p));
        }
      }
    };
  }

  it('lets a flat hull zoom further than a tall one', () => {
    const flat = holoFitZoom(hull(20, 6, 30), 15, 30);
    const tall = holoFitZoom(hull(30, 25, 40), 20, 30);
    expect(flat).toBeGreaterThan(1.8);
    expect(tall).toBeLessThan(1.5);
  });

  it('never goes below 1 and is open-ended without a framing', () => {
    expect(holoFitZoom(hull(10, 10, 10), 5, 30)).toBeGreaterThanOrEqual(1);
    expect(holoFitZoom(hull(10, 10, 10), 0, 30)).toBe(Number.POSITIVE_INFINITY);
    expect(holoFitZoom(() => undefined, 5, 30)).toBe(Number.POSITIVE_INFINITY);
  });
});
