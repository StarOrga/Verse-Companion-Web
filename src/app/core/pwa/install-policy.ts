/**
 * Pure rules of the PWA install prompt (no DOM, no Angular): what counts as a success, the back-off
 * ladder, the session counter and the eligibility gate. `PwaInstallService` feeds these with the
 * real device; the specs feed them with plain objects and a fake clock.
 */

export type InstallPlatform = 'android-native' | 'ios' | 'other';
export type InstallTrigger = 'success' | 'idle' | 'manual';

/** Persisted under `sc.pwa.install`. */
export interface InstallState {
  /** Sessions counted so far (a session = tab/app open after >= SESSION_GAP_MS of silence). */
  sessions: number;
  /** Last time anything happened, epoch ms (drives the session gap). */
  lastActivity: number;
  /** How often the reader declined (card "Later", system dialog cancel, closed iOS sheet). */
  dismissals: number;
  lastDismissedAt: number | null;
  /** `appinstalled` seen: never prompt again. */
  installed: boolean;
}

export const EMPTY_INSTALL_STATE: InstallState = { sessions: 0, lastActivity: 0, dismissals: 0, lastDismissedAt: null, installed: false };

export const DAY_MS = 86_400_000;
/** A new session starts after this much silence. */
export const SESSION_GAP_MS = 30 * 60_000;
/** Pause after the 1st, 2nd, 3rd dismissal; a 4th dismissal ends the automatic prompt for good. */
export const BACKOFF_DAYS = [14, 45, 120] as const;
/** Quiet time before a card may appear after a success / in the idle fallback. */
export const CALM_AFTER_SUCCESS_MS = 2_500;
export const CALM_IDLE_MS = 8_000;
/** A success trigger that finds no calm moment within this window is dropped. */
export const TRIGGER_WINDOW_MS = 60_000;
/** Idle fallback: from this session on, after this long on a page. */
export const IDLE_MIN_SESSIONS = 4;
export const IDLE_DELAY_MS = 20_000;
export const MIN_SESSIONS = 2;

const SUCCESS_VERBS = new Set(['create', 'add', 'import', 'share', 'submit', 'finish', 'earn', 'accept', 'assign']);

/** `area:object_verb` is a success when its last word is a success verb. `app:*` (the prompt itself) never counts. */
export function isSuccessEvent(name: string): boolean {
  const [area, rest] = name.split(':');
  if (!rest || area === 'app') return false;
  const verb = rest.slice(rest.lastIndexOf('_') + 1);
  return SUCCESS_VERBS.has(verb);
}

export function backoffActive(state: Pick<InstallState, 'dismissals' | 'lastDismissedAt'>, now: number): boolean {
  if (state.dismissals <= 0) return false;
  if (state.dismissals > BACKOFF_DAYS.length) return true;
  if (state.lastDismissedAt === null) return false;
  return now - state.lastDismissedAt < BACKOFF_DAYS[state.dismissals - 1] * DAY_MS;
}

/** Counts a session when the last activity lies >= 30 min back (or never happened). */
export function withSessionTick(state: InstallState, now: number): InstallState {
  const fresh = state.lastActivity === 0 || now - state.lastActivity >= SESSION_GAP_MS;
  return { ...state, sessions: fresh ? state.sessions + 1 : state.sessions, lastActivity: now };
}

export interface EligibilityInput {
  state: InstallState;
  now: number;
  trigger: InstallTrigger;
  platform: InstallPlatform;
  /** `canInstall` (event stashed) for Android, always true for iOS. */
  installable: boolean;
  standalone: boolean;
  coarsePointer: boolean;
  signedInShellRoute: boolean;
  shownThisSession: boolean;
}

/** All gates of the AUTOMATIC prompt. */
export function isEligible(i: EligibilityInput): boolean {
  if (i.trigger === 'manual') return true;
  if (i.standalone || i.state.installed || !i.coarsePointer || !i.signedInShellRoute || i.shownThisSession) return false;
  if (i.platform === 'other' || !i.installable) return false;
  if (backoffActive(i.state, i.now)) return false;
  return i.state.sessions >= (i.trigger === 'idle' ? IDLE_MIN_SESSIONS : MIN_SESSIONS);
}

/** What the view in front of the reader says about a calm moment (the DOM checks live in `PwaEnv.calmDom`). */
export interface CalmViewInput {
  /** `html.sc-immersive`: a stage owns the screen. */
  immersive: boolean;
  /** A phone on its side (`data-sc-compact`). */
  compact: boolean;
  fullscreen: boolean;
  url: string;
}

/** The ship page is the place people study; a card over it is never calm. */
export function isShipDetailUrl(url: string): boolean {
  return /^\/codex\/ship(\/|\?|#|$)/.test(url);
}

/** No automatic card while an immersive view, a landscape phone, fullscreen or a ship detail page is up. */
export function calmView(i: CalmViewInput): boolean {
  return !(i.immersive || i.compact || i.fullscreen || isShipDetailUrl(i.url));
}
