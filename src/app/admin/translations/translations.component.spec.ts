import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { FakeCall, fakeSupabase } from '../../testing/fake-supabase';
import { AdminTranslationsComponent } from './translations.component';

const job = (id: string, status: string) => ({
  id,
  build_id: 'b1',
  lang: 'de',
  mode: 'delta',
  status,
  string_count: 10,
  estimate_usd: 1.5,
  spent_usd: 0.5,
  stats: { judge: { n: 2, mean: 4.5 } },
  error: null,
  created_at: '2026-10-29T10:00:00Z',
  build: { patch_version: '4.4', channel: 'LIVE', build_number: '1' },
});

describe('AdminTranslationsComponent', () => {
  /** What the confirm dialog was asked, and what it answers. */
  let asked: { titleKey: string; params?: Record<string, unknown>; tone?: string }[] = [];
  let confirmAnswer = true;
  let calls: FakeCall[] = [];

  function create(answer: (c: FakeCall) => { data?: unknown; error?: unknown }) {
    const fake = fakeSupabase({ answer });
    calls = fake.calls;
    asked = [];
    confirmAnswer = true;
    const confirm = async (q: (typeof asked)[number]) => {
      asked.push(q);
      return confirmAnswer;
    };
    TestBed.configureTestingModule({
      imports: [AdminTranslationsComponent],
      providers: [fake.provider, provideTranslateService(), provideRouter([]), { provide: ScConfirmService, useValue: { confirm } }],
    });
    const fixture = TestBed.createComponent(AdminTranslationsComponent);
    fixture.detectChanges();
    return fixture;
  }

  const invokes = () => calls.filter((c) => c.op === 'invoke').map((c) => (c.args as { body: Record<string, unknown> }).body);

  const ok = (c: FakeCall) => {
    switch (c.target) {
      case 'translation_settings':
        return { data: { enabled: false, upload_cap_usd: 20, monthly_cap_usd: 190 } };
      case 'translation_languages':
        return { data: [{ lang: 'de', cig_folder: 'german_(germany)', approved: true }, { lang: 'fr', cig_folder: 'french_(france)', approved: false }] };
      case 'translation_jobs':
        return { data: [job('j1', 'awaiting_approval'), job('j2', 'published')] };
      case 'translation_ledger':
        return { data: [{ usd: 10 }, { usd: '9.5' }] };
      default:
        return { data: [] };
    }
  };

  it('shows approve only on awaiting jobs, cancel on unfinished ones, and the month spend', async () => {
    const fixture = create(ok);
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const rows = Array.from(el.querySelectorAll('table.jobs tbody tr'));
    expect(rows.length).toBe(2);
    expect(rows[0].querySelectorAll('.actions button').length).toBe(2);
    expect(rows[1].querySelectorAll('.actions button').length).toBe(0);
    expect(fixture.componentInstance.spend()).toBe(19.5);
    expect(fixture.componentInstance.spendPct()).toBe(10);
    expect(el.querySelectorAll('.lang').length).toBe(2);
  });

  it('a full run is ordered with one call: it estimates itself, no cost is asked for yet', async () => {
    const fixture = create((c) => (c.target === 'codex_builds' ? { data: [{ id: 'b1', patch_version: '4.4', channel: 'LIVE', build_number: '1' }] } : c.op === 'invoke' ? { data: { ok: true } } : ok(c)));
    await fixture.whenStable();
    const cmp = fixture.componentInstance;
    await cmp.startFull({ lang: 'de', cig_folder: 'german_(germany)', approved: true });
    expect(asked.map((q) => [q.titleKey, q.tone])).toEqual([['admin.translations.fullRun.startTitle', undefined]]);
    expect(invokes()).toEqual([{ op: 'start_full', build_id: 'b1', lang: 'de' }]);

    confirmAnswer = false;
    await cmp.startFull({ lang: 'de', cig_folder: 'german_(germany)', approved: true });
    expect(invokes().length).toBe(1);
  });

  it('approving a full run states its cost first; a delta job is approved directly', async () => {
    const fixture = create((c) => (c.op === 'invoke' ? { data: { ok: true } } : ok(c)));
    await fixture.whenStable();
    const cmp = fixture.componentInstance;
    const full = { ...job('j7', 'awaiting_approval'), mode: 'full' as const, estimate_usd: 41.2, string_count: 68000 };

    confirmAnswer = false;
    await cmp.approve(full);
    expect(asked.map((q) => [q.titleKey, q.tone, q.params])).toEqual([
      ['admin.translations.fullRun.title', 'danger', { lang: 'de', usd: '41.20', count: 68000 }],
    ]);
    expect(invokes()).toEqual([]);

    confirmAnswer = true;
    await cmp.approve(full);
    expect(invokes()).toEqual([{ op: 'approve', job_id: 'j7' }]);

    await cmp.approve({ ...job('j1', 'awaiting_approval'), mode: 'delta' as const });
    expect(asked.length).toBe(2);
    expect(invokes().length).toBe(2);
  });

  it('shows how far an estimate is, and no number on a job that waits', async () => {
    const jobs = [
      { ...job('j1', 'estimating'), stats: { est: { phase: 'rows', cursor: 77, total: 154 } } },
      { ...job('j2', 'submitted'), stats: { phase: 'running' } },
    ];
    const fixture = create((c) => (c.target === 'translation_jobs' ? { data: jobs } : ok(c)));
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('table.jobs tbody tr'));
    expect(rows.map((r) => r.querySelectorAll('.progress-line').length)).toEqual([1, 0]);
    expect(fixture.componentInstance.progress(fixture.componentInstance.jobs()[0])).toEqual({ pct: 20 });
  });

  it('renders an error state with retry instead of the empty state when loading fails', async () => {
    const fixture = create((c) => (c.target === 'translation_jobs' ? { error: { message: 'down' } } : ok(c)));
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.state.error')).not.toBeNull();
    expect(el.querySelector('table.jobs')).toBeNull();
  });

  it('the header leads back with an „Admin“ crumb and no repeated eyebrow; the six sections are real anchors', async () => {
    const fixture = create(ok);
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const crumb = el.querySelector<HTMLAnchorElement>('sc-page-header nav a')!;
    expect(crumb.textContent!.trim()).toBe('admin.translations.crumb');
    expect(crumb.getAttribute('href')).toBe('/admin/hub');
    expect(el.querySelector('sc-page-header .eyebrow')).toBeNull();
    expect(el.textContent).not.toContain('adminHub.title');
    expect(el.querySelector('[role=tablist]')).toBeNull();
    const bar = Array.from(el.querySelectorAll<HTMLAnchorElement>('sc-translations-page-bar a'));
    expect(bar.map((a) => a.getAttribute('href'))).toEqual([
      '/admin/translations',
      '/admin/translations?tab=cards',
      '/admin/translations?tab=sources',
      '/admin/translations?tab=outreach',
      '/admin/translations?tab=alerts',
      '/admin/translations?tab=glossary',
    ]);
    const rail = Array.from(el.querySelectorAll<HTMLAnchorElement>('sc-translations-rail a'));
    expect(rail.length).toBe(6);
    expect(rail[0].getAttribute('aria-current')).toBe('page');
  });
});
