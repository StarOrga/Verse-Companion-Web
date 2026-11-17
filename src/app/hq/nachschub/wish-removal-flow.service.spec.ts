import { TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import de from '../../../../public/i18n/de.json';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import { planRemoval, withSplit, type RemovalHolder } from './nachschub.model';
import { NachschubService, type NachschubResult, type WishRef } from './nachschub.service';
import { WishRemovalFlowService } from './wish-removal-flow.service';

const REF: WishRef & { name: string } = { kind: 'weapon', className: 'karna', forClassName: null, name: 'Karna Rifle' };
const holder = (id: string, name: string, max: number, assignedAt: string, over: Partial<RemovalHolder> = {}): RemovalHolder => ({
  packageId: id, packageName: name, max, assignedAt, otherOpen: 2, einsaetze: 1, ...over,
});

function setup(wished: number, holders: RemovalHolder[]) {
  const applyWishRemoval = vi.fn().mockName('applyWishRemoval').mockImplementation(
    async (_r: unknown, n: number): Promise<NachschubResult> => ({ ok: true, key: 'hq.nachschub.done.wishRemoved', params: { name: 'Karna Rifle', count: n, dissolved: 0 }, undo: async () => ({ ok: true, key: 'hq.nachschub.done.undone' }) }),
  );
  const fake = {
    allocationOf: () => ({ wished, assigned: holders.reduce((n, h) => n + h.max, 0), free: wished - holders.reduce((n, h) => n + h.max, 0), key: 'k', assignments: [] }),
    planWishRemoval: (_r: WishRef, n: number) => planRemoval(wished, holders, n),
    planWishRemovalWithSplit: (_r: WishRef, n: number, split: Record<string, number>) => withSplit(planRemoval(wished, holders, n), holders, split),
    applyWishRemoval,
  };
  TestBed.configureTestingModule({ providers: [provideTranslateService(), { provide: NachschubService, useValue: fake }] });
  const t = TestBed.inject(TranslateService);
  t.setTranslation('de', de);
  t.use('de');
  return { flow: TestBed.inject(WishRemovalFlowService), applyWishRemoval };
}

const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector(sel) as T | null;
const qa = (sel: string): HTMLElement[] => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const settle = async (): Promise<void> => {
  await new Promise<void>((r) => setTimeout(r));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
};

describe('WishRemovalFlowService', () => {
  afterEach(() => TestBed.inject(OverlayContainer).ngOnDestroy());

  it('free pieces only: nothing is asked, the write runs at once', async () => {
    const { flow, applyWishRemoval } = setup(5, [holder('a', 'Bodentrupp', 2, '2026-11-02')]);
    const r = await flow.lower(REF, 3, 'wishlist');
    expect(q('sc-wish-removal-dialog')).toBeNull();
    expect(applyWishRemoval).toHaveBeenCalledWith(REF, 3, { surface: 'wishlist' });
    expect(r?.ok).toBe(true);
  });

  it('one Operation: one bar, every segment in one style, the confirm applies the chosen quantity', async () => {
    const { flow, applyWishRemoval } = setup(5, [holder('a', 'Bodentrupp ausrüsten', 3, '2026-11-02')]);
    const p = flow.lower(REF, 4, 'wishlist');
    await settle();
    expect(q('.scp-title')?.textContent).toContain('Karna Rifle entfernen');
    expect(q('.wr-cap')?.textContent).toContain('Diese 4 Stücke gehen:');
    const segs = qa('.wr-sg');
    expect(segs.map((s) => s.textContent!.trim())).toEqual(['2 frei', '2 aus „Bodentrupp ausrüsten“']);
    const [free, op] = segs.map((s) => getComputedStyle(s));
    expect(free.backgroundColor).toBe(op.backgroundColor);
    expect(free.borderColor).toBe(op.borderColor);
    expect(segs[1].querySelector('svg')).not.toBeNull();
    expect(segs[0].querySelector('svg')).toBeNull();
    expect(q('.wr-hint')).toBeNull();
    expect(q('.wr-mut')?.textContent).toContain('behält andere Wünsche');
    q<HTMLButtonElement>('button.confirm')!.click();
    await p;
    expect(applyWishRemoval).toHaveBeenCalledWith(REF, 4, { surface: 'wishlist', dissolve: [] });
  });

  it('cancel changes nothing', async () => {
    const { flow, applyWishRemoval } = setup(5, [holder('a', 'Bodentrupp', 3, '2026-11-02')]);
    const p = flow.lower(REF, 4, 'wishlist');
    await settle();
    q<HTMLButtonElement>('button.cancel')!.click();
    expect(await p).toBeNull();
    expect(applyWishRemoval).not.toHaveBeenCalled();
    expect(q('sc-wish-removal-dialog')).toBeNull();
  });

  it('several Operationen: the newest gives first, the user shifts the split, the parts must add up', async () => {
    const { flow, applyWishRemoval } = setup(4, [holder('a', 'Neu', 2, '2026-11-03'), holder('b', 'Alt', 2, '2026-11-01')]);
    const p = flow.lower(REF, 3, 'hq');
    await settle();
    expect(qa('.wr-row').length).toBe(2);
    expect(qa('.wr-row')[0].textContent).toContain('zuletzt zugeordnet');
    expect(q('.wr-sum')?.textContent).toContain('3 von 3 verteilt');
    const rows = qa('.wr-row');
    const less = (i: number): HTMLButtonElement => rows[i].querySelector('.qs-less') as HTMLButtonElement;
    const more = (i: number): HTMLButtonElement => rows[i].querySelector('.qs-more') as HTMLButtonElement;
    less(0).click();
    await settle();
    expect(q('.wr-sum')?.textContent).toContain('2 von 3 verteilt');
    expect(q<HTMLButtonElement>('button.confirm')!.disabled).toBe(true);
    more(1).click();
    await settle();
    expect(q('.wr-sum')?.textContent).toContain('3 von 3 verteilt');
    expect(q<HTMLButtonElement>('button.confirm')!.disabled).toBe(false);
    q<HTMLButtonElement>('button.confirm')!.click();
    await p;
    expect(applyWishRemoval).toHaveBeenCalledWith(REF, 3, { surface: 'hq', split: { a: 1, b: 2 }, dissolve: [] });
  });

  it('last wish of an Operation with Einsätze: it stays, the box "auch auflösen" starts unticked and is passed on', async () => {
    const { flow, applyWishRemoval } = setup(2, [holder('a', 'Flotte ausbauen', 2, '2026-11-02', { otherOpen: 0, einsaetze: 3 })]);
    const p = flow.lower(REF, 2, 'wishlist');
    await settle();
    expect(q('.wr-hint')?.textContent).toContain('Die 3 Einsätze bleiben.');
    expect(q('.wr-hint.dng')).toBeNull();
    const box = q<HTMLInputElement>('.wr-chk input')!;
    expect(box.checked).toBe(false);
    expect(q('button.confirm')!.classList).not.toContain('sc-action--danger');
    box.click();
    await settle();
    q<HTMLButtonElement>('button.confirm')!.click();
    await p;
    expect(applyWishRemoval).toHaveBeenCalledWith(REF, 2, { surface: 'wishlist', dissolve: ['a'] });
  });

  it('last wish of an Operation without Einsatz: danger hint and the danger action say it goes along', async () => {
    const { flow, applyWishRemoval } = setup(1, [holder('a', 'Zweitschiff', 1, '2026-11-02', { otherOpen: 0, einsaetze: 0 })]);
    const p = flow.lower(REF, 1, 'wishlist');
    await settle();
    expect(q('.wr-hint.dng')?.textContent).toContain('hat keinen Einsatz und wird mit aufgelöst.');
    expect(q('.wr-chk')).toBeNull();
    const confirm = q<HTMLButtonElement>('button.confirm')!;
    expect(confirm.textContent).toContain('Entfernen und auflösen');
    expect(confirm.classList).toContain('sc-action--danger');
    // a single segment is still the same bar
    expect(qa('.wr-sg').length).toBe(1);
    confirm.click();
    await p;
    expect(applyWishRemoval).toHaveBeenCalledOnce();
  });

  it('announce puts the undo of a result on the toast, with a second line when an Operation went along', () => {
    const { flow } = setup(1, []);
    const toast = TestBed.inject(UndoToastService);
    const undo = vi.fn().mockName('undo').mockResolvedValue({ ok: true, key: 'x' });
    flow.announce({ ok: true, key: 'hq.nachschub.done.wishRemoved', params: { count: 1, name: 'A', dissolved: 1 }, undo });
    expect(toast.current()?.messageKey).toBe('hq.nachschub.done.wishRemoved');
    expect(toast.current()?.detailKey).toBe('wishRemoval.toastDissolved');
    toast.undo();
    expect(undo).toHaveBeenCalledOnce();
  });
});
