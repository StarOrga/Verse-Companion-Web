import type { PatchOutline, PatchOutlineNode } from './patch-outline';
import { extractFixed, extractImages, extractPrep, parsePrepLine, prepTone } from './patch-prep';

function node(kind: PatchOutlineNode['kind'], text: string, depth = 0): PatchOutlineNode {
  return { kind, text, depth };
}

function outline(nodes: PatchOutlineNode[]): PatchOutline {
  return { slug: 'x', subject: 'x', nodes, bulletCount: nodes.filter((n) => n.kind === 'bullet').length, truncated: false };
}

describe('extractPrep — "wie bereite ich mich vor" from the note itself', () => {
  const LIVE = outline([
    node('heading', 'Star Citizen Alpha Patch 4.10 LIVE'),
    node('text', 'Alpha Patch 4.10 has now been released onto the LIVE environment!'),
    node('subheading', 'Important Build Info'),
    node('bullet', 'Long Term Persistence: Preserved'),
    node('bullet', 'Starting aUEC: 20,000'),
    node('heading', 'Features and Gameplay'),
    node('bullet', 'Siege of Orison V2'),
    node('heading', 'Known Issues'),
    node('bullet', 'Quantum travel may desync in a party of 4+'),
    node('bullet', 'Elevators occasionally refuse to arrive'),
  ]);

  it('reads the Label: Value lines under the build-info heading and tones them', () => {
    const prep = extractPrep(LIVE)!;
    expect(prep.items.map((i) => i.label)).toEqual(['Long Term Persistence', 'Starting aUEC']);
    expect(prep.items[0].tone).toBe('kept');
    expect(prep.items[1].tone).toBe('neutral');
    expect(prep.wipe).toBe(false);
  });

  it('collects known issues and testing focus, capped', () => {
    const prep = extractPrep(LIVE)!;
    expect(prep.knownIssues.length).toBe(2);
    expect(prep.testingFocus).toEqual([]);

    const ptu = outline([
      node('heading', 'Testing Focus'),
      ...Array.from({ length: 12 }, (_, i) => node('bullet', `Focus ${i}`)),
      node('heading', 'Known Issues'),
    ]);
    expect(extractPrep(ptu)!.testingFocus.length).toBe(8);
  });

  it('flags a wipe loudly', () => {
    const wipe = outline([
      node('heading', 'Important Build Info'),
      node('bullet', 'Long Term Persistence: Wipe'),
      node('bullet', 'Reputation: Reset'),
      node('bullet', 'Starting aUEC: 20,000'),
    ]);
    const prep = extractPrep(wipe)!;
    expect(prep.wipe).toBe(true);
    expect(prep.items.map((i) => i.tone)).toEqual(['wiped', 'wiped', 'neutral']);
  });

  it('is null for a note without any preparation block', () => {
    expect(extractPrep(outline([node('heading', 'Features'), node('bullet', 'Thing')]))).toBeNull();
    expect(extractPrep(null)).toBeNull();
  });

  it('stops at the next heading so feature bullets never become facts', () => {
    const prep = extractPrep(LIVE)!;
    expect(prep.items.some((i) => /orison/i.test(i.label))).toBe(false);
  });
});

describe('parsePrepLine / prepTone', () => {
  it('parses a colon line and rejects prose', () => {
    expect(parsePrepLine('Starting aUEC: 20,000')).toEqual({ label: 'Starting aUEC', value: '20,000', tone: 'neutral' });
    expect(parsePrepLine('This is just a sentence without a fact')).toBeNull();
  });

  it('tones by wording', () => {
    expect(prepTone('Preserved')).toBe('kept');
    expect(prepTone('Full wipe')).toBe('wiped');
    expect(prepTone('Carried over, no wipe')).toBe('kept');
    expect(prepTone('20,000')).toBe('neutral');
  });
});

describe('extractFixed / extractImages', () => {
  const outline = {
    slug: 's', subject: 'x', truncated: false, bulletCount: 3,
    nodes: [
      { kind: 'heading', text: 'Features', depth: 0 },
      { kind: 'bullet', text: 'A feature', depth: 0 },
      { kind: 'heading', text: 'Bug Fixes', depth: 0 },
      { kind: 'subheading', text: 'Ships', depth: 0 },
      { kind: 'bullet', text: 'Fixed a crash', depth: 0, links: ['https://example.test/shot.png?x=1', 'https://example.test/page'] },
      { kind: 'heading', text: 'Known Issues', depth: 0 },
      { kind: 'bullet', text: 'Not a fix', depth: 0 },
    ],
  } as PatchOutline;

  it('reads the Bug Fixes block up to the next heading, skipping area labels', () => {
    expect(extractFixed(outline)).toEqual(['Fixed a crash']);
    expect(extractFixed(null)).toEqual([]);
  });

  it('collects image links only, once each', () => {
    expect(extractImages(outline)).toEqual(['https://example.test/shot.png?x=1']);
  });
});
