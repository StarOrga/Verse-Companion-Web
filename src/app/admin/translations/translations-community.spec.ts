import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { FakeCall, FakeResult, fakeSupabase } from '../../testing/fake-supabase';
import { TranslationAlertsComponent } from './translation-alerts.component';
import { TranslationOutreachComponent } from './translation-outreach.component';
import { TranslationSourcesComponent } from './translation-sources.component';
import { canImportSource, contextLines, goalPercent, passProgress } from './translations.logic';

type Answer = (c: FakeCall) => FakeResult | Promise<FakeResult>;

function setup(answer: Answer, userId = 'me') {
  const fake = fakeSupabase({ answer });
  const confirm = vi.fn().mockName('confirm').mockResolvedValue(true);
  TestBed.configureTestingModule({
    providers: [
      fake.provider,
      provideTranslateService(),
      provideRouter([]),
      { provide: ScConfirmService, useValue: { confirm } },
      { provide: AuthService, useValue: { realUser: () => ({ id: userId }) } },
    ],
  });
  return { fake, confirm };
}

async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

const q = <T extends Element>(el: HTMLElement, sel: string) => el.querySelector<T>(sel);
describe('logic helpers of the community tabs', () => {
  it('reports the progress of a pass only in phases that count', () => {
    expect(passProgress({ status: 'open', phase: 'scan', pos: 8, total: 24 })).toBe(33);
    expect(passProgress({ status: 'open', phase: 'apply', pos: 4, total: 24 })).toBe(25);
    expect(passProgress({ status: 'open', phase: 'fetch', pos: 0, total: 24 })).toBeNull();
    expect(passProgress({ status: 'open', phase: 'mine', pos: 0, total: 0 })).toBeNull();
    expect(passProgress({ status: 'done', phase: 'scan', pos: 8, total: 24 })).toBeNull();
    expect(passProgress({ status: 'open', phase: 'detect', pos: 40, total: 24 })).toBe(100);
  });

  it('allows import only for licensed and permitted sources', () => {
    expect(canImportSource('licensed')).toBe(true);
    expect(canImportSource('permitted')).toBe(true);
    expect(canImportSource('awaiting_permission')).toBe(false);
    expect(canImportSource('refused')).toBe(false);
  });

  it('clamps the goal progress and flattens card context', () => {
    expect(goalPercent(5, 10)).toBe(50);
    expect(goalPercent(25, 10)).toBe(100);
    expect(contextLines(['a', { key: 'k', text: 'b' }, { x: 1 }])).toEqual(['a', 'k: b', '{"x":1}']);
  });
});

describe('TranslationSourcesComponent', () => {
  const src = (id: string, status: string) => ({
    id,
    lang: id === 'thord82' ? 'es' : 'de',
    name: id,
    license: 'MIT',
    license_kind: 'permissive',
    status,
    enabled: true,
    game_folder: 'german_(germany)',
    last_synced_at: null,
    coverage: { text_pct: 94.3 },
  });
  const pass = (id: string, extra: Record<string, unknown> = {}) => ({
    id, kind: 'seed', lang: 'de', source_id: 'rjcncpt', reason: 'seed', status: 'done', phase: 'done', pos: 0, total: 24, error: null,
    created_at: '2026-11-17T10:00:00Z', updated_at: '2026-11-17T10:20:00Z', ...extra,
  });
  let passRows: ReturnType<typeof pass>[] = [];
  const answer: Answer = (c) => {
    if (c.target === 'translation_sources') return { data: [src('rjcncpt', 'licensed'), src('thord82', 'awaiting_permission')] };
    if (c.target === 'translation_passes') return { data: passRows };
    if (c.op === 'invoke') {
      const op = (c.args as { body: { op: string } }).body.op;
      if (op === 'import_seed') return { data: { ok: true, source_id: 'rjcncpt', lang: 'de', queued: true, pass_id: 'p1' } };
      if (op === 'learn') return { data: { ok: true, lang: 'de', queued: true, pass_id: 'p2' } };
      return { data: { ok: true, checked: 2, changed: 1, errors: [{ source_id: 'x', error: 'translate.source_fetch_404' }] } };
    }
    return { data: null };
  };
  beforeEach(() => {
    passRows = [];
  });

  it('disables import for sources awaiting permission and imports licensed ones via the orchestrator', async () => {
    const { fake, confirm } = setup(answer);
    const fixture = TestBed.createComponent(TranslationSourcesComponent);
    fixture.detectChanges();
    await settle(fixture);
    const rows = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('table.src tbody tr'));
    expect(rows.length).toBe(2);
    const importBtn = (r: Element) => r.querySelector<HTMLButtonElement>('.tip-wrap button')!;
    expect(importBtn(rows[0]).disabled).toBe(false);
    expect(importBtn(rows[1]).disabled).toBe(true);

    const cmp = fixture.componentInstance;
    await cmp.importSeed(cmp.sources()[1]);
    expect(fake.calls.some((c) => c.op === 'invoke')).toBe(false);

    await cmp.importSeed(cmp.sources()[0]);
    expect(confirm).toHaveBeenCalled();
    const inv = fake.calls.find((c) => c.op === 'invoke')!;
    expect(inv.target).toBe('translate-orchestrator');
    expect((inv.args as { body: unknown }).body).toEqual({ op: 'import_seed', source_id: 'rjcncpt' });
    // The import only starts: the flash says so and no row count is claimed.
    expect(cmp.flash()).toEqual({ key: 'admin.translations.sources.importStarted', params: { name: 'rjcncpt' }, err: false });
  });

  it('shows running and failed background passes and stops reading them when none runs any more', async () => {
    passRows = [
      pass('p1', { status: 'open', phase: 'scan', pos: 8, total: 24 }),
      pass('p2', { kind: 'learn', source_id: null, status: 'failed', phase: 'mine', error: 'translate.worker_limit' }),
      pass('p3', { kind: 'overlay', source_id: null }),
    ];
    const { fake } = setup(answer);
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(TranslationSourcesComponent);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      const rows = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[data-test=passes] tbody tr'));
      expect(rows.length).toBe(3);
      expect(rows[0].querySelector('.pill')?.classList.contains('warn')).toBe(true);
      expect(rows[0].textContent).toContain('33 %');
      expect(rows[1].querySelector('.pill')?.classList.contains('bad')).toBe(true);
      expect(rows[1].textContent).toContain('admin.translations.jobErrors.worker_limit');
      expect(rows[2].querySelector('.pill')?.classList.contains('ok')).toBe(true);

      // The import ends: the next read picks it up, reloads the sources (coverage, last sync) and polling stops.
      const reads = (target: string) => fake.calls.filter((c) => c.target === target).length;
      passRows = [pass('p1'), passRows[1], passRows[2]];
      const sourcesBefore = reads('translation_sources');
      await vi.advanceTimersByTimeAsync(5000);
      expect(reads('translation_sources')).toBe(sourcesBefore + 1);
      const passesAfter = reads('translation_passes');
      await vi.advanceTimersByTimeAsync(20_000);
      expect(reads('translation_passes')).toBe(passesAfter);
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a destroyed tab stops reading the passes', async () => {
    passRows = [pass('p1', { status: 'open', phase: 'apply', pos: 4 })];
    const { fake } = setup(answer);
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(TranslationSourcesComponent);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
      const before = fake.calls.filter((c) => c.target === 'translation_passes').length;
      fixture.destroy();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fake.calls.filter((c) => c.target === 'translation_passes').length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a tab destroyed while a read is under way sets no new timer', async () => {
    passRows = [pass('p1', { status: 'open', phase: 'apply', pos: 4 })];
    const { fake } = setup(answer);
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(TranslationSourcesComponent);
      fixture.detectChanges();
      // The first read has been sent and not answered yet.
      const reads = () => fake.calls.filter((c) => c.target === 'translation_passes').length;
      expect(reads()).toBe(1);
      fixture.destroy();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(reads()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts a learning pass and says that it runs in the background', async () => {
    setup(answer);
    const fixture = TestBed.createComponent(TranslationSourcesComponent);
    fixture.detectChanges();
    await settle(fixture);
    const cmp = fixture.componentInstance;
    await cmp.learn(cmp.sources()[0]);
    expect(cmp.flash()).toEqual({ key: 'admin.translations.sources.learnStarted', params: { lang: 'de' }, err: false });
  });

  it('syncs all sources after confirmation', async () => {
    const { fake } = setup(answer);
    const fixture = TestBed.createComponent(TranslationSourcesComponent);
    fixture.detectChanges();
    await settle(fixture);
    await fixture.componentInstance.sync();
    const inv = fake.calls.find((c) => c.op === 'invoke')!;
    expect((inv.args as { body: unknown }).body).toEqual({ op: 'sync_sources' });
    // The function answers with the list of failed sources; the text counts them.
    expect(fixture.componentInstance.flash()?.params).toEqual({ checked: 2, changed: 1, errors: 1 });
  });
});

describe('TranslationOutreachComponent', () => {
  const draft = (extra: Record<string, unknown> = {}) => ({
    id: 'o1',
    source_id: 'thord82',
    kind: 'permission',
    message_lang: 'de',
    subject: 'Anfrage',
    body: 'Hallo',
    status: 'draft',
    approved_at: null,
    sent_at: null,
    answer: null,
    answer_at: null,
    decision: null,
    created_at: '2026-11-08T10:00:00Z',
    ...extra,
  });
  const make =
    (protectedAdmin: boolean | 'unreadable', extra: Answer = () => ({ data: null })): Answer =>
    (c) => {
      const r = extra(c);
      if (r && (r as FakeResult).data !== null) return r;
      if (c.target === 'translation_outreach' && c.op === 'from') return { data: [draft()] };
      if (c.target === 'translation_sources') return { data: [{ id: 'thord82', name: 'Thord82', lang: 'es', status: 'awaiting_permission', license_kind: 'none' }] };
      if (c.target === 'list_users_for_admin') {
        return protectedAdmin === 'unreadable'
          ? { error: { message: 'x' } }
          : { data: [{ id: 'me', display_name: 'Jerry', email: 'j@example.test', protected: protectedAdmin }] };
      }
      return { data: null };
    };

  it('says that nothing is sent automatically', async () => {
    setup(make(true));
    const fixture = TestBed.createComponent(TranslationOutreachComponent);
    fixture.detectChanges();
    await settle(fixture);
    expect(q(fixture.nativeElement, '[data-test=no-auto-send]')).not.toBeNull();
  });

  it('disables approve for a non-protected admin', async () => {
    setup(make(false));
    const fixture = TestBed.createComponent(TranslationOutreachComponent);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.componentInstance.approveLocked()).toBe(true);
    const approve = q<HTMLButtonElement>(fixture.nativeElement, '[data-test=draft] .tip-wrap button')!;
    expect(approve.disabled).toBe(true);
  });

  it('approves for a protected admin and keeps the button usable', async () => {
    const approved = draft({ status: 'approved' });
    const { fake } = setup(make(true, (c) => (c.target === 'approve_translation_outreach' ? { data: approved } : { data: null })));
    const fixture = TestBed.createComponent(TranslationOutreachComponent);
    fixture.detectChanges();
    await settle(fixture);
    const btn = q<HTMLButtonElement>(fixture.nativeElement, '[data-test=draft] .tip-wrap button')!;
    expect(btn.disabled).toBe(false);
    await fixture.componentInstance.approve(fixture.componentInstance.items()[0]);
    expect(fake.calls.find((c) => c.target === 'approve_translation_outreach')!.args).toEqual({ p_id: 'o1' });
    expect(fixture.componentInstance.items()[0].status).toBe('approved');
  });

  it('locks the button again when the database refuses with 42501', async () => {
    setup(make('unreadable', (c) => (c.target === 'approve_translation_outreach' ? { error: { code: '42501', message: 'no' } } : { data: null })));
    const fixture = TestBed.createComponent(TranslationOutreachComponent);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.componentInstance.approveLocked()).toBe(false);
    await fixture.componentInstance.approve(fixture.componentInstance.items()[0]);
    expect(fixture.componentInstance.approveLocked()).toBe(true);
    expect(fixture.componentInstance.flash()).toEqual({ key: 'admin.translations.outreach.approveLocked', err: true });
    expect(fixture.componentInstance.items()[0].status).toBe('draft');
  });

  it('saves draft edits, marks sent and records an answer through the RPCs', async () => {
    const { fake } = setup(
      make(true, (c) => {
        if (c.target === 'mark_translation_outreach_sent') return { data: draft({ status: 'sent' }) };
        if (c.target === 'record_translation_outreach_answer') return { data: draft({ status: 'answered', decision: 'granted' }) };
        return { data: null };
      }),
    );
    const fixture = TestBed.createComponent(TranslationOutreachComponent);
    fixture.detectChanges();
    await settle(fixture);
    const cmp = fixture.componentInstance;
    const o = cmp.items()[0];

    cmp.patch(o, { subject: 'Neu' });
    expect(cmp.dirty(o)).toBe(true);
    await cmp.save(o);
    const upd = fake.calls.find((c) => c.target === 'translation_outreach' && c.chain.some(([m]) => m === 'update'))!;
    expect(upd.chain.find(([m]) => m === 'update')![1][0]).toEqual({ subject: 'Neu', body: 'Hallo', message_lang: 'de' });

    await cmp.markSent(cmp.items()[0]);
    expect(fake.calls.find((c) => c.target === 'mark_translation_outreach_sent')!.args).toEqual({ p_id: 'o1' });
    expect(cmp.items()[0].status).toBe('sent');

    cmp.openAnswer(cmp.items()[0]);
    cmp.answerText.set('Ja, gern');
    await cmp.recordAnswer(cmp.items()[0]);
    expect(fake.calls.find((c) => c.target === 'record_translation_outreach_answer')!.args).toEqual({
      p_id: 'o1',
      p_answer: 'Ja, gern',
      p_decision: 'granted',
    });
    expect(cmp.items()[0].status).toBe('answered');
  });
});

describe('TranslationAlertsComponent', () => {
  const alert = {
    id: 'a1',
    lang: 'de',
    key: 'ui_x',
    en_old: 'Old EN',
    en_new: 'New EN',
    cig_old: 'Alt',
    cig_new: 'Neu',
    admin_text: 'Meins',
    status: 'open',
    created_at: '2026-11-08T10:00:00Z',
  };

  it('shows the four-way diff and the admin text, and resolves with keep / edit', async () => {
    const { fake } = setup((c) => (c.target === 'translation_override_alerts' ? { data: [alert] } : { data: alert }));
    const fixture = TestBed.createComponent(TranslationAlertsComponent);
    fixture.detectChanges();
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const text = q(el, '[data-test=alert]')!.textContent!;
    for (const s of ['Old EN', 'New EN', 'Alt', 'Neu', 'Meins']) expect(text).toContain(s);

    const cmp = fixture.componentInstance;
    cmp.startEdit(alert as never);
    cmp.editText.set(' Besser ');
    await cmp.resolve(alert as never, 'edited');
    const call = fake.calls.find((c) => c.target === 'resolve_override_alert')!;
    expect(call.args).toEqual({ p_alert_id: 'a1', p_resolution: 'edited', p_edited_text: 'Besser' });
    expect(cmp.items().length).toBe(0);
  });

  it('sends keep without edited text and shows an error state with retry on load failure', async () => {
    const { fake } = setup((c) => (c.target === 'translation_override_alerts' ? { data: [alert] } : { data: alert }));
    const fixture = TestBed.createComponent(TranslationAlertsComponent);
    fixture.detectChanges();
    await settle(fixture);
    await fixture.componentInstance.resolve(alert as never, 'kept');
    expect(fake.calls.find((c) => c.target === 'resolve_override_alert')!.args).toEqual({
      p_alert_id: 'a1',
      p_resolution: 'kept',
      p_edited_text: null,
    });
    TestBed.resetTestingModule();

    setup(() => ({ error: { message: 'down' } }));
    const failed = TestBed.createComponent(TranslationAlertsComponent);
    failed.detectChanges();
    await settle(failed);
    expect(q(failed.nativeElement, '.state.error')).not.toBeNull();
    expect(q(failed.nativeElement, '[data-test=empty]')).toBeNull();
  });
});
