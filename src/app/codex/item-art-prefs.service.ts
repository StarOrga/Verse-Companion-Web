import { Injectable, computed, inject } from '@angular/core';
import { AccountPrefsService } from '../core/account-prefs.service';

/** `profiles.ui_prefs` key; `'icons'` = the game's flat glyphs instead of the model renders. */
export const ITEM_ART_KEY = 'codex.itemArt';

/** What a search row and an item page show as the item's picture. */
export type ItemArt = 'renders' | 'icons';

/**
 * Item pictures in the search and on item pages (feedback #402).
 *
 * Default `renders`: the colour still of the item's 3D model the Data Uploader
 * ships as `payload.renderImage`, where the build has one; everything else
 * keeps its icon. `icons` keeps the flat category/game glyphs everywhere — one
 * reader scans a list faster by shape than by picture.
 *
 * Stored in `profiles.ui_prefs` through `AccountPrefsService`, so it follows
 * the account across browsers; signed out there are no prefs and the default
 * applies. Ships are not affected (their RSI store pictures stay).
 */
@Injectable({ providedIn: 'root' })
export class ItemArtPrefsService {
  private readonly account = inject(AccountPrefsService);

  readonly art = computed<ItemArt>(() => (this.account.prefs()?.[ITEM_ART_KEY] === 'icons' ? 'icons' : 'renders'));

  /** `true` → model renders are shown where an item has one. */
  readonly renders = computed(() => this.art() === 'renders');

  set(art: ItemArt): void {
    // `null` removes the key: the default stays the absence of a value.
    this.account.set(ITEM_ART_KEY, art === 'icons' ? 'icons' : null);
  }
}
