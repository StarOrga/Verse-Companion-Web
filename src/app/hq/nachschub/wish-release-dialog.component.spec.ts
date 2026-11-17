import { TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import de from '../../../../public/i18n/de.json';
import { NachschubService, type NachschubResult, type ReleaseInfo } from './nachschub.service';
import { WishRemovalFlowService } from './wish-removal-flow.service';

const info = (over: Partial<ReleaseInfo> = {}): ReleaseInfo => ({ lineId: 'l1', packageId: 'p1', packageName: 'Bodentrupp', pieces: 3, emptiesPackage: false, einsaetze: 2, dissolvesAlong: false, ...over });
const ok: NachschubResult = { ok: true, key: 'hq.nachschub.done.released', params: { name: 'Karna Rifle', count: 3, dissolved: 0 } };
const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector(sel) as T | null;
const settle = async (): Promise<void> => {
  await new Promise<void>((r) => setTimeout(r));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
};

function setup(i: ReleaseInfo | null) {
  const release = vi.fn().mockName('release').mockResolvedValue(ok);
  TestBed.configureTestingModule({ providers: [provideTranslateService(), { provide: NachschubService, useValue: { releaseInfo: () => i, release } }] });
  const t = TestBed.inject(TranslateService);
  t.setTranslation('de', de);
  t.use('de');
  return { flow: TestBed.inject(WishRemovalFlowService), release };
}

describe('release confirmation in the HQ (C7)', () => {
  afterEach(() => TestBed.inject(OverlayContainer).ngOnDestroy());

  it('asks with three buttons; "Lösen" keeps the wish on the wishlist', async () => {
    const { flow, release } = setup(info());
    const p = flow.release('l1', 'Karna Rifle', 'hq');
    await settle();
    expect(q('.scp-title')?.textContent).toContain('Karna Rifle aus der Operation lösen?');
    expect(q('.wr-text')?.textContent).toContain('Die 3 Stücke bleiben auf deiner Wunschliste und werden wieder frei.');
    const names = Array.from(document.querySelectorAll('sc-wish-release-dialog button.sc-action')).map((b) => b.textContent!.trim()).filter((t) => t && !t.includes('Schließen'));
    expect(names).toEqual(expect.arrayContaining(['Lösen', 'Abbrechen', 'Auch von der Wunschliste löschen']));
    expect(q('button.delete')!.classList).toContain('sc-action--danger');
    expect(q('button.release')!.classList).toContain('sc-action--primary');
    q<HTMLButtonElement>('button.release')!.click();
    await p;
    expect(release).toHaveBeenCalledWith('l1', { alsoRemoveWish: false, dissolve: false, surface: 'hq' });
  });

  it('the red button also deletes the wish; cancel does nothing', async () => {
    const { flow, release } = setup(info());
    const p = flow.release('l1', 'Karna Rifle', 'hq');
    await settle();
    q<HTMLButtonElement>('button.delete')!.click();
    await p;
    expect(release).toHaveBeenCalledWith('l1', { alsoRemoveWish: true, dissolve: false, surface: 'hq' });
    release.mockClear();
    const p2 = flow.release('l1', 'Karna Rifle', 'hq');
    await settle();
    q<HTMLButtonElement>('button.cancel')!.click();
    expect(await p2).toBeNull();
    expect(release).not.toHaveBeenCalled();
  });

  it('a release that empties the Operation says so: danger hint without Einsatz, the unticked box with', async () => {
    const { flow } = setup(info({ emptiesPackage: true, einsaetze: 0, dissolvesAlong: true }));
    void flow.release('l1', 'Karna Rifle', 'hq');
    await settle();
    expect(q('.wr-hint.dng')?.textContent).toContain('wird mit aufgelöst');
  });

  it('with Einsätze the Operation stays and the box is offered unticked', async () => {
    const { flow, release } = setup(info({ emptiesPackage: true, einsaetze: 2 }));
    const p = flow.release('l1', 'Karna Rifle', 'hq');
    await settle();
    expect(q('.wr-hint')?.textContent).toContain('Die 2 Einsätze bleiben.');
    const box = q<HTMLInputElement>('.wr-chk input')!;
    expect(box.checked).toBe(false);
    box.click();
    await settle();
    q<HTMLButtonElement>('button.release')!.click();
    await p;
    expect(release).toHaveBeenCalledWith('l1', { alsoRemoveWish: false, dissolve: true, surface: 'hq' });
  });

  it('a line that is no open wish line opens nothing', async () => {
    const { flow } = setup(null);
    expect(await flow.release('x', 'Karna Rifle', 'hq')).toBeNull();
    expect(q('sc-wish-release-dialog')).toBeNull();
  });
});
