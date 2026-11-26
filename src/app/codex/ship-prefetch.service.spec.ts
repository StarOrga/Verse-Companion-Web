import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AssetPackageService, type BackgroundFetch } from './asset-package/asset-package.service';
import { SHIP_PREFETCH_SCHEDULER, ShipPrefetchService, modelPrefetchAllowed, prefetchAllowed } from './ship-prefetch.service';

// #404: the classic ship page fetches the ship's 3D model in idle time — cancellable,
// skipped on save-data / slow links, one ship only, never twice.

class PackagesStub {
  readonly calls: { ship: string; bg: BackgroundFetch }[] = [];
  scenes = 0;
  /** Resolve the latest prefetch with this value. */
  private pending: ((v: boolean) => void)[] = [];
  prefetchShip(ship: string, bg: BackgroundFetch): Promise<boolean> {
    this.calls.push({ ship, bg });
    return new Promise<boolean>((resolve) => {
      this.pending.push(resolve);
      bg.signal.addEventListener('abort', () => resolve(false), { once: true });
    });
  }
  preloadScene(): Promise<unknown> {
    this.scenes += 1;
    return Promise.resolve();
  }
  finish(v: boolean): void {
    this.pending.pop()?.(v);
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r));

function setup() {
  const events = new Subject<unknown>();
  const packages = new PackagesStub();
  const queued: (() => void)[] = [];
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: { events } },
      { provide: AssetPackageService, useValue: packages },
      { provide: SHIP_PREFETCH_SCHEDULER, useValue: (run: () => void, _d: number, signal: AbortSignal) => queued.push(() => !signal.aborted && run()) },
    ],
  });
  const svc = TestBed.inject(ShipPrefetchService);
  svc.allowed = () => true;
  const idle = async () => {
    const jobs = queued.splice(0);
    jobs.forEach((j) => j());
    await flush();
  };
  return { svc, packages, events, idle, queued };
}

describe('ShipPrefetchService (#404)', () => {
  it('waits for idle time, then prefetches the one ship and the scene chunk', async () => {
    const { svc, packages, idle } = setup();
    const done = svc.start('AEGS_Gladius');
    await flush();
    expect(packages.calls.length).toBe(0);
    await idle();
    expect(packages.calls.map((c) => c.ship)).toEqual(['AEGS_Gladius']);
    expect(packages.scenes).toBe(1);
    packages.finish(true);
    expect(await done).toBe(true);
  });

  it('reuses the run in flight for the same ship (no duplicate requests)', async () => {
    const { svc, packages, idle } = setup();
    const a = svc.start('AEGS_Gladius');
    const b = svc.start('aegs_gladius');
    expect(b).toBe(a);
    await idle();
    expect(packages.calls.length).toBe(1);
    packages.finish(true);
    expect(await a).toBe(true);
  });

  it('aborts on navigation away', async () => {
    const { svc, packages, events, idle } = setup();
    const done = svc.start('AEGS_Gladius');
    await idle();
    const { signal } = packages.calls[0].bg;
    events.next(new NavigationStart(1, '/codex'));
    expect(signal.aborted).toBe(true);
    expect(await done).toBe(false);
  });

  it('a different ship cancels the first — one ship only', async () => {
    const { svc, packages, idle } = setup();
    void svc.start('AEGS_Gladius');
    await idle();
    void svc.start('ANVL_Arrow');
    expect(packages.calls[0].bg.signal.aborted).toBe(true);
    await idle();
    expect(packages.calls.map((c) => c.ship)).toEqual(['AEGS_Gladius', 'ANVL_Arrow']);
  });

  it('steps aside for a foreground load and resumes in the next idle stretch', async () => {
    const { svc, packages, idle } = setup();
    const done = svc.start('AEGS_Gladius');
    await idle();
    svc.yieldToForeground();
    expect(packages.calls[0].bg.signal.aborted).toBe(true);
    await flush();
    await idle();
    expect(packages.calls.length).toBe(2);
    packages.finish(true);
    expect(await done).toBe(true);
  });

  it('does nothing when the gate refuses (save-data, slow link, phone)', async () => {
    const { svc, packages, idle, queued } = setup();
    svc.allowed = () => false;
    expect(await svc.start('AEGS_Gladius')).toBe(false);
    expect(queued.length).toBe(0);
    await idle();
    expect(packages.calls.length).toBe(0);
  });
});

describe('prefetch gates (#404)', () => {
  it('prefetchAllowed: off for save-data and 2G, on otherwise', () => {
    expect(prefetchAllowed({ connection: { saveData: true, effectiveType: '4g' } })).toBe(false);
    expect(prefetchAllowed({ connection: { effectiveType: '2g' } })).toBe(false);
    expect(prefetchAllowed({ connection: { effectiveType: 'slow-2g' } })).toBe(false);
    expect(prefetchAllowed({ connection: { effectiveType: '4g' } })).toBe(true);
    expect(prefetchAllowed({})).toBe(true);
  });

  it('modelPrefetchAllowed: also off on 3G and on a phone', () => {
    const desktop = () => false;
    expect(modelPrefetchAllowed({ connection: { effectiveType: '3g' } }, desktop)).toBe(false);
    expect(modelPrefetchAllowed({ connection: { effectiveType: '4g' } }, () => true)).toBe(false);
    expect(modelPrefetchAllowed({ connection: { saveData: true } }, desktop)).toBe(false);
    expect(modelPrefetchAllowed({ connection: { effectiveType: '4g' } }, desktop)).toBe(true);
  });
});
