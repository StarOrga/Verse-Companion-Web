import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsService } from '../analytics.service';
import { pageEventOf } from './page-events.service';

function fire(url: string): [string, unknown] | null {
  const ev = pageEventOf(url);
  if (!ev) return null;
  const track = vi.fn();
  ev.run({ track } as unknown as AnalyticsService);
  return track.mock.calls[0] as [string, unknown];
}

describe('pageEventOf', () => {
  it('maps a codex detail page to kind + class name', () => {
    expect(fire('/codex/ship/AEGS_Gladius?view=classic')).toEqual(['codex:entry_view', { kind: 'ship', class_name: 'AEGS_Gladius' }]);
  });

  it('maps the verse hub and its sub pages', () => {
    expect(fire('/verse')?.[0]).toBe('verse:briefing_view');
    expect(fire('/verse/explorer')).toEqual(['verse:starmap_open', { page: 'explorer' }]);
    expect(fire('/verse/patches/4.1')).toEqual(['verse:patch_open', { line: '4.1' }]);
  });

  it('never puts a share token into the event', () => {
    const [, props] = fire('/shared/loadout/SECRET123') as [string, unknown];
    expect(JSON.stringify(props)).not.toContain('SECRET123');
    expect(fire('/invite/TOKEN')?.[0]).toBe('social:invite_view');
  });

  it('maps admin tools and hq pages, ignores the rest', () => {
    expect(fire('/admin/telemetry')).toEqual(['admin:tool_open', { tool: 'telemetry' }]);
    expect(fire('/hq#planen')).toEqual(['hq:page_view', { page: 'planen' }]);
    expect(pageEventOf('/settings')).toBeNull();
  });
});
