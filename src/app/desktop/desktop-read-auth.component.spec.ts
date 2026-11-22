import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { DesktopReadAuthComponent } from './desktop-read-auth.component';
import { AuthService } from '../auth/auth.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { DesktopConnectionService } from './desktop-connection.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import de from '../../../public/i18n/de.json';
import en from '../../../public/i18n/en.json';

describe('DesktopReadAuthComponent', () => {
  let submit: Mock;
  let touch: Mock;
  let authed: boolean;

  function setup(params: Record<string, string>) {
    submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockReturnValue(undefined as never);
    touch = vi.fn().mockName('touch').mockResolvedValue(undefined);
    const invoke = vi.fn().mockName('invoke').mockResolvedValue({
      data: { access_token: 'app-access', refresh_token: 'app-refresh', expires_at: 1234 },
      error: null,
    });
    const getSession = vi.fn().mockName('getSession').mockResolvedValue({
      data: { session: { access_token: 'browser-access', refresh_token: 'browser-refresh', expires_at: 99 } },
      error: null,
    });
    TestBed.configureTestingModule({
      imports: [DesktopReadAuthComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(params) } } },
        {
          provide: AuthService,
          useValue: {
            init: () => undefined,
            ready: () => true,
            isAuthenticated: () => authed,
            user: signal({ email: 'pilot@example.com' }),
          },
        },
        { provide: ImpersonationService, useValue: { activeOrPending: () => false, exit: () => undefined } },
        { provide: DesktopConnectionService, useValue: { touch } },
        {
          provide: SupabaseClientProvider,
          useValue: { client: { auth: { getSession } }, realClient: { functions: { invoke } } },
        },
      ],
    });
    const fixture = TestBed.createComponent(DesktopReadAuthComponent);
    return { fixture, cmp: fixture.componentInstance };
  }

  beforeEach(() => {
    authed = true;
    sessionStorage.removeItem('sc.oauth-redirect-qs');
  });
  afterEach(() => document.querySelectorAll('body > form').forEach((f) => f.remove()));

  it('without cb/state: errorMissingParams, nothing posted', async () => {
    const { fixture, cmp } = setup({});
    await cmp.ngOnInit();
    fixture.detectChanges();
    expect(cmp.status()).toBe('error');
    expect(cmp.errorMsg()).toBe('desktopConnect.errorMissingParams');
    expect(fixture.nativeElement.querySelector('.err').textContent).toContain('desktopConnect.errorMissingParams');
    expect(submit).not.toHaveBeenCalled();
  });

  for (const cb of [
    'https://evil.example/scc/callback',
    'http://localhost:4000/scc/callback',
    'http://127.0.0.1/scc/callback',
  ]) {
    it(`a non-loopback callback is an error: ${cb}`, async () => {
      const { cmp } = setup({ cb, state: 's' });
      await cmp.ngOnInit();
      expect(cmp.status()).toBe('error');
      expect(cmp.errorMsg()).toBe('desktopConnect.errorBadCallback');
      expect(submit).not.toHaveBeenCalled();
    });
  }

  it('signed out: asks for login and keeps the request as redirect', async () => {
    authed = false;
    const { cmp } = setup({ cb: 'http://127.0.0.1:5000/x', state: 's' });
    await cmp.ngOnInit();
    expect(cmp.status()).toBe('login_required');
    expect(cmp.returnUrl).toContain('/apps/starscape/connect?cb=');
    expect(submit).not.toHaveBeenCalled();
  });

  it('always posts to /scc/callback, whatever path cb carried', async () => {
    const { cmp } = setup({ cb: 'http://127.0.0.1:5000/steal/elsewhere?x=1', state: 's' });
    await cmp.ngOnInit();
    expect(submit).toHaveBeenCalledTimes(1);
    const form = vi.mocked(submit).mock.contexts.at(-1) as HTMLFormElement;
    expect(form.action).toBe('http://127.0.0.1:5000/scc/callback');
  });

  it('back from Starscape with done=ok shows the connected stage without a session check', async () => {
    const getSession = vi.fn();
    const { fixture, cmp } = setup({ done: 'ok' });
    TestBed.inject(SupabaseClientProvider).client.auth.getSession = getSession as never;
    await cmp.ngOnInit();
    fixture.detectChanges();
    expect(cmp.status()).toBe('connected');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('desktopConnect.titleConnected');
    expect((cmp as unknown as { phase: () => string }).phase()).toBe('done');
    // Title + one line of info, nothing to click.
    expect(fixture.nativeElement.querySelectorAll('h1').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('p').length).toBe(1);
    expect(fixture.nativeElement.querySelector('button, a')).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  for (const [done, key] of [
    ['csrf', 'desktopConnect.done.csrf'],
    ['no_token', 'desktopConnect.done.noToken'],
    ['origin', 'desktopConnect.done.failed'],
    ['something-new', 'desktopConnect.done.failed'],
  ] as const) {
    it(`done=${done} names its cause and offers no retry link`, async () => {
      const { fixture, cmp } = setup({ done });
      await cmp.ngOnInit();
      fixture.detectChanges();
      expect(cmp.status()).toBe('error');
      expect(cmp.errorMsg()).toBe(key);
      expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('desktopConnect.titleFailed');
      expect(fixture.nativeElement.querySelector('a, button')).toBeNull();
      expect(submit).not.toHaveBeenCalled();
    });
  }

  it('done=start asks to start the sign-in in the app', async () => {
    const { fixture, cmp } = setup({ done: 'start' });
    await cmp.ngOnInit();
    fixture.detectChanges();
    expect(cmp.status()).toBe('start');
    expect(fixture.nativeElement.querySelector('p')?.textContent).toContain('desktopConnect.start');
    expect(submit).not.toHaveBeenCalled();
  });

  it('signed out: title, one info line and the sign-in link only', async () => {
    authed = false;
    const { fixture, cmp } = setup({ cb: 'http://127.0.0.1:5000/scc/callback', state: 's' });
    await cmp.ngOnInit();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('desktopConnect.titleConnect');
    expect(fixture.nativeElement.querySelectorAll('p').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('a, button').length).toBe(1);
  });

  it('posts the token in the body, never in the URL', async () => {
    const { cmp } = setup({ cb: 'http://127.0.0.1:5000/scc/callback', state: 'st' });
    await cmp.ngOnInit();
    expect(cmp.status()).toBe('redirecting');
    expect(touch).toHaveBeenCalledTimes(1);
    expect(touch).toHaveBeenCalledWith('starscape');
    const form = vi.mocked(submit).mock.contexts.at(-1) as HTMLFormElement;
    expect(form.method.toLowerCase()).toBe('post');
    expect(form.action).not.toContain('?');
    expect(form.action).not.toContain('app-access');
    const field = (n: string) => (form.querySelector(`input[name="${n}"]`) as HTMLInputElement | null)?.value;
    expect(field('state')).toBe('st');
    expect(field('token')).toBe('app-access');
    expect(field('refresh_token')).toBe('app-refresh');
    expect(field('email')).toBe('pilot@example.com');
  });
});

describe('DesktopReadAuthComponent i18n keys', () => {
  const KEYS = [
    'titleConnect', 'titleConnecting', 'titleConnected', 'titleFailed',
    'authorizing', 'loginRequired', 'redirecting', 'handedOverHint', 'connected', 'start',
    'errorMissingParams', 'errorBadCallback', 'errorNoToken', 'retry',
    'done.csrf', 'done.noToken', 'done.failed',
  ];
  for (const [lang, cat] of [['de', de], ['en', en]] as const) {
    for (const key of KEYS) {
      it(`${lang}: desktopConnect.${key} is a non-empty string`, () => {
        const value = key
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], (cat as { desktopConnect: unknown }).desktopConnect);
        expect(typeof value).toBe('string');
        expect((value as string).length).toBeGreaterThan(0);
      });
    }
  }
});
