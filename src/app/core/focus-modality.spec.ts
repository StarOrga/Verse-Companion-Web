import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TABBING_ATTR, trackTabbing } from './focus-modality';

const key = (init: KeyboardEventInit): void => {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
};
const press = (): void => {
  document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
};
const tabbing = (): boolean => document.documentElement.hasAttribute(TABBING_ATTR);

describe('trackTabbing', () => {
  let stop: () => void;
  beforeEach(() => (stop = trackTabbing()));
  afterEach(() => stop());

  it('starts unmarked', () => {
    expect(tabbing()).toBe(false);
  });

  it('marks the document on Tab and Shift+Tab', () => {
    key({ key: 'Tab' });
    expect(tabbing()).toBe(true);
    press();
    key({ key: 'Tab', shiftKey: true });
    expect(tabbing()).toBe(true);
  });

  it('does not take typing or a shortcut for navigation', () => {
    key({ key: 'a' });
    key({ key: 'ArrowDown' });
    key({ key: 'k', ctrlKey: true });
    key({ key: 'Tab', ctrlKey: true });
    key({ key: 'Tab', altKey: true });
    expect(tabbing()).toBe(false);
  });

  it('drops the mark on the next press and keeps it while typing', () => {
    key({ key: 'Tab' });
    key({ key: 'x' });
    expect(tabbing()).toBe(true);
    press();
    expect(tabbing()).toBe(false);
  });

  it('stops listening and clears the mark', () => {
    key({ key: 'Tab' });
    stop();
    expect(tabbing()).toBe(false);
    key({ key: 'Tab' });
    expect(tabbing()).toBe(false);
  });
});

/** The rule in styles.scss that the mark drives (the global stylesheet is loaded in the test page). */
describe('keyboard ring on text fields', () => {
  let stop: () => void;
  let host: HTMLElement;
  const mount = <T extends HTMLElement>(el: T): T => {
    host.appendChild(el);
    el.focus();
    return el;
  };
  const ring = (el: HTMLElement): string => getComputedStyle(el).getPropertyValue('--sc-focus-ring').trim();

  beforeEach(() => {
    stop = trackTabbing();
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    stop();
    host.remove();
  });

  it('blanks the ring on a focused text field until Tab is used', () => {
    const input = mount(document.createElement('input'));
    const page = ring(document.documentElement);
    expect(page).not.toBe('');
    expect(ring(input)).not.toBe(page);
    key({ key: 'Tab' });
    expect(ring(input)).toBe(page);
    press();
    expect(ring(input)).not.toBe(page);
  });

  it('covers textarea and contenteditable, and leaves a checkbox and a button alone', () => {
    const page = ring(document.documentElement);
    expect(ring(mount(document.createElement('textarea')))).not.toBe(page);
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(ring(mount(editable))).not.toBe(page);
    const box = document.createElement('input');
    box.type = 'checkbox';
    expect(ring(mount(box))).toBe(page);
    expect(ring(mount(document.createElement('button')))).toBe(page);
  });
});
