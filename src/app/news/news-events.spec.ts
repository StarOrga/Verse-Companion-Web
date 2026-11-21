import { daysUntil, eventPhase, eventStem, eventTeaser, isEventNews, type VerseEvent } from './news-events';

const NOW = Date.parse('2026-11-21T14:00:00Z');

function ev(id: string, start: string, end: string, extra: Partial<VerseEvent> = {}): VerseEvent {
  return {
    id, kind: 'expo', name: id, start, end, dateStatus: 'confirmed', freeFly: false, url: '',
    summary: { en: '', de: '' }, ...extra,
  };
}

describe('news events (feedback #389)', () => {
  it('classifies event posts by their title', () => {
    expect(isEventNews({ title: 'Intergalactic Aerospace Expo 2956 Free Fly', channel: 'comm-link' })).toBe(true);
    expect(isEventNews({ title: 'Luminalia 2956', channel: 'youtube' })).toBe(true);
    expect(isEventNews({ title: 'XenoThreat returns to Stanton', channel: 'spectrum' })).toBe(true);
    expect(isEventNews({ title: 'New dynamic event: Hathor', channel: 'comm-link' })).toBe(true);
    expect(isEventNews({ title: 'This Week in Star Citizen', channel: 'comm-link' })).toBe(false);
    expect(isEventNews({ title: 'Roadmap Roundup: IAE prep', channel: 'comm-link' })).toBe(false);
  });

  it('never counts patch notes or status lines as event posts', () => {
    expect(isEventNews({ title: 'Alpha 4.4 Luminalia Hotfix', channel: 'patch' })).toBe(false);
    expect(isEventNews({ title: 'Free Fly maintenance', channel: 'status' })).toBe(false);
  });

  it('matches a curated timeline name without its year', () => {
    expect(eventStem('Stormfall Gala 2956')).toBe('stormfall gala');
    expect(isEventNews({ title: 'The Stormfall Gala is here', channel: 'comm-link' }, ['stormfall gala'])).toBe(true);
    expect(isEventNews({ title: 'The Stormfall Gala is here', channel: 'comm-link' })).toBe(false);
  });

  it('dates the phases in UTC days, end day inclusive', () => {
    expect(eventPhase(ev('a', '2026-11-20', '2026-11-21'), NOW)).toBe('running');
    expect(eventPhase(ev('b', '2026-11-22', '2026-11-30'), NOW)).toBe('upcoming');
    expect(eventPhase(ev('c', '2026-11-01', '2026-11-20'), NOW)).toBe('past');
    expect(daysUntil('2026-11-24', NOW)).toBe(3);
  });

  it('teases running events ending first and upcoming events soonest first, within the horizon', () => {
    const t = eventTeaser([
      ev('late-run', '2026-11-10', '2026-12-03'),
      ev('soon-end', '2026-11-15', '2026-11-25'),
      ev('next', '2026-12-10', '2026-12-22'),
      ev('first', '2026-11-28', '2026-11-29'),
      ev('far', '2027-08-01', '2027-08-10'),
      ev('over', '2026-10-01', '2026-10-05'),
    ], NOW);
    expect(t.running.map((e) => e.id)).toEqual(['soon-end', 'late-run']);
    expect(t.upcoming.map((e) => e.id)).toEqual(['first', 'next']);
  });
});
