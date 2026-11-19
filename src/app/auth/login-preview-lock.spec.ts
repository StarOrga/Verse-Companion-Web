import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { AccessRequestService } from './access-request.service';
import { AnalyticsService } from '../core/analytics.service';
import { AuthService } from './auth.service';
import { ImpersonationService } from './impersonation.service';
import { LoginComponent } from './login.component';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ViewAs } from './impersonation-policy';
import { VerseBodiesService } from '../verse/pages/briefing/bodies/body.directive';

/**
 * Defect B regression: while previewing as the signed-out visitor,
 * `auth.isAuthenticated()` is shadowed to `false` (see auth.service.ts), so
 * `authGuard` bounces every route back to `/login?redirect=…` even after a
 * REAL, successful sign-in — the credential paths must refuse instead of
 * silently looping. The banner/menu "Exit" control already reaches this
 * page (mounted app-level) and stays the only exit (batch #6: no second
 * exit box inside the form), so the fix here is only: (1) don't attempt the
 * sign-in, (2) explain why.
 */
describe('LoginComponent — signed-out preview lock', () => {
  let signInWithPassword: Mock;
  let signInWithGoogle: Mock;
  let signInWithDiscord: Mock;
  let exit: Mock;
  let viewAs: ViewAs | null;

  function setup() {
    signInWithPassword = vi.fn().mockName('signInWithPassword').mockResolvedValue({ error: null });
    signInWithGoogle = vi.fn().mockName('signInWithGoogle').mockResolvedValue({ error: null });
    signInWithDiscord = vi.fn().mockName('signInWithDiscord').mockResolvedValue({ error: null });
    exit = vi.fn().mockName('exit');
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        { provide: AccessRequestService, useValue: { submit: () => Promise.resolve({ kind: 'ok' }) } },
        { provide: AuthService, useValue: { ready: () => false, realUser: () => null, signInWithPassword, signInWithGoogle, signInWithDiscord } },
        { provide: AnalyticsService, useValue: { track: () => {} } },
        { provide: SupabaseClientProvider, useValue: { client: {} } },
        { provide: ImpersonationService, useValue: { viewAs: () => viewAs, exit } },
        { provide: VerseBodiesService, useValue: { attach: () => () => undefined } },
      ],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the page normally when no sign-in is attempted (fidelity preserved)', () => {
    viewAs = 'anon';
    const fixture = setup();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('h1')).toBeTruthy();
    expect(el.querySelector('form')).toBeTruthy();
    expect(el.querySelector('input[type="email"]')).toBeTruthy();
    // The banner on top is the exit: no inline preview box (batch #6, B3.5).
    expect(el.querySelector('.notice.preview-locked')).toBeNull();
    expect(el.textContent).not.toContain('auth.previewLocked.exit');
  });

  it('refuses onSubmit(), never calls signInWithPassword, and surfaces the notice', async () => {
    viewAs = 'anon';
    const fixture = setup();
    const comp = fixture.componentInstance;
    comp.form.setValue({ email: 'pilot@example.com', password: 'hunter22' });

    await comp.onSubmit();
    fixture.detectChanges();

    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(comp.errorMsg()).toBe('auth.previewLocked.body');
    expect(fixture.nativeElement.querySelector('.err')?.textContent).toContain('auth.previewLocked.body');
    expect(exit).not.toHaveBeenCalled();
  });

  it('refuses signInWithGoogle() while previewing as anon', async () => {
    viewAs = 'anon';
    const fixture = setup();
    const comp = fixture.componentInstance;

    await comp.signInWithGoogle();

    expect(signInWithGoogle).not.toHaveBeenCalled();
    expect(comp.errorMsg()).toBeTruthy();
  });

  it('refuses signInWithDiscord() while previewing as anon', async () => {
    viewAs = 'anon';
    const fixture = setup();
    const comp = fixture.componentInstance;

    await comp.signInWithDiscord();

    expect(signInWithDiscord).not.toHaveBeenCalled();
    expect(comp.errorMsg()).toBeTruthy();
  });

  it('signInWithDiscord() starts the Discord OAuth flow, not Google', async () => {
    viewAs = null;
    const fixture = setup();
    const comp = fixture.componentInstance;

    await comp.signInWithDiscord();

    expect(signInWithDiscord).toHaveBeenCalledTimes(1);
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  it('renders a Discord button next to Google', () => {
    viewAs = null;
    const fixture = setup();
    expect(fixture.nativeElement.querySelectorAll('button.oauth').length).toBe(2);
  });

  it('keeps the sign-in submit the one primary step in the preview too (B3.5)', () => {
    viewAs = 'anon';
    const fixture = setup();
    fixture.detectChanges();
    const primaries = fixture.nativeElement.querySelectorAll('.sc-action--primary');
    expect(primaries.length).toBe(1);
    expect((primaries[0] as HTMLElement).getAttribute('type')).toBe('submit');
  });

  it('makes the sign-in submit the primary step outside a preview (#970)', () => {
    viewAs = null;
    const fixture = setup();
    fixture.detectChanges();
    const primaries = fixture.nativeElement.querySelectorAll('.sc-action--primary');
    expect(primaries.length).toBe(1);
    expect((primaries[0] as HTMLElement).getAttribute('type')).toBe('submit');
  });


  it('does not block sign-in for non-anon previews (viewer/collaborator never shadow auth)', async () => {
    viewAs = 'viewer';
    const fixture = setup();
    const comp = fixture.componentInstance;
    comp.form.setValue({ email: 'pilot@example.com', password: 'hunter22' });

    await comp.onSubmit();

    expect(signInWithPassword).toHaveBeenCalledWith('pilot@example.com', 'hunter22');
  });

  it('does not block sign-in with no active preview', async () => {
    viewAs = null;
    const fixture = setup();
    const comp = fixture.componentInstance;
    comp.form.setValue({ email: 'pilot@example.com', password: 'hunter22' });

    await comp.onSubmit();

    expect(signInWithPassword).toHaveBeenCalledWith('pilot@example.com', 'hunter22');
  });
});
