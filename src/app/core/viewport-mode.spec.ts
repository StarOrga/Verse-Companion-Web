import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { COMPACT_QUERY, PHONE_QUERY, TABLET_QUERY, ViewportModeService } from './viewport-mode';

describe('ViewportModeService', () => {
  it('mirrors each mode on <html> and in its signal', () => {
    const svc = TestBed.inject(ViewportModeService);
    const root = document.documentElement;
    expect(svc.phone()).toBe(matchMedia(PHONE_QUERY).matches);
    expect(root.hasAttribute('data-sc-phone')).toBe(svc.phone());
    expect(svc.compact()).toBe(matchMedia(COMPACT_QUERY).matches);
    expect(root.hasAttribute('data-sc-compact')).toBe(svc.compact());
    expect(svc.tablet()).toBe(matchMedia(TABLET_QUERY).matches);
    expect(root.hasAttribute('data-sc-tablet')).toBe(svc.tablet());
  });

  it('stops writing <html> once its injector is destroyed (no attribute leaks into later tests)', () => {
    TestBed.inject(ViewportModeService);
    const root = document.documentElement;
    TestBed.resetTestingModule();
    for (const attr of ['data-sc-phone', 'data-sc-compact', 'data-sc-tablet']) expect(root.hasAttribute(attr)).toBe(false);
  });

  it('keeps the compact query on the shared string (landscape and short)', () => {
    expect(COMPACT_QUERY).toContain('orientation: landscape');
    expect(COMPACT_QUERY).toContain('max-height: 500px');
  });
});
