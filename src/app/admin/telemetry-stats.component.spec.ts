import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { FeedbackFabPrefsService } from '../core/feedback-fab-prefs.service';
import { FeedbackComposerSeedService } from '../feedback/feedback-composer-seed.service';
import { draftScopes } from '../feedback/feedback-draft.types';
import { FakeCall, FakeResult, fakeSupabase } from '../testing/fake-supabase';
import { TelemetryStatsComponent } from './telemetry-stats.component';
import { mergeRefresh, sortCards, sparkPoints, topicsByTitle, type Overview, type OverviewCard } from './telemetry-overview';

const P = 'https://eu.posthog.com/project/7';
const FB = (title: string) => ({ title, body: `${title}\n\nProblem\n\nPostHog: ${P}/x` });

/** Screen r2-d1-s1 „Mit Handlungsbedarf“ as the server answers it (order: error, warn, ok). */
const ATTENTION: Overview = {
  generatedAt: '2026-11-15T01:40:00.000Z',
  lastVisitAt: '2026-11-10T20:40:00.000Z',
  posthogReachable: true,
  attention: 3,
  quotas: [],
  cards: [
    {
      id: 'errors', level: 'error', kpi: { value: 4, display: '4', unitKey: 'newErrors' }, boardWaiting: 1, calmKey: 'errorsCalm',
      top: [
        { label: 'TypeError in Hangar-Schiffsseite', value: '9×', badge: 'web', level: 'warn', url: `${P}/error_tracking/a`, feedback: FB('Fehler: TypeError') },
        { label: 'patch-teaser: Claude überlastet', value: '12×', badge: 'server', level: 'warn', url: `${P}/error_tracking/b`, feedback: FB('Fehler: patch-teaser') },
        { label: 'Uploader: zstd-Fehler', value: '5×', badge: 'desktop', level: 'warn', url: `${P}/error_tracking/c`, feedback: FB('Fehler: zstd') },
      ],
      links: [{ labelKey: 'errorTracking', url: `${P}/error_tracking` }],
    },
    {
      id: 'quota', level: 'warn', kpi: { value: 84, display: '84 %', unitKey: 'quotaPct' }, forecast: { display: '168 %', pct: 168 },
      bar: { pct: 84, monthPct: 50 }, calmKey: 'quotaCalm', upgradeUrl: 'https://eu.posthog.com/organization/billing',
      feedbackCta: FB('PostHog-Kontingent: Ereignisse sparen'),
      top: [{ label: 'Ereignisse', value: '84 % · Prognose 168 %', level: 'warn', url: 'https://eu.posthog.com/organization/billing', feedback: FB('PostHog-Kontingent: Ereignisse') }],
      links: [{ labelKey: 'billing', url: 'https://eu.posthog.com/organization/billing' }],
    },
    {
      id: 'services', level: 'warn', kpi: { value: 1, display: '1/8', unitKey: 'servicesDown' }, calmKey: 'servicesCalm',
      top: [{ label: 'uex', value: '25 % Fehler', level: 'warn', badge: 'server', feedback: FB('Dienst uex: auffällig') }],
      links: [{ labelKey: 'serviceHealth', url: `${P}/error_tracking` }],
    },
    {
      id: 'usage', level: 'ok', kpi: { value: 142, display: '142', unitKey: 'activeUsers' }, delta: { value: 12, unit: 'pct', better: 'up' },
      spark: [10, 12, 11, 15, 16, 18, 20], calmKey: 'usageCalm',
      top: [{ label: '/codex', value: '+18', badge: 'web' }],
      links: [{ labelKey: 'webAnalytics', url: `${P}/web` }, { labelKey: 'dashboards', url: `${P}/dashboard` }],
    },
    { id: 'ai', level: 'ok', kpi: { value: 6.4, display: '$6.40', unitKey: 'aiCostUsd' }, forecast: { display: '$11.20' }, calmKey: 'aiCalm', top: [{ label: 'patch-teaser', value: '$0.62', badge: 'server' }], links: [{ labelKey: 'llmObservability', url: `${P}/llm-observability` }] },
    { id: 'desktop', level: 'ok', kpi: { value: 38, display: '38', unitKey: 'desktopInstalls' }, calmKey: 'desktopCalm', top: [], links: [{ labelKey: 'desktopEvents', url: `${P}/activity/explore` }] },
  ],
};

/** Screen r2-d1-s2 „Alles ruhig“: every card ok, no findings. */
const CALM: Overview = {
  ...ATTENTION,
  attention: 0,
  cards: ATTENTION.cards.map((c) => ({ ...c, level: 'ok' as const, top: [], feedbackCta: undefined, boardWaiting: 0, kpi: { ...c.kpi } })),
};

describe('TelemetryStatsComponent', () => {
  async function mount(answer: (call: FakeCall) => FakeResult | Promise<FakeResult>) {
    const fake = fakeSupabase({ answer });
    TestBed.configureTestingModule({
      providers: [fake.provider, provideRouter([{ path: '', component: TelemetryStatsComponent }]), provideTranslateService({ fallbackLang: 'en' })],
    });
    const harness = await RouterTestingHarness.create('/');
    await settle(harness);
    return { harness, fake, el: harness.routeNativeElement as HTMLElement };
  }

  async function settle(harness: RouterTestingHarness) {
    harness.detectChanges();
    await harness.fixture.whenStable();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    harness.detectChanges();
  }

  const invokes = (calls: FakeCall[]) => calls.filter((c) => c.op === 'invoke' && c.target === 'telemetry-overview');
  const answerWith = (o: Overview) => (call: FakeCall): FakeResult => (call.op === 'invoke' && (call.args as { method?: string }).method === 'POST' ? { data: { ok: true } } : { data: o });

  afterEach(() => TestBed.resetTestingModule());

  it('renders the six cards in the order the server sent them', async () => {
    const { el, fake } = await mount(answerWith(ATTENTION));
    const ids = Array.from(el.querySelectorAll('[data-card]')).map((c) => c.getAttribute('data-card'));
    expect(ids).toEqual(['errors', 'quota', 'services', 'usage', 'ai', 'desktop']);
    expect((invokes(fake.calls)[0].args as { method: string }).method).toBe('GET');
  });

  it('uses the singular sentence when exactly one card needs attention', async () => {
    const { el } = await mount(answerWith({ ...ATTENTION, attention: 1 }));
    const status = el.querySelector('[data-status]')!;
    expect(status.textContent).toContain('telemetry.status.attentionOne');
  });

  it('shows the attention strip with the since-line, level icon and a text alternative', async () => {
    const { el } = await mount(answerWith(ATTENTION));
    const status = el.querySelector('[data-status]')!;
    expect(status.className).toContain('st-attention');
    expect(status.textContent).toContain('telemetry.status.attention');
    expect(status.textContent).toContain('telemetry.status.since');
    const quota = el.querySelector('[data-card="quota"]')!;
    expect(quota.querySelector('.tick')!.textContent!.trim()).toBe('!');
    expect(quota.querySelector('.sc-sr-only')!.textContent).toContain('telemetry.level.warn');
    expect(el.querySelector('[data-card="errors"] .tick')!.textContent!.trim()).toBe('×');
  });

  it('draws the quota bar with the month marker, and the usage spark inline', async () => {
    const { el } = await mount(answerWith(ATTENTION));
    const bar = el.querySelector('[data-card="quota"] .bar')!;
    expect((bar.querySelector('span') as HTMLElement).style.width).toBe('84%');
    expect((bar.querySelector('i') as HTMLElement).style.left).toBe('50%');
    expect(el.querySelector('[data-card="usage"] svg.spark polyline')!.getAttribute('points')).toBe(sparkPoints(ATTENTION.cards[3].spark!));
    expect(el.querySelector('[data-card="usage"] .delta')!.textContent).toBe('+12 %');
  });

  it('lists the top three with badges and PostHog links as new-tab anchors', async () => {
    const { el } = await mount(answerWith(ATTENTION));
    const rows = el.querySelectorAll('[data-card="errors"] .list li');
    expect(rows.length).toBe(3);
    expect(Array.from(rows).map((r) => r.querySelector('.badge')!.textContent!.trim())).toEqual(['telemetry.badge.web', 'telemetry.badge.server', 'telemetry.badge.desktop']);
    const a = rows[0].querySelector('a.item-link') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe(`${P}/error_tracking/a`);
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener noreferrer');
    expect(el.querySelector('[data-card="errors"] .badge.board')!.textContent).toContain('telemetry.boardWaitingOne');
  });

  it('seeds the admin composer with the finding text when a top item becomes feedback', async () => {
    const { el, harness } = await mount(answerWith(ATTENTION));
    const seeds = TestBed.inject(FeedbackComposerSeedService);
    (el.querySelector('[data-card="errors"] .list li:nth-child(3) .to-fb') as HTMLButtonElement).click();
    await settle(harness);
    const seed = seeds.take(draftScopes.adminNew)!;
    expect(seed.body).toBe(FB('Fehler: zstd').body);
    expect(seed.body).toContain(`PostHog: ${P}`);
    expect(seed.area).toBe('desktop');
  });

  it('shows a checked speech bubble linking the topic a finding already became, and opens it in the panel', async () => {
    const topics = [
      { id: 'other', seq: 3, body: 'Something else' },
      { id: 'zstd-topic', seq: 358, body: `${FB('Fehler: zstd').body}\n\n[sc-view:holo]` },
    ];
    const { el, harness } = await mount((call) =>
      call.op === 'from' && call.target === 'admin_feedback' ? { data: topics } : answerWith(ATTENTION)(call));
    TestBed.inject(FeedbackFabPrefsService).setShow(true);
    const seeds = TestBed.inject(FeedbackComposerSeedService);
    const rows = el.querySelectorAll('[data-card="errors"] .list li');
    expect(rows[0].querySelector('button.to-fb')).not.toBeNull();
    const link = rows[2].querySelector('a.to-fb.done') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(rows[2].querySelector('button.to-fb')).toBeNull();
    expect(link.getAttribute('href')).toBe('/admin/feedback?topic=zstd-topic');
    expect(link.getAttribute('aria-label')).toBe('telemetry.openFeedback');
    link.click();
    await settle(harness);
    expect(seeds.takeTopic()).toBe('zstd-topic');
    expect(seeds.take(draftScopes.adminNew)).toBeNull();
  });

  it('looks for linked topics again once a board wrote a new one', async () => {
    let topics: { id: string; seq: number; body: string }[] = [];
    const { el, harness } = await mount((call) =>
      call.op === 'from' && call.target === 'admin_feedback' ? { data: topics } : answerWith(ATTENTION)(call));
    expect(el.querySelector('[data-card="errors"] a.to-fb.done')).toBeNull();
    topics = [{ id: 't1', seq: 1, body: FB('Fehler: TypeError').body }];
    TestBed.inject(FeedbackComposerSeedService).noteCreated();
    await settle(harness);
    expect(el.querySelector('[data-card="errors"] .list li:nth-child(1) a.to-fb.done')).not.toBeNull();
  });

  it('offers the quota card both CTAs: saving proposal as feedback and the plan link', async () => {
    const { el, harness } = await mount(answerWith(ATTENTION));
    const seeds = TestBed.inject(FeedbackComposerSeedService);
    const cta = el.querySelector('[data-card="quota"] .cta')!;
    const plan = cta.querySelector('a[href="https://eu.posthog.com/organization/billing"]') as HTMLAnchorElement;
    expect(plan.target).toBe('_blank');
    expect(cta.querySelectorAll('a[href="https://eu.posthog.com/organization/billing"]').length).toBe(1);
    (cta.querySelector('.cta-fb') as HTMLButtonElement).click();
    await settle(harness);
    expect(seeds.take(draftScopes.adminNew)!.body).toBe(FB('PostHog-Kontingent: Ereignisse sparen').body);
  });

  it('shows a calm card and the all-quiet strip when nothing needs attention', async () => {
    const { el } = await mount(answerWith(CALM));
    expect(el.querySelector('[data-status]')!.className).toContain('st-calm');
    expect(el.querySelector('[data-status]')!.textContent).toContain('telemetry.status.calm');
    expect(el.querySelector('[data-card="errors"] .calm')!.textContent).toContain('telemetry.calm.errorsCalm');
    expect(el.querySelector('[data-notice]')).toBeNull();
  });

  it('never shows the all-quiet strip when PostHog is unreachable, but a visible notice', async () => {
    const down: Overview = { ...CALM, posthogReachable: false, cards: CALM.cards.map((c) => (c.id === 'quota' || c.id === 'errors' ? { ...c, level: 'unknown' as const } : c)) };
    const { el } = await mount(answerWith(down));
    expect(el.querySelector('[data-notice="unreachable"]')!.textContent).toContain('telemetry.unavailable');
    expect(el.querySelector('[data-status]')!.className).toContain('st-blind');
    expect(el.querySelector('[data-status]')!.textContent).not.toContain('telemetry.status.calm');
    expect(el.querySelector('[data-card="quota"] .calm')!.textContent).toContain('telemetry.cardUnavailable');
  });

  it('shows an error state with retry, never the cards or an empty state, and recovers on retry', async () => {
    let fail = true;
    const { el, harness } = await mount((call) => (call.op === 'invoke' && (call.args as { method?: string }).method === 'POST' ? { data: { ok: true } } : fail ? { error: { message: 'x', status: 500 } } : { data: ATTENTION }));
    expect(el.querySelector('.state.err')!.textContent).toContain('telemetry.errorTitle');
    expect(el.querySelector('.state.err')!.textContent).toContain('errors.');
    expect(el.querySelector('[data-card]')).toBeNull();
    fail = false;
    (el.querySelector('.state.err button') as HTMLButtonElement).click();
    await settle(harness);
    expect(el.querySelector('.state.err')).toBeNull();
    expect(el.querySelectorAll('[data-card]').length).toBe(6);
  });

  it('posts seen once, after the cards were rendered', async () => {
    const { fake, harness } = await mount(answerWith(ATTENTION));
    await settle(harness);
    const posts = invokes(fake.calls).filter((c) => (c.args as { method: string }).method === 'POST');
    expect(posts.length).toBe(1);
    expect((posts[0].args as { body: unknown }).body).toEqual({ seen: true });
    expect(fake.calls.indexOf(posts[0])).toBeGreaterThan(fake.calls.indexOf(invokes(fake.calls)[0]));
  });

  it('does not call the removed stats rpc', async () => {
    const { fake } = await mount(answerWith(ATTENTION));
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false);
  });
});

describe('telemetry overview helpers', () => {
  it('keeps the errors card of the first load when a refresh answers after the seen mark', () => {
    const fresh: Overview = { ...CALM, lastVisitAt: '2026-11-15T02:00:00.000Z' };
    const merged = mergeRefresh(ATTENTION, fresh);
    expect(merged.cards.find((c) => c.id === 'errors')!.level).toBe('error');
    expect(merged.lastVisitAt).toBe(ATTENTION.lastVisitAt);
    expect(merged.attention).toBe(1);
    expect(merged.cards[0].id).toBe('errors');
  });

  it('sorts error, warn, ok, unknown and the design order inside a level', () => {
    const cards = ['desktop', 'ai', 'usage', 'services', 'errors', 'quota'].map((id, i) => ({ id, level: i === 3 ? 'warn' : 'ok' }) as OverviewCard);
    expect(sortCards(cards).map((c) => c.id)).toEqual(['services', 'quota', 'errors', 'usage', 'ai', 'desktop']);
  });

  it('links a topic by its first line, the newest one when a title was written twice', () => {
    const map = topicsByTitle(
      [
        { id: 'new', seq: 9, body: 'Fehler: A\n\nedited text' },
        { id: 'old', seq: 2, body: 'Fehler: A\n\nProblem' },
        { id: 'inside', seq: 3, body: 'Intro\nFehler: B' },
      ],
      ['Fehler: A', 'Fehler: B'],
    );
    expect(map.get('Fehler: A')).toEqual({ id: 'new', seq: 9 });
    expect(map.has('Fehler: B')).toBe(false);
  });

  it('draws a flat series as a centred line', () => {
    expect(sparkPoints([5, 5, 5])).toBe('0,13 60,13 120,13');
  });
});
