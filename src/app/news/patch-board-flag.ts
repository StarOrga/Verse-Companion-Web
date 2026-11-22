/**
 * Which patch board `/verse/patches` renders.
 *
 * true  = the "Live first" board with read state (`patch-board-v2.component.ts`,
 *         concept 20261110-1749-patch-lesestand, round 5).
 * false = the previous time-stack board (`patch-board.component.ts`), untouched.
 *
 * Set to false to restore the previous board — nothing else has to change.
 */
export const PATCH_BOARD_V2 = true;
