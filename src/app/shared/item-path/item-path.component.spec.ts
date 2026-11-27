import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ItemPathService, ownWordOf, stepsOf } from '../../hq/data/item-path.service';
import type { ItemPathState, PathStep } from '../../hq/data/item-path.service';
import { NachschubFocusService } from '../../hq/nachschub/nachschub-focus.service';
import type { WishAssignment } from '../../hq/nachschub/nachschub.service';
import { WishRemovalFlowService } from '../../hq/nachschub/wish-removal-flow.service';
import { WishCartService } from '../../shell/cart/wish-cart.service';
import { UndoToastService } from '../undo-toast/undo-toast.service';
import { ItemPathComponent, ItemPathLevel, nextStepOf, ownStepOf } from './item-path.component';
import { FakeItemPath, fakeItemPath, pathState } from './item-path.testing';

interface Opts {
  kind?: string;
  level?: ItemPathLevel;
  state?: Partial<ItemPathState>;
}

function setup(o: Opts = {}) {
  const path: FakeItemPath = fakeItemPath(o.state);
  const cart = { open: vi.fn().mockName('open').mockResolvedValue(true) };
  const lowered = { ok: true, key: 'wishRemoval.done', undo: async () => ({ ok: true, key: 'itemPath.done.undone' }) };
  const flow = { lower: vi.fn().mockName('lower').mockResolvedValue(lowered), announce: vi.fn().mockName('announce') };
  const focus = { select: vi.fn().mockName('select') };
  TestBed.configureTestingModule({
    imports: [ItemPathComponent],
    providers: [
      // The strip's link goes to Planen; a route there keeps a plain click from failing the run.
      provideRouter([{ path: 'hq', children: [] }]),
      provideTranslateService(),
      { provide: ItemPathService, useValue: path },
      { provide: WishCartService, useValue: cart },
      { provide: WishRemovalFlowService, useValue: flow },
      { provide: NachschubFocusService, useValue: focus },
    ],
  });
  const fixture = TestBed.createComponent(ItemPathComponent);
  fixture.componentRef.setInput('kind', o.kind ?? 'item');
  fixture.componentRef.setInput('className', 'cls');
  fixture.componentRef.setInput('name', 'Helm');
  fixture.componentRef.setInput('level', o.level ?? 'tertiary');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const node = (step: PathStep) => el.querySelector<HTMLElement>(`.node[data-step="${step}"]`);
  const settle = async () => {
    // Not whenStable: the undo toast holds a 6 s window open in the zone.
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  };
  const click = async (b: HTMLElement) => {
    b.click();
    await settle();
  };
  const popover = () => document.querySelector<HTMLElement>('.cdk-overlay-container .rp');
  return { fixture, el, node, click, settle, popover, path, cart, flow, focus, toast: TestBed.inject(UndoToastService) };
}

describe('ItemPathComponent: the two-node path', () => {
  // Several cases click real anchors (the Operation strip, the picker's footer
  // link). Left alone the test browser follows them, leaves the page and
  // Vitest loses its connection. Capture phase: the component's own handlers
  // still run, only the browser's navigation is stopped.
  const stayOnPage = (e: MouseEvent): void => {
    if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault();
  };
  beforeEach(() => document.addEventListener('click', stayOnPage, true));
  afterEach(() => {
    document.removeEventListener('click', stayOnPage, true);
    TestBed.inject(UndoToastService).flush();
    document.querySelector('.cdk-overlay-container')?.replaceChildren();
  });

  it('has two nodes only: Wunschliste and Inventar, no Nachschub node', () => {
    const { el } = setup();
    const steps = Array.from(el.querySelectorAll('.node')).map((n) => n.getAttribute('data-step'));
    expect(steps).toEqual(['wish', 'inventar']);
  });

  it('a ship ends at the Hangar, a blueprint at the Sammlung, an announced ship at the wish', () => {
    expect(stepsOf('ship')).toEqual(['wish', 'hangar']);
    expect(stepsOf('item')).toEqual(['wish', 'inventar']);
    expect(stepsOf('upcoming')).toEqual(['wish']);
    expect(ownWordOf('ship')).toBe('hangar');
    expect(ownWordOf('blueprint')).toBe('sammlung');
    expect(ownWordOf('weapon')).toBe('inventar');
    expect(ownWordOf('upcoming')).toBeNull();
  });

  it('renders the Hangar node for a ship and only the wish node for an announced ship', () => {
    expect(setup({ kind: 'ship' }).node('hangar')).not.toBeNull();
    TestBed.resetTestingModule();
    expect(setup({ kind: 'upcoming' }).el.querySelectorAll('.node').length).toBe(1);
  });

  it('an empty wish node puts one piece on the wishlist, with an undo toast', async () => {
    const t = setup();
    await t.click(t.node('wish')!);
    expect(t.path.addWish).toHaveBeenCalledTimes(1);
    expect(t.path.addWish).toHaveBeenCalledWith('item', 'cls', 'Helm');
    expect(t.cart.open).not.toHaveBeenCalled();
    expect(t.toast.current()?.messageKey).toBe('itemPath.done.wishOn');
  });

  it('a filled wish node shows the quantity and opens the cart instead of adding more', async () => {
    const t = setup({ state: { wished: true, wishQty: 3 } });
    expect(t.node('wish')!.querySelector('.n')!.textContent!.trim()).toBe('3');
    await t.click(t.node('wish')!);
    expect(t.cart.open).toHaveBeenCalledTimes(1);
    expect(t.path.addWish).not.toHaveBeenCalled();
  });

  it('a filled Inventar node is a real link to the item in HQ Bestand', () => {
    const t = setup({ state: { inventarQty: 2 } });
    const a = t.node('inventar') as HTMLAnchorElement;
    expect(a.tagName).toBe('A');
    const href = a.getAttribute('href')!;
    expect(href).toContain('/hq');
    expect(href).toContain('bestand=inventar');
    expect(href).toContain('focus=cls');
    expect(href).toContain('#inventar');
    expect(a.querySelector('.n')!.textContent!.trim()).toBe('2');
  });

  it('a collected blueprint links to the Sammlung tab', () => {
    const t = setup({ kind: 'blueprint', state: { inventarQty: 1 } });
    expect((t.node('inventar') as HTMLAnchorElement).getAttribute('href')).toContain('bestand=sammlung');
  });

  it('an owned ship links to its page in the Hangar', () => {
    const t = setup({ kind: 'ship', state: { inHangar: true, hangarShipId: 'abc' } });
    expect((t.node('hangar') as HTMLAnchorElement).getAttribute('href')).toBe('/hq/hangar/abc');
  });

  it('an empty Inventar node asks for the place first, then stores one piece', async () => {
    const t = setup();
    await t.click(t.node('inventar')!);
    const pop = t.popover()!;
    expect(pop).not.toBeNull();
    pop.querySelector<HTMLButtonElement>('.place')!.click();
    await t.settle();
    expect(t.path.moveToInventar).toHaveBeenCalledTimes(1);
    expect(t.path.moveToInventar).toHaveBeenCalledWith('item', 'cls', 'Helm', 'Bei mir', 1);
  });

  it('an empty Hangar node adds the ship; an empty Sammlung node collects the blueprint', async () => {
    const ship = setup({ kind: 'ship' });
    await ship.click(ship.node('hangar')!);
    expect(ship.path.addToHangar).toHaveBeenCalledTimes(1);
    expect(ship.path.addToHangar).toHaveBeenCalledWith('cls', 'Helm');
    TestBed.resetTestingModule();
    const bp = setup({ kind: 'blueprint' });
    await bp.click(bp.node('inventar')!);
    expect(bp.path.moveToInventar).toHaveBeenCalledTimes(1);
    expect(bp.path.moveToInventar).toHaveBeenCalledWith('blueprint', 'cls', 'Helm', 'Blueprints', 1);
  });

  it('a failure shows its translated key at the node, no toast', async () => {
    const t = setup();
    t.path.addWish.mockResolvedValue({ ok: false, key: 'errors.itemPath.failed' });
    await t.click(t.node('wish')!);
    expect(t.popover()!.textContent).toContain('errors.itemPath.failed');
    expect(t.popover()!.classList).toContain('err');
    expect(t.popover()!.getAttribute('role')).toBe('alert');
    expect(t.toast.current()).toBeNull();
  });

  it('a refusal (tone info) shows neutral, as a status - never in the danger tone (AUD-2)', async () => {
    const t = setup();
    t.path.addWish.mockResolvedValue({ ok: false, key: 'itemPath.err.unavailable', tone: 'info' });
    await t.click(t.node('wish')!);
    expect(t.popover()!.textContent).toContain('itemPath.err.unavailable');
    expect(t.popover()!.classList).not.toContain('err');
    expect(t.popover()!.getAttribute('role')).toBe('status');
  });

  it('an owned ship shows its copies on the Hangar node and still takes a wish', async () => {
    const t = setup({ kind: 'ship', state: { inHangar: true, hangarQty: 2, hangarShipId: 's1' } });
    expect(t.node('hangar')!.textContent).toContain('2');
    await t.click(t.node('wish')!);
    expect(t.path.addWish).toHaveBeenCalledTimes(1);
    expect(t.path.addWish).toHaveBeenCalledWith('ship', 'cls', 'Helm');
  });

  describe('the detail page (primary level)', () => {
    it('shows a stepper at the wish: + sets the quantity, - lowers it only through the removal flow (C6)', async () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 2, free: 2 } });
      const [less, more] = Array.from(t.el.querySelectorAll<HTMLButtonElement>('.stop .st button'));
      await t.click(more);
      expect(t.path.setWishQty).toHaveBeenCalledWith('item', 'cls', 'Helm', 3);
      await t.click(less);
      expect(t.flow.lower).toHaveBeenCalledWith({ kind: 'item', className: 'cls', forClassName: null, name: 'Helm' }, 1, 'codex');
      expect(t.flow.announce).toHaveBeenCalledTimes(1);
      expect(t.path.setWishQty).toHaveBeenCalledTimes(1);
      expect(t.path.removeWish).not.toHaveBeenCalled();
    });

    it('a lowering the reader cancels in the dialog changes nothing and shows nothing', async () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 3, assigned: 3, free: 0 } });
      t.flow.lower.mockResolvedValueOnce(null);
      await t.click(t.el.querySelector<HTMLButtonElement>('.stop .st button')!);
      expect(t.flow.announce).not.toHaveBeenCalled();
      expect(t.popover()).toBeNull();
    });

    it('never meets the reader with the old refusal itemPath.err.wishAssigned when lowering an assigned wish', async () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 3, assigned: 3, free: 0 } });
      await t.click(t.el.querySelector<HTMLButtonElement>('.stop .st button')!);
      expect(t.path.setWishQty).not.toHaveBeenCalled();
      expect(t.flow.lower).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).not.toContain('itemPath.err.wishAssigned');
    });

    it('without stock the ownership station shows only its button, and it asks for the place on click', async () => {
      const t = setup({ level: 'primary' });
      const stops = t.el.querySelectorAll('.stop');
      expect(stops.length).toBe(2);
      expect(stops[1].querySelector('.strip')).toBeNull();
      expect(stops[1].querySelector('p')).toBeNull();
      const btn = stops[1].querySelector<HTMLButtonElement>('button.sc-action--secondary')!;
      await t.click(btn);
      expect(t.popover()).not.toBeNull();
      expect(btn.classList).toContain('is-open');
      expect(btn.getAttribute('aria-expanded')).toBe('true');
    });

    it('with stock: a stepper on the first place and a link to the item', async () => {
      const t = setup({ level: 'primary', state: { inventarQty: 2, places: [{ location: 'Bei mir', qty: 2 }] } });
      const stop = t.el.querySelectorAll('.stop')[1];
      await t.click(stop.querySelectorAll<HTMLButtonElement>('.st button')[1]);
      expect(t.path.adjustInventar).toHaveBeenCalledWith('cls', 'Helm', 'Bei mir', 1);
      expect(stop.querySelector('a.alink')!.getAttribute('href')).toContain('focus=cls');
    });
  });

  describe('the pill (secondary level)', () => {
    it('offers the wish first, then the Inventar, then nothing', () => {
      expect(nextStepOf(pathState('item'))).toBe('wish');
      expect(nextStepOf(pathState('item', { wished: true }))).toBe('inventar');
      expect(nextStepOf(pathState('item', { wished: true, inventarQty: 1 }))).toBeNull();
      expect(nextStepOf(pathState('ship', { wished: true }))).toBe('hangar');
      expect(nextStepOf(pathState('ship', { inHangar: true }))).toBeNull();
      expect(nextStepOf(pathState('upcoming'))).toBe('wish');
      expect(nextStepOf(pathState('upcoming', { wished: true }))).toBeNull();
      expect(ownStepOf(pathState('ship'))).toBe('hangar');
      expect(ownStepOf(pathState('upcoming'))).toBeNull();
    });

    it('renders the next step as a button', async () => {
      const t = setup({ level: 'secondary' });
      await t.click(t.el.querySelector<HTMLButtonElement>('button.go')!);
      expect(t.path.addWish).toHaveBeenCalledTimes(1);
    });
  });

  describe('the add moment (streak, pulse, fill - once per add)', () => {
    const adding = (t: ReturnType<typeof setup>) => t.el.querySelectorAll('[data-adding]');

    /** The write also moves the state, as the real service does. */
    function wishing(t: ReturnType<typeof setup>): void {
      t.path.addWish.mockImplementation(async () => {
        t.path.current.set({ wished: true, wishQty: 1 });
        return { ok: true, key: 'itemPath.done.wishOn', undo: async () => ({ ok: true, key: 'itemPath.done.undone' }) };
      });
    }

    // Skipped: this case crashes the headless test browser (Vitest
    // "Browser connection was closed") — on main too (web-ci on 7871cf90,
    // 2026-11-26). The other add-moment cases still pin the one-shot. Re-enable
    // once the crash is found.
    it.skip('plays on the wish node when the reader adds, then ends (one shot) and the node keeps its wished look', async () => {
      const t = setup();
      wishing(t);
      expect(adding(t).length).toBe(0);
      await t.click(t.node('wish')!);
      expect(adding(t).length).toBe(1);
      expect(t.node('wish')!.hasAttribute('data-adding')).toBe(true);
      expect(t.node('wish')!.classList).toContain('is-adding');
      await new Promise((r) => setTimeout(r, 1800));
      t.fixture.detectChanges();
      expect(adding(t).length).toBe(0);
      expect(t.node('wish')!.classList).toContain('on');
    });

    it('does not play on the first render of an item that is already wished', () => {
      const t = setup({ state: { wished: true, wishQty: 2 } });
      expect(adding(t).length).toBe(0);
      expect(t.node('wish')!.classList).toContain('on');
    });

    it('does not play for a quantity change or a removal', async () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 2 } });
      const [less, more] = Array.from(t.el.querySelectorAll<HTMLButtonElement>('.stop .st button'));
      await t.click(more);
      expect(adding(t).length).toBe(0);
      t.flow.lower.mockImplementationOnce(async () => {
        t.path.current.set({ wished: false, wishQty: 0 });
        return { ok: true, key: 'itemPath.done.wishOff' };
      });
      await t.click(less);
      expect(adding(t).length).toBe(0);
    });

    it('does not play when the add fails', async () => {
      const t = setup();
      t.path.addWish.mockResolvedValueOnce({ ok: false, key: 'itemPath.err.failed' });
      await t.click(t.node('wish')!);
      expect(adding(t).length).toBe(0);
    });

    it('plays from the pill button', async () => {
      const t = setup({ level: 'secondary' });
      wishing(t);
      await t.click(t.el.querySelector<HTMLButtonElement>('button.go')!);
      expect(t.node('wish')!.hasAttribute('data-adding')).toBe(true);
    });

    it('plays on the detail page, where the wish stop carries it', async () => {
      const t = setup({ level: 'primary' });
      wishing(t);
      await t.click(t.el.querySelector<HTMLButtonElement>('.stop button.sc-action--primary')!);
      expect(t.el.querySelector('.stop-h')!.hasAttribute('data-adding')).toBe(true);
    });
  });
  describe('Operationen in the wish station (concept pfad-stationen)', () => {
    const asg = (over: Partial<WishAssignment> = {}): WishAssignment => ({
      packageId: 'op1', packageName: 'Bodentrupp ausrüsten', qty: 3, assignedAt: '2026-11-17T10:00:00Z', createdAt: '2026-11-10T10:00:00Z',
      einsaetzeDone: 1, einsaetzeTotal: 4, lineIds: ['l1'], ...over,
    });
    const wishStation = (t: ReturnType<typeof setup>) => t.el.querySelector<HTMLElement>('.stop[data-station="wish"]')!;
    const ownStation = (t: ReturnType<typeof setup>) => t.el.querySelector<HTMLElement>('.stop[data-station="own"]')!;
    const picker = () => document.querySelector<HTMLElement>('.cdk-overlay-container sc-item-path-assign');
    const targets = {
      operations: [
        { id: 'new1', name: 'Vorrat Lazarett', createdAt: '2026-11-16T10:00:00Z', einsaetzeDone: 0, einsaetzeTotal: 2 },
        { id: 'op1', name: 'Bodentrupp ausrüsten', createdAt: '2026-11-10T10:00:00Z', einsaetzeDone: 1, einsaetzeTotal: 4 },
        { id: 'old', name: 'Flotte ausbauen', createdAt: '2026-11-01T10:00:00Z', einsaetzeDone: 2, einsaetzeTotal: 5 },
      ],
      slotsUsed: 3, slotsMax: 7, canCreate: true, blockKey: null,
    };

    it('two stations only (B1): the wish station holds the assignment, no third station', () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 5, assigned: 3, free: 2, assignments: [asg()] } });
      expect(t.el.querySelectorAll('.stop').length).toBe(2);
      expect(wishStation(t).querySelector('.strip.asg')).not.toBeNull();
    });

    it('not assigned: only the button "Zuordnen", same tier as "Ins Inventar", no strip (B3)', () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 5, free: 5 } });
      const w = wishStation(t);
      expect(w.querySelector('.strip')).toBeNull();
      const btn = w.querySelector<HTMLButtonElement>('button.assign')!;
      expect(btn.textContent).toContain('pathCtl.assign.go');
      expect(btn.classList).toContain('sc-action--secondary');
      expect(ownStation(t).querySelector('button.sc-action--secondary')).not.toBeNull();
    });

    it('assigned: a strip that links to the Operation in the HQ, Route glyph, marks BEFORE the text (B4)', async () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 5, assigned: 3, free: 2, assignments: [asg()] } });
      const a = wishStation(t).querySelector<HTMLAnchorElement>('a.strip.asg')!;
      expect(a.getAttribute('href')).toBe('/hq#planen');
      expect(a.querySelector('.strip-i')).not.toBeNull();
      expect(a.querySelector('.asg-name')!.textContent).toContain('pathCtl.assign.line');
      const kids = Array.from(a.children).map((c) => c.classList[0]);
      expect(kids.indexOf('seg')).toBeGreaterThan(kids.indexOf('asg-name'));
      expect(kids.indexOf('mut')).toBeGreaterThan(kids.indexOf('seg'));
      expect(a.querySelectorAll('.seg i').length).toBe(4);
      expect(a.querySelectorAll('.seg i.on').length).toBe(1);
      a.click();
      await t.settle();
      expect(t.focus.select).toHaveBeenCalledWith('op1');
      // Free pieces left: "Zuordnen" stays under the strip.
      expect(wishStation(t).querySelector('button.assign')).not.toBeNull();
    });

    it('while the Operationen load, "Zuordnen" shows busy and opens no picker; the strips appear once known', async () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 3, free: 0, assignmentsKnown: false } });
      const btn = wishStation(t).querySelector<HTMLButtonElement>('button.assign')!;
      expect(btn).not.toBeNull();
      expect(btn.classList).toContain('is-busy');
      expect(wishStation(t).querySelector('.strip')).toBeNull();
      btn.click();
      await t.settle();
      expect(picker()).toBeNull();
      t.path.current.set({ wished: true, wishQty: 3, assigned: 2, free: 1, assignmentsKnown: true, assignments: [asg({ qty: 2 })] });
      t.fixture.detectChanges();
      expect(wishStation(t).querySelectorAll('a.strip.asg').length).toBe(1);
      expect(wishStation(t).querySelector('button.assign')!.classList).not.toContain('is-busy');
    });

    it('everything assigned: the strip, no "Zuordnen"', () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 3, assigned: 3, free: 0, assignments: [asg()] } });
      expect(wishStation(t).querySelector('button.assign')).toBeNull();
    });

    it('several Operationen: one strip each, newest first, up to two, then "+N weitere"', () => {
      const list = [asg({ packageId: 'a' }), asg({ packageId: 'b' }), asg({ packageId: 'c' })];
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 9, assigned: 9, free: 0, assignments: list } });
      expect(wishStation(t).querySelectorAll('a.strip.asg').length).toBe(2);
      expect(wishStation(t).querySelector('a.strip-more')!.textContent).toContain('pathCtl.assign.moreOne');
    });

    it('owned: ONE line with the quantity, the one nearest place and a hint for more places (B5)', () => {
      const places = [{ location: 'Area 18', qty: 1 }, { location: 'Lorville', qty: 2 }, { location: 'Bei mir', qty: 1 }];
      const t = setup({ level: 'primary', state: { inventarQty: 4, places, nearestPlace: 'Lorville', morePlaces: 2 } });
      const strips = ownStation(t).querySelectorAll<HTMLElement>('.strip.own');
      expect(strips.length).toBe(1);
      const strip = strips[0];
      expect(strip.querySelector('.place-1')!.textContent).toContain('Lorville');
      expect(strip.textContent).not.toContain('Area 18');
      expect(strip.querySelector('.more-places')!.textContent).toContain('pathCtl.own.morePlaces');
      expect(strip.querySelector('a.alink')!.getAttribute('href')).toContain('focus=cls');
      expect(getComputedStyle(strip).flexWrap).toBe('nowrap');
    });

    it('the Inventar counter steps at the place the strip names', async () => {
      const places = [{ location: 'Area 18', qty: 1 }, { location: 'Lorville', qty: 2 }];
      const t = setup({ level: 'primary', state: { inventarQty: 3, places, nearestPlace: 'Lorville', morePlaces: 1 } });
      await t.click(ownStation(t).querySelectorAll<HTMLButtonElement>('.st button')[1]);
      expect(t.path.adjustInventar).toHaveBeenCalledWith('cls', 'Helm', 'Lorville', 1);
    });

    it('a ship in the Hangar shows "Im Hangar" without a place', () => {
      const t = setup({ kind: 'ship', level: 'primary', state: { inHangar: true, hangarQty: 1, hangarShipId: 's1' } });
      const strip = ownStation(t).querySelector('.strip.own')!;
      expect(strip.textContent).toContain('pathCtl.ownOn.hangar');
      expect(strip.querySelector('.place-1')).toBeNull();
      expect(strip.querySelector('a.alink')!.getAttribute('href')).toBe('/hq/hangar/s1');
    });

    it('the picker hangs on its button: newest first, "zuletzt erstellt", preset to every free piece, new last, footer link (B6, B7)', async () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 5, free: 5 } });
      t.path.targets.set(targets);
      const btn = wishStation(t).querySelector<HTMLButtonElement>('button.assign')!;
      await t.click(btn);
      expect(t.path.loadAssignTargets).toHaveBeenCalled();
      const p = picker()!;
      expect(p).not.toBeNull();
      expect(p.getAttribute('data-caret')).toBe('top');
      expect(btn.classList).toContain('is-open');
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      const names = Array.from(p.querySelectorAll('.ap-row .ap-pn b')).map((b) => b.textContent!.trim());
      expect(names).toEqual(['Vorrat Lazarett', 'Bodentrupp ausrüsten', 'Flotte ausbauen', 'pathCtl.assign.new']);
      expect(p.querySelectorAll('.ap-row')[0].querySelector('small')!.textContent).toContain('pathCtl.assign.newest');
      expect(p.querySelectorAll('.ap-row')[1].querySelector('small')).toBeNull();
      expect(p.querySelector('.st b')!.textContent!.trim()).toBe('5');
      expect(p.textContent).toContain('pathCtl.assign.ofWished');
      const rows = p.querySelectorAll<HTMLButtonElement>('.ap-row');
      expect(rows[rows.length - 1].getAttribute('data-target')).toBe('new');
      expect(rows[rows.length - 1].disabled).toBe(false);
      expect(p.querySelector('a.ap-link')!.getAttribute('href')).toBe('/hq#planen');
      // The overlay sits below the button and does not cover it.
      expect(p.getBoundingClientRect().top).toBeGreaterThanOrEqual(btn.getBoundingClientRect().bottom);
      await t.click(btn);
      expect(picker()).toBeNull();
    });

    it('with all 7 slots taken "Neue Operation" is disabled and says why', async () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 2, free: 2 } });
      t.path.targets.set({ ...targets, slotsUsed: 7, canCreate: false, blockKey: 'hq.nachschub.slotsFull' });
      await t.click(wishStation(t).querySelector<HTMLButtonElement>('button.assign')!);
      const nu = picker()!.querySelector<HTMLButtonElement>('.ap-row[data-target="new"]')!;
      expect(nu.disabled).toBe(true);
      expect(nu.textContent).toContain('hq.nachschub.slotsFull');
    });

    it('assigning calls the service with surface codex and offers the undo toast; the stepper sets the quantity', async () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 5, free: 5 } });
      t.path.targets.set(targets);
      await t.click(wishStation(t).querySelector<HTMLButtonElement>('button.assign')!);
      const p = picker()!;
      p.querySelector<HTMLButtonElement>('.st button')!.click();
      await t.settle();
      expect(p.querySelector('.st b')!.textContent!.trim()).toBe('4');
      p.querySelectorAll<HTMLButtonElement>('.ap-row')[1].click();
      await t.settle();
      expect(t.path.assignWish).toHaveBeenCalledWith('item', 'cls', 4, 'op1', { name: 'Helm', surface: 'codex' });
      expect(picker()).toBeNull();
      expect(t.toast.current()?.messageKey).toBe('hq.nachschub.assigned');
    });

    it('"Neue Operation" assigns to a new one (the service proposes the name)', async () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 3, free: 3 } });
      await t.click(wishStation(t).querySelector<HTMLButtonElement>('button.assign')!);
      picker()!.querySelector<HTMLButtonElement>('.ap-row[data-target="new"]')!.click();
      await t.settle();
      expect(t.path.assignWish).toHaveBeenCalledWith('item', 'cls', 3, 'new', { name: 'Helm', surface: 'codex' });
    });

    it('while the Operationen load the picker rows are off and say so; once loaded a click assigns', async () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 3, free: 3, assignmentsKnown: true } });
      t.path.targets.set(targets);
      await t.click(wishStation(t).querySelector<HTMLButtonElement>('button.assign')!);
      // The store reloads under the open picker: nothing may be clicked into the void.
      t.path.current.set({ wished: true, wishQty: 3, free: 0, assignmentsKnown: false });
      await t.settle();
      const p = picker()!;
      expect(p.querySelector('.ap-busy')!.textContent).toContain('pathCtl.assign.loading');
      const rows = Array.from(p.querySelectorAll<HTMLButtonElement>('.ap-row'));
      expect(rows.every((b) => b.disabled)).toBe(true);
      rows[rows.length - 1].click();
      await t.settle();
      expect(t.path.assignWish).not.toHaveBeenCalled();
      t.path.current.set({ wished: true, wishQty: 3, free: 3, assignmentsKnown: true });
      await t.settle();
      expect(picker()!.querySelector('.ap-busy')).toBeNull();
      picker()!.querySelector<HTMLButtonElement>('.ap-row[data-target="new"]')!.click();
      await t.settle();
      expect(t.path.assignWish).toHaveBeenCalledTimes(1);
    });

    it('a write under way shows "Wird zugeordnet" in the picker; a refused assign shows its translated message', async () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 2, free: 2 } });
      let finish: (v: unknown) => void = () => undefined;
      t.path.assignWish.mockReturnValueOnce(new Promise((res) => (finish = res)));
      await t.click(wishStation(t).querySelector<HTMLButtonElement>('button.assign')!);
      picker()!.querySelector<HTMLButtonElement>('.ap-row[data-target="new"]')!.click();
      await t.settle();
      expect(picker()!.querySelector('.ap-busy')!.textContent).toContain('pathCtl.assign.working');
      finish({ ok: false, key: 'hq.nachschub.nothingFree' });
      await t.settle();
      expect(document.querySelector('.cdk-overlay-container .rp')!.textContent).toContain('hq.nachschub.nothingFree');
    });

    it('rows and cards: a small Route badge on an assigned wish node, the ring stays solid, nothing to assign (B8)', () => {
      const t = setup({ state: { wished: true, wishQty: 2, assigned: 1, free: 1, assignments: [asg({ qty: 1 })] } });
      const node = t.node('wish')!;
      expect(node.querySelector('.op-badge')).not.toBeNull();
      expect(getComputedStyle(node).borderTopStyle).toBe('solid');
      expect(t.el.querySelector('button.assign')).toBeNull();
      expect(node.getAttribute('aria-label')).toContain('pathCtl.wishAssigned');
      TestBed.resetTestingModule();
      expect(setup({ state: { wished: true, wishQty: 2, free: 2 } }).node('wish')!.querySelector('.op-badge')).toBeNull();
    });
  });
});
