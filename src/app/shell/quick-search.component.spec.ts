import type { Mock } from 'vitest';
import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { CodexService } from '../codex/codex.service';
import { CodexBuildDiffService } from '../codex/codex-build-diff.service';
import { HangarService } from '../hangar/hangar.service';
import { CodexSearchHub, isTypeToSearchKey } from '../codex/search/codex-search-hub.service';
import { QuickSearchComponent } from './quick-search.component';
import { SearchOpenService } from './search-open.service';
import { fakeSupabase } from '../testing/fake-supabase';

describe('QuickSearchComponent', () => {
  let searchAll: Mock;

  beforeEach(() => {
    searchAll = vi.fn().mockName('searchAll').mockResolvedValue({ hits: [], totals: {} });
    TestBed.configureTestingModule({
      imports: [QuickSearchComponent],
      providers: [
        // Never the real client: opening a result would log search_log_open to the cloud project.
        fakeSupabase().provider,
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: { searchAll, suggestNames: () => Promise.resolve([]), isPinned: () => false } },
        { provide: CodexBuildDiffService, useValue: { addedShipsMemo: () => Promise.resolve([]) } },
        { provide: HangarService, useValue: { ships: signal([]), loadAll: () => Promise.resolve() } },
        { provide: AuthService, useValue: { user: signal(null), isAuthenticated: signal(false) } },
      ],
    });
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => (n.innerHTML = ''));
  });

  function create() {
    const fixture = TestBed.createComponent(QuickSearchComponent);
    fixture.detectChanges();
    return fixture;
  }

  function press(k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    return ev;
  }

  describe('Ctrl+K routing', () => {
    it('off the Codex (no bar mounted) Ctrl+K opens the overlay', () => {
      const fixture = create();
      const ev = press('k', { ctrlKey: true });
      fixture.detectChanges();

      expect(ev.defaultPrevented).toBe(true);
      expect(fixture.componentInstance.visible()).toBe(true);
      expect(document.querySelector('.cdk-overlay-container .qs-input')).not.toBeNull();
    });

    it('on a Codex page Ctrl+K, "/" and the header button bring the page bar forward, no overlay', () => {
      const fixture = create();
      const bar = { activate: vi.fn().mockName('activate') };
      const unregister = TestBed.inject(CodexSearchHub).register(bar);

      press('k', { metaKey: true });
      press('/');
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.trigger')!.click();
      fixture.detectChanges();

      expect(bar.activate).toHaveBeenCalledTimes(3);
      expect(fixture.componentInstance.visible()).toBe(false);
      expect(document.querySelector('.cdk-overlay-container .qs-input')).toBeNull();
      unregister();
    });

    it('SearchOpenService (the wish action): no bar, the palette opens; a bar on the page is activated instead', () => {
      const fixture = create();
      expect(TestBed.inject(SearchOpenService).open()).toBe(true);
      fixture.detectChanges();
      expect(fixture.componentInstance.visible()).toBe(true);
      fixture.componentInstance.close();
      const bar = { activate: vi.fn().mockName('activate') };
      const unregister = TestBed.inject(CodexSearchHub).register(bar);
      TestBed.inject(SearchOpenService).open();
      expect(bar.activate).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.visible()).toBe(false);
      unregister();
    });

    it('once the bar is gone (left the Codex), Ctrl+K falls back to the overlay', () => {
      const fixture = create();
      const unregister = TestBed.inject(CodexSearchHub).register({ activate: () => undefined });
      unregister();
      press('k', { ctrlKey: true });
      fixture.detectChanges();
      expect(fixture.componentInstance.visible()).toBe(true);
    });
  });

  describe('type-to-search', () => {
    it('a letter typed on a Codex page starts the bar with that letter', () => {
      create();
      const bar = { activate: vi.fn().mockName('activate') };
      const unregister = TestBed.inject(CodexSearchHub).register(bar);

      const ev = press('g');

      expect(bar.activate).toHaveBeenCalledTimes(1);
      expect(bar.activate).toHaveBeenCalledWith('g');
      expect(ev.defaultPrevented).toBe(true);
      unregister();
    });

    it('ignores inputs, textareas, contenteditable, chords, digits and pages without a bar', () => {
      create();
      const input = document.createElement('input');
      const area = document.createElement('textarea');
      const editable = document.createElement('div');
      editable.contentEditable = 'true';
      document.body.append(input, area, editable);
      const bar = { activate: vi.fn().mockName('activate') };
      const unregister = TestBed.inject(CodexSearchHub).register(bar);

      press('g', {}, input);
      press('g', {}, area);
      press('g', {}, editable);
      press('g', { altKey: true });
      press('3'); // digits are the pages' own hotkeys
      press(' ');
      expect(bar.activate).not.toHaveBeenCalled();

      unregister();
      press('g');
      expect(bar.activate).not.toHaveBeenCalled();
      input.remove();
      area.remove();
      editable.remove();
    });

    // #385 regression: the type-to-search of #1218 lived only in the beta Fusion bar, so in this
    // header — the one every reader gets without the shell β — a letter on /verse or /hq did nothing.
    it('off the Codex a letter typed on the page opens the palette with that letter, caret after it', fakeAsync(() => {
      const fixture = create();
      const main = document.createElement('main');
      main.id = 'sc-main';
      main.innerHTML = '<section><p>News</p></section>';
      document.body.append(main);

      const ev = press('v', {}, main.querySelector('p')!);
      fixture.detectChanges();
      tick();

      expect(ev.defaultPrevented).toBe(true);
      expect(fixture.componentInstance.visible()).toBe(true);
      const field = document.querySelector<HTMLInputElement>('.cdk-overlay-container .qs-input')!;
      expect(field.value).toBe('v');
      expect(document.activeElement).toBe(field);
      expect(field.selectionStart).toBe(1);
      fixture.componentInstance.close();
      main.remove();
    }));

    it('off the Codex a page with a text field of its own, or Tab navigation, keeps the letter', () => {
      const fixture = create();
      const main = document.createElement('main');
      main.id = 'sc-main';
      main.innerHTML = '<input type="text" class="filter" /><button type="button">Go</button>';
      document.body.append(main);

      expect(press('v').defaultPrevented).toBe(false);
      main.querySelector('input')!.remove();
      document.documentElement.setAttribute('data-sc-tabbing', '');
      expect(press('v', {}, main.querySelector('button')!).defaultPrevented).toBe(false);
      document.documentElement.removeAttribute('data-sc-tabbing');
      fixture.detectChanges();
      expect(fixture.componentInstance.visible()).toBe(false);
      main.remove();
    });

    it('stays out of the way while a dialog is open', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      document.body.append(dialog);
      const ev = new KeyboardEvent('keydown', { key: 'g' });
      Object.defineProperty(ev, 'target', { value: document.body });
      expect(isTypeToSearchKey(ev)).toBe(false);
      dialog.remove();
      expect(isTypeToSearchKey(ev)).toBe(true);
    });
  });

  it('a failed search shows the error state with retry, not "no results" (AUD-236)', fakeAsync(() => {
    vi.spyOn(console, 'warn').mockReturnValue(undefined as never);
    searchAll.mockRejectedValue(new TypeError('Failed to fetch'));
    const fixture = create();
    fixture.componentInstance.open();
    fixture.detectChanges();
    fixture.componentInstance.engine.setInput('gladius');
    tick(1000);
    fixture.detectChanges();

    const text = document.querySelector('.cdk-overlay-container')?.textContent ?? '';
    expect(text).toContain('codex.search.bar.failed');
    expect(text).not.toContain('codex.search.bar.empty');
    fixture.componentInstance.close();
  }));

  it('Escape clears a typed term first and closes on an empty field', fakeAsync(() => {
    const fixture = create();
    fixture.componentInstance.open();
    fixture.componentInstance.engine.setInput('glad');
    fixture.detectChanges();
    const input = document.querySelector<HTMLInputElement>('.cdk-overlay-container .qs-input')!;

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    tick();
    expect(fixture.componentInstance.engine.input()).toBe('');
    expect(fixture.componentInstance.visible()).toBe(true);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    tick();
    expect(fixture.componentInstance.visible()).toBe(false);
  }));
});
