import { EnvironmentInjector, Injectable, afterNextRender, inject } from '@angular/core';

/**
 * The one way to "open the search of the page the reader is on, as if they had clicked into it": the Ctrl+K key and
 * the wishes' "Wunsch suchen" both end here. A search surface registers how IT opens (the subheader's field takes the
 * caret and its panel opens; on a landing page its stage field or a Codex page's slim bar does; the legacy header's
 * button opens the Ctrl+K palette), the newest registration wins, and `open()` calls it. No second mechanism: what
 * Ctrl+K does on a page is exactly what `open()` does there.
 */
@Injectable({ providedIn: 'root' })
export class SearchOpenService {
  private readonly injector = inject(EnvironmentInjector);
  private readonly openers: { owner: object; open: () => void }[] = [];

  /** A search surface says how it opens; returns the unregister function. */
  register(owner: object, open: () => void): () => void {
    this.openers.push({ owner, open });
    return () => {
      const i = this.openers.findIndex((e) => e.owner === owner);
      if (i >= 0) this.openers.splice(i, 1);
    };
  }

  /** True while a search surface is mounted (always, inside the shell and the public layout). */
  get available(): boolean {
    return this.openers.length > 0;
  }

  /** Open the page's search now: caret in the visible field and its panel open, else the Ctrl+K palette. False with no surface. */
  open(): boolean {
    const newest = this.openers[this.openers.length - 1];
    if (!newest) return false;
    newest.open();
    return true;
  }

  /**
   * As {@link open}, but after the next render: for a caller that is itself closing a modal window. While that window
   * stands, the page is inert and a field behind it cannot take the caret; once it is gone the field can.
   */
  openAfterRender(): void {
    afterNextRender(() => this.open(), { injector: this.injector });
  }
}
