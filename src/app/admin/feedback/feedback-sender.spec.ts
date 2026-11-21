import { POSTHOG_GUARD_PROFILE_ID } from '../../feedback/feedback.types';
import { senderFilterKey, senderNameKey, senderOf, senderTitleKey } from './feedback-sender';

describe('feedback sender (#390)', () => {
  it('names machine items by their guard, not as unknown', () => {
    expect(senderOf('posthog', null)).toBe('posthog');
    expect(senderOf('service', null)).toBe('service');
    expect(senderOf(null, POSTHOG_GUARD_PROFILE_ID)).toBe('posthog');
    expect(senderNameKey('posthog')).toBe('adminFeedback.guard.name');
    expect(senderNameKey('service')).toBe('adminFeedback.guard.serviceName');
    expect(senderTitleKey('service')).toBe('adminFeedback.guard.serviceTitle');
    expect(senderTitleKey('posthog')).toBe('adminFeedback.guard.title');
  });

  it('falls back to "no account" only for a human row without an author', () => {
    expect(senderOf('human', null)).toBe('none');
    expect(senderOf(undefined, null)).toBe('none');
    expect(senderNameKey('none')).toBe('adminFeedback.noAccount');
    expect(senderOf('human', 'u1')).toBe('person');
    expect(senderNameKey('person')).toBeNull();
  });

  it('keeps one filter bucket per sender', () => {
    const keys = new Set([
      senderFilterKey('posthog', null),
      senderFilterKey('service', null),
      senderFilterKey('human', null),
      senderFilterKey('human', 'u1'),
    ]);
    expect(keys.size).toBe(4);
    expect(senderFilterKey('human', 'u1')).toBe('u1');
  });
});
