/**
 * Back gesture for popups (concept popup-aufbau r1-back: "Erst Fenster, dann Seite").
 *
 * A popup that takes part pushes ONE history entry on open (same URL, the router's state kept,
 * plus a `scPopup` marker). The browser / phone back gesture then leaves that entry: the
 * topmost popup closes and the page stays. Only the next back leaves the page. A popup closed
 * through its ✕ / Escape / Abbrechen pops its own entry again, so no stale entry remains.
 *
 * These popstates are popup-internal (the URL never changes), so they are stopped in a
 * window capture listener before Angular's Location sees them: the router does not re-run and
 * CDK overlays with `disposeOnNavigation` underneath (a dialog under a confirm) stay open.
 * A popup whose page navigated away while it was open does not pop (the entry under it is the
 * router's now); its marker entry then is a harmless same-URL step.
 */
export interface PopupHistoryEntry {
  readonly id: string;
  /** Called when the back gesture left this popup's entry. */
  readonly onBack: () => void;
}

const stack: PopupHistoryEntry[] = [];
let ownPops = 0;
let listening = false;
let seq = 0;

function markerOf(state: unknown): string | null {
  return state && typeof state === 'object' && 'scPopup' in state ? String((state as { scPopup: unknown }).scPopup) : null;
}

function onPopstate(ev: PopStateEvent): void {
  if (ownPops > 0) {
    ownPops--;
    ev.stopImmediatePropagation();
    return;
  }
  const top = stack[stack.length - 1];
  if (!top || markerOf(ev.state) === top.id) return;
  stack.pop();
  ev.stopImmediatePropagation();
  top.onBack();
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', onPopstate, true);
}

/** Push the popup's history entry; returns its id. */
export function pushPopupEntry(onBack: () => void): string {
  const id = `p${++seq}-${Date.now().toString(36)}`;
  listen();
  const prev = history.state && typeof history.state === 'object' ? history.state : {};
  history.pushState({ ...prev, scPopup: id }, '', location.href);
  stack.push({ id, onBack });
  return id;
}

/** The popup closed by itself: drop its entry, and step back over it if the page still stands on it. */
export function releasePopupEntry(id: string): void {
  const at = stack.findIndex((e) => e.id === id);
  if (at < 0) return;
  stack.splice(at, 1);
  if (markerOf(history.state) !== id) return;
  ownPops++;
  history.back();
}

/** Open popup entries (for tests). */
export function popupEntryDepth(): number {
  return stack.length;
}
