import type { HoloSilhouette } from '../holo-silhouette';
import type { SilThumb } from '../../shared/sil-thumb/sil-thumbs.service';

/**
 * Longest the ship detail keeps its skeleton (the arriving silhouette) after the data is in,
 * waiting for the hull outline the Holotable draws. Usually 0: the outline is read alongside
 * the detail. Past this the stage enters without it, as before.
 */
export const SILHOUETTE_HOLD_MS = 900;

/**
 * The detail's own hull silhouette as an arrival thumb, exactly as the Holotable draws it (nose up, its own
 * box), so the skeleton's outline and the hologram that replaces it are the same picture.
 */
export function arrivalThumbOf(sil: Pick<HoloSilhouette, 'viewBox' | 'path'> | null): SilThumb | null {
  if (!sil?.viewBox || !sil.path) return null;
  return { viewBox: sil.viewBox, path: sil.path, transform: '' };
}

/**
 * A tile thumb back on the table's axis. The small tiles lay a ship on its side (`rotateShipBox`: a quarter turn
 * about the box centre, the box's sides swapped); the stage shows it nose up, so the turn is taken out again.
 * A thumb without that turn, or with a box that cannot be read, passes unchanged.
 */
export function uprightThumb(thumb: SilThumb | null): SilThumb | null {
  if (!thumb || !thumb.transform?.startsWith('rotate(90')) return thumb;
  const p = thumb.viewBox.trim().split(/[\s,]+/).map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n)) || p[2] <= 0 || p[3] <= 0) return thumb;
  const [x, y, w, h] = p;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return { ...thumb, viewBox: `${cx - h / 2} ${cy - w / 2} ${h} ${w}`, transform: '' };
}
