/**
 * Fixed identity of the machine sender on the admin board (migration
 * 20261115030100): items filed by the PostHog signal function and the service
 * health watcher carry `author_id = NULL` and an `origin` other than 'human';
 * replies the guard writes use this profile. Same value as
 * `supabase/functions/_shared/posthog-guard.ts`.
 */
export const POSTHOG_GUARD_PROFILE_ID = '00000000-0000-4000-8000-0000706f7374';

/** Where a board item came from. */
export type FeedbackOrigin = 'human' | 'posthog' | 'service';
