/**
 * Game identity (x.y.z + build) and the auto-run decision built on it —
 * feedback 17.11. notes #5/#6. Fixtures are excerpts of the real files on the
 * reporting machine: the LIVE build_manifest.id of build 13165946, the RSI
 * launcher log lines of its install, and the uploader log scenarios of
 * 15.–17.11. ("no auto-run (already-uploaded)" → "subthemes pending [hulls]").
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  patchFromLauncherLog,
  readGameIdentity,
  resolveGameIdentity,
  type DiscoveredChannel,
} from '../src/lib/discovery.js';
import { applyLedger, decideAutoRun, describeDecision, isModelsOnly, type LedgerVerdict } from '../src/lib/auto-run.js';
import { currentRevisions, planSubthemes, SUBTHEME_KEYS, type LedgerEntry, type SubthemeKey } from '../src/lib/subthemes.js';
import { catalogAlreadyLanded } from '../src/lib/resume-compat.js';
import type { CatalogSnapshot } from '../src/lib/sync.js';

/** C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\build_manifest.id (17.11.2026). */
const REAL_MANIFEST = `{
    "Data": {
        "Branch": "sc-alpha-4.10.0",
        "BuildDateStamp": "Wed Nov 11 2026",
        "BuildId": "d6fec516-2d22-45eb-aeb2-29b9d769bd1d",
        "BuildTimeStamp": "03:55:14 PM CST",
        "Config": "shipping",
        "Platform": "pc",
        "RequestedP4ChangeNum": "13165946",
        "Shelved_Change": "",
        "Tag": "public",
        "Version": "4.10.200.58746"
    }
}`;

/** %APPDATA%\rsilauncher\logs\log.log — the 4.10.2 install, then the 4.10.3 delta update. */
const REAL_LAUNCHER_LOG = [
  '{ "t":"2026-11-06 10:02:11.120", "[main][info] ": "[Pipeline] Installing Star Citizen LIVE 4.10.2-live.12913470 at C:\\\\Program Files\\\\Roberts Space Industries\\\\StarCitizen (type: update, forceDP: false)"  },',
  '{ "t":"2026-11-13 18:53:51.676", "[main][info] ": "[Pipeline] Installing Star Citizen LIVE 4.10.3-live.13165946 at C:\\\\Program Files\\\\Roberts Space Industries\\\\StarCitizen (type: update, forceDP: false)"  },',
  '{ "t":"2026-11-13 18:57:41.313", "[main][info] ": "[PatcherPhase] Delta update completed (SC LIVE 4.10.3-live.13165946) in C:\\\\Program Files\\\\Roberts Space Industries\\\\StarCitizen\\\\LIVE"  },',
].join('\n');

const BUILD = '13165946';

function live(version: string | null, buildNumber: string | null = BUILD): DiscoveredChannel {
  return {
    channel: 'LIVE',
    installPath: 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE',
    dataP4kPath: 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE/Data.p4k',
    version,
    buildNumber,
    sizeBytes: 150_000_000_000,
    source: 'rsi-launcher',
  };
}

function snapshot(patchVersion: string, buildNumber: string): CatalogSnapshot {
  return {
    syncedAt: 1,
    bundleCount: 1,
    channels: [
      {
        channel: 'live' as CatalogSnapshot['channels'][number]['channel'],
        patchVersion,
        buildNumber,
        qualityScore: 100,
        entityTotal: 454_632,
        bundleId: 'b-live',
        createdAt: '2026-11-16T00:00:00Z',
      },
    ],
  };
}

const rev = currentRevisions();
/** Ledger rows at this uploader's revisions — `except` left out (= missing on the server). */
function ledger(except: SubthemeKey[] = [], bumped: SubthemeKey[] = []): LedgerEntry[] {
  return SUBTHEME_KEYS.filter((k) => !except.includes(k)).map((k) => ({
    subtheme: k,
    revision: bumped.includes(k) ? rev[k] - 1 : rev[k],
  }));
}

function decide(local: DiscoveredChannel, snap: CatalogSnapshot, rows: LedgerEntry[] | null) {
  const base = decideAutoRun({ signedIn: true, channels: [local], snapshot: snap });
  const verdicts: LedgerVerdict[] = [
    { channel: local, plan: planSubthemes({ buildNumber: local.buildNumber ?? '', ledger: rows, force: false }) },
  ];
  return applyLedger(base, verdicts);
}

describe('game identity — the local installation is the one truth', () => {
  it('reads 4.10.3 + 13165946 from the real manifest and launcher log, not the reused branch 4.10.0', () => {
    const id = resolveGameIdentity({ manifestRaw: REAL_MANIFEST, launcherLog: REAL_LAUNCHER_LOG });
    expect(id).toEqual({ version: '4.10.3', buildNumber: BUILD, source: 'launcher-log' });
  });

  it('never takes the manifest "Version" counter (4.10.200) as the patch', () => {
    const id = resolveGameIdentity({ manifestRaw: REAL_MANIFEST });
    expect(id.version).not.toBe('4.10.200');
  });

  it('falls back to the manifest Branch when the launcher log has no line for this build', () => {
    const otherBuild = REAL_LAUNCHER_LOG.replace(/13165946/g, '13000000');
    expect(resolveGameIdentity({ manifestRaw: REAL_MANIFEST, launcherLog: otherBuild })).toEqual({
      version: '4.10.0',
      buildNumber: BUILD,
      source: 'manifest-branch',
    });
  });

  it('only a line of exactly this build relabels it — the older 4.10.2 line never does', () => {
    expect(patchFromLauncherLog(REAL_LAUNCHER_LOG, '12913470')).toBe('4.10.2');
    expect(patchFromLauncherLog(REAL_LAUNCHER_LOG, BUILD)).toBe('4.10.3');
    expect(patchFromLauncherLog(REAL_LAUNCHER_LOG, '1316594')).toBeNull();
    expect(patchFromLauncherLog('Installing Star Citizen PTU 4.11.0-ptu.13200001 at D:\\\\SC', '13200001')).toBe('4.11.0');
  });

  it('reads the identity from a channel folder + launcher logs on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sc-id-'));
    const channelDir = join(dir, 'LIVE');
    const launcher = join(dir, 'rsilauncher');
    await mkdir(channelDir, { recursive: true });
    await mkdir(join(launcher, 'logs'), { recursive: true });
    await writeFile(join(channelDir, 'build_manifest.id'), REAL_MANIFEST);
    await writeFile(join(launcher, 'logs', 'log.log'), REAL_LAUNCHER_LOG);
    expect(await readGameIdentity(channelDir, launcher)).toEqual({ version: '4.10.3', buildNumber: BUILD, source: 'launcher-log' });
  });
});

describe('auto-run — identity x.y.z + build, then only what is open', () => {
  it('nothing to do: same mechanism, patch, build, all parts on the server', () => {
    const d = decide(live('4.10.3'), snapshot('4.10.3', BUILD), ledger());
    expect(d.run).toBe(false);
    expect(d.reason).toBe('already-uploaded');
  });

  it('a label-only difference (bundle row under the old 4.10.0) does nothing when the ledger holds every part', () => {
    const d = decide(live('4.10.3'), snapshot('4.10.0', BUILD), ledger());
    expect(d.run).toBe(false);
    expect(d.reason).toBe('already-uploaded');
  });

  it('real log scenario 15.–17.11.: only the hulls open → a parts run naming them, models only', () => {
    const d = decide(live('4.10.3'), snapshot('4.10.3', BUILD), ledger(['hulls']));
    expect(d).toMatchObject({ run: true, kind: 'parts', pending: ['hulls'] });
    expect(isModelsOnly(d.pending)).toBe(true);
    expect(describeDecision(d)).toBe('LIVE 4.10.3 (13165946): same build on the server, parts [hulls] open — starting');
    expect(describeDecision(d)).not.toContain('vs');
  });

  it('trigger: mechanism changed (a subtheme revision bumped) runs exactly that part', () => {
    const d = decide(live('4.10.3'), snapshot('4.10.3', BUILD), ledger([], ['ships']));
    expect(d).toMatchObject({ run: true, kind: 'parts', pending: ['ships'] });
    expect(isModelsOnly(d.pending)).toBe(false);
  });

  it('trigger: patch changed (x.y.z differs) → identity run', () => {
    const d = decide(live('4.11.0', '13300000'), snapshot('4.10.3', BUILD), []);
    expect(d).toMatchObject({ run: true, kind: 'identity', localVersion: '4.11.0', serverVersion: '4.10.3' });
    expect(d.pending).toEqual([...SUBTHEME_KEYS]);
  });

  it('trigger: build changed under the same x.y.z → identity run', () => {
    const base = decideAutoRun({ signedIn: true, channels: [live('4.10.3', '13170000')], snapshot: snapshot('4.10.3', BUILD) });
    expect(base).toMatchObject({ run: true, kind: 'identity', localBuild: '13170000', serverBuild: BUILD });
    const d = decide(live('4.10.3', '13170000'), snapshot('4.10.3', BUILD), []);
    expect(d.run).toBe(true);
  });

  it('trigger: content missing on the server (no ledger row) → that part runs', () => {
    const d = decide(live('4.10.3'), snapshot('4.10.3', BUILD), ledger(['silhouettes', 'hulls']));
    expect(d).toMatchObject({ run: true, kind: 'parts', pending: ['silhouettes', 'hulls'] });
    expect(isModelsOnly(d.pending)).toBe(false);
  });

  it('identity differs but the ledger is unreadable → conservative full run', () => {
    const d = decide(live('4.10.3'), snapshot('4.10.2', '12913470'), null);
    expect(d).toMatchObject({ run: true, kind: 'identity' });
    expect(d.pending).toBeUndefined();
  });

  it('a held part under two patch labels counts once at the current revision', () => {
    const rows = [...ledger(), { subtheme: 'ships', revision: rev.ships - 1 }];
    const plan = planSubthemes({ buildNumber: BUILD, ledger: rows, force: false });
    expect(plan.pending).toEqual([]);
  });
});

describe('leftover catalog job of a build the server already holds', () => {
  const job = {
    nat: { channel: 'LIVE', patchVersion: '4.10.0', buildNumber: BUILD },
    catalog: { status: 'running' },
  } as unknown as Parameters<typeof catalogAlreadyLanded>[0];

  it('is dropped when only the hulls are open (17.11. re-upload at Metadaten 15/17)', () => {
    expect(catalogAlreadyLanded(job, planSubthemes({ buildNumber: BUILD, ledger: ledger(['hulls']), force: false }))).toBe(true);
  });

  it('is kept when a catalog part is open or the ledger is unreadable', () => {
    expect(catalogAlreadyLanded(job, planSubthemes({ buildNumber: BUILD, ledger: ledger(['items']), force: false }))).toBe(false);
    expect(catalogAlreadyLanded(job, planSubthemes({ buildNumber: BUILD, ledger: null, force: false }))).toBe(false);
  });
});
