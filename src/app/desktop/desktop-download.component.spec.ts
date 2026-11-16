import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { DesktopDownloadComponent } from './desktop-download.component';
import { DesktopReleaseService, ReleaseInfo } from './desktop-release.service';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { RoleService } from '../auth/role.service';
import { AuthService } from '../auth/auth.service';
import { fakeSupabase } from '../testing/fake-supabase';
import { P4kBundleRow } from '../p4k/p4k.service';

/** Smoke tests for /uploader; they keep the later merge with /download (AUD-176) honest. */
describe('DesktopDownloadComponent', () => {
  const release = (version: string): ReleaseInfo => ({
    version,
    notes: 'notes',
    created_at: '2026-09-01T10:00:00Z',
    platforms: {
      'win-x64': { url: `https://example.test/${version}/setup.exe`, size_bytes: 2048, sha256: '0123456789abcdef' },
    },
  });

  let forChannel: Mock;
  const role = signal<'viewer' | 'collaborator' | 'admin' | null>('viewer');

  let bundles: Partial<P4kBundleRow>[] = [];
  function setup(r: 'viewer' | 'collaborator' | 'admin' = 'viewer') {
    role.set(r);
    forChannel = vi.fn().mockName('forChannel').mockImplementation((ch: string) => Promise.resolve({ release: release(`2.0.0-${ch}`), error: null }));
    const canInstall = signal(true);
    TestBed.configureTestingModule({
      imports: [DesktopDownloadComponent],
      providers: [
        provideTranslateService(),
        { provide: DesktopReleaseService, useValue: { forChannel } },
        { provide: RoleService, useValue: { role, isAdmin: computed(() => role() === 'admin') } },
        fakeSupabase({
          answer: (c) => (c.target === 'list_p4k_bundles_for_collaborator' ? { data: bundles } : { data: null }),
        }).provider,
        { provide: AuthService, useValue: { user: signal({ id: 'me' }) } },
        {
          provide: DesktopCapabilityService,
          useValue: { canInstall, isMobileDevice: computed(() => !canInstall()) },
        },
      ],
    });
    const fixture = TestBed.createComponent(DesktopDownloadComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the release entries as real anchors', async () => {
    const f = setup();
    await f.whenStable();
    f.detectChanges();
    const links = f.nativeElement.querySelectorAll('a.ap-btn') as NodeListOf<HTMLAnchorElement>;
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('https://example.test/2.0.0-stable/setup.exe');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(f.nativeElement.querySelector('h1').textContent).toContain('desktop.title');
  });

  it('the download is stable for every role, an admin included', async () => {
    const f = setup('admin');
    await f.whenStable();
    f.detectChanges();
    expect(f.componentInstance.release()?.version).toBe('2.0.0-stable');
    expect(f.nativeElement.querySelector('a.ap-btn').getAttribute('href')).toContain('2.0.0-stable');
  });

  it('a viewer never asks for anything but stable', async () => {
    const f = setup('viewer');
    await f.whenStable();
    expect(vi.mocked(forChannel).mock.calls).toEqual([['stable']]);
  });

  it('the admin promote row reads its own source ring and follows a switch', async () => {
    const f = setup('admin');
    await f.whenStable();
    f.detectChanges();
    expect(f.componentInstance.sourceRelease()?.version).toBe('2.0.0-alpha');
    expect(f.nativeElement.querySelector('.promote .pver').textContent).toContain('2.0.0-alpha');
    f.componentInstance.onPromoteSource('beta');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(f.componentInstance.sourceRelease()?.version).toBe('2.0.0-beta');
    // The download itself stays stable.
    expect(f.componentInstance.release()?.version).toBe('2.0.0-stable');
  });

  it('the promote row is admin-only', async () => {
    const viewer = setup('viewer');
    await viewer.whenStable();
    viewer.detectChanges();
    expect(viewer.nativeElement.querySelector('.promote')).toBeNull();
    TestBed.resetTestingModule();
    const admin = setup('admin');
    await admin.whenStable();
    admin.detectChanges();
    expect(admin.nativeElement.querySelector('.promote')).not.toBeNull();
  });

  it('shows the bundle history inline, no popup any more (B4.1)', async () => {
    const f = setup('collaborator');
    await f.whenStable();
    expect(f.nativeElement.querySelector('sc-p4k-history .hist-list, sc-p4k-history .state')).not.toBeNull();
    expect(f.nativeElement.querySelector('sc-popup')).toBeNull();
  });

  it('silhouette coverage sits on the page for admins only (B4.2)', async () => {
    const viewer = setup('collaborator');
    await viewer.whenStable();
    expect(viewer.nativeElement.querySelector('sc-silhouette-coverage')).toBeNull();
    TestBed.resetTestingModule();
    const admin = setup('admin');
    await admin.whenStable();
    expect(admin.nativeElement.querySelector('sc-silhouette-coverage .cov-card.hot')).not.toBeNull();
  });

  it('setup steps stay open until this reader uploaded, then fold with every step ticked (B4.3)', async () => {
    bundles = [];
    const fresh = setup('collaborator');
    await fresh.whenStable();
    fresh.detectChanges();
    const open = fresh.nativeElement.querySelector('details.steps') as HTMLDetailsElement;
    expect(open.open).toBe(true);
    expect(open.querySelectorAll('li.ok').length).toBe(0);
    TestBed.resetTestingModule();
    bundles = [{
      id: 'b1', channel: 'live', patch_version: '4.10.0', build_number: '1', schema_version: 1, quality_score: 90,
      entity_counts: {}, diff_summary: null, disabled: false, disabled_reason: null, tool_version: null,
      uploaded_by_id: 'me', uploaded_by_email: 'me@example.com', uploaded_by_name: null,
      created_at: '2026-11-14T10:00:00Z', superseded_at: null,
    }];
    const done = setup('collaborator');
    await done.whenStable();
    done.detectChanges();
    const folded = done.nativeElement.querySelector('details.steps') as HTMLDetailsElement;
    expect(folded.open).toBe(false);
    expect(folded.querySelectorAll('li.ok').length).toBe(3);
    expect(done.nativeElement.querySelector('.build-tile .big').textContent).toContain('4.10.0');
    bundles = [];
  });
});
