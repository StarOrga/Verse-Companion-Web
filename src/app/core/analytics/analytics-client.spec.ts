import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService, TELEMETRY_SAVER_FLAG, readAppRelease, remoteConfigHasNoFlags } from '../analytics.service';
import { ConsentService } from '../consent.service';
import { setErrorShownSink, toErrorKey } from '../describe-error';
import { EVENTS, EVENT_AREAS, EVENT_VERBS, LEGACY_EVENT_NAMES } from './events';
import { hashUserId } from './analytics-identity.service';

interface FakeClient {
  capture: Mock;
  captureException: Mock;
  identify: Mock;
  reset: Mock;
  register: Mock;
  on: Mock;
  startSessionRecording: Mock;
  stopSessionRecording: Mock;
  set_config: Mock;
  opt_out_capturing: Mock;
  opt_in_capturing: Mock;
}

function fakeClient(): FakeClient {
  return {
    capture: vi.fn(),
    captureException: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    register: vi.fn(),
    on: vi.fn(),
    startSessionRecording: vi.fn(),
    stopSessionRecording: vi.fn(),
    set_config: vi.fn(),
    opt_out_capturing: vi.fn(),
    opt_in_capturing: vi.fn(),
  };
}

describe('AnalyticsService client behaviour', () => {
  let svc: AnalyticsService;
  let consent: ConsentService;
  let client: FakeClient;
  const internals = () => svc as unknown as Record<string, (...a: unknown[]) => unknown>;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [AnalyticsService, ConsentService, provideRouter([])] });
    svc = TestBed.inject(AnalyticsService);
    consent = TestBed.inject(ConsentService);
    client = fakeClient();
    (svc as unknown as { client: unknown }).client = client;
    consent.setStatistics(true);
  });

  afterEach(() => {
    setErrorShownSink(null);
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('track() sends the catalogue event with its properties', () => {
    svc.track('hangar:ship_add', { ship_class: 'AEGS_Gladius', status: 'owned', ship_count: 2 });
    svc.track('auth:user_sign_out');
    expect(client.capture).toHaveBeenCalledWith('hangar:ship_add', { ship_class: 'AEGS_Gladius', status: 'owned', ship_count: 2 });
    expect(client.capture).toHaveBeenCalledWith('auth:user_sign_out', undefined);
  });

  it('settles flags at once when the remote config reports hasFeatureFlags: false', () => {
    expect(remoteConfigHasNoFlags({ ok: true, config: { hasFeatureFlags: false } })).toBe(true);
    expect(remoteConfigHasNoFlags({ ok: true, config: { hasFeatureFlags: true } })).toBe(false);
    expect(remoteConfigHasNoFlags({ ok: false })).toBe(false);
    expect(svc.flagsPending()).toBe(true);
    internals()['watchRemoteConfig'](client);
    const [event, handler] = client.on.mock.calls[0] as [string, (r: unknown) => void];
    expect(event).toBe('extensionsRemoteConfig');
    handler({ ok: true, config: { hasFeatureFlags: true } });
    expect(svc.flagsPending()).toBe(true);
    handler({ ok: true, config: { hasFeatureFlags: false } });
    expect(svc.flagsPending()).toBe(false);
  });

  it('identifies with the hash and the role only, and resets on sign-out', () => {
    svc.identify('abc123', 'admin');
    expect(client.identify).toHaveBeenCalledWith('abc123', { role: 'admin' });
    svc.resetIdentity();
    expect(client.reset).toHaveBeenCalledTimes(1);
    svc.resetIdentity();
    expect(client.reset).toHaveBeenCalledTimes(1); // nothing identified any more
  });

  it('does not identify without statistics consent', () => {
    consent.essentialOnly();
    svc.identify('abc123', 'viewer');
    expect(client.identify).not.toHaveBeenCalled();
  });

  it('starts session replay only once an $exception was captured', () => {
    expect(client.startSessionRecording).not.toHaveBeenCalled();
    svc.captureException(new Error('boom'));
    svc.captureException(new Error('boom 2'));
    expect(client.captureException).toHaveBeenCalledTimes(2);
    expect(client.startSessionRecording).toHaveBeenCalledTimes(1);
  });

  it('telemetry-saver pauses replay and heatmaps but still sends errors', () => {
    svc.captureException(new Error('first'));
    expect(client.startSessionRecording).toHaveBeenCalledTimes(1);
    internals()['applySaver'](true);
    expect(client.stopSessionRecording).toHaveBeenCalled();
    expect(client.set_config).toHaveBeenLastCalledWith(expect.objectContaining({ enable_heatmaps: false }));
    svc.captureException(new Error('second'));
    expect(client.captureException).toHaveBeenCalledTimes(2);
    internals()['applySaver'](false);
    expect(client.set_config).toHaveBeenLastCalledWith(expect.objectContaining({ enable_heatmaps: true }));
    expect(TELEMETRY_SAVER_FLAG).toBe('telemetry-saver');
  });

  it('saver on: an error does not start replay', () => {
    internals()['applySaver'](true);
    svc.captureException(new Error('x'));
    expect(client.captureException).toHaveBeenCalledTimes(1);
    expect(client.startSessionRecording).not.toHaveBeenCalled();
  });

  it('reports app:error_show through toErrorKey, capped per scope and key', () => {
    internals()['bindErrorSink']();
    for (let i = 0; i < 5; i++) toErrorKey('codex', 'load ships', new Error('Failed to fetch'));
    const shown = client.capture.mock.calls.filter(([name]) => name === 'app:error_show');
    expect(shown).toHaveLength(3);
    expect(shown[0][1]).toEqual({ scope: 'codex', key: expect.stringMatching(/^errors\./) });
  });

  it('reads the build stamp from <meta name="app-version">', () => {
    const doc = document.implementation.createHTMLDocument('x');
    expect(readAppRelease(doc)).toBe('dev');
    doc.head.innerHTML = '<meta name="app-version" content="v0.265.1">';
    expect(readAppRelease(doc)).toBe('v0.265.1');
  });
});

describe('hashUserId', () => {
  it('is a stable salted sha256 hex that never contains the id', async () => {
    const a = await hashUserId('user-1', 'salt');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashUserId('user-1', 'salt')).toBe(a);
    expect(await hashUserId('user-1', 'other')).not.toBe(a);
    expect(a).not.toContain('user-1');
  });
});

describe('event catalogue', () => {
  const verbs = EVENT_VERBS.join('|');
  const pattern = new RegExp(`^([a-z]+):[a-z0-9]+(?:_[a-z0-9]+)*_(?:${verbs})$`);

  it('every name is category:object_action with a listed verb, and the category is its area', () => {
    for (const [name, def] of Object.entries(EVENTS)) {
      expect(name, name).toMatch(pattern);
      expect(name.split(':')[0], name).toBe(def.area);
      expect(EVENT_AREAS).toContain(def.area);
      expect(def.desc.length).toBeGreaterThan(10);
    }
  });

  it('every legacy name maps to a catalogue event', () => {
    for (const target of Object.values(LEGACY_EVENT_NAMES)) expect(Object.keys(EVENTS)).toContain(target);
  });
});
