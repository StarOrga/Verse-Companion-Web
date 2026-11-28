/**
 * Boot splash lifecycle. The splash (`.scb` in src/index.html) is a sibling of <sc-root>, so
 * Angular's first render never destroys it. Its dark backdrop shows at once; the logo, star
 * streaks and word (`.scb-stage`) only fade in once the load has taken longer than
 * SPLASH_REVEAL_MS — a fast reload never flashes them. That delay lives in CSS
 * (`--scb-reveal` in index.html); keep both in step.
 *
 * Leaving is one continuous hand-over, never a cut:
 * - the stage never showed: the backdrop fades out quickly (`scb-leave scb-quick`);
 * - the stage showed: it stays at least SPLASH_MIN_SHOWN_MS (a logo that flashes for a few
 *   frames reads as a glitch), then waits for the main thread to calm down (the first page's
 *   render is one long task; a transition started inside it loses most of its frames) and
 *   only then leaves with `scb-leave`, a fade plus a slow push-in on the logo.
 *
 * A reload during boot (a new build that became ready while the app was opening, see
 * SwUpdateService) does not restart the animation: {@link holdBootSplash} keeps the splash up
 * until the reload, {@link markBootSplashResume} notes how far the animation had run, and
 * public/boot-splash.js seeks the next document's splash to that point.
 */
export const SPLASH_REVEAL_MS = 600;
/** Mirrors the .scb-leave transition length in index.html. */
export const SPLASH_LEAVE_MS = 700;
/** Mirrors the .scb-quick transition length in index.html (backdrop only, the stage never showed). */
export const SPLASH_QUICK_LEAVE_MS = 220;
/** Once the logo is on screen it stays at least this long before it leaves. */
export const SPLASH_MIN_SHOWN_MS = 900;
/** Longest the leave waits for calm frames; past it the splash leaves anyway. */
export const SPLASH_SETTLE_CAP_MS = 800;
/** A frame that took longer than this is not calm: the main thread is still busy with the page. */
const CALM_FRAME_MS = 50;
/** The splash must never cover a dead app: removed after this regardless. */
export const SPLASH_FAILSAFE_MS = 10_000;
/** sessionStorage note for public/boot-splash.js: `{ at: epoch ms, age: ms the animation had run }`. */
export const SPLASH_RESUME_KEY = 'sc.boot.resume';

const SPLASH_SELECTOR = '.scb';
const LEAVING_ATTR = 'data-scb-leaving';

let holds = 0;
let waiting: Document | null = null;

function stageVisible(splash: Element): boolean {
  const stage = splash.querySelector('.scb-stage');
  if (!stage) return false;
  return parseFloat(getComputedStyle(stage).opacity) > 0.02;
}

/** How long the stage has been showing: the document's age minus the reveal delay (none after a resume). */
function shownFor(splash: Element): number {
  const delay = splash.classList.contains('scb-resume') ? 0 : SPLASH_REVEAL_MS;
  return performance.now() - delay;
}

/** Calls `done` after two calm frames in a row, or once SPLASH_SETTLE_CAP_MS has passed. */
function whenCalm(view: Window, done: () => void): void {
  const start = performance.now();
  let last = start;
  let calm = 0;
  const frame = (): void => {
    const now = performance.now();
    calm = now - last <= CALM_FRAME_MS ? calm + 1 : 0;
    last = now;
    if (calm >= 2 || now - start >= SPLASH_SETTLE_CAP_MS) done();
    else view.requestAnimationFrame(frame);
  };
  view.requestAnimationFrame(frame);
}

function leave(splash: Element, quick: boolean): void {
  if (!splash.isConnected) return;
  splash.classList.add('scb-leave');
  if (quick) splash.classList.add('scb-quick');
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    splash.remove();
  };
  splash.addEventListener('transitionend', (e) => {
    if (e.target === splash) finish();
  });
  setTimeout(finish, (quick ? SPLASH_QUICK_LEAVE_MS : SPLASH_LEAVE_MS) + 250);
}

/**
 * Hand the splash over to the page (see the file comment for the two ways out). No-op without
 * a splash or while it already leaves; while a hold is active the hand-over waits for its release.
 */
export function dismissBootSplash(doc: Document = document): void {
  const splash = doc.querySelector(SPLASH_SELECTOR);
  if (!splash || splash.hasAttribute(LEAVING_ATTR)) return;
  if (holds > 0) {
    waiting = doc;
    return;
  }
  splash.setAttribute(LEAVING_ATTR, '');
  if (!stageVisible(splash)) {
    leave(splash, true);
    return;
  }
  const view = doc.defaultView ?? window;
  const settle = (): void => whenCalm(view, () => leave(splash, false));
  const rest = SPLASH_MIN_SHOWN_MS - shownFor(splash);
  if (rest > 0) setTimeout(settle, rest);
  else settle();
}

/**
 * Keep the splash up although the page may be ready (a reload is on its way). Returns the
 * release; a hand-over asked for in the meantime runs on the last release. Idempotent per hold.
 */
export function holdBootSplash(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds > 0 || !waiting) return;
    const doc = waiting;
    waiting = null;
    dismissBootSplash(doc);
  };
}

/**
 * Before a reload during boot: note how far the splash animation has run, so the next document
 * continues it (public/boot-splash.js). Returns false when the splash is gone or already
 * leaving — the page is visible then, and the reload starts a fresh splash.
 */
export function markBootSplashResume(doc: Document = document): boolean {
  try {
    const splash = doc.querySelector(SPLASH_SELECTOR);
    if (!splash || splash.hasAttribute(LEAVING_ATTR)) return false;
    const view = doc.defaultView ?? window;
    view.sessionStorage.setItem(SPLASH_RESUME_KEY, JSON.stringify({ at: Date.now(), age: Math.round(performance.now()) }));
    return true;
  } catch {
    // No DOM (specs with a stub document) or storage blocked: the next document starts its splash anew.
    return false;
  }
}

/** The reload did not happen after all: the note must not reach a later document. */
export function clearBootSplashResume(doc: Document = document): void {
  try {
    (doc.defaultView ?? window).sessionStorage.removeItem(SPLASH_RESUME_KEY);
  } catch {
    // Storage blocked: there was no note either.
  }
}

/** Hard removal after SPLASH_FAILSAFE_MS if nothing dismissed it (bootstrap failure, hung route). */
export function armBootSplashFailsafe(doc: Document = document): void {
  setTimeout(() => {
    doc.querySelector(SPLASH_SELECTOR)?.remove();
  }, SPLASH_FAILSAFE_MS);
}

/** Specs only: forget holds left over from another test. */
export function resetBootSplashHolds(): void {
  holds = 0;
  waiting = null;
}
