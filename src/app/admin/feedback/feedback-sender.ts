import { POSTHOG_GUARD_PROFILE_ID } from '../../feedback/feedback.types';

/**
 * Who a topic or reply comes from, as the board names it (feedback #390: never
 * "Unbekannt"). A guard item is named by the guard that filed it, a person by
 * their profile. An author-less topic posted on the internal board (`source`
 * `admin`, the default) was filed by the routine via service_role — that is
 * the AI, so it reads "KI" / "AI". Only an author-less topic a viewer submitted
 * (`source` `user`) is a deleted account (FK `on delete set null`): "Ohne Konto".
 */
export type FeedbackSender = 'posthog' | 'service' | 'ai' | 'person' | 'none';

export function senderOf(
  origin: string | null | undefined,
  authorId: string | null,
  source?: string | null,
): FeedbackSender {
  if (origin === 'service') return 'service';
  if ((origin && origin !== 'human') || authorId === POSTHOG_GUARD_PROFILE_ID) return 'posthog';
  if (authorId) return 'person';
  return source === 'user' ? 'none' : 'ai';
}

/** True for every sender that is not a person — the guards and the AI; they draw the bot glyph. */
export function isAutomatic(s: FeedbackSender): boolean {
  return s === 'posthog' || s === 'service' || s === 'ai';
}

/**
 * The "Wer?" filter key: one chip per person, one per guard, one for the AI,
 * one for deleted accounts — never one shared bucket for everything without
 * an author_id (that bucket took its label from whichever row came first).
 */
export function senderFilterKey(
  origin: string | null | undefined,
  authorId: string | null,
  source?: string | null,
): string {
  const s = senderOf(origin, authorId, source);
  if (s === 'person') return authorId as string;
  return `__${s}__`;
}

/** i18n key of a non-person sender's name; null for a person (their profile names them). */
export function senderNameKey(s: FeedbackSender): string | null {
  switch (s) {
    case 'posthog': return 'adminFeedback.guard.name';
    case 'service': return 'adminFeedback.guard.serviceName';
    case 'ai': return 'adminFeedback.kind.ai';
    case 'none': return 'adminFeedback.noAccount';
    default: return null;
  }
}

/** i18n key of an automatic sender's avatar tooltip. */
export function senderTitleKey(s: FeedbackSender): string {
  if (s === 'service') return 'adminFeedback.guard.serviceTitle';
  if (s === 'ai') return 'adminFeedback.aiSenderTitle';
  return 'adminFeedback.guard.title';
}

/**
 * The sender of a non-system thread reply. The AI's replies are `is_system`
 * and labelled apart, so an author-less human reply can only be a deleted
 * account — "Ohne Konto", never the AI.
 */
export function replySenderOf(authorId: string | null): FeedbackSender {
  if (authorId === POSTHOG_GUARD_PROFILE_ID) return 'posthog';
  return authorId ? 'person' : 'none';
}
