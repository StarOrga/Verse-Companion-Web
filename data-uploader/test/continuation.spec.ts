/**
 * "Nur die 3D-Modelle fortsetzen" (17.11. feedback): when the ledger holds the
 * catalogue for this identity, a run with only silhouettes and/or hulls open
 * does exactly those steps — with or without an extract on disk — and can
 * never reach the bundle, the metadata or a new codex build row.
 */
import { describe, expect, it } from 'vitest';
import { isLocalOnly, planContinuation } from '../src/lib/auto-run.js';
import { currentRevisions, planSubthemes, SUBTHEME_KEYS, type LedgerEntry, type SubthemeKey } from '../src/lib/subthemes.js';
import { fetchLiveBuildId } from '../src/lib/subtheme-ledger.js';

const rev = currentRevisions();
function ledger(open: SubthemeKey[], bumped: SubthemeKey[] = []): LedgerEntry[] {
  return SUBTHEME_KEYS.filter((k) => !open.includes(k)).map((k) => ({
    subtheme: k,
    revision: bumped.includes(k) ? rev[k] - 1 : rev[k],
  }));
}
const plan = (open: SubthemeKey[], bumped: SubthemeKey[] = []) =>
  planSubthemes({ buildNumber: '13165946', ledger: ledger(open, bumped), force: false });

/** Everything the run may send: the planned steps plus, in the full path only, the bundle + metadata. */
const NETWORK_STEPS_OF_FULL_RUN = ['bundle', 'metadata', 'silhouettes', 'hulls'];

describe('planContinuation — what a partly held build still has to do', () => {
  it.each([
    ['models only, extract on disk', ['hulls'] as SubthemeKey[], true, 'reuse', ['hulls']],
    ['models only, NO extract on disk', ['hulls'] as SubthemeKey[], false, 'local', ['hulls']],
    ['silhouettes only, extract on disk', ['silhouettes'] as SubthemeKey[], true, 'reuse', ['silhouettes']],
    ['silhouettes only, NO extract on disk', ['silhouettes'] as SubthemeKey[], false, 'local', ['silhouettes']],
    ['hulls + silhouettes, extract on disk', ['hulls', 'silhouettes'] as SubthemeKey[], true, 'reuse', ['silhouettes', 'hulls']],
    ['hulls + silhouettes, NO extract on disk', ['silhouettes', 'hulls'] as SubthemeKey[], false, 'local', ['silhouettes', 'hulls']],
  ])('%s', (_name, open, onDisk, extract, steps) => {
    const p = plan(open);
    expect(p.reason).toBe('ledger');
    expect([...p.pending].sort()).toEqual([...open].sort());
    const c = planContinuation(p.pending, onDisk as boolean);
    expect(c).toEqual({ extract, steps });
    // No upload step of a held subtheme is reachable: the step list holds only open parts…
    for (const s of c!.steps) expect(p.pending).toContain(s);
    // …and neither the bundle nor the metadata/catalogue upload is among them.
    expect(c!.steps as string[]).not.toContain('bundle');
    expect(c!.steps as string[]).not.toContain('metadata');
    expect(NETWORK_STEPS_OF_FULL_RUN.filter((s) => (c!.steps as string[]).includes(s))).toEqual(c!.steps);
    for (const held of p.skip) expect(c!.steps as string[]).not.toContain(held);
  });

  it('stays sensitive: any open catalogue part, a bumped revision or a missing ledger is a normal run', () => {
    for (const open of [['ships'], ['strings', 'hulls'], ['codex_extra', 'silhouettes'], ['items']] as SubthemeKey[][]) {
      expect(planContinuation(plan(open).pending, true)).toBeNull();
      expect(planContinuation(plan(open).pending, false)).toBeNull();
    }
    // a bumped subtheme revision (mechanism changed) is open again
    expect(plan([], ['weapons']).pending).toEqual(['weapons']);
    expect(planContinuation(plan([], ['weapons']).pending, false)).toBeNull();
    // new patch / build: the ledger has no row at all -> everything open
    const none = planSubthemes({ buildNumber: '13300000', ledger: [], force: false });
    expect(planContinuation(none.pending, true)).toBeNull();
    // unreadable ledger, unknown build, force: skip nothing
    expect(planContinuation(planSubthemes({ buildNumber: '13165946', ledger: null, force: false }).pending, true)).toBeNull();
    expect(planContinuation(planSubthemes({ buildNumber: '', ledger: ledger([]), force: false }).pending, true)).toBeNull();
    expect(planContinuation(planSubthemes({ buildNumber: '13165946', ledger: ledger([]), force: true }).pending, true)).toBeNull();
  });

  it('nothing open is not a continuation (the all-current path handles it)', () => {
    expect(isLocalOnly([])).toBe(false);
    expect(planContinuation([], true)).toBeNull();
  });
});

describe('fetchLiveBuildId — the row a silhouettes-only run attaches to', () => {
  const opts = (fetchImpl: typeof fetch) => ({ apiBase: 'https://x.test', anonKey: 'k', accessToken: 't', fetchImpl });
  const key = { channel: 'live', patchVersion: '4.10.3', buildNumber: '13165946' };
  const ID = '0b9f1c52-5d1e-4b1a-9a53-1d2f3a4b5c6d';

  it('reads the published (finalized, not superseded) build of that channel + build number', async () => {
    let url = '';
    const f = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify([{ id: ID }]), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchLiveBuildId(opts(f), key)).toBe(ID);
    expect(url).toContain('/rest/v1/codex_builds?');
    expect(url).toContain('channel=eq.LIVE');
    expect(url).toContain('build_number=eq.13165946');
    expect(url).toContain('superseded_at=is.null');
    expect(url).toContain('finalized_at=not.is.null');
  });

  it('is null (so nothing is sent, no row is minted) without a hit, on an error or without a build number', async () => {
    const empty = (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch;
    const bad = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    const boom = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchLiveBuildId(opts(empty), key)).toBeNull();
    expect(await fetchLiveBuildId(opts(bad), key)).toBeNull();
    expect(await fetchLiveBuildId(opts(boom), key)).toBeNull();
    expect(await fetchLiveBuildId(opts(empty), { ...key, buildNumber: ' ' })).toBeNull();
  });
});
