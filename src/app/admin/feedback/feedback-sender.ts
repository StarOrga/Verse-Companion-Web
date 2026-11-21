import { POSTHOG_GUARD_PROFILE_ID } from '../../feedback/feedback.types';

/**
 * Who a topic or reply comes from, as the board names it (feedback #390: never
 * "Unbekannt"). A machine sender is named by the guard that filed it, a person
 * by their profile; a row whose author is gone — a deleted account (FK `on
 * delete set null`) or an item the routine filed via service_role — is
 * "Ohne Konto", which is true in both cases.
 */
export type FeedbackSender = 'posthog' | 'service' | 'person' | 'none';

export function senderOf(origin: string | null | undefined, authorId: string | null): FeedbackSender {
  if (origin === 'service') return 'service';
  if ((origin && origin !== 'human') || authorId === POSTHOG_GUARD_PROFILE_ID) return 'posthog';
  return authorId ? 'person' : 'none';
}

/**
 * The "Wer?" filter key: one chip per person, one per guard, one for all
 * rows without an account — never one shared bucket for everything without
 * an author_id (that bucket took its label from whichever row came first).
 */
export function senderFilterKey(origin: string | null | undefined, authorId: string | null): string {
  const s = senderOf(origin, authorId);
  if (s === 'person') return authorId as string;
  return `__${s}__`;
}

/** i18n key of a non-person sender's name; null for a person (their profile names them). */
export function senderNameKey(s: FeedbackSender): string | null {
  switch (s) {
    case 'posthog': return 'adminFeedback.guard.name';
    case 'service': return 'adminFeedback.guard.serviceName';
    case 'none': return 'adminFeedback.noAccount';
    default: return null;
  }
}

/** i18n key of a machine sender's avatar tooltip. */
export function senderTitleKey(s: FeedbackSender): string {
  return s === 'service' ? 'adminFeedback.guard.serviceTitle' : 'adminFeedback.guard.title';
}
