import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** The three viewport modes (spec §1.1). Written once; stylesheets use the `sc-compact` mixin (shell/_viewport.scss). */
export const PHONE_QUERY = '(max-width: 720px)';
export const COMPACT_QUERY = '(orientation: landscape) and (max-height: 500px)';
export const TABLET_QUERY = '(min-width: 721px) and (pointer: coarse) and (min-height: 501px)';

/**
 * One source for "what kind of screen is this": sets `data-sc-phone` (portrait phone / narrow window),
 * `data-sc-compact` (a phone on its side) and `data-sc-tablet` on <html> and exposes the same as signals.
 * One `matchMedia` listener per mode. `start()` is called once by the shell; the service also starts
 * itself on first injection, so a consumer never reads a stale value.
 */
@Injectable({ providedIn: 'root' })
export class ViewportModeService {
  private readonly doc = inject(DOCUMENT);
  readonly phone = signal(false);
  readonly compact = signal(false);
  readonly tablet = signal(false);
  /**
   * `html[data-sc-bar-off]`, set by a page that needs the whole bottom of a phone (the Holotable's ship sheet):
   * the bottom search capsule steps aside and the header carries the search. Only a phone in portrait honours it.
   */
  readonly barOff = signal(false);
  private started = false;
  /** Listener / observer teardown: a destroyed injector (tests, an app re-bootstrap) must not keep writing <html>. */
  private readonly teardown: (() => void)[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const off of this.teardown.splice(0)) off();
      const root = this.doc.documentElement;
      for (const attr of ['data-sc-phone', 'data-sc-compact', 'data-sc-tablet']) root.removeAttribute(attr);
    });
    this.start();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const win = this.doc.defaultView;
    if (!win || typeof win.matchMedia !== 'function') return;
    this.bind(win, PHONE_QUERY, 'data-sc-phone', this.phone);
    this.bind(win, COMPACT_QUERY, 'data-sc-compact', this.compact);
    this.bind(win, TABLET_QUERY, 'data-sc-tablet', this.tablet);
    const root = this.doc.documentElement;
    const readBarOff = () => this.barOff.set(root.hasAttribute('data-sc-bar-off') && this.phone() && !this.compact());
    readBarOff();
    if (typeof MutationObserver === 'function') {
      const mo = new MutationObserver(readBarOff);
      mo.observe(root, { attributes: true, attributeFilter: ['data-sc-bar-off', 'data-sc-phone', 'data-sc-compact'] });
      this.teardown.push(() => mo.disconnect());
    }
  }

  private bind(win: Window, query: string, attr: string, state: ReturnType<typeof signal<boolean>>): void {
    const mql = win.matchMedia(query);
    const root = this.doc.documentElement;
    const apply = (on: boolean) => {
      state.set(on);
      if (on) root.setAttribute(attr, '');
      else root.removeAttribute(attr);
    };
    apply(mql.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mql.addEventListener('change', onChange);
    this.teardown.push(() => mql.removeEventListener('change', onChange));
  }
}
