import type { NavOriginService } from '../shared/page-header/nav-origin.service';

/**
 * How loud a blueprint or preview page's path control is. Signed in: always the full form of the two stations
 * (concept pfad-stationen R5, owner decision r5-d-bauplan "Immer, wenn du angemeldet bist"). Signed out it stays as
 * before: the full form when the reader came from Planen (an HQ page; the fragment is not kept by NavOriginService)
 * or from a set, the pill otherwise (concept gegenstand-weg D2).
 */
export function pathLevelFor(origin: NavOriginService, signedIn: boolean): 'primary' | 'secondary' {
  if (signedIn) return 'primary';
  const p = origin.previous()?.path ?? '';
  return p === '/hq' || p.startsWith('/codex/set') ? 'primary' : 'secondary';
}
