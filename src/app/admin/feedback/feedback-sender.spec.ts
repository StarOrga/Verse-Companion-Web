import { POSTHOG_GUARD_PROFILE_ID } from '../../feedback/feedback.types';
import { isAutomatic, replySenderOf, senderFilterKey, senderNameKey, senderOf, senderTitleKey } from './feedback-sender';

describe('feedback sender (#390)', () => {
  it('names guard items by their guard, not as unknown', () => {
    expect(senderOf('posthog', null)).toBe('posthog');
    expect(senderOf('service', null)).toBe('service');
    expect(senderOf(null, POSTHOG_GUARD_PROFILE_ID)).toBe('posthog');
    expect(senderNameKey('posthog')).toBe('adminFeedback.guard.name');
    expect(senderNameKey('service')).toBe('adminFeedback.guard.serviceName');
    expect(senderTitleKey('service')).toBe('adminFeedback.guard.serviceTitle');
    expect(senderTitleKey('posthog')).toBe('adminFeedback.guard.title');
  });

  it('labels an author-less board topic as the AI that filed it', () => {
    expect(senderOf('human', null)).toBe('ai');
    expect(senderOf(undefined, null)).toBe('ai');
    expect(senderOf('human', null, 'admin')).toBe('ai');
    expect(senderNameKey('ai')).toBe('adminFeedback.kind.ai');
    expect(senderTitleKey('ai')).toBe('adminFeedback.aiSenderTitle');
    expect(isAutomatic('ai')).toBe(true);
    expect(isAutomatic('posthog')).toBe(true);
    expect(isAutomatic('person')).toBe(false);
    expect(isAutomatic('none')).toBe(false);
  });

  it('falls back to "no account" only for a deleted account', () => {
    expect(senderOf('human', null, 'user')).toBe('none');
    expect(senderNameKey('none')).toBe('adminFeedback.noAccount');
    expect(replySenderOf(null)).toBe('none');
    expect(replySenderOf(POSTHOG_GUARD_PROFILE_ID)).toBe('posthog');
    expect(replySenderOf('u1')).toBe('person');
    expect(senderOf('human', 'u1')).toBe('person');
    expect(senderNameKey('person')).toBeNull();
  });

  it('keeps one filter bucket per sender', () => {
    const keys = new Set([
      senderFilterKey('posthog', null),
      senderFilterKey('service', null),
      senderFilterKey('human', null),
      senderFilterKey('human', null, 'user'),
      senderFilterKey('human', 'u1'),
    ]);
    expect(keys.size).toBe(5);
    expect(senderFilterKey('human', 'u1')).toBe('u1');
  });
});
