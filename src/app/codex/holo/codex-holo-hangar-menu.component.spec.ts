import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ItemPathService } from '../../hq/data/item-path.service';
import { NachschubFocusService } from '../../hq/nachschub/nachschub-focus.service';
import { WishRemovalFlowService } from '../../hq/nachschub/wish-removal-flow.service';
import { fakeItemPath, type FakeItemPath } from '../../shared/item-path/item-path.testing';
import { WishCartService } from '../../shell/cart/wish-cart.service';
import { CodexHoloHangarMenuComponent, HangarExemplar } from './codex-holo-hangar-menu.component';

const ex = (id: string, diffCount: number, summary: string | null = null): HangarExemplar => ({
  id,
  name: `Gladius · ${id}`,
  diffCount,
  summary,
  link: { commands: ['/hq/hangar', 'ship-1'], queryParams: { v: id } },
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('CodexHoloHangarMenuComponent', () => {
  let fixture: ComponentFixture<CodexHoloHangarMenuComponent>;
  let path: FakeItemPath;
  let flow: { lower: ReturnType<typeof vi.fn>; announce: ReturnType<typeof vi.fn> };
  // The trigger lives in the host, the panel in the CDK overlay container.
  const q = (sel: string) => (fixture.nativeElement.querySelector(sel) ?? document.querySelector(sel)) as HTMLElement | null;
  const all = (sel: string) =>
    [...Array.from(fixture.nativeElement.querySelectorAll(sel)), ...Array.from(document.querySelectorAll(`.cdk-overlay-container ${sel}`))] as HTMLElement[];

  beforeEach(() => {
    path = fakeItemPath({ inHangar: true, hangarQty: 2, hangarShipId: 'ship-1' });
    flow = { lower: vi.fn().mockResolvedValue(null), announce: vi.fn() };
    TestBed.configureTestingModule({
      imports: [CodexHoloHangarMenuComponent],
      providers: [
        provideRouter([{ path: 'hq', children: [] }]),
        provideTranslateService({}),
        { provide: ItemPathService, useValue: path },
        { provide: WishRemovalFlowService, useValue: flow },
        { provide: WishCartService, useValue: { open: vi.fn().mockResolvedValue(true) } },
        { provide: NachschubFocusService, useValue: { select: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(CodexHoloHangarMenuComponent);
    fixture.componentRef.setInput('shipName', 'Gladius');
    fixture.componentRef.setInput('className', 'AEGS_Gladius');
    fixture.componentRef.setInput('count', 2);
    fixture.componentRef.setInput('signedIn', true);
    fixture.componentRef.setInput('exemplars', [ex('pvp', 1, 'Laser-Nase für PvP'), ex('bounty', 0)]);
  });

  afterEach(() => fixture.destroy());

  function open(): void {
    fixture.detectChanges();
    q('.hb')!.click();
    fixture.detectChanges();
  }

  it('is a labelled dialog, not a menu: Ausstattung first, then the wish and the hangar station', () => {
    open();
    expect(q('.hb')!.getAttribute('aria-haspopup')).toBe('dialog');
    expect(q('.scp-frame')!.getAttribute('role')).toBe('dialog');
    expect(q('[role="menu"], [role^="menuitem"]')).toBeNull();
    const stations = all('sc-item-path [data-station]').map((s) => s.getAttribute('data-station'));
    expect(stations).toEqual(['wish', 'own']);
    expect(q('.grp')!.compareDocumentPosition(q('sc-item-path')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lists Werk and every exemplar as links, with the summary and the diff marker', () => {
    open();
    const rows = all('.grp a.row');
    expect(rows.length).toBe(3);
    expect(rows[1].getAttribute('href')).toContain('/hq/hangar/ship-1?v=pvp');
    expect(rows[1].textContent).toContain('Laser-Nase für PvP');
    expect(rows[1].querySelector('sc-holo-diff-marker')).not.toBeNull();
    expect(rows[2].querySelector('sc-holo-diff-marker')).toBeNull();
    expect(rows[0].getAttribute('aria-current')).toBe('true');
  });

  it('carries the Route badge on the trigger only while a wish of this hull sits in an Operation', () => {
    fixture.detectChanges();
    expect(q('.hb .op-badge')).toBeNull();
    path.current.set({ inHangar: true, wished: true, wishQty: 3, assigned: 2, free: 1, assignmentsKnown: true });
    fixture.detectChanges();
    expect(q('.hb .op-badge')).not.toBeNull();
    expect(q('.hb .sc-sr-only')!.textContent).toContain('pathCtl.wishAssigned');
  });

  it('lowers the wish through the one removal flow, never by a direct write', async () => {
    path.current.set({ inHangar: true, wished: true, wishQty: 2, free: 2, assignmentsKnown: true });
    open();
    q('[data-station="wish"] .st button')!.click();
    await settle();
    expect(flow.lower).toHaveBeenCalledTimes(1);
    expect(flow.lower.mock.calls[0][0]).toMatchObject({ kind: 'ship', className: 'AEGS_Gladius' });
    expect(path.setWishQty).not.toHaveBeenCalled();
    expect(fixture.componentInstance.open()).toBe(true);
  });

  it('"Zuordnen" opens the picker inside the panel and the panel stays open; Escape closes the picker first, then the panel', async () => {
    path.current.set({ inHangar: true, wished: true, wishQty: 2, free: 2, assignmentsKnown: true });
    open();
    const assign = q('[data-station="wish"] button.assign')!;
    assign.click();
    fixture.detectChanges();
    await settle();
    const picker = q('.menu sc-item-path-assign');
    expect(picker).not.toBeNull();
    expect(picker!.classList).toContain('inline');
    expect(fixture.componentInstance.open()).toBe(true);
    // In the flow of the panel: no second floating layer next to it.
    expect(document.querySelectorAll('.cdk-overlay-pane').length).toBe(1);

    const esc = () => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    picker!.querySelector('.scp-frame')!.dispatchEvent(esc());
    fixture.detectChanges();
    expect(q('.menu sc-item-path-assign')).toBeNull();
    expect(fixture.componentInstance.open()).toBe(true);

    q('.menu .scp-frame')!.dispatchEvent(esc());
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('"Zuordnen" is busy while the Operationen load', () => {
    path.current.set({ inHangar: true, wished: true, wishQty: 2, free: 0, assignmentsKnown: false });
    open();
    expect(q('[data-station="wish"] button.assign')!.getAttribute('aria-busy')).toBe('true');
  });

  it('lists a wish with its loadout under the wish station and opens it like an exemplar (D1)', () => {
    path.current.set({ inHangar: true, wished: true, wishQty: 1, assignmentsKnown: true });
    fixture.componentRef.setInput('wishes', [ex('wish-1', 2)]);
    fixture.componentRef.setInput('activeId', 'wish-1');
    open();
    const wish = q('[data-station="wish"] a.row.wish');
    expect(wish).not.toBeNull();
    expect(wish!.getAttribute('href')).toContain('?v=wish-1');
    expect(wish!.getAttribute('aria-current')).toBe('true');
    expect(wish!.querySelector('sc-holo-diff-marker')).not.toBeNull();
    expect(q('.hb .ex')!.textContent).toContain('Gladius · wish-1');
    wish!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('on a swapped Werk offers "wish this build", which the page writes with the swaps', () => {
    fixture.componentRef.setInput('activeId', null);
    fixture.componentRef.setInput('werkChanged', 2);
    const asked: unknown[] = [];
    fixture.componentInstance.addWish.subscribe((v) => asked.push(v));
    open();
    const btn = q('[data-station="wish"] button.wish-build')!;
    expect(btn.textContent).toContain('codex.holo.hangar.wishWithMany');
    btn.click();
    expect(asked).toEqual([null]);
    expect(path.addWish).not.toHaveBeenCalled();
  });

  it('the plain wish is written by the station itself', async () => {
    open();
    const go = all('[data-station="wish"] button').find((b) => b.textContent?.includes('pathCtl.go.wish'))!;
    go.click();
    await settle();
    expect(path.addWish).toHaveBeenCalledWith('ship', 'AEGS_Gladius', 'Gladius');
  });

  it('on Werk the hangar station offers saving as an exemplar and another copy; the strip links into the hangar', () => {
    fixture.componentRef.setInput('activeId', null);
    const saved: unknown[] = [];
    const copies: unknown[] = [];
    fixture.componentInstance.saveAsExemplar.subscribe((v) => saved.push(v));
    fixture.componentInstance.addCopy.subscribe((v) => copies.push(v));
    open();
    const own = q('[data-station="own"]')!;
    expect(own.querySelector('.h-new')).toBeNull();
    expect(own.querySelector('.strip.own a')!.getAttribute('href')).toContain('ship-1');
    (own.querySelector('.h-another') as HTMLElement).click();
    expect(copies).toEqual([null]);
    expect(fixture.componentInstance.open()).toBe(true);
    (own.querySelector('.h-save') as HTMLElement).click();
    expect(saved).toEqual([null]);
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('on an exemplar: its name in the hangar strip, copy / new from Werk, and its four icon actions', () => {
    fixture.componentRef.setInput('activeId', 'pvp');
    const copied: string[] = [];
    const removed: string[] = [];
    fixture.componentInstance.copyExemplar.subscribe((id) => copied.push(id));
    fixture.componentInstance.remove.subscribe((id) => removed.push(id));
    open();
    expect(q('[data-station="own"] .own-name')!.textContent).toContain('Gladius · pvp');
    expect(all('.acts button').length).toBe(4);
    expect(q('[data-station="own"] .h-new')).not.toBeNull();
    q('[data-station="own"] .h-copy')!.click();
    expect(copied).toEqual(['pvp']);
    open();
    q('.acts .a-remove')!.click();
    expect(removed).toEqual(['pvp']);
  });

  it('signed out it shows the sign-in link instead of the stations', () => {
    fixture.componentRef.setInput('signedIn', false);
    open();
    expect(q('sc-item-path')).toBeNull();
    expect(q('a.sign-in')!.getAttribute('href')).toBe('/login');
  });

  it('the stations stand without an extra frame inside the panel', () => {
    open();
    expect(q('sc-item-path')!.classList).toContain('ip-bare');
    expect(fixture.componentInstance.open()).toBe(true);
    fixture.componentInstance.close();
    fixture.detectChanges();
    expect(document.querySelector('.cdk-overlay-container .menu')).toBeNull();
  });

  it('the trigger sentence can wrap, never clips the shown Ausstattung', () => {
    fixture.detectChanges();
    const hb = q('.hb')!;
    expect(getComputedStyle(hb).whiteSpace).not.toBe('nowrap');
    expect(getComputedStyle(q('.hb .t')!).flexWrap).toBe('wrap');
    expect(getComputedStyle(q('.hb .ex')!).overflow).toBe('visible');
  });

  it('in the slim head band the trigger keeps one row: the loadout name ellipsises and the tooltip carries the sentence', () => {
    const band = document.createElement('sc-codex-detail-head');
    band.className = 'slim';
    band.style.cssText = 'display: block; width: 160px';
    document.body.appendChild(band);
    band.appendChild(fixture.nativeElement);
    (fixture.nativeElement as HTMLElement).style.width = '160px';
    fixture.detectChanges();
    const ex = q('.hb .ex')!;
    expect(getComputedStyle(q('.hb .t')!).flexWrap).toBe('nowrap');
    expect(getComputedStyle(ex).textOverflow).toBe('ellipsis');
    expect(getComputedStyle(ex).whiteSpace).toBe('nowrap');
    q('.hb')!.dispatchEvent(new Event('pointerenter'));
    fixture.detectChanges();
    expect(ex.scrollWidth).toBeGreaterThan(ex.clientWidth);
    expect((fixture.componentInstance as unknown as { cutTip: () => string | null }).cutTip()).toBe(q('.hb')!.getAttribute('aria-label'));
    band.remove();
  });

  it('a press beside it closes it; a press inside does not', () => {
    open();
    q('.grp')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(fixture.componentInstance.open()).toBe(true);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(fixture.componentInstance.open()).toBe(false);
  });
});
