import { TABBING_ATTR } from '../../core/focus-modality';
import { focusAllowsTypeToSearch, hasOwnTextField, keyPopupOpen, typeToSearchHere } from './type-to-search';

describe('type-to-search (#385)', () => {
  let main: HTMLElement;
  let bar: HTMLElement;

  beforeEach(() => {
    main = document.createElement('main');
    main.id = 'sc-main';
    main.tabIndex = -1;
    bar = document.createElement('div');
    bar.innerHTML = '<input type="search" class="bar-field" />';
    document.body.append(bar, main);
  });

  afterEach(() => {
    main.remove();
    bar.remove();
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    document.documentElement.removeAttribute(TABBING_ATTR);
  });

  /** A keydown dispatched on `target`, with what the bar's listener would decide. */
  function press(target: EventTarget, init: KeyboardEventInit = { key: 'a' }): boolean {
    let verdict = false;
    const listen = (ev: Event): void => {
      verdict = typeToSearchHere(ev as KeyboardEvent, bar);
    };
    document.addEventListener('keydown', listen);
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    document.removeEventListener('keydown', listen);
    return verdict;
  }

  it('takes a letter typed on the page itself (nothing focused, the main region, a plain container)', () => {
    main.innerHTML = '<section><p>Text</p></section>';
    expect(press(document.body)).toBe(true);
    expect(press(main)).toBe(true);
    expect(press(main.querySelector('p')!)).toBe(true);
    expect(press(document.body, { key: 'A', shiftKey: true })).toBe(true);
  });

  it('leaves chords, digits, Space and claimed keys alone', () => {
    expect(press(document.body, { key: 'a', ctrlKey: true })).toBe(false);
    expect(press(document.body, { key: 'a', altKey: true })).toBe(false);
    expect(press(document.body, { key: '1' })).toBe(false);
    expect(press(document.body, { key: ' ' })).toBe(false);
    expect(press(document.body, { key: 'ArrowDown' })).toBe(false);
    const claim = (ev: Event) => ev.preventDefault();
    main.addEventListener('keydown', claim);
    expect(press(main, { key: 'v' })).toBe(false);
    main.removeEventListener('keydown', claim);
  });

  it('stays off while a text field takes the key', () => {
    main.innerHTML = '<textarea></textarea>';
    expect(press(main.querySelector('textarea')!)).toBe(false);
  });

  it('stays off on a page with a text field of its own (a second search, a filter, a form)', () => {
    main.innerHTML = '<input type="text" />';
    expect(press(document.body)).toBe(false);
  });

  it('counts only visible, usable text fields of the page — never the bar field, toggles or hidden ones', () => {
    main.innerHTML =
      '<input type="checkbox" /><input type="range" /><input type="text" disabled />' +
      '<input type="text" style="display:none" /><div hidden><input type="text" /></div>' +
      '<div aria-hidden="true"><input type="text" /></div>';
    expect(hasOwnTextField(main, bar)).toBe(false);
    expect(hasOwnTextField(bar)).toBe(true); // the bar field itself would count, so it is ignored
    expect(press(document.body)).toBe(true);
  });

  it('keeps keyboard navigation: a control reached with Tab keeps its letters', () => {
    main.innerHTML = '<button type="button">Go</button><a href="/x">Link</a>';
    const btn = main.querySelector('button')!;
    expect(press(btn)).toBe(true); // focused by a click: the reader is not navigating
    document.documentElement.setAttribute(TABBING_ATTR, '');
    expect(press(btn)).toBe(false);
    expect(press(main.querySelector('a')!)).toBe(false);
    expect(focusAllowsTypeToSearch(main)).toBe(true); // the skip-link target is no control
    expect(focusAllowsTypeToSearch(document.body)).toBe(true);
  });

  it('stays off while a menu or list popup or a dialog is open', () => {
    const overlay = document.createElement('div');
    overlay.className = 'cdk-overlay-container';
    overlay.innerHTML = '<div role="listbox"></div>';
    document.body.append(overlay);
    expect(keyPopupOpen()).toBe(true);
    expect(press(document.body)).toBe(false);
    overlay.innerHTML = '<div class="sc-tooltip-bubble">Hint</div>';
    expect(keyPopupOpen()).toBe(false); // a tooltip takes no keys
    expect(press(document.body)).toBe(true);
    main.innerHTML = '<div role="dialog"></div>';
    expect(press(document.body)).toBe(false);
  });
});
