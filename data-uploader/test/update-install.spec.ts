import { describe, it, expect } from 'vitest';
import { nextInstallStep, effectiveUpdateEventType, bannerModel, classifyUpdateError } from '../src/lib/update-install.js';

const base = { staged: '0.9.0', feedVersion: null, superseded: false, workBusy: false };

describe('nextInstallStep', () => {
  it('has nothing to do without a staged update', () => {
    expect(nextInstallStep({ ...base, staged: null })).toBe('none');
  });
  it('fetches the newer release first when the staged one is outdated', () => {
    expect(nextInstallStep({ ...base, feedVersion: '0.10.0', superseded: true, workBusy: true })).toBe('refetch');
  });
  it('keeps the request standing while work runs (extraction, build or upload)', () => {
    expect(nextInstallStep({ ...base, workBusy: true })).toBe('wait');
  });
  it('installs once the work ended or was paused', () => {
    expect(nextInstallStep(base)).toBe('go');
  });
});

describe('bannerModel install states', () => {
  it('preparing locks the button with text', () => {
    const m = bannerModel({ type: 'install-state', state: 'preparing', version: '0.9.0' });
    expect(m.textKey).toBe('update.preparing');
    expect(m.button).toMatchObject({ disabled: true, action: 'install' });
  });
  it('waiting stays visible and offers a veto', () => {
    const m = bannerModel({ type: 'install-state', state: 'waiting', version: '0.9.0' });
    expect(m.textKey).toBe('update.waiting');
    expect(m.button).toMatchObject({ disabled: false, action: 'cancel' });
  });
  it('closing announces the 2-3 minute restart and locks the button', () => {
    const m = bannerModel({ type: 'install-state', state: 'closing', version: '0.9.0' });
    expect(m.textKey).toBe('update.closing');
    expect(m.button?.disabled).toBe(true);
  });
  it('failed re-enables the install button with an error message', () => {
    const m = bannerModel({ type: 'install-state', state: 'failed', version: '0.9.0' });
    expect(m.tone).toBe('error');
    expect(m.button).toMatchObject({ disabled: false, action: 'install' });
  });
  it('downloaded offers install', () => {
    const m = bannerModel({ type: 'downloaded', version: '0.9.0' });
    expect(m.button).toMatchObject({ action: 'install', disabled: false });
  });
});

describe('bannerModel background checks', () => {
  it('a re-check keeps the staged install button', () => {
    for (const type of ['checking', 'not-available']) {
      expect(effectiveUpdateEventType(type, 'idle', '0.9.0')).toBe('downloaded');
    }
  });
  it('a re-check keeps a running install notice', () => {
    for (const type of ['checking', 'not-available', 'downloaded']) {
      expect(effectiveUpdateEventType(type, 'waiting', '0.9.0')).toBe('install-state');
    }
  });
  it('a staged update dropped by a channel switch leaves no install button', () => {
    expect(effectiveUpdateEventType('checking', 'idle', null)).toBe('unchanged');
    expect(bannerModel({ type: 'checking' }).visible).toBe(false);
    expect(bannerModel({ type: 'not-available' }).visible).toBe(false);
  });
  it('tells that a newer version replaces the staged one', () => {
    const m = bannerModel({ type: 'available', version: '0.10.0', supersedes: '0.9.0' });
    expect(m.textKey).toBe('update.supersedes');
    expect(m.params).toEqual({ version: '0.10.0', old: '0.9.0' });
    expect(m.button).toBeNull();
  });
});

describe('update errors reach the window as a code, never as the raw message', () => {
  it('hides the banner for an error (the connection chip carries it)', () => {
    expect(bannerModel({ type: 'error' }).visible).toBe(false);
  });
  it('maps the revoked/unknown release token 401 to unknown-build', () => {
    const raw =
      '401 "method: GET url: https://x.supabase.co/functions/v1/desktop-latest/alpha.yml?noCache=1\n\n Data:\n {\n  \\"error\\": \\"invalid_or_revoked_release_token\\"\n}\n " Headers: { "server": "cloudflare" }';
    expect(classifyUpdateError(raw)).toBe('unknown-build');
    expect(classifyUpdateError('HttpError: 403 Forbidden')).toBe('unknown-build');
  });
  it('maps 5xx to server and network failures to offline', () => {
    expect(classifyUpdateError('HttpError: 503 Service Unavailable')).toBe('server');
    expect(classifyUpdateError('net::ERR_INTERNET_DISCONNECTED')).toBe('offline');
    expect(classifyUpdateError('getaddrinfo ENOTFOUND hcnqhvzlavdycidqyaai.supabase.co')).toBe('offline');
  });
  it('recognises a staged update that did not install', () => {
    expect(classifyUpdateError('update to v0.84.4 did not install — still running v0.84.3')).toBe('not-installed');
  });
  it('falls back to other', () => {
    expect(classifyUpdateError('sha512 checksum mismatch')).toBe('other');
  });
});
