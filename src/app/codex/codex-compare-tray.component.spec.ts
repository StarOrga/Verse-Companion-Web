import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexService } from './codex.service';
import { CodexCompareTrayComponent } from './codex-compare-tray.component';

describe('CodexCompareTrayComponent', () => {
  const keys = signal<string[]>([]);
  const rejected = signal<string | null>(null);
  let unpin: Mock;
  let clearCompare: Mock;
  let getDetail: Mock;

  function mount(initial: string[], detail: (kind: string, slug: string) => Promise<unknown> = async () => null) {
    keys.set(initial);
    rejected.set(null);
    unpin = vi.fn().mockName('unpin');
    clearCompare = vi.fn().mockName('clearCompare');
    getDetail = vi.fn().mockName('getDetail').mockImplementation(detail);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        {
          provide: CodexService,
          useValue: { compareKeys: keys, compareRejectedKind: rejected, unpin, clearCompare, getDetail },
        },
      ],
    });
    const fixture = TestBed.createComponent(CodexCompareTrayComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('renders nothing while nothing is pinned', () => {
    const { el } = mount([]);
    expect(el.querySelector('.tray')).toBeNull();
  });

  it('shows pinned entries as real anchors to /codex/<kind>/<className>', () => {
    const { el } = mount(['ship:aegis_avenger', 'weapon:klwe_laser']);
    const links = Array.from(el.querySelectorAll('a.chip-link')) as HTMLAnchorElement[];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/codex/ship/aegis_avenger',
      '/codex/weapon/klwe_laser',
    ]);
  });

  it('names the chips from the pinned details while the tray is still collapsed, one read per pin', async () => {
    const { fixture, el } = mount(['ship:aegs_avenger_titan'], async (kind, slug) => ({
      kind, classNameSlug: slug, row: { name_localized: 'Avenger Titan' }, payload: {},
    }));
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.tray.expanded')).toBeNull();
    expect(el.querySelector('a.chip-link')?.textContent?.trim()).toBe('Avenger Titan');
    keys.set(['ship:aegs_avenger_titan', 'ship:anvl_arrow']);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getDetail).toHaveBeenCalledTimes(2);
  });

  it('removes a pin via .chip-x and clears all via .clear', () => {
    const { el } = mount(['ship:a', 'ship:b']);
    (el.querySelectorAll('button.chip-x')[1] as HTMLButtonElement).click();
    expect(unpin).toHaveBeenCalledTimes(1);
    expect(unpin).toHaveBeenCalledWith('ship:b');
    (el.querySelector('button.clear') as HTMLButtonElement).click();
    expect(clearCompare).toHaveBeenCalled();
  });

  it('offers the compare toggle (a button) only from two pins and opens the panel', async () => {
    const { fixture, el } = mount(['ship:a']);
    expect(el.querySelector('button.toggle')).toBeNull();

    keys.set(['ship:a', 'ship:b']);
    fixture.detectChanges();
    const toggle = el.querySelector('button.toggle') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toContain('codex.compare.open');
    expect(el.querySelector('.panel')).toBeNull();

    toggle.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.tray.expanded')).not.toBeNull();
    expect(el.querySelector('.panel')).not.toBeNull();
    expect(getDetail).toHaveBeenCalledTimes(2);
    expect(el.querySelector('button.toggle')?.textContent).toContain('codex.compare.close');
  });

  it('shows the "differences only" toggle state, not only as aria-pressed', async () => {
    const { fixture, el } = mount(['ship:a', 'ship:b']);
    (el.querySelector('button.toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const diff = el.querySelector('button.diff-toggle') as HTMLButtonElement;
    expect(diff).not.toBeNull();
    const before = getComputedStyle(diff).backgroundColor;
    expect(diff.getAttribute('aria-pressed')).toBe('false');
    diff.click();
    fixture.detectChanges();
    expect(diff.getAttribute('aria-pressed')).toBe('true');
    expect(diff.classList).toContain('on');
    expect(getComputedStyle(diff).backgroundColor).not.toBe(before);
  });

  it('announces a rejected mixed-kind pin', () => {
    const { fixture, el } = mount(['ship:a']);
    rejected.set('weapon');
    fixture.detectChanges();
    expect(el.querySelector('.reject')?.textContent).toContain('codex.compare.mixedKind');
  });
});
