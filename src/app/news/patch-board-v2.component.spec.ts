import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { ConsentService } from '../core/consent.service';
import { NewsService, VerseFeed, VerseNewsItem } from './news.service';
import { PatchBoardV2Component } from './patch-board-v2.component';
import type { PatchOutline } from './patch-outline';
import type { RoadmapPayload } from './roadmap';
import { RoadmapService } from './roadmap.service';
import deCatalog from '../../../public/i18n/de.json';

function note(id: string, title: string, publishedAt: string): VerseNewsItem {
  return {
    id, title, publishedAt, channel: 'patch', source: 'patch-notes',
    url: `https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/${id}`,
  };
}

const FEED = {
  status: null,
  fetchedAt: new Date().toISOString(),
  news: [
    note('l49', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-06-01T10:00:00Z'),
    note('l410', 'Star Citizen Alpha 4.10 LIVE Release Notes', '2026-09-01T10:00:00Z'),
    note('l4103', 'Star Citizen Alpha 4.10.3 LIVE Release Notes', '2026-11-10T10:00:00Z'),
    note('p50a', 'Star Citizen Alpha 5.0 PTU Patch Notes (wave 1)', '2026-11-12T10:00:00Z'),
    note('p50b', 'Star Citizen Alpha 5.0 PTU Patch Notes (wave 2)', '2026-11-18T10:00:00Z'),
  ],
} as unknown as VerseFeed;

const ROADMAP: RoadmapPayload = {
  current: null,
  next: {
    id: 'n', name: '5.0', quarter: 'Q4 2026', status: 'tentative', patchLine: '5.0',
    cards: [
      { id: 'a', slug: 'a', name: 'Alpha item', description: '', body: '', status: 'committed', category: 'Gameplay', thumbnail: 'https://cdn.example/a.jpg' },
      { id: 'b', slug: 'b', name: 'Beta item', description: '', body: '', status: 'tentative', category: 'Ships', thumbnail: null },
    ],
  },
  later: [], liveVersion: '4.10', ptuVersion: '5.0', boardUrl: '', updatedAt: '',
};

const OUTLINE: PatchOutline = {
  slug: 'l4103', subject: 'x', truncated: false, bulletCount: 1,
  nodes: [{ kind: 'heading', text: 'Features', depth: 0 }, { kind: 'bullet', text: 'Headline change of the hotfix', depth: 0 }],
};

function roadmapStub(payload: RoadmapPayload | null) {
  const outlines = signal<ReadonlyMap<string, PatchOutline>>(new Map([['l4103', OUTLINE]]));
  return {
    roadmap: signal(payload), loading: signal(false), unavailable: signal(false), outlines, pending: signal<ReadonlySet<string>>(new Set()),
    hasRoadmap: () => payload !== null, loadedOutlineCount: () => outlines().size, loadRoadmap: () => Promise.resolve(),
    requestOutlines: () => undefined, hasOutline: (s: string) => outlines().has(s), outlineFor: (s: string) => outlines().get(s) ?? null,
    isPending: () => false, isMissing: () => false,
  };
}

describe('Patch board v2 — Live first', () => {
  let fixture: ComponentFixture<PatchBoardV2Component>;

  async function render(url = '/verse/patches'): Promise<void> {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PatchBoardV2Component],
      providers: [
        provideTranslateService(),
        provideRouter([{ path: 'verse/patches', children: [] }]),
        NewsService,
        { provide: HttpClient, useValue: { get: () => of(FEED) } },
        { provide: ConsentService, useValue: { preferencesAllowed: () => false, statisticsAllowed: () => false } },
        { provide: RoadmapService, useValue: roadmapStub(ROADMAP) },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', deCatalog);
    translate.use('de');
    await TestBed.inject(Router).navigateByUrl(url);
    fixture = TestBed.createComponent(PatchBoardV2Component);
    fixture.detectChanges();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
    localStorage.clear();
  });

  const root = () => fixture.nativeElement as HTMLElement;
  const text = (sel: string) => root().querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('opens on Live: newest live note in the header, newest unread, next line to the right', async () => {
    await render();
    expect(text('.box.now')).toContain('Gerade auf Live gekommen');
    expect(text('.box.now .ver')).toContain('4.10.3');
    expect(text('.box.now .newbadge')).toBe('Neu für dich');
    expect(text('.box.now .list')).toContain('Headline change of the hotfix');
    expect(text('.box.next')).toContain('Alpha 5.0');
    expect(text('.box.next .when')).toContain('Kein offizielles Datum');
  });

  it('confirming keeps the content and swaps the badge for a read note with a way back', async () => {
    await render();
    (root().querySelector('.box.now .acts button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root().querySelector('.box.now .newbadge')).toBeNull();
    expect(text('.box.now .list')).toContain('Headline change');
    expect(text('.box.now .readnote')).toContain('gelesen am');
    const again = Array.from(root().querySelectorAll('.box.now .acts button')).find((b) => b.textContent?.includes('Nochmal lesen')) as HTMLButtonElement;
    again.click();
    fixture.detectChanges();
    expect(root().querySelector('.box.now .newbadge')).not.toBeNull();
  });

  it('roadmap: one line of chips for the statuses the data has, a click opens a compact list, Escape closes it', async () => {
    await render();
    const chips = Array.from(root().querySelectorAll('.chip')).map((c) => c.textContent?.replace(/\s+/g, ' ').trim());
    expect(chips).toEqual(['1 Bestätigt', '1 Möglich']);
    expect(root().textContent).not.toContain('Verschoben');
    (root().querySelector('.chip') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(text('.pop')).toContain('Alpha item');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(root().querySelector('.pop')).toBeNull();
  });

  it('timeline: Live card carries the newest sub-version, the stack holds next, live, last', async () => {
    await render();
    const rows = Array.from(root().querySelectorAll('.tl > .row:not(.fold)')) as HTMLElement[];
    expect(rows.map((r) => r.dataset['status'])).toEqual(['ptu', 'live', 'superseded']);
    expect(rows[1].querySelector('.sv.top .sl')?.textContent).toContain('4.10.3');
    expect(rows[1].querySelector('.bundle')?.textContent).toContain('1 frühere Updates');
    expect(rows[0].querySelector('.pill')?.textContent).toContain('Als Nächstes');
    // next row links to the PTU tab, never to a dossier
    expect(rows[0].querySelector('a.card-link')?.getAttribute('href')).toContain('view=ptu');
  });

  it('PTU tab (?view=ptu): every build is its own row, newest expanded, only test builds', async () => {
    await render('/verse/patches?view=ptu');
    const rows = Array.from(root().querySelectorAll('.tl > .row')) as HTMLElement[];
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Welle 2');
    expect(rows[1].textContent).toContain('Welle 1');
    expect(rows[0].querySelector('.subs')).not.toBeNull();
    expect(rows[1].querySelector('.subs')).toBeNull();
    (rows[1].querySelector('button.ch') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(rows[1].querySelector('.subs')).not.toBeNull();
    expect(root().querySelector('.box.now')).toBeNull();
    expect(root().querySelector('.switch a.ptu')?.getAttribute('aria-current')).toBe('page');
  });
});
