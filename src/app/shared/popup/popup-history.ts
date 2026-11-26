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

interface Entry extends PopupHistoryEntry {
  /** The browser entry is really on the history stack (a push waits while a step back is in flight). */
  pushed: boolean;
  /** The popup is gone but its entry is still under a live popup's: skipped when it surfaces. */
  dead: boolean;
}

/** How long a self-issued step back may stay unanswered (a cancelled traversal) before we stop waiting. */
const EXPECT_TIMEOUT_MS = 600;

const stack: Entry[] = [];
/** Steps back this module issued itself and whose popstate has not been seen yet. */
let expecting = 0;
let expectTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
let seq = 0;

function markerOf(state: unknown): string | null {
  return state && typeof state === 'object' && 'scPopup' in state ? String((state as { scPopup: unknown }).scPopup) : null;
}

function top(): Entry | undefined {
  return stack[stack.length - 1];
}

function stepBack(): void {
  expecting++;
  if (expectTimer) clearTimeout(expectTimer);
  // A traversal that never lands (cancelled, or the page left) must not swallow a later real Back.
  expectTimer = setTimeout(() => {
    expectTimer = null;
    expecting = 0;
    settle();
  }, EXPECT_TIMEOUT_MS);
  history.back();
}

/** Nothing in flight: skip entries of destroyed popups that surfaced, then push the entries that waited. */
function settle(): void {
  if (expecting > 0) return;
  for (let t = top(); t?.dead; t = top()) {
    stack.pop();
    if (t.pushed && markerOf(history.state) === t.id) {
      stepBack();
      return;
    }
  }
  for (const e of stack) {
    if (e.pushed) continue;
    const prev = history.state && typeof history.state === 'object' ? history.state : {};
    history.pushState({ ...prev, scPopup: e.id }, '', location.href);
    e.pushed = true;
  }
}

function onPopstate(ev: PopStateEvent): void {
  if (expecting > 0) {
    expecting--;
    ev.stopImmediatePropagation();
    if (expecting === 0) {
      if (expectTimer) clearTimeout(expectTimer);
      expectTimer = null;
      settle();
    }
    return;
  }
  const t = top();
  if (!t || !t.pushed || markerOf(ev.state) === t.id) return;
  stack.pop();
  ev.stopImmediatePropagation();
  t.onBack();
  settle();
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', onPopstate, true);
}

/**
 * Install the popstate listener before the app boots (main.ts). It must be the FIRST popstate
 * listener on window: Chrome runs window's popstate listeners in the order they were added, the
 * capture flag does not put ours ahead of Angular's. Added lazily with the first popup it came
 * after the router's, so the step back of a closing popup reached the router as a same-URL
 * navigation and the scroll policy threw the page to the top (admin feedback #403: closing the
 * swap picker on a ship's loadout jumped up the page).
 */
export function installPopupHistory(): void {
  listen();
}

/** Push the popup's history entry; returns its id. */
export function pushPopupEntry(onBack: () => void): string {
  const id = `p${++seq}-${Date.now().toString(36)}`;
  listen();
  stack.push({ id, onBack, pushed: false, dead: false });
  // While a step back is in flight (a popup closed in this very tick) the push waits for its popstate:
  // pushing first would let that traversal land on the entry of the popup that just closed.
  settle();
  return id;
}

/** The popup closed by itself: drop its entry, and step back over it if the page still stands on it. */
export function releasePopupEntry(id: string): void {
  const at = stack.findIndex((e) => e.id === id);
  if (at < 0) return;
  const entry = stack[at];
  if (!entry.pushed) {
    stack.splice(at, 1);
    return;
  }
  const onTop = at === stack.length - 1;
  if (onTop && expecting === 0) {
    stack.pop();
    if (markerOf(history.state) === id) stepBack();
    return;
  }
  // Under a live popup, or a step back is still in flight: the browser entry stays until it surfaces.
  entry.dead = true;
}

/** Open popup entries that belong to a live popup (for tests). */
export function popupEntryDepth(): number {
  return stack.filter((e) => !e.dead).length;
}
