import { Injectable, computed, inject } from '@angular/core';
import { AccountPrefsService } from '../../core/account-prefs.service';

/** `profiles.ui_prefs` key; `true` = the two-colour liveness tint. */
export const ROUTINE_TINT_BINARY_KEY = 'feedback.routineTintBinary';
/** `profiles.ui_prefs` key; `true` = the steady green "PC on" light (feedback #405). */
export const ROUTINE_PC_LIGHT_KEY = 'feedback.routinePcLight';

/**
 * Which palette the feedback title's liveness tint (`scRoutineStatus`) uses.
 *
 * Default: the four-state palette since #583 — green idle, cyan while a run is
 * working, amber when the usage brake holds, red when the routine went quiet.
 * Opt-in: the original two colours of feedback a7573f0e — green while the
 * routine is up or working, red while nothing is being worked on (offline or
 * paused). One admin reads the title as "is anyone on my questions?" and wants
 * exactly that yes/no back, another prefers the cyan (feedback #338) — so it is
 * a per-account choice, not a palette swap for everybody.
 *
 * Stored in `profiles.ui_prefs` through `AccountPrefsService`, so it follows the
 * account from browser to browser and nobody else ever sees it.
 */
@Injectable({ providedIn: 'root' })
export class RoutineTintPrefsService {
  private readonly account = inject(AccountPrefsService);

  /** `true` → the title is only ever green, red or (unknown) grey. */
  readonly binary = computed(() => this.account.prefs()?.[ROUTINE_TINT_BINARY_KEY] === true);

  /**
   * `true` → the title glows green, steadily, for as long as the watcher on
   * the dev PC keeps ticking — idle, working or paused alike — and turns red
   * shortly after the ticks stop (feedback #405: "dauerhaftes Grün, damit ich
   * weiß, ob hier dran gearbeitet wird"). It replaces the cyan a working run
   * showed in the four-state palette. Outranks `binary` when both are on.
   */
  readonly pcLight = computed(() => this.account.prefs()?.[ROUTINE_PC_LIGHT_KEY] === true);

  setPcLight(on: boolean): void {
    this.account.set(ROUTINE_PC_LIGHT_KEY, on ? true : null);
  }

  setBinary(on: boolean): void {
    // `null` removes the key: the default stays the absence of a value.
    this.account.set(ROUTINE_TINT_BINARY_KEY, on ? true : null);
  }
}
