import type { AnalyticsService } from '../../core/analytics.service';

/** Where a wish was assigned to / released from an Operation (concept 20261117-1110-pfad-stationen, A12). */
export type PathGroupSurface = 'codex' | 'hq' | 'wishlist';

/** `hq:path_group_assign` - pieces of a wish were assigned to an Operation; `created` = a new Operation was made for it. */
export function trackPathGroupAssign(analytics: Pick<AnalyticsService, 'track'>, surface: PathGroupSurface, created: boolean): void {
  analytics.track('hq:path_group_assign', { surface, created });
}

/** `hq:path_group_release` - `pieces` assigned pieces left their Operation(s); `dissolved` = an Operation went with them. */
export function trackPathGroupRelease(analytics: Pick<AnalyticsService, 'track'>, surface: PathGroupSurface, pieces: number, dissolved: boolean): void {
  analytics.track('hq:path_group_release', { surface, pieces, dissolved });
}
