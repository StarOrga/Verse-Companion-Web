import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShellChromeService } from './fusion-bar/shell-chrome.service';

/** Hide on scroll-down / reveal on scroll-up of the compact header (spec 1.3): state on <html data-sc-chrome>. */
describe('ShellChromeService.startChromeAutoHide', () => {
  let y = 0;
  let header: HTMLElement;
  let stop: () => void;
  const root = document.documentElement;
  // window.scrollY is an own property of window in Chromium: restore the real one, never delete it
  // (a deleted scrollY reads undefined and breaks every later spec that measures the page).
  const realScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');

  const scrollTo = async (next: number): Promise<void> => {
    y = next;
    window.dispatchEvent(new Event('scroll'));
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  };

  beforeEach(() => {
    y = 0;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
    root.setAttribute('data-sc-compact', '');
    header = document.createElement('header');
    Object.defineProperty(header, 'offsetHeight', { configurable: true, value: 48 });
    document.body.appendChild(header);
    // A page tall enough that "page end" never applies.
    document.body.style.minHeight = '5000px';
    stop = TestBed.inject(ShellChromeService).startChromeAutoHide(header);
  });

  afterEach(() => {
    stop();
    header.remove();
    document.body.style.minHeight = '';
    root.removeAttribute('data-sc-compact');
    root.classList.remove('sc-immersive');
    root.removeAttribute('data-sc-chrome');
    if (realScrollY) Object.defineProperty(window, 'scrollY', realScrollY);
    else delete (window as unknown as { scrollY?: number }).scrollY;
  });

  it('hides after travelling down past the header and reveals on a small scroll up', async () => {
    await scrollTo(100);
    expect(root.getAttribute('data-sc-chrome')).toBe('hidden');
    await scrollTo(94);
    expect(root.getAttribute('data-sc-chrome')).toBe('hidden');
    await scrollTo(84);
    expect(root.hasAttribute('data-sc-chrome')).toBe(false);
  });

  it('stays shown at the top and while a stage is immersive', async () => {
    await scrollTo(6);
    expect(root.hasAttribute('data-sc-chrome')).toBe(false);
    root.classList.add('sc-immersive');
    await scrollTo(300);
    expect(root.hasAttribute('data-sc-chrome')).toBe(false);
  });

  it('is inactive outside compact', async () => {
    root.removeAttribute('data-sc-compact');
    await scrollTo(400);
    expect(root.hasAttribute('data-sc-chrome')).toBe(false);
  });
});
