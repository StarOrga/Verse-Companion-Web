import {
  BACKOFF_DAYS,
  DAY_MS,
  EMPTY_INSTALL_STATE,
  EligibilityInput,
  SESSION_GAP_MS,
  backoffActive,
  isEligible,
  isSuccessEvent,
  withSessionTick,
} from './install-policy';

describe('isSuccessEvent', () => {
  it('accepts success verbs and nothing else', () => {
    for (const n of ['hangar:ship_add', 'hangar:fleet_import', 'verse:starscape_share', 'feedback:report_submit', 'verse:star_earn', 'hangar:loadout_create'])
      expect(isSuccessEvent(n), n).toBe(true);
    for (const n of ['app:error_show', 'hangar:ship_remove', 'codex:page_view', 'search:query_search', 'settings:beta_toggle', 'codex:item_select', 'app:install_finish', 'verse:door_open', 'x'])
      expect(isSuccessEvent(n), n).toBe(false);
  });
});

describe('backoffActive', () => {
  const T = 1_000_000_000_000;
  it('is off without dismissals', () => expect(backoffActive({ dismissals: 0, lastDismissedAt: null }, T)).toBe(false));
  it('runs 14 / 45 / 120 days after the 1st / 2nd / 3rd dismissal', () => {
    BACKOFF_DAYS.forEach((days, i) => {
      const st = { dismissals: i + 1, lastDismissedAt: T };
      expect(backoffActive(st, T + days * DAY_MS - 1)).toBe(true);
      expect(backoffActive(st, T + days * DAY_MS)).toBe(false);
    });
  });
  it('never ends after a 4th dismissal', () => expect(backoffActive({ dismissals: 4, lastDismissedAt: 0 }, 1e15)).toBe(true));
});

describe('withSessionTick', () => {
  it('counts the first visit and any visit after 30 min of silence, not a quick reload', () => {
    let st = withSessionTick(EMPTY_INSTALL_STATE, 1000);
    expect(st.sessions).toBe(1);
    st = withSessionTick(st, 1000 + SESSION_GAP_MS - 1);
    expect(st.sessions).toBe(1);
    st = withSessionTick(st, 1000 + SESSION_GAP_MS - 1 + SESSION_GAP_MS);
    expect(st.sessions).toBe(2);
  });
});

describe('isEligible', () => {
  const base = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
    state: { ...EMPTY_INSTALL_STATE, sessions: 2 },
    now: 5e12,
    trigger: 'success',
    platform: 'android-native',
    installable: true,
    standalone: false,
    coarsePointer: true,
    signedInShellRoute: true,
    shownThisSession: false,
    ...over,
  });
  it('passes when every gate is open', () => expect(isEligible(base())).toBe(true));
  it('fails on each closed gate', () => {
    expect(isEligible(base({ standalone: true }))).toBe(false);
    expect(isEligible(base({ coarsePointer: false }))).toBe(false);
    expect(isEligible(base({ signedInShellRoute: false }))).toBe(false);
    expect(isEligible(base({ shownThisSession: true }))).toBe(false);
    expect(isEligible(base({ platform: 'other' }))).toBe(false);
    expect(isEligible(base({ installable: false }))).toBe(false);
    expect(isEligible(base({ state: { ...EMPTY_INSTALL_STATE, sessions: 1 } }))).toBe(false);
    expect(isEligible(base({ state: { ...EMPTY_INSTALL_STATE, sessions: 2, installed: true } }))).toBe(false);
    expect(isEligible(base({ state: { ...EMPTY_INSTALL_STATE, sessions: 2, dismissals: 1, lastDismissedAt: 5e12 - DAY_MS } }))).toBe(false);
  });
  it('the idle fallback needs the 4th session; manual needs nothing', () => {
    expect(isEligible(base({ trigger: 'idle' }))).toBe(false);
    expect(isEligible(base({ trigger: 'idle', state: { ...EMPTY_INSTALL_STATE, sessions: 4 } }))).toBe(true);
    expect(isEligible(base({ trigger: 'manual', standalone: true, coarsePointer: false }))).toBe(true);
  });
});
