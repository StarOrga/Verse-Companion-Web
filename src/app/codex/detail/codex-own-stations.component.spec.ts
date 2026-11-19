import type { Mock } from 'vitest';
import { Type, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HangarService } from '../../hangar/hangar.service';
import type { HangarShip } from '../../hangar/hangar.types';
import { ItemPathService } from '../../hq/data/item-path.service';
import { HqItemMarksService, type HqItemMark } from '../../hq/data/hq-item-marks.service';
import { HqOwnershipService } from '../../hq/hq-ownership.service';
import { NachschubService } from '../../hq/nachschub/nachschub.service';
import { WishRemovalFlowService } from '../../hq/nachschub/wish-removal-flow.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { fakeItemPath, type FakeItemPath } from '../../shared/item-path/item-path.testing';
import { CodexOwnStationsComponent } from './codex-own-stations.component';
import { CodexOwnSegmentComponent } from './codex-own-segment.component';

const SHIP = { id: 'sh1', shipClassName: 'AEGS_Avenger_Stalker', customName: 'Schatten', status: 'owned', pinnedRank: 1, notes: null } as unknown as HangarShip;

describe('Codex ownership stations (concept pfad-stationen R5) + head segment (codex-kopf-besitz C2)', () => {
  let path: FakeItemPath;
  let confirm: Mock;
  let prompt: Mock;
  /** The removal flow runs for real; only the Nachschub store behind it is a stand-in (C6). */
  let nach: { needsConfirm: boolean; planWishRemoval: Mock; applyWishRemoval: Mock };
  let marks: { list: ReturnType<typeof signal<HqItemMark[]>>; setNote: Mock; setPinned: Mock };

  function setup<T>(type: Type<T>, inputs: Record<string, unknown>): ComponentFixture<T> {
    path = fakeItemPath();
    nach = {
      needsConfirm: false,
      planWishRemoval: vi.fn().mockName('planWishRemoval').mockImplementation(() => ({ needsConfirm: nach.needsConfirm })),
      applyWishRemoval: vi.fn().mockName('applyWishRemoval').mockResolvedValue({ ok: true, key: 'wishRemoval.done', undo: async () => ({ ok: true, key: 'itemPath.done.undone' }) }),
    };
    confirm = vi.fn().mockName('confirm').mockResolvedValue(true);
    prompt = vi.fn().mockName('prompt').mockResolvedValue(null);
    const list = signal<HqItemMark[]>([]);
    marks = { list, setNote: vi.fn().mockName('setNote').mockResolvedValue(true), setPinned: vi.fn().mockName('setPinned').mockResolvedValue(true) };
    TestBed.configureTestingModule({
      imports: [type],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ItemPathService, useValue: path },
        { provide: ScConfirmService, useValue: { confirm, prompt } },
        {
          provide: HqItemMarksService,
          useValue: {
            ensureLoaded: () => Promise.resolve(),
            error: signal(null),
            noteOf: (c: string) => list().find((m) => m.class_name === c)?.note ?? null,
            isPinned: (c: string) => list().some((m) => m.class_name === c && m.pinned_rank != null),
            setNote: (...a: unknown[]) => marks.setNote(...a),
            setPinned: (...a: unknown[]) => marks.setPinned(...a),
          },
        },
        { provide: HangarService, useValue: { error: signal(null), ships: signal([SHIP]), updateShip: vi.fn(), pinShip: vi.fn(), removeShip: vi.fn() } },
        { provide: HqOwnershipService, useValue: { configsForShip: () => [], invalidate: () => undefined } },
        { provide: NachschubService, useValue: nach },
      ],
    });
    const fixture = TestBed.createComponent(type);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  /** One macrotask: every awaited write and the toast offer have run (the toast's own timer is not waited out). */
  const flush = () => new Promise((r) => setTimeout(r));
  const text = (f: ComponentFixture<unknown>) => (f.nativeElement as HTMLElement).textContent ?? '';

  describe('stations (R5 "Zwei Kästen")', () => {
    const el = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
    const ownStop = (f: ComponentFixture<unknown>) => el(f).querySelector<HTMLElement>('[data-station="own"]');

    it('ship not owned: the two stations of the path control (primary), wish first, no card heading', () => {
      const f = setup(CodexOwnStationsComponent, { kind: 'ship', className: 'AEGS_Avenger_Stalker', name: 'Avenger Stalker' });
      expect(el(f).querySelector('sc-item-path.ip-primary')).not.toBeNull();
      expect(Array.from(el(f).querySelectorAll('[data-station]')).map((s) => s.getAttribute('data-station'))).toEqual(['wish', 'own']);
      expect(text(f)).not.toContain('codex.ownCard.haveTitle');
      expect(ownStop(f)?.querySelector('.tools'), 'no tools before anything is owned').toBeNull();
    });

    it('item page panel: stacked layout; ship classic: side by side (auto)', () => {
      const item = setup(CodexOwnStationsComponent, { kind: 'weapon', className: 'gun', name: 'Karna', layout: 'stacked' });
      expect(el(item).querySelector('sc-item-path')?.classList).toContain('ip-stacked');
      TestBed.resetTestingModule();
      const ship = setup(CodexOwnStationsComponent, { kind: 'ship', className: 'X' });
      expect(el(ship).querySelector('sc-item-path')?.classList).not.toContain('ip-stacked');
    });

    it('wished: lowering runs through the one removal flow, free pieces without a dialog (C6, A4)', async () => {
      const f = setup(CodexOwnStationsComponent, { kind: 'weapon', className: 'gun', name: 'Karna', layout: 'stacked' });
      path.current.set({ wished: true, wishQty: 3, free: 3, assignmentsKnown: true });
      f.detectChanges();
      const ask = vi.spyOn(TestBed.inject(WishRemovalFlowService) as unknown as { ask: () => Promise<unknown> }, 'ask');
      el(f).querySelectorAll<HTMLButtonElement>('[data-station="wish"] .st button')[0].click();
      await flush();
      expect(ask).not.toHaveBeenCalled();
      expect(nach.applyWishRemoval).toHaveBeenCalledWith({ kind: 'weapon', className: 'gun', forClassName: null, name: 'Karna' }, 1, { surface: 'codex' });
      expect(path.setWishQty).not.toHaveBeenCalled();
    });

    it('wished, assigned pieces hit: the dialog asks first and nothing is written before (C6, A5)', async () => {
      const f = setup(CodexOwnStationsComponent, { kind: 'weapon', className: 'gun', name: 'Karna' });
      path.current.set({ wished: true, wishQty: 2, assigned: 2, free: 0, assignmentsKnown: true });
      nach.needsConfirm = true;
      f.detectChanges();
      const ask = vi.spyOn(TestBed.inject(WishRemovalFlowService) as unknown as { ask: () => Promise<unknown> }, 'ask').mockResolvedValue(null);
      el(f).querySelectorAll<HTMLButtonElement>('[data-station="wish"] .st button')[0].click();
      await flush();
      expect(ask).toHaveBeenCalledTimes(1);
      expect(nach.applyWishRemoval).not.toHaveBeenCalled();
    });

    it('"Zuordnen" is busy while the Operationen load, offered for free pieces once known (assignmentsKnown, A3)', () => {
      const f = setup(CodexOwnStationsComponent, { kind: 'weapon', className: 'gun', name: 'Karna', layout: 'stacked' });
      path.current.set({ wished: true, wishQty: 2, free: 0, assignmentsKnown: false });
      f.detectChanges();
      expect(el(f).querySelector('.assign')?.classList).toContain('is-busy');
      path.current.set({ wished: true, wishQty: 2, assigned: 2, free: 0, assignmentsKnown: true });
      f.detectChanges();
      expect(el(f).querySelector('.assign'), 'never more assigned than wished: nothing free, no button').toBeNull();
      path.current.set({ wished: true, wishQty: 3, assigned: 2, free: 1, assignmentsKnown: true });
      f.detectChanges();
      expect(el(f).querySelector('.assign')).not.toBeNull();
    });

    it('ship owned: the own name in the strip, the four own-ship icons in the station head, the Operation hint', () => {
      const f = setup(CodexOwnStationsComponent, { kind: 'ship', className: 'AEGS_Avenger_Stalker', name: 'Avenger Stalker', ship: SHIP, nachschubName: 'Kampfflotte' });
      path.current.set({ inHangar: true, hangarQty: 1, hangarShipId: 'sh1' });
      f.detectChanges();
      const own = ownStop(f)!;
      expect(own.querySelector('.strip.own .own-name')?.textContent).toContain('„Schatten“');
      expect(own.querySelector('.head .tools sc-codex-own-ship-actions')).not.toBeNull();
      expect(own.querySelectorAll('.head .tools button[scAction]').length).toBe(4);
      expect(own.querySelector('.strip.own a.alink')?.textContent).toContain('pathCtl.view.hangar');
      expect(own.querySelector('.os-hq')?.textContent).toContain('codex.ownCard.inNachschub');
      expect(text(f)).not.toContain('codex.ownCard.showInHq');
    });

    it('no Operation hint when the ship sits in none', () => {
      const f = setup(CodexOwnStationsComponent, { kind: 'ship', className: 'X', ship: SHIP });
      path.current.set({ inHangar: true, hangarQty: 1 });
      f.detectChanges();
      expect(el(f).querySelector('.os-hq')).toBeNull();
    });

    it('HQ-hosted copy (forceOwned): the ownership station reads filled whatever the store says', () => {
      const f = setup(CodexOwnStationsComponent, { kind: 'ship', className: 'X', ship: SHIP, forceOwned: true });
      expect(ownStop(f)?.classList).toContain('on');
      expect(ownStop(f)?.querySelector('sc-codex-own-ship-actions')).not.toBeNull();
    });

    it('item owned: note, pin and remove as icon buttons in the head; remove asks first (danger); the note shows', async () => {
      const f = setup(CodexOwnStationsComponent, { kind: 'weapon', className: 'KLWE_Laser_S3', name: 'M6A', layout: 'stacked' });
      path.current.set({ inventarQty: 2, places: [{ location: 'Area 18', qty: 2 }], nearestPlace: 'Area 18' });
      f.detectChanges();
      const own = ownStop(f)!;
      for (const c of ['.os-note', '.os-pin', '.os-remove']) {
        const b = own.querySelector<HTMLElement>(`.head .tools ${c}`);
        expect(b?.getAttribute('tier'), c).toBe('tertiary');
        expect(b?.getAttribute('aria-label'), c).toBeTruthy();
      }
      prompt.mockResolvedValue('for the Cutlass');
      own.querySelector<HTMLButtonElement>('.os-note')!.click();
      await flush();
      expect(marks.setNote).toHaveBeenCalledWith('KLWE_Laser_S3', 'for the Cutlass');
      own.querySelector<HTMLButtonElement>('.os-pin')!.click();
      await flush();
      expect(marks.setPinned).toHaveBeenCalledWith('KLWE_Laser_S3', true);
      marks.list.set([{ class_name: 'KLWE_Laser_S3', note: 'for the Cutlass', pinned_rank: 1 }]);
      f.detectChanges();
      expect(own.querySelector('.os-note-text')?.textContent).toContain('for the Cutlass');
      own.querySelector<HTMLButtonElement>('.os-remove')!.click();
      await flush();
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ titleKey: 'codex.ownCard.removeTitle', tone: 'danger' }));
      expect(path.removeFromInventar).toHaveBeenCalledWith('weapon', 'KLWE_Laser_S3', 'M6A');
    });

    it('item not owned: no note, pin or remove', () => {
      const f = setup(CodexOwnStationsComponent, { kind: 'weapon', className: 'KLWE_Laser_S3', name: 'M6A' });
      expect(el(f).querySelector('.os-note, .os-pin, .os-remove')).toBeNull();
    });

    it('blueprint collected (Sammlung): removal un-collects it after the danger confirm', async () => {
      const f = setup(CodexOwnStationsComponent, { kind: 'blueprint', className: 'BP_KLWE_Laser_S3', name: 'M6A Blueprint' });
      path.current.set({ inventarQty: 1, places: [{ location: 'Blueprints', qty: 1 }] });
      f.detectChanges();
      expect(ownStop(f)?.textContent).toContain('pathCtl.node.sammlung');
      const rm = ownStop(f)!.querySelector<HTMLButtonElement>('.os-remove')!;
      expect(rm.getAttribute('aria-label')).toBe('codex.ownCard.removeSammlung');
      rm.click();
      await flush();
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ titleKey: 'codex.ownCard.removeSammlungTitle', tone: 'danger' }));
      expect(path.setBlueprintOwned).toHaveBeenCalledWith('BP_KLWE_Laser_S3', 'M6A Blueprint', false);
    });

    it('a failed write shows its translated key, never raw text', async () => {
      const f = setup(CodexOwnStationsComponent, { kind: 'weapon', className: 'KLWE_Laser_S3', name: 'M6A' });
      path.current.set({ inventarQty: 1, places: [{ location: 'Area 18', qty: 1 }] });
      path.removeFromInventar.mockResolvedValue({ ok: false, key: 'errors.network' });
      f.detectChanges();
      el(f).querySelector<HTMLButtonElement>('.os-remove')!.click();
      await flush();
      f.detectChanges();
      expect(el(f).querySelector('.os-err[role="alert"]')?.textContent).toContain('errors.network');
    });

    it('signed out: the hint and a sign-in anchor instead of the stations', () => {
      const f = setup(CodexOwnStationsComponent, { kind: 'ship', className: 'X' });
      path.current.set({ signedIn: false });
      f.detectChanges();
      expect(el(f).querySelector<HTMLAnchorElement>('a[href="/login"]')).not.toBeNull();
      expect(text(f)).toContain('codex.ownCard.signedOut');
      expect(el(f).querySelector('sc-item-path')).toBeNull();
    });

    it('reveal() focuses the ownership station and lights it up briefly', () => {
      const f = setup(CodexOwnStationsComponent, { kind: 'ship', className: 'X' });
      const host = el(f);
      document.body.appendChild(host);
      f.componentInstance.reveal();
      f.detectChanges();
      expect(document.activeElement).toBe(ownStop(f));
      expect(ownStop(f)?.classList).toContain('flash');
      host.remove();
    });
  });

  describe('head segment', () => {
    it('not owned: a quiet button that asks the page to show the card', () => {
      const f = setup(CodexOwnSegmentComponent, { kind: 'ship', className: 'X' });
      const jumped = vi.fn().mockName('jump');
      f.componentInstance.jump.subscribe(jumped);
      const btn = (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.quiet')!;
      expect(btn.textContent).toContain('codex.head.notOwn.hangar');
      btn.click();
      expect(jumped).toHaveBeenCalled();
    });

    it('owned ship: "Im Hangar" plus the inline variant select (no primary tier)', () => {
      const f = setup(CodexOwnSegmentComponent, {
        kind: 'ship', className: 'X', forceOwned: true, showVariant: true, hangarShipId: 'sh1',
        variants: [{ id: 'c1', name: 'a', active: true }], activeVariantId: 'c1', personal: true,
      });
      const el = f.nativeElement as HTMLElement;
      expect(el.querySelector('.own')?.textContent).toContain('codex.head.own.hangarN');
      const sel = el.querySelector<HTMLButtonElement>('sc-codex-mode-switch .isel')!;
      expect(sel.textContent).toContain('a');
      expect(el.querySelector('[tier="primary"]')).toBeNull();
      sel.click();
      f.detectChanges();
      const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('.menu a'));
      expect(links.length).toBe(1);
      expect(links[0].getAttribute('href')).toContain('/hq/hangar/sh1');
    });

    it('owned ship without a saved variant: "n× im Hangar · Gezeigt: Serie", no select', () => {
      const f = setup(CodexOwnSegmentComponent, { kind: 'ship', className: 'X', forceOwned: true });
      const el = f.nativeElement as HTMLElement;
      expect(el.querySelector('.own')?.textContent).toContain('codex.head.own.hangarN');
      expect(el.querySelector('.shown')?.textContent).toContain('codex.head.shown');
      expect(el.querySelector('.shown')?.textContent).toContain('codex.personal.stock');
      expect(el.querySelector('sc-codex-mode-switch')).toBeNull();
    });

    it('item: "Im Inventar · n×" / "Nicht im Inventar"', () => {
      const f = setup(CodexOwnSegmentComponent, { kind: 'weapon', className: 'X' });
      expect(text(f)).toContain('codex.head.notOwn.inventar');
      path.current.set({ inventarQty: 2 });
      f.detectChanges();
      expect(text(f)).toContain('codex.head.own.inventar');
    });

    it('blueprint: the Sammlung row counts as owned ("In der Sammlung")', () => {
      const f = setup(CodexOwnSegmentComponent, { kind: 'blueprint', className: 'BP_X' });
      expect(text(f)).toContain('codex.head.notOwn.sammlung');
      path.current.set({ inventarQty: 1, places: [{ location: 'Blueprints', qty: 1 }] });
      f.detectChanges();
      expect(text(f)).toContain('codex.head.own.sammlung');
    });
  });
});
