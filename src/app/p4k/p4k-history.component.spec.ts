import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideTranslateService } from '@ngx-translate/core';
import { P4kHistoryComponent, groupBundlesByPatch, leadingBundleIds, leadingChanges, patchStateOf, reenableTargets } from './p4k-history.component';
import { ChannelTag, P4kBundleRow, P4kService } from './p4k.service';
import { RoleService } from '../auth/role.service';
import { ScConfirmService } from '../shared/dialog/sc-confirm.service';

function row(channel: ChannelTag, patch: string, quality: number, created: string): P4kBundleRow {
  return {
    id: `${channel}-${patch}-${created}`,
    channel,
    patch_version: patch,
    build_number: '1',
    schema_version: 1,
    quality_score: quality,
    entity_counts: { ships: 100 },
    diff_summary: null,
    disabled: false,
    disabled_reason: null,
    tool_version: '0.4.5',
    uploaded_by_id: 'u',
    uploaded_by_email: 'u@example.com',
    uploaded_by_name: 'U',
    created_at: created,
    superseded_at: null,
  };
}

function setup(bundles: P4kBundleRow[], isAdmin = false) {
  return setupWithMocks(bundles, isAdmin).fixture;
}

/** Same page, plus the service and dialog mocks for the admin actions. */
function setupWithMocks(bundles: P4kBundleRow[], isAdmin = false) {
  const dialog = {
    confirm: vi.fn().mockName('confirm').mockResolvedValue(true),
    prompt: vi.fn().mockName('prompt').mockResolvedValue(''),
  };
  const svc = {
    setDisabled: vi.fn().mockName('setDisabled').mockResolvedValue(undefined),
    deleteBundle: vi.fn().mockName('deleteBundle').mockResolvedValue(undefined),
    applyStates: vi.fn().mockName('applyStates').mockResolvedValue(undefined),
    bundles: signal(bundles),
    busy: signal(false),
    errorMsg: signal<string | null>(null),
    includeHistory: signal(false),
    includeDisabled: signal(false),
    listBundles: vi.fn().mockName('listBundles').mockResolvedValue(undefined),
    toggleHistory: vi.fn().mockName('toggleHistory'),
    toggleDisabled: vi.fn().mockName('toggleDisabled'),
  };
  TestBed.configureTestingModule({
    imports: [P4kHistoryComponent],
    providers: [
      provideHttpClient(withXhr()),
      provideTranslateService({ fallbackLang: 'en' }),
      { provide: P4kService, useValue: svc },
      { provide: RoleService, useValue: { isAdmin: signal(isAdmin) } },
      { provide: ScConfirmService, useValue: dialog },
    ],
  });
  const fixture = TestBed.createComponent(P4kHistoryComponent);
  fixture.detectChanges();
  return { fixture, svc, dialog };
}

describe('P4kHistoryComponent — patch cards (redesigned entries)', () => {
  it('renders one patch card per patch version, newest first', () => {
    const el = setup([
      row('live', '4.8.0', 90, '2026-05-02T00:00:00Z'),
      row('ptu', '4.10.0', 70, '2026-05-01T00:00:00Z'),
    ]).nativeElement as HTMLElement;
    const cards = Array.from(el.querySelectorAll('.hist-list .patch')) as HTMLElement[];
    expect(cards.length).toBe(2);
    expect(cards.map((c) => c.querySelector('.patch-ver')!.textContent!.trim())).toEqual([
      '4.10.0',
      '4.8.0',
    ]);
  });

  it('reveals the per-upload rows only after the patch card is expanded', () => {
    const fixture = setup([
      row('live', '4.8.0', 90, '2026-05-01T00:00:00Z'),
      row('ptu', '4.8.0', 60, '2026-05-02T00:00:00Z'),
    ]);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.up-row').length).toBe(0);

    (el.querySelector('.patch-main') as HTMLElement).click();
    fixture.detectChanges();

    // Both uploads for the single 4.8.0 patch group are now shown.
    expect(el.querySelectorAll('.up-row').length).toBe(2);
  });

  it('renders admin actions on the upload rows only for admins', () => {
    const fixture = setup([row('live', '4.8.0', 90, '2026-05-01T00:00:00Z')], true);
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('.patch-main') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.up-row .acts')).toBeTruthy();
  });
});

describe('P4kHistoryComponent — superseded vs disabled', () => {
  const supersededRow = (): P4kBundleRow => ({
    ...row('live', '4.8.0', 88, '2026-06-01T00:00:00Z'),
    disabled: true,
    superseded_at: '2026-07-01T00:00:00Z',
    disabled_reason: 'superseded by tool 0.9.0',
  });
  const manualDisabledRow = (): P4kBundleRow => ({
    ...row('live', '4.8.0', 88, '2026-06-01T00:00:00Z'),
    disabled: true,
    superseded_at: null,
    disabled_reason: 'bad extract',
  });

  it('isSuperseded is true only for auto-retired (superseded_at set) rows', () => {
    const c = setup([]).componentInstance;
    expect(c.isSuperseded(supersededRow())).toBe(true);
    expect(c.isSuperseded(manualDisabledRow())).toBe(false); // manual moderation disable
    expect(c.isSuperseded(row('live', '4.8.0', 88, '2026-06-01T00:00:00Z'))).toBe(false); // active
  });

  it('renders a Superseded badge on a fully-superseded patch card', () => {
    const el = setup([supersededRow()]).nativeElement as HTMLElement;
    expect(el.querySelector('.patch.superseded')).toBeTruthy();
    expect(el.querySelector('.patch-ver .badge')).toBeTruthy();
  });

  it('renders no Superseded badge on an active patch card', () => {
    const el = setup([row('live', '4.8.0', 88, '2026-06-01T00:00:00Z')]).nativeElement as HTMLElement;
    expect(el.querySelector('.badge')).toBeNull();
  });
});

describe('P4kHistoryComponent — admin actions ask in the app dialog', () => {
  const bundle = () => row('live', '4.8.0', 88, '2026-06-01T00:00:00Z');

  it('does not delete when the question is cancelled', async () => {
    const { fixture, svc, dialog } = setupWithMocks([bundle()], true);
    dialog.confirm.mockResolvedValue(false);
    await fixture.componentInstance.remove(bundle());
    expect(dialog.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ titleKey: 'p4k.prompts.deleteTitle', tone: 'danger' }),
    );
    expect(svc.deleteBundle).not.toHaveBeenCalled();
  });
});

describe('P4kHistoryComponent — per patch, leading, delete (B4.5)', () => {
  const at = (r: P4kBundleRow, patch: Partial<P4kBundleRow>): P4kBundleRow => ({ ...r, ...patch });
  const a = row('live', '4.8.0', 88, '2026-06-01T00:00:00Z');
  const b = row('live', '4.8.0', 90, '2026-06-02T00:00:00Z');
  const p = row('ptu', '4.8.0', 70, '2026-06-03T00:00:00Z');

  it('the leading upload is the newest active one per patch and channel', () => {
    expect([...leadingBundleIds([a, b, p])].sort()).toEqual([b.id, p.id].sort());
    expect([...leadingBundleIds([a, at(b, { disabled: true }), p])].sort()).toEqual([a.id, p.id].sort());
  });

  it('choosing a leading upload enables it and steps back the other active one of the same channel only', () => {
    const changes = leadingChanges([at(a, { disabled: true }), b, p], at(a, { disabled: true }), 'why');
    expect(changes).toEqual([
      { id: a.id, disabled: false, reason: null },
      { id: b.id, disabled: true, reason: 'why' },
    ]);
  });

  it('a superseded upload is never re-enabled as leading', () => {
    const old = at(a, { disabled: true, superseded_at: '2026-06-02T00:00:00Z' });
    expect(leadingChanges([old, b], old, 'why')).toEqual([{ id: b.id, disabled: true, reason: 'why' }]);
  });

  it('patch state: on / off (by hand) / history (only superseded)', () => {
    const [g] = groupBundlesByPatch([a, b]);
    expect(patchStateOf(g)).toBe('on');
    const [off] = groupBundlesByPatch([at(a, { disabled: true }), at(b, { disabled: true })]);
    expect(patchStateOf(off)).toBe('off');
    expect(reenableTargets(off).map((u) => u.id)).toEqual([b.id]);
    const [hist] = groupBundlesByPatch([at(a, { disabled: true, superseded_at: 'x' })]);
    expect(patchStateOf(hist)).toBe('history');
  });

  it('deactivates the whole patch with one trimmed reason, and not when cancelled', async () => {
    const { fixture, svc, dialog } = setupWithMocks([a, b, p], true);
    const [g] = groupBundlesByPatch([a, b, p]);
    dialog.prompt.mockResolvedValue(null);
    await fixture.componentInstance.disablePatch(g);
    expect(svc.applyStates).not.toHaveBeenCalled();
    dialog.prompt.mockResolvedValue(' alt ');
    await fixture.componentInstance.disablePatch(g);
    expect(dialog.prompt).toHaveBeenCalledWith(expect.objectContaining({ titleKey: 'p4k.prompts.disablePatchTitle', tone: 'danger' }));
    expect(svc.applyStates).toHaveBeenCalledWith(
      [p, b, a].map((u) => ({ id: u.id, disabled: true, reason: 'alt' })),
    );
  });

  it('re-enables a patch only after confirmation', async () => {
    const offA = at(a, { disabled: true });
    const { fixture, svc, dialog } = setupWithMocks([offA], true);
    const [g] = groupBundlesByPatch([offA]);
    dialog.confirm.mockResolvedValue(false);
    await fixture.componentInstance.reenablePatch(g);
    expect(svc.applyStates).not.toHaveBeenCalled();
    dialog.confirm.mockResolvedValue(true);
    await fixture.componentInstance.reenablePatch(g);
    expect(svc.applyStates).toHaveBeenCalledWith([{ id: a.id, disabled: false, reason: null }]);
  });

  it('shows the patch action on the patch head and "use as leading" only on a non-leading upload', () => {
    const fixture = setup([a, b], true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.patch-head .patch-acts')).toBeTruthy();
    (el.querySelector('.patch-main') as HTMLElement).click();
    fixture.detectChanges();
    const rows = Array.from(el.querySelectorAll('.up-row')) as HTMLElement[];
    expect(rows[0].querySelector('.badge.lead')).toBeTruthy();
    expect(rows[0].textContent).not.toContain('p4k.actions.lead');
    expect(rows[1].textContent).toContain('p4k.actions.lead');
    expect(rows[1].textContent).toContain('p4k.actions.delete');
  });

  it('on the timeline the newest patch starts open', () => {
    TestBed.resetTestingModule();
    const fixture = setup([a, row('live', '4.9.0', 90, '2026-07-01T00:00:00Z')]);
    fixture.componentRef.setInput('timeline', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.up-row').length).toBe(1);
    expect(el.querySelector('.hist-list.timeline .patch.now .patch-ver')!.textContent).toContain('4.9.0');
  });
});
