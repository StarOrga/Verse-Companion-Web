import { describe, expect, it, vi, beforeEach } from 'vitest';

const opened: string[] = [];
vi.mock('electron', () => ({
  shell: {
    openExternal: (url: string) => {
      opened.push(url);
      return Promise.resolve();
    },
  },
}));

const WEB = 'https://versecompanion-alpha.vercel.app';

async function waitForAuthUrl(): Promise<URL> {
  for (let i = 0; i < 200; i++) {
    const url = opened.at(-1);
    if (url) return new URL(url);
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('auth URL never opened');
}

function form(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  };
}

describe('handoffRedirectUrl', () => {
  it('points at the web app connect page with the outcome', async () => {
    const { handoffRedirectUrl } = await import('../src/lib/oauth.js');
    expect(handoffRedirectUrl(WEB, 'ok')).toBe(`${WEB}/apps/uploader/auth?done=ok`);
    expect(handoffRedirectUrl(`${WEB}/`, 'csrf')).toBe(`${WEB}/apps/uploader/auth?done=csrf`);
  });

  it('refuses a base that is no http(s) URL', async () => {
    const { handoffRedirectUrl } = await import('../src/lib/oauth.js');
    expect(handoffRedirectUrl('not a url', 'ok')).toBeNull();
    expect(handoffRedirectUrl('javascript:alert(1)', 'ok')).toBeNull();
  });
});

describe('runOAuthFlow loopback answers', () => {
  beforeEach(() => {
    opened.length = 0;
  });

  it('sends the tab back to the web connect page after a successful hand-off', async () => {
    const { runOAuthFlow } = await import('../src/lib/oauth.js');
    const flow = runOAuthFlow(WEB);
    const auth = await waitForAuthUrl();
    const cb = auth.searchParams.get('cb')!;
    const state = auth.searchParams.get('state')!;

    const res = await fetch(cb, form({ state, token: 'jwt', email: 'pilot@example.com', refresh_token: 'r', expires_at: '1700000000' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${WEB}/apps/uploader/auth?done=ok`);

    const result = await flow;
    expect(result).toEqual({
      ok: true,
      accessToken: 'jwt',
      refreshToken: 'r',
      expiresAt: 1700000000,
      userEmail: 'pilot@example.com',
    });
  });

  it('reports a state mismatch on the web page and fails the flow', async () => {
    const { runOAuthFlow } = await import('../src/lib/oauth.js');
    const flow = runOAuthFlow(WEB);
    const auth = await waitForAuthUrl();
    const cb = auth.searchParams.get('cb')!;

    const res = await fetch(cb, form({ state: 'forged', token: 'jwt' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${WEB}/apps/uploader/auth?done=csrf`);
    await expect(flow).resolves.toEqual({ ok: false, error: 'state mismatch' });
  });

  it('reports a missing token on the web page', async () => {
    const { runOAuthFlow } = await import('../src/lib/oauth.js');
    const flow = runOAuthFlow(WEB);
    const auth = await waitForAuthUrl();
    const cb = auth.searchParams.get('cb')!;
    const state = auth.searchParams.get('state')!;

    const res = await fetch(cb, form({ state }));
    expect(res.headers.get('location')).toBe(`${WEB}/apps/uploader/auth?done=no_token`);
    await expect(flow).resolves.toMatchObject({ ok: false });
  });

  it('falls back to the plain loopback page when the web base is unusable', async () => {
    const { runOAuthFlow } = await import('../src/lib/oauth.js');
    const flow = runOAuthFlow('not a url');
    const auth = await waitForAuthUrl().catch(() => null);
    // `not a url` cannot form an auth URL either — openExternal gets the raw
    // string concatenation, so read cb/state from it by hand.
    const raw = opened.at(-1) ?? '';
    const qs = new URLSearchParams(raw.slice(raw.indexOf('?') + 1));
    const cb = auth?.searchParams.get('cb') ?? qs.get('cb')!;
    const state = auth?.searchParams.get('state') ?? qs.get('state')!;

    const res = await fetch(cb, form({ state, token: 'jwt' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(await res.text()).toContain('Verbunden');
    await expect(flow).resolves.toMatchObject({ ok: true, accessToken: 'jwt' });
  });
});
