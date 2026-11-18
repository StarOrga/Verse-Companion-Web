import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { AssetPackageViewerComponent, HOVER_GRACE_MS } from './asset-package-viewer.component';
import { AssetPackageService } from './asset-package.service';
import { CodexService } from '../codex.service';
import { parseManifest, type AssetPackageRow } from './asset-package.model';
import { calloutSize } from './holo-overlay';
import { manifestFixture, placementFixture } from './asset-package.testing';

const ROW: AssetPackageRow = {
  kind: 'ship', entityClass: 'AEGS_Gladius', shipId: 'AEGS_Gladius', manifestSha256: 'm', rootSha256: 'root',
  interiorSha256: 'int', partCount: 2, totalBytes: 10, schemaVersion: 1,
};

function emptySlotManifest(): Record<string, unknown> {
  const raw = manifestFixture();
  (raw['placements'] as Record<string, unknown>[]).push(
    placementFixture({
      id: 'empty_gun', portName: 'hardpoint_weapon_left', group: 'weapons', position: [2, 0, 1], rotation: [0, 0, 0, 1],
      port: { minSize: 1, maxSize: 3, types: ['WeaponGun'], flags: [], editable: true }, loadout: 'empty',
    }),
  );
  return raw;
}

describe('AssetPackageViewerComponent (state logic, no WebGL)', () => {
  function create(raw: Record<string, unknown> = manifestFixture()) {
    TestBed.configureTestingModule({
      imports: [AssetPackageViewerComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        // The manifest never arrives: the spec drives the state directly and no
        // three.js scene (WebGL) is ever created.
        { provide: AssetPackageService, useValue: { manifest: () => new Promise(() => undefined), urls: {} } },
        { provide: CodexService, useValue: { resolveEntities: () => Promise.resolve(new Map()) } },
      ],
    });
    const fixture = TestBed.createComponent(AssetPackageViewerComponent);
    fixture.componentRef.setInput('row', ROW);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    c.manifest.set(parseManifest(raw));
    return { fixture, c };
  }

  /** Stand in for the per-frame projection (no WebGL in specs). */
  function project(c: AssetPackageViewerComponent, ids: string[]): void {
    c['viewport'].set({ w: 1000, h: 600 });
    c['silhouette'].set({ left: 300, top: 200, right: 700, bottom: 400 });
    c['points'].set(new Map(ids.map((id, i) => [id, { x: 400 + i * 40, y: 300, onScreen: true }] as const)));
  }

  it('starts with interior off and the other groups on', () => {
    const { c } = create();
    expect(c.status()).toBe('loading');
    expect(c.groupsOn().has('interior')).toBe(false);
    expect(c.visibleIds().has('hardpoint_power_plant')).toBe(true);
  });

  it('toggles a group and a single placement (with its children)', () => {
    const { c } = create();
    c.toggleGroup('components');
    expect(c.visibleIds().has('hardpoint_power_plant')).toBe(false);
    c.toggleGroup('components');
    c.togglePlacement('turret');
    expect(c.visibleIds().has('turret')).toBe(false);
    expect(c.visibleIds().has('turret/gun')).toBe(false);
    c.togglePlacement('turret');
    expect(c.visibleIds().has('turret/gun')).toBe(true);
  });

  it('hover/focus x-rays onto one placement and reports its raw port; leaving lingers for the label', fakeAsync(() => {
    const { c } = create();
    const seen: (string[] | null)[] = [];
    c.hovered.subscribe((v) => seen.push(v));
    const pp = c.manifest()!.placements[0];
    c.focus(pp);
    expect(c.focusIds()).toEqual(['hardpoint_power_plant']);
    c.blur(pp);
    // Grace period: the pointer may still reach the label.
    expect(c.focusIds()).toEqual(['hardpoint_power_plant']);
    tick(HOVER_GRACE_MS);
    expect(c.focusIds()).toEqual([]);
    expect(seen).toEqual([['hardpoint_power_plant'], null]);
  }));

  it('entering the label keeps the selection', fakeAsync(() => {
    const { c } = create();
    const pp = c.manifest()!.placements[0];
    c.focus(pp);
    c.blur(pp);
    c.holdLabel();
    tick(HOVER_GRACE_MS * 2);
    expect(c.focusIds()).toEqual(['hardpoint_power_plant']);
    c.releaseLabel();
    tick(HOVER_GRACE_MS);
    expect(c.focusIds()).toEqual([]);
  }));

  it('follows the host list via activePorts', () => {
    const { fixture, c } = create();
    fixture.componentRef.setInput('activePorts', ['turret']);
    expect(c.focusIds()).toEqual(['turret', 'turret/gun']);
    expect(c.labelTarget()?.id).toBe('turret');
  });

  it('a modified click keeps the x-ray (the anchor opens a new tab), a plain one clears it', () => {
    const { c } = create();
    c.focus(c.manifest()!.placements[0]);
    c.onActivate(new MouseEvent('click', { button: 0, ctrlKey: true }));
    expect(c.focusIds().length).toBe(1);
    c.onActivate(new MouseEvent('click', { button: 0 }));
    expect(c.focusIds().length).toBe(0);
  });

  it('lists free attachment slots without a link', () => {
    const { c } = create();
    const optic = c.rows().find((r) => r.p.id === 'optic')!;
    expect(optic.free).toBe(true);
    expect(optic.link).toBeNull();
  });

  it('labels the selected component outside the hull with a link to its codex page', async () => {
    const { fixture, c } = create();
    const t = TestBed.inject(TranslateService);
    t.setTranslation('en', {
      codex: { assetPackage: { label: { aria: 'Selected slot: {{name}}', open: 'Open {{name}} in the Codex', prev: 'Previous slot', next: 'Next slot' } } },
    });
    t.use('en');
    c['items'].set(new Map([['POWR_A', { kind: 'component', name: 'Regulus' }]]));
    project(c, ['hardpoint_power_plant']);
    c.status.set('ready');
    c.focus(c.manifest()!.placements[0]);
    fixture.detectChanges();
    await fixture.whenStable();
    const l = c.label()!;
    expect(l.row.name).toBe('Regulus');
    // The anchor sits left of the hull centre: the label goes left, outside the hull.
    expect(l.side).toBe('left');
    expect(l.left + 240).toBeLessThanOrEqual(300);
    const el: HTMLElement = fixture.nativeElement;
    const group = el.querySelector('.clabel')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toContain('Regulus');
    const a = group.querySelector('a.nm') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/codex/component/POWR_A');
    expect(a.getAttribute('aria-label')).toContain('Regulus');
    expect(a.getAttribute('title')).toBeNull();
    expect(el.querySelector('svg.leader line')).not.toBeNull();
    // Step buttons: icon-only, named, no native tooltip.
    const steps = group.querySelectorAll('button.step');
    expect(steps.length).toBe(2);
    steps.forEach((b) => {
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.getAttribute('title')).toBeNull();
    });
  });

  it('steps through the slots, pins the choice and reports its port', () => {
    const { c } = create(emptySlotManifest());
    const seen: (string[] | null)[] = [];
    c.hovered.subscribe((v) => seen.push(v));
    c.step(1);
    expect(c.pinned()).toBe('hardpoint_power_plant');
    c.step(-1);
    expect(c.pinned()).toBe('empty_gun');
    expect(c.focusIds()).toEqual(['empty_gun']);
    c.unpin();
    expect(c.focusIds()).toEqual([]);
    expect(seen).toEqual([['hardpoint_power_plant'], ['hardpoint_weapon_left'], null]);
  });

  it('labels an empty slot as free with the port and what it accepts', () => {
    const { c } = create(emptySlotManifest());
    project(c, ['empty_gun']);
    c.step(-1);
    const l = c.label()!;
    expect(l.empty).toBe(true);
    expect(l.row.link).toBeNull();
    expect(c.labelMeta(l)).toBe('hardpoint_weapon_left · S3 · WeaponGun');
  });

  it('shows no label without a projected anchor', () => {
    const { c } = create();
    c.focus(c.manifest()!.placements[0]);
    expect(c.label()).toBeNull();
  });

  it('moving from one hotspot to its neighbour retargets at once, never through "nothing"', () => {
    const { c } = create();
    const seen: (string[] | null)[] = [];
    c.hovered.subscribe((v) => seen.push(v));
    const [a, b] = c.manifest()!.placements;
    c.focus(a);
    c.blur(a);
    c.focus(b);
    expect(c.localFocus()).toBe(b.id);
    expect(seen).toEqual([[a.portName], [b.portName]]);
  });

  it('Escape clears a pin or hover label, swallows the key only then, and ignores a dialog above', async () => {
    const { fixture, c } = create();
    const outer = vi.fn().mockName('outer');
    document.addEventListener('keydown', outer);
    const press = () => {
      const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev);
    };
    // Nothing selected: no listener, the stage's own Escape sees the key.
    press();
    expect(outer).toHaveBeenCalledTimes(1);

    c.step(1);
    fixture.detectChanges();
    await fixture.whenStable();
    press();
    expect(c.pinned()).toBeNull();
    expect(outer).toHaveBeenCalledTimes(1);

    c.focus(c.manifest()!.placements[0]);
    fixture.detectChanges();
    await fixture.whenStable();
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    document.body.appendChild(dlg);
    press();
    expect(c.localFocus()).not.toBeNull();
    expect(outer).toHaveBeenCalledTimes(2);
    dlg.remove();
    press();
    expect(c.localFocus()).toBeNull();
    expect(outer).toHaveBeenCalledTimes(2);
    document.removeEventListener('keydown', outer);
  });

  describe('table interaction', () => {
    function table(raw: Record<string, unknown> = manifestFixture()) {
      const made = create(raw);
      made.fixture.componentRef.setInput('interaction', 'table');
      made.c['items'].set(new Map([['POWR_A', { kind: 'component', name: 'Regulus' }]]));
      return made;
    }

    it('a hover lights the part, a selection takes the green look and holds, neither turns the see-through on', () => {
      const { c } = table();
      const seen: unknown[] = [];
      c.selectionChange.subscribe((v) => seen.push(v?.id ?? null));
      const pp = c.manifest()!.placements[0];
      c.focus(pp);
      expect(c.focusIds()).toEqual([pp.id]);
      expect(c['highlight']()).toEqual({ hover: [pp.id], selected: [] });
      c.blur(pp);
      expect(c.focusIds()).toEqual([]);

      c.onPick(new MouseEvent('click', { button: 0, cancelable: true }), c.toRowFor(pp));
      expect(c.pinned()).toBe(pp.id);
      expect(c['highlight']()).toEqual({ hover: [], selected: [pp.id] });
      expect(seen).toEqual([pp.id]);
      // The pointer goes on to a neighbour: the selection and its see-through stay, both are lit.
      const other = c.manifest()!.placements[1];
      c.focus(other);
      expect(c.focusIds()).toContain(pp.id);
      expect(c.focusIds()).toContain(other.id);
      c.blur(other);
      expect(c.pinned()).toBe(pp.id);
      expect(c.clearSelection()).toBe(true);
      expect(seen).toEqual([pp.id, null]);
    });

    /** A scene stand-in: `pick` answers what lies under the pointer, the rest is a no-op. */
    function fakeScene(c: AssetPackageViewerComponent, hit: { id: string | null }) {
      const pick = vi.fn<(x: number, y: number, slop: number, cands: ReadonlySet<string>) => string | null>(() => hit.id);
      const frame = vi.fn();
      const noop = () => undefined;
      c['scene'] = {
        pick, frame, dispose: noop, setHighlight: noop, setPaused: noop, setSpin: noop, setQuiet: noop,
        setVisibility: noop, setSafeArea: noop, viewChanged: () => false, project: () => new Map(),
        silhouette: () => null, partRect: () => ({ left: 380, top: 280, right: 420, bottom: 320 }),
      } as never;
      return { pick, frame };
    }

    /** Real pointer events on the canvas: down, optional travel, up + click (detail = click count). */
    function clickAt(canvas: HTMLCanvasElement, opts: { travel?: number; detail?: number; type?: string } = {}): void {
      const at = { clientX: 400, clientY: 300, bubbles: true, cancelable: true, pointerId: 1, pointerType: opts.type ?? 'mouse' };
      const end = { ...at, clientX: 400 + (opts.travel ?? 0) };
      canvas.dispatchEvent(new PointerEvent('pointerdown', { ...at, button: 0, buttons: 1 }));
      if (opts.travel) canvas.dispatchEvent(new PointerEvent('pointermove', { ...end, buttons: 1 }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { ...end, button: 0, buttons: 0 }));
      canvas.dispatchEvent(new PointerEvent('click', { ...end, button: 0, detail: opts.detail ?? 1 }));
    }

    async function ready(raw?: Record<string, unknown>) {
      const made = table(raw);
      project(made.c, ['hardpoint_power_plant']);
      made.c.status.set('ready');
      made.fixture.detectChanges();
      await made.fixture.whenStable();
      const canvas = (made.fixture.nativeElement as HTMLElement).querySelector('canvas')!;
      const intents: unknown[] = [];
      made.c.selectionIntent.subscribe((v) => intents.push(v));
      const changes: (string | null)[] = [];
      made.c.selectionChange.subscribe((v) => changes.push(v?.id ?? null));
      return { ...made, canvas, intents, changes };
    }

    it('a click on the part selects it, a second click on it deselects (C8)', async () => {
      const { c, canvas, intents, changes } = await ready();
      const hit = { id: 'hardpoint_power_plant' as string | null };
      const { pick } = fakeScene(c, hit);
      clickAt(canvas);
      expect(c.pinned()).toBe('hardpoint_power_plant');
      // Fine pointer: the invisible hit area is 24 px, among the pickable parts only.
      expect(pick.mock.calls[0][2]).toBe(24);
      expect(pick.mock.calls[0][3].has('hardpoint_power_plant')).toBe(true);
      clickAt(canvas);
      expect(c.pinned()).toBeNull();
      expect(changes).toEqual(['hardpoint_power_plant', null]);
      expect(intents).toEqual([{ kind: 'select', source: 'model' }, { kind: 'deselect', via: 'again' }]);
      c['scene'] = null;
    });

    it('a click into empty space deselects, a drag does not and never selects', async () => {
      const { c, canvas, intents } = await ready();
      const hit = { id: 'hardpoint_power_plant' as string | null };
      fakeScene(c, hit);
      clickAt(canvas, { travel: 12 });
      expect(c.pinned()).toBeNull();
      clickAt(canvas, { travel: 3 });
      expect(c.pinned()).toBe('hardpoint_power_plant');
      hit.id = null;
      clickAt(canvas, { travel: 30 });
      expect(c.pinned()).toBe('hardpoint_power_plant');
      clickAt(canvas);
      expect(c.pinned()).toBeNull();
      expect(intents).toEqual([{ kind: 'select', source: 'model' }, { kind: 'deselect', via: 'empty' }]);
      c['scene'] = null;
    });

    it('a first tap selects at once with a 48 px hit area; a tap beside it deselects (C14)', async () => {
      const { c, canvas } = await ready();
      const hit = { id: 'hardpoint_power_plant' as string | null };
      const { pick } = fakeScene(c, hit);
      clickAt(canvas, { type: 'touch' });
      expect(c.pinned()).toBe('hardpoint_power_plant');
      expect(pick.mock.calls[0][2]).toBe(48);
      hit.id = null;
      clickAt(canvas, { type: 'touch' });
      expect(c.pinned()).toBeNull();
      c['scene'] = null;
    });

    it('a double click on a part toggles once and never re-frames; off a part it re-frames', async () => {
      const { c, canvas } = await ready();
      const hit = { id: 'hardpoint_power_plant' as string | null };
      const { frame } = fakeScene(c, hit);
      clickAt(canvas, { detail: 1 });
      clickAt(canvas, { detail: 2 });
      canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 400, clientY: 300, bubbles: true }));
      expect(c.pinned()).toBe('hardpoint_power_plant');
      expect(frame).not.toHaveBeenCalled();
      hit.id = null;
      canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 400, clientY: 300, bubbles: true }));
      expect(frame).toHaveBeenCalledTimes(1);
      c['scene'] = null;
    });

    it('a hover lights the part with the pointer cursor and a name tag beside it; the tag turns green on select and has no close control', async () => {
      const { fixture, c, canvas } = await ready();
      const hit = { id: 'hardpoint_power_plant' as string | null };
      fakeScene(c, hit);
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: 300, pointerType: 'mouse', buttons: 0, bubbles: true }));
      c['projectDirty'] = true;
      c['reproject']();
      fixture.detectChanges();
      expect(c['highlight']()).toEqual({ hover: ['hardpoint_power_plant'], selected: [] });
      expect(canvas.style.cursor).toBe('pointer');
      const el: HTMLElement = fixture.nativeElement;
      let tag = el.querySelector('.name-tag') as HTMLElement;
      expect(tag.textContent).toContain('Regulus');
      expect(getComputedStyle(tag).pointerEvents).toBe('none');
      // Beside the part, not on it: above its screen box (top 280).
      expect(c.nameTags()[0].y).toBeLessThanOrEqual(280);
      expect(c.nameTags()[0].below).toBe(false);
      expect(tag.classList.contains('sel')).toBe(false);
      clickAt(canvas);
      fixture.detectChanges();
      tag = el.querySelector('.name-tag') as HTMLElement;
      expect(tag.classList.contains('sel')).toBe(true);
      expect(el.querySelectorAll('.name-tag').length).toBe(1);
      expect(tag.querySelector('button')).toBeNull();
      expect(el.querySelector('button.close')).toBeNull();
      hit.id = null;
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 900, clientY: 50, pointerType: 'mouse', buttons: 0, bubbles: true }));
      fixture.detectChanges();
      expect(canvas.style.cursor).toBe('');
      c['scene'] = null;
    });

    it('the turntable holds while the pointer is over the model and while a part is selected', async () => {
      const { fixture, c, canvas } = await ready();
      fixture.componentRef.setInput('spin', 'ccw');
      fixture.detectChanges();
      const reduced = c['reducedMotion']();
      fakeScene(c, { id: null });
      const spin = () => c['effectiveSpin']();
      if (!reduced) expect(spin()).toBe('ccw');
      // project(): the model's box is 300..700 × 200..400 in canvas px.
      const r = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 500, clientY: r.top + 300, pointerType: 'mouse', buttons: 0, bubbles: true }));
      expect(c.pointerOver()).toBe(true);
      expect(spin()).toBe('none');
      canvas.dispatchEvent(new PointerEvent('pointerleave'));
      expect(c.pointerOver()).toBe(false);
      if (!reduced) expect(spin()).toBe('ccw');
      c.select(c.byId().get('hardpoint_power_plant')!);
      expect(spin()).toBe('none');
      c.clearSelection();
      if (!reduced) expect(spin()).toBe('ccw');
      c['scene'] = null;
    });

    it('keyboard: the part is a focus target without a drawn dot; Enter selects, Enter again and Escape deselect', async () => {
      const { fixture, c, intents } = await ready();
      const el: HTMLElement = fixture.nativeElement;
      const target = el.querySelector('.hs') as HTMLElement;
      expect(target.tagName).toBe('SPAN');
      expect(target.getAttribute('role')).toBe('button');
      expect(target.tabIndex).toBe(0);
      expect(getComputedStyle(target).pointerEvents).toBe('none');
      expect(getComputedStyle(target).opacity).toBe('0');
      target.dispatchEvent(new FocusEvent('focus'));
      expect(c['highlight']().hover).toEqual(['hardpoint_power_plant']);
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(c.pinned()).toBe('hardpoint_power_plant');
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(c.pinned()).toBeNull();
      target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
      expect(c.pinned()).toBe('hardpoint_power_plant');
      fixture.detectChanges();
      await fixture.whenStable();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(c.pinned()).toBeNull();
      expect(intents).toEqual([
        { kind: 'select', source: 'keyboard' },
        { kind: 'deselect', via: 'again' },
        { kind: 'select', source: 'keyboard' },
        { kind: 'deselect', via: 'escape' },
      ]);
    });

    it('takes the selection from the host by port or id and does not echo it', () => {
      const { fixture, c } = table();
      const seen: unknown[] = [];
      c.selectionChange.subscribe((v) => seen.push(v));
      fixture.componentRef.setInput('selectedPort', 'HARDPOINT_POWER_PLANT');
      fixture.detectChanges();
      expect(c.pinned()).toBe('hardpoint_power_plant');
      fixture.componentRef.setInput('selectedPort', null);
      fixture.detectChanges();
      expect(c.pinned()).toBeNull();
      expect(seen).toEqual([]);
    });

    function withSwappable(): Record<string, unknown> {
      const raw = manifestFixture();
      const list = raw['placements'] as Record<string, unknown>[];
      for (const p of list) if (p['id'] === 'hardpoint_power_plant') p['port'] = { minSize: 1, maxSize: 1, types: ['PowerPlant'], flags: [], editable: true };
      return raw;
    }

    it('shows swappable dots by default; the chip at the end of the row shows all', async () => {
      const { fixture, c } = table(withSwappable());
      const ids = c.manifest()!.placements.filter((p) => p.position && p.itemClass).map((p) => p.id);
      project(c, ids);
      c.status.set('ready');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(c.hotspots().map((h) => h.p.id)).toEqual(['hardpoint_power_plant']);
      const el: HTMLElement = fixture.nativeElement;
      // No chip bar of its own in the table: the stage's filter row and its "Alle Teile" chip drive it.
      expect(el.querySelector('.bar')).toBeNull();
      c.toggleAllParts();
      expect(c.hotspotScope()).toBe('all');
      expect(c.hotspots().length).toBeGreaterThan(1);
      expect(c.hotspots().filter((h) => h.minor).length).toBe(c.hotspots().length - 1);
    });

    it('gives an out-of-scope part the panel points at a dot, without moving the others', () => {
      const { fixture, c } = table(withSwappable());
      const ids = c.manifest()!.placements.filter((p) => p.position && p.itemClass).map((p) => p.id);
      project(c, ids);
      const before = c.hotspots().map((h) => [h.p.id, h.x, h.y]);
      const other = ids.find((id) => id !== 'hardpoint_power_plant')!;
      fixture.componentRef.setInput('selectedPort', other);
      fixture.detectChanges();
      const after = c.hotspots();
      expect(after.length).toBeGreaterThan(before.length);
      expect(after.slice(0, before.length).map((h) => [h.p.id, h.x, h.y])).toEqual(before as never);
    });

    it('keeps relevant parts lit and quiet ones reachable', async () => {
      const { fixture, c } = table();
      const ids = c.manifest()!.placements.filter((p) => p.position && p.itemClass).map((p) => p.id);
      project(c, ids);
      fixture.componentRef.setInput('hotspotScope', 'all');
      fixture.componentRef.setInput('relevantPorts', new Set(['turret']));
      c.status.set('ready');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(c.quietIds().has('turret')).toBe(false);
      expect(c.quietIds().has('turret/gun')).toBe(false);
      expect(c.quietIds().has('hardpoint_power_plant')).toBe(true);
      // Quiet parts stay pickable on the canvas.
      expect(c.pickable().has('hardpoint_power_plant')).toBe(true);
      fixture.componentRef.setInput('relevantPorts', new Set());
      expect(c.quietIds().size).toBe(0);
    });

    it('sets the callout in a gutter, fixed, and offers the swap only on a swappable port', async () => {
      const { fixture, c } = table(withSwappable());
      project(c, ['hardpoint_power_plant']);
      fixture.componentRef.setInput('safeArea', { left: 230, right: 230 });
      fixture.componentRef.setInput('calloutValues', [{ label: 'Size', value: 'S1' }]);
      fixture.detectChanges();
      c.select(c.byId().get('hardpoint_power_plant')!);
      c.status.set('ready');
      fixture.detectChanges();
      await fixture.whenStable();
      const co = c.callout()!;
      expect(c.label()).toBeNull();
      expect(co.left + calloutSize(window.innerWidth).w).toBeLessThanOrEqual(230);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.callout .nm')!.textContent).toContain('Regulus');
      const swaps: unknown[] = [];
      c.swapRequested.subscribe((v) => swaps.push(v.id));
      (el.querySelector('.callout .sw') as HTMLButtonElement).click();
      expect(swaps).toEqual(['hardpoint_power_plant']);
      // No gutter (phone): the panel carries it alone, the anchor stays readable.
      fixture.componentRef.setInput('safeArea', null);
      expect(c.callout()).toBeNull();
      expect(c.selectionAnchor()).not.toBeNull();
    });

    function wheel(init: WheelEventInit): WheelEvent {
      return new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true, composed: true, ...init });
    }

    it('leaves a wheel without Ctrl to the page and hints once; Ctrl + wheel zooms', fakeAsync(() => {
      const { fixture, c } = table();
      const zoomBy = vi.fn().mockName('zoomBy');
      c['scene'] = { zoomBy, dispose: () => undefined, setHighlight: () => undefined, setPaused: () => undefined } as never;
      const host: HTMLElement = fixture.nativeElement;
      const orbit = vi.fn().mockName('orbit');
      const canvas = host.querySelector('canvas')!;
      canvas.addEventListener('wheel', orbit);

      const plain = wheel({});
      canvas.dispatchEvent(plain);
      expect(plain.defaultPrevented).toBe(false);
      expect(orbit).not.toHaveBeenCalled();
      expect(zoomBy).not.toHaveBeenCalled();
      expect(c.wheelHint()).toBe(true);
      tick(5000);
      expect(c.wheelHint()).toBe(false);
      canvas.dispatchEvent(wheel({}));
      expect(c.wheelHint()).toBe(false);

      const ctrl = wheel({ ctrlKey: true });
      canvas.dispatchEvent(ctrl);
      expect(ctrl.defaultPrevented).toBe(true);
      expect(zoomBy).toHaveBeenCalledTimes(1);
      expect(zoomBy).toHaveBeenCalledWith(100);
      c['scene'] = null;
    }));

    it('the classic viewer leaves the wheel, the click and the hover x-ray alone', () => {
      const { fixture, c } = create();
      const pp = c.manifest()!.placements[0];
      c.focus(pp);
      expect(c['highlight']()).toEqual({ hover: [pp.id], selected: [] });
      c['scene'] = { zoomBy: () => undefined, dispose: () => undefined, setHighlight: () => undefined, setPaused: () => undefined } as never;
      const plain = wheel({});
      const canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas')!;
      const orbit = vi.fn().mockName('orbit');
      canvas.addEventListener('wheel', orbit);
      canvas.dispatchEvent(plain);
      expect(orbit).toHaveBeenCalled();
      expect(c.wheelHint()).toBe(false);
      c['scene'] = null;
    });
  });

  it('fans stacked hotspots apart, has no tooltip bubble and offers a reset-view chip', () => {
    const { fixture, c } = create();
    c['viewport'].set({ w: 1000, h: 600 });
    const withPos = c.manifest()!.placements.filter((p) => p.position).slice(0, 2);
    c['points'].set(new Map(withPos.map((p, i) => [p.id, { x: 400 + i * 2, y: 300, onScreen: true }] as const)));
    c.status.set('ready');
    fixture.detectChanges();
    const hs = c.hotspots();
    expect(hs.length).toBeGreaterThanOrEqual(2);
    expect(Math.hypot(hs[0].x - hs[1].x, hs[0].y - hs[1].y)).toBeGreaterThanOrEqual(17.9);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.hs').length).toBe(hs.length);
    el.querySelectorAll('.hs').forEach((d) => expect(d.getAttribute('aria-label')).toBeTruthy());
    expect(el.querySelector('.bar .reset-view')).not.toBeNull();
  });
});
