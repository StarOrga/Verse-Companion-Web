import type { NavOriginService } from '../shared/page-header/nav-origin.service';
import { pathLevelFor } from './path-level.util';

const from = (path: string | null) => ({ previous: () => (path === null ? null : { path }) }) as unknown as NavOriginService;

describe('pathLevelFor (R5 r5-d-bauplan, D2)', () => {
  it('signed in: always the full form, wherever the reader came from', () => {
    for (const p of [null, '/codex/index', '/hq', '/codex/set/abc']) expect(pathLevelFor(from(p), true), String(p)).toBe('primary');
  });

  it('signed out: the full form only from Planen or a set, the pill otherwise', () => {
    expect(pathLevelFor(from('/hq'), false)).toBe('primary');
    expect(pathLevelFor(from('/codex/set/abc'), false)).toBe('primary');
    expect(pathLevelFor(from('/codex/index'), false)).toBe('secondary');
    expect(pathLevelFor(from(null), false)).toBe('secondary');
  });
});
