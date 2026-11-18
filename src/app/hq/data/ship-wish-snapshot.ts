import type { HangarService } from '../../hangar/hangar.service';
import type { HangarShipOrigin } from '../../hangar/hangar.types';

/*
 * A ship wish lowered to 0 is deleted: a ship that is only wished is a hangar row (`status = 'wishlist'`), and the row
 * goes. Its custom name, notes, skin and origin live nowhere else, so the undo has to put them back from a copy taken
 * before the delete. Fields only fill where the re-created row is still blank, so an edit made in between wins.
 */

export interface ShipWishSnapshot {
  readonly customName: string | null;
  readonly notes: string | null;
  readonly selectedSkinId: string | null;
  readonly origin: HangarShipOrigin | null;
}

type ShipReader = Pick<HangarService, 'shipByClassName'>;
type ShipWriter = Pick<HangarService, 'shipByClassName' | 'updateShip'>;

/** The wished hangar row's own data (null when the ship has no wished row or nothing worth keeping on it). */
export function snapshotShipWish(hangar: ShipReader, className: string): ShipWishSnapshot | null {
  const s = hangar.shipByClassName(className);
  if (!s || s.status !== 'wishlist') return null;
  const snap: ShipWishSnapshot = {
    customName: s.customName ?? null,
    notes: s.notes ?? null,
    selectedSkinId: s.selectedSkinId ?? null,
    origin: s.origin ?? null,
  };
  return snap.customName || snap.notes || snap.selectedSkinId || snap.origin ? snap : null;
}

/** Writes the snapshot's fields back onto the re-created wished row, where that row has none. False when a write failed. */
export async function restoreShipWish(hangar: ShipWriter, className: string, snap: ShipWishSnapshot | null): Promise<boolean> {
  if (!snap) return true;
  const s = hangar.shipByClassName(className);
  if (!s || s.status !== 'wishlist') return true; // the ship is owned or gone now: the wish was not re-created, nothing to fill
  const patch: Partial<{ customName: string | null; notes: string | null; selectedSkinId: string | null; origin: HangarShipOrigin | null }> = {};
  if (snap.customName && !s.customName) patch.customName = snap.customName;
  if (snap.notes && !s.notes) patch.notes = snap.notes;
  if (snap.selectedSkinId && !s.selectedSkinId) patch.selectedSkinId = snap.selectedSkinId;
  if (snap.origin && !s.origin) patch.origin = snap.origin;
  return Object.keys(patch).length ? hangar.updateShip(s.id, patch) : true;
}
