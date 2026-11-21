import { TABBING_ATTR } from '../../core/focus-modality';
import { isTypeToSearchKey } from '../../codex/search/codex-search-hub.service';

/**
 * Type-to-search for the bar (feedback #385): a letter typed while nothing takes text lands in
 * the bar's search field, on every page where that field is the page's only search.
 *
 * The page decides by what it shows, not by a route list that could drift from the pages:
 * - the routed content (`#sc-main`) shows a text field of its own (a list filter, a second search,
 *   a form) → off: the letter could be meant for that field, two searches would compete;
 * - focus sits on a control the reader reached with Tab → off: keyboard navigation stays where it is;
 *   a control focused by a click (a chip, a card) does not count, the reader is not navigating;
 * - a menu or list popup is open → off: the letter belongs to it (type-ahead, filter);
 * - everything {@link isTypeToSearchKey} already rules out (modifier chords, digits and Space,
 *   IME composition, an open dialog, a key a page hotkey claimed with `preventDefault`).
 */

/** Input types that do not take free text. */
const NON_TEXT_INPUT = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/** Something a reader focuses to operate it (Tab stops), as opposed to a plain container. */
const INTERACTIVE =
  'a[href], button, input, select, textarea, summary, [contenteditable], [tabindex]:not([tabindex="-1"]), ' +
  '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], ' +
  '[role="radio"], [role="switch"], [role="slider"], [role="spinbutton"], [role="treeitem"], [role="gridcell"]';

/** A field that takes text. */
const TEXT_FIELD = 'input, textarea, [contenteditable]:not([contenteditable="false"]), [role="searchbox"], [role="textbox"], [role="combobox"]';

/** A popup that takes keys of its own while it is open. */
const KEY_POPUP =
  '.cdk-overlay-container [role="menu"], .cdk-overlay-container [role="listbox"], .cdk-overlay-container [role="dialog"]';

function visible(el: Element): boolean {
  const html = el as HTMLElement;
  if (typeof html.checkVisibility === 'function') return html.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions);
  return html.getClientRects().length > 0;
}

/** True when the reader is not navigating with the keyboard on a control right now. */
export function focusAllowsTypeToSearch(target: EventTarget | null, doc: Document = document): boolean {
  if (!(target instanceof Element) || target === doc.body || target === doc.documentElement) return true;
  if (!target.matches(INTERACTIVE)) return true;
  return !doc.documentElement.hasAttribute(TABBING_ATTR);
}

/** True when `root` shows a usable text field of its own (outside `ignore`, the bar). */
export function hasOwnTextField(root: ParentNode | null, ignore: Element | null = null): boolean {
  if (!root) return false;
  for (const el of Array.from(root.querySelectorAll(TEXT_FIELD))) {
    if (ignore?.contains(el)) continue;
    if (el instanceof HTMLInputElement && (NON_TEXT_INPUT.has(el.type) || el.disabled || el.readOnly)) continue;
    if (el instanceof HTMLTextAreaElement && (el.disabled || el.readOnly)) continue;
    if (el.closest('[inert], [aria-hidden="true"]')) continue;
    if (visible(el)) return true;
  }
  return false;
}

/** True while a menu or list popup (sc-select, a context menu) is open. */
export function keyPopupOpen(doc: Document = document): boolean {
  return !!doc.querySelector(KEY_POPUP);
}

/** Should this keydown start the bar's search? `bar` is the bar's own element (its field never counts). */
export function typeToSearchHere(ev: KeyboardEvent, bar: Element | null, doc: Document = document): boolean {
  if (!isTypeToSearchKey(ev)) return false;
  if (!focusAllowsTypeToSearch(ev.target, doc)) return false;
  if (keyPopupOpen(doc)) return false;
  return !hasOwnTextField(doc.getElementById('sc-main'), bar);
}
