import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { AccessRequestService } from './access-request.service';
import { AnalyticsService } from '../core/analytics.service';
import { AuthService } from './auth.service';
import { LoginComponent } from './login.component';
import { LOGIN_PLANET_ATTACH_MS } from './login-scene.component';
import { SupabaseClientProvider } from '../core/supabase.client';
import { VerseBodiesService } from '../verse/pages/briefing/bodies/body.directive';

/**
 * The "Bruecke" login (concept 20261115-2122, B3.1-B3.5): the scene behind, header and footer
 * like the signed-in shell, the provider marks on the OAuth buttons, and the login page's own
 * legally required footer (fan badge, disclaimer, RSI link, trademarks, legal links).
 */
describe('LoginComponent — Bruecke layout', () => {
  let attach: Mock;

  function setup() {
    attach = vi.fn().mockName('attach').mockReturnValue(() => undefined);
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        { provide: AccessRequestService, useValue: { submit: () => Promise.resolve({ kind: 'ok' }) } },
        { provide: AuthService, useValue: { ready: () => false, realUser: () => null } },
        { provide: AnalyticsService, useValue: { track: () => undefined } },
        { provide: SupabaseClientProvider, useValue: { client: {} } },
        { provide: VerseBodiesService, useValue: { attach } },
      ],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => vi.useRealTimers());

  it('renders the decorative scene behind header, console and footer (B3.1)', () => {
    const el: HTMLElement = setup().nativeElement;
    const scene = el.querySelector('sc-login-scene');
    expect(scene).toBeTruthy();
    expect(scene?.getAttribute('aria-hidden')).toBe('true');
    expect(scene?.querySelector('canvas.ls-gl')).toBeTruthy();
    expect(el.querySelector('header.lg-head sc-brand-logo')).toBeTruthy();
    expect(el.querySelector('header.lg-head sc-brand-name')).toBeTruthy();
    expect(el.querySelector('.lg-panel form')).toBeTruthy();
    expect(el.querySelector('footer.lg-foot')).toBeTruthy();
  });

  it('header navigations are real anchors', () => {
    const el: HTMLElement = setup().nativeElement;
    const links = [...el.querySelectorAll<HTMLAnchorElement>('.lg-nav a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/about', '/login']);
  });

  it('keeps the login page footer complete: badge, disclaimer, RSI link, trademarks, legal anchors (B3.4)', () => {
    const foot: HTMLElement = setup().nativeElement.querySelector('footer.lg-foot');
    expect(foot.querySelector('img.fan-badge')?.getAttribute('src')).toBe('icons/made-by-community.png');
    expect(foot.textContent).toContain('footer.disclaimer');
    expect(foot.textContent).toContain('footer.trademarks');
    const rsi = foot.querySelector<HTMLAnchorElement>('a[href="https://robertsspaceindustries.com"]');
    expect(rsi?.getAttribute('target')).toBe('_blank');
    expect(rsi?.getAttribute('rel')).toBe('noopener noreferrer');
    const legal = [...foot.querySelectorAll<HTMLAnchorElement>('.lg-foot-links a')].map((a) => a.getAttribute('href'));
    expect(legal).toEqual(['/about', '/legal/privacy', '/legal/imprint']);
  });

  it('keeps the trust links on the sign-in console itself (AV phishing heuristic)', () => {
    const panel: HTMLElement = setup().nativeElement.querySelector('.lg-panel');
    const trust = [...panel.querySelectorAll<HTMLAnchorElement>('.trust-links a')].map((a) => a.getAttribute('href'));
    expect(trust).toEqual(['/about', '/legal/privacy', '/legal/imprint']);
  });

  it('shows the official Google and Discord marks in their own colours, hidden from assistive tech (B3.3)', () => {
    const el: HTMLElement = setup().nativeElement;
    const [google, discord] = [...el.querySelectorAll<HTMLButtonElement>('button.oauth')];
    const fills = (b: HTMLElement) => [...b.querySelectorAll('svg.brand-mark path')].map((p) => p.getAttribute('fill'));
    expect(fills(google)).toEqual(['#EA4335', '#4285F4', '#FBBC05', '#34A853']);
    expect(fills(discord)).toEqual(['#5865F2']);
    for (const b of [google, discord]) {
      expect(b.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(b.classList).toContain('sc-action--secondary');
    }
    expect(google.textContent).toContain('auth.continueGoogle');
    expect(discord.textContent).toContain('auth.continueDiscord');
  });

  it('switching the panel marks the page switched, so the intro stagger never replays', () => {
    const fixture = setup();
    expect(fixture.nativeElement.classList).not.toContain('switched');
    fixture.componentInstance.showApply();
    fixture.detectChanges();
    expect(fixture.nativeElement.classList).toContain('switched');
  });

  it('attaches the living microTech only after the intro, and never after leaving', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fixture = setup();
    await fixture.whenStable();
    vi.advanceTimersByTime(LOGIN_PLANET_ATTACH_MS - 1);
    expect(attach).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0][1]).toBe('microtech');
  });

  it('clears the pending attach on destroy', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fixture = setup();
    await fixture.whenStable();
    fixture.destroy();
    vi.advanceTimersByTime(LOGIN_PLANET_ATTACH_MS * 2);
    expect(attach).not.toHaveBeenCalled();
  });
});
