import { baselineCutoff, isRead, parseReadState, serializeReadState, unreadCount, withRead, withUnread } from './patch-read';

describe('patch read state', () => {
  const times = [100, 300, 200];

  it('first contact: history is read, the newest note is not', () => {
    const upTo = baselineCutoff(times);
    expect(upTo).toBe(200);
    const st = { live: { upTo, at: null } };
    expect(isRead(st, 'live', 200)).toBe(true);
    expect(isRead(st, 'live', 300)).toBe(false);
    expect(unreadCount(st, 'live', times)).toBe(1);
  });

  it('a single note is unread at first contact', () => {
    expect(baselineCutoff([500])).toBe(0);
    expect(isRead({ live: { upTo: 0, at: null } }, 'live', 500)).toBe(false);
  });

  it('confirming reads everything up to the newest and records when', () => {
    const st = withRead({ live: { upTo: 200, at: null } }, 'live', times, 999);
    expect(st.live).toEqual({ upTo: 300, at: 999 });
    expect(unreadCount(st, 'live', times)).toBe(0);
  });

  it('marking unread again reopens only the note and what is newer', () => {
    const st = withUnread({ live: { upTo: 300, at: 5 } }, 'live', 300, times);
    expect(st.live).toEqual({ upTo: 200, at: null });
    expect(withUnread({}, 'ptu', 100, times).ptu?.upTo).toBe(0);
  });

  it('an unknown channel counts as read (no dots before the baseline is written)', () => {
    expect(isRead({}, 'ptu', 123)).toBe(true);
  });

  it('round-trips and survives garbage', () => {
    const st = { live: { upTo: 1, at: 2 }, ptu: { upTo: 3, at: null } };
    expect(parseReadState(serializeReadState(st))).toEqual(st);
    expect(parseReadState('{nope')).toEqual({});
    expect(parseReadState(42)).toEqual({});
    expect(parseReadState('{"live":{"upTo":"x"}}')).toEqual({});
  });

  it('channels are independent', () => {
    const st = withRead({ ptu: { upTo: 10, at: null } }, 'live', times, 1);
    expect(st.ptu?.upTo).toBe(10);
  });
});
