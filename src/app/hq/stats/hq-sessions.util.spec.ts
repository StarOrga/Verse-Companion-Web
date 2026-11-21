import { groupSessions } from './hq-sessions.util';

const ev = (type: string, at: string, data: Record<string, unknown> = {}) => ({ type, at: `2026-11-10T${at}:00.000Z`, data });

describe('groupSessions (#896)', () => {
  it('one card per session with duration, jumps, contracts, aUEC and losses, newest first', () => {
    const s = groupSessions(
      [
        ev('session.joined', '10:00'),
        ev('qt.arrived', '10:10'),
        ev('qt.arrived', '10:20'),
        ev('contract.completed', '10:30'),
        ev('shop.purchase', '10:40', { kind: 'buy', price: 1000 }),
        ev('shop.purchase', '10:50', { kind: 'sell', price: '2500' }),
        ev('incapacitated', '10:55'),
        ev('vehicle.destroyed', '10:56'),
        ev('insurance.claim_complete', '10:58'),
        ev('session.quit', '11:00'),
        ev('session.joined', '12:00'),
        ev('session.quit', '12:30'),
      ],
      false,
    );
    expect(s.length).toBe(2);
    expect(s[0].startedAt).toBe('2026-11-10T12:00:00.000Z');
    const first = s[1];
    expect(first.durationMs).toBe(60 * 60 * 1000);
    expect(first.end).toBe('quit');
    expect([first.jumps, first.contracts, first.auecNet, first.deaths, first.shipsLost, first.claims]).toEqual([2, 1, 1500, 1, 1, 1]);
    expect(first.traded).toBe(true);
    expect(s[0].traded).toBe(false);
  });

  it('a session without a quit (crash) closes at its last event; a following join starts a new one', () => {
    const s = groupSessions(
      [ev('session.joined', '10:00'), ev('qt.arrived', '10:30'), ev('session.joined', '11:00'), ev('disconnect', '11:15')],
      false,
    );
    expect(s.map((x) => x.end)).toEqual(['quit', 'noQuit']);
    expect(s[1].endedAt).toBe('2026-11-10T10:30:00.000Z');
    expect(s[1].durationMs).toBe(30 * 60 * 1000);
  });

  it('the open newest session is live while the game runs, else it ended without a quit', () => {
    const events = [ev('session.joined', '10:00'), ev('qt.arrived', '10:20')];
    expect(groupSessions(events, true)[0].end).toBe('live');
    expect(groupSessions(events, false)[0].end).toBe('noQuit');
  });

  it('events before any join (app attached late) form a session with an unknown start', () => {
    const s = groupSessions([ev('qt.arrived', '09:00'), ev('contract.completed', '09:30'), ev('session.quit', '09:45')], false);
    expect(s.length).toBe(1);
    expect(s[0].startUnknown).toBe(true);
    expect(s[0].startedAt).toBe('2026-11-10T09:00:00.000Z');
    expect(s[0].contracts).toBe(1);
  });

  it('input order does not matter and a stray quit opens nothing', () => {
    const s = groupSessions([ev('session.quit', '11:00'), ev('session.quit', '08:00'), ev('session.joined', '10:00')], false);
    expect(s.length).toBe(1);
    expect(s[0].durationMs).toBe(60 * 60 * 1000);
  });

  it('counts the costs of a session: fines with their aUEC sum, injuries, medbed heals, claim requests (#1192)', () => {
    const [s0] = groupSessions(
      [
        ev('session.joined', '10:00'),
        ev('crime.fined', '10:05', { amount: 1500, key: 'k' }),
        ev('crime.fined', '10:06', { amount: '3000', key: 'k' }),
        ev('crime.fined', '10:07', { amount: 'garbage' }),
        ev('injury', '10:10', { severity: 'minor' }),
        ev('medbed.healed', '10:20', { parts: ['arm'] }),
        ev('insurance.claim_requested', '10:30', { requestId: 'r1' }),
        ev('session.quit', '11:00'),
      ],
      false,
    );
    expect([s0.fines, s0.fineAmount, s0.injuries, s0.medbeds, s0.claimRequests]).toEqual([3, 4500, 1, 1, 1]);
    expect([s0.deaths, s0.shipsLost, s0.claims]).toEqual([0, 0, 0]);
  });

  it('a session without cost events counts zero costs, and a negative amount adds nothing', () => {
    const [quiet] = groupSessions([ev('session.joined', '10:00'), ev('qt.arrived', '10:10'), ev('session.quit', '10:30')], false);
    expect([quiet.fines, quiet.fineAmount, quiet.injuries, quiet.medbeds, quiet.claimRequests]).toEqual([0, 0, 0, 0, 0]);
    const [neg] = groupSessions([ev('session.joined', '10:00'), ev('crime.fined', '10:10', { amount: -50 }), ev('session.quit', '10:30')], false);
    expect([neg.fines, neg.fineAmount]).toEqual([1, 0]);
  });
});
