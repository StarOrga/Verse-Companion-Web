import { groupPatchNotes } from './patch-notes';
import { cardImage, channelTimes, headlineBullets, liveLineView, previewCards, ptuRows, roadmapChips, waveOf } from './patch-board-model';
import type { PatchOutline } from './patch-outline';
import type { SubVersionRow } from './patch-timeline';
import type { RoadmapCard } from './roadmap';
import type { VerseNewsItem } from './news.service';
import { buildPatchStack } from './patch-stack';

function note(id: number, title: string, publishedAt: string, images?: string[]): VerseNewsItem {
  return {
    id: String(id), title, url: `https://robertsspaceindustries.com/spectrum/community/SC/forum/3/thread/t-${id}`,
    publishedAt, channel: 'patch', source: 'patch-notes', ...(images ? { images } : {}),
  };
}

const items: VerseNewsItem[] = [
  note(1, 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-06-01T10:00:00Z'),
  note(2, 'Star Citizen Alpha 4.10 LIVE Release Notes', '2026-09-01T10:00:00Z', ['https://x/4-10.jpg']),
  note(3, 'Star Citizen Alpha 4.10.3 LIVE Release Notes', '2026-11-10T10:00:00Z'),
  note(4, 'Star Citizen Alpha 5.0 PTU Patch Notes (wave 1)', '2026-11-12T10:00:00Z'),
  note(5, 'Star Citizen Alpha 5.0 PTU Patch Notes (wave 2)', '2026-11-18T10:00:00Z'),
];

function row(version: string, stage: SubVersionRow['stage'], publishedAt: string): SubVersionRow {
  return { id: version, version, title: version, stage, hotfix: false, publishedAt, url: '', stability: null, level: null, older: false };
}

function rc(id: string, status: RoadmapCard['status'], thumbnail: string | null = null): RoadmapCard {
  return { id, slug: id, name: id, description: '', body: '', status, category: '', thumbnail };
}

describe('patch board model', () => {
  const groups = groupPatchNotes(items);

  it('splits channels: live notes vs test builds', () => {
    expect(channelTimes(groups, 'live').length).toBe(3);
    expect(channelTimes(groups, 'ptu').length).toBe(2);
  });

  it('live line view: newest live note on top, the earlier ones bundled, test builds excluded', () => {
    const v = liveLineView([row('4.10.3', 'live', 'c'), row('4.10.2', 'live', 'b'), row('4.10.1', 'ptu', 'a'), row('4.10', 'live', 'z')]);
    expect(v.latest?.version).toBe('4.10.3');
    expect(v.earlier.map((r) => r.version)).toEqual(['4.10.2', '4.10']);
    expect(liveLineView([]).latest).toBeNull();
  });

  it('PTU tab: every build of the line in testing is its own row, wave counted, newest first', () => {
    const rows = ptuRows(groups);
    expect(rows.map((r) => r.wave)).toEqual([2, 1]);
    expect(rows[0].newest).toBe(true);
    expect(rows[1].newest).toBe(false);
    expect(rows.every((r) => r.line === '5.0')).toBe(true);
  });

  it('the wave is the one RSI names in the title, never a build count', () => {
    expect(waveOf('[Wave 3] Star Citizen Alpha 5.0 PTU Patch Notes 13228337')).toBe(3);
    expect(waveOf('[All Waves] Star Citizen Alpha 4.10.3 PTU Patch Notes')).toBeNull();
    expect(waveOf('Star Citizen Alpha 5.0 PTU Patch Notes')).toBeNull();
  });

  it('headline bullets skip the build facts (wipe, starting money)', () => {
    const outline = {
      nodes: [
        { kind: 'heading', text: 'Important Build Info', depth: 0 },
        { kind: 'bullet', text: 'Long Term Persistence: Preserved', depth: 0 },
        { kind: 'bullet', text: 'Starting aUEC: 20,000', depth: 0 },
        { kind: 'heading', text: 'New Features', depth: 0 },
        { kind: 'bullet', text: 'LBCO Skarnov Rifle', depth: 0 },
      ],
    } as unknown as PatchOutline;
    expect(headlineBullets(outline)).toEqual(['LBCO Skarnov Rifle']);
  });

  it('card image falls back from note image to roadmap thumbnail to null', () => {
    const stack = buildPatchStack(groups, null);
    expect(cardImage(stack.live!)).toBe('https://x/4-10.jpg');
    expect(cardImage(stack.last!)).toBeNull();
    const withRelease = { ...stack.last!, release: { id: 'r', name: '4.9', quarter: '', status: 'released', patchLine: '4.9', cards: [rc('a', 'released', 'https://x/t.jpg')] } } as typeof stack.last & object;
    expect(cardImage(withRelease)).toBe('https://x/t.jpg');
  });

  it('roadmap chips only for statuses the data carries — no invented categories', () => {
    const cards = [rc('a', 'committed'), rc('b', 'committed'), rc('c', 'tentative'), rc('d', 'unknown')];
    expect(roadmapChips(cards)).toEqual([{ bucket: 'committed', count: 2 }, { bucket: 'tentative', count: 1 }]);
    expect(roadmapChips([])).toEqual([]);
  });

  it('preview lines: confirmed first, capped', () => {
    const cards = [rc('t1', 'tentative'), rc('c1', 'committed'), rc('c2', 'committed'), rc('t2', 'tentative'), rc('c3', 'committed')];
    expect(previewCards(cards, 4).map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 't1']);
  });

  it('headline bullets: content before fixes, top level only, capped', () => {
    const outline: PatchOutline = {
      slug: 's', subject: '', bulletCount: 5, truncated: false,
      nodes: [
        { kind: 'heading', text: 'Bug Fixes', depth: 0 },
        { kind: 'bullet', text: 'Fixed a crash', depth: 0 },
        { kind: 'heading', text: 'Gameplay', depth: 0 },
        { kind: 'bullet', text: 'New mission', depth: 0 },
        { kind: 'bullet', text: 'nested', depth: 1 },
        { kind: 'bullet', text: 'Second', depth: 0 },
      ],
    };
    expect(headlineBullets(outline, 3)).toEqual(['New mission', 'Second', 'Fixed a crash']);
    expect(headlineBullets(null)).toEqual([]);
  });
});
