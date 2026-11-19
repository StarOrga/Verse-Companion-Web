import { describe, it, expect } from 'vitest';
import { UploadJobStore, createJob, nextStage, sentFor, type JobOrigin, type TextIO, type UploadJobState } from '../src/lib/upload-job.js';
import { applyReset, changedSubthemes, resumeCompat } from '../src/lib/resume-compat.js';
import { currentRevisions } from '../src/lib/subthemes.js';

const NAT = { channel: 'LIVE', patchVersion: '4.10.2', buildNumber: '13165946' };
const NOW: JobOrigin = { uploaderVersion: '0.81.4', revisions: currentRevisions() };

/** The same uploader with one subtheme's logic one revision older. */
function older(...keys: (keyof ReturnType<typeof currentRevisions>)[]): JobOrigin {
  const revisions: Record<string, number> = { ...NOW.revisions };
  for (const k of keys) revisions[k] = (NOW.revisions[k] ?? 0) - 1;
  return { uploaderVersion: '0.81.3', revisions };
}

/** A job paused in the 3D-model step: metadata + silhouettes on the server, 40 ships sent. */
function pausedInModels(origin: JobOrigin | null): UploadJobState {
  const j = createJob('j1', 'C:/out/live', NAT, 1, origin);
  return {
    ...j,
    status: 'paused',
    bundle: { status: 'done', bundleId: 'b1' },
    catalog: { status: 'done', buildId: 'build-1', donePhases: ['codex_ships'], cursor: null },
    silhouettes: { status: 'done' },
    skins: { status: 'running', doneShips: Array.from({ length: 40 }, (_, i) => `S${i}`) },
  };
}

describe('resume after an uploader update', () => {
  it('resumes where it stopped when nothing the job did changed', () => {
    expect(resumeCompat({ job: pausedInModels(NOW), current: NOW })).toEqual({ action: 'keep' });
  });

  it('starts over at the extraction when the metadata extraction changed — not at the 3D models', () => {
    const c = resumeCompat({ job: pausedInModels(older('ships')), current: NOW });
    expect(c).toEqual({ action: 'restart', changed: ['ships'], reason: 'extractor-changed' });
  });

  it('every catalog subtheme counts as metadata extraction', () => {
    for (const k of ['strings', 'ships', 'components', 'weapons', 'items', 'codex_extra'] as const) {
      expect(resumeCompat({ job: pausedInModels(older(k)), current: NOW }).action).toBe('restart');
    }
  });

  it('a changed metadata extraction restarts even when the 3D logic changed too', () => {
    const c = resumeCompat({ job: pausedInModels(older('items', 'hulls')), current: NOW });
    expect(c).toMatchObject({ action: 'restart', changed: ['items', 'hulls'] });
  });

  it('only the 3D logic changed: the model step starts over, the metadata stays', () => {
    const job = pausedInModels(older('hulls'));
    const c = resumeCompat({ job, current: NOW });
    expect(c).toEqual({ action: 'reset', stages: ['skins'], changed: ['hulls'] });
    if (c.action !== 'reset') throw new Error('unreachable');
    const next = applyReset(job, c.stages, NOW);
    expect(next.skins).toEqual({ status: 'pending', doneShips: [] });
    expect(next.catalog.status).toBe('done');
    expect(next.silhouettes.status).toBe('done');
    expect(nextStage(next)).toBe('skins');
    expect(next.origin).toEqual(NOW);
    expect(resumeCompat({ job: next, current: NOW })).toEqual({ action: 'keep' });
  });

  it('only the silhouette logic changed: silhouettes and nothing else start over', () => {
    const job = pausedInModels(older('silhouettes'));
    const c = resumeCompat({ job, current: NOW });
    expect(c).toEqual({ action: 'reset', stages: ['silhouettes'], changed: ['silhouettes'] });
    if (c.action !== 'reset') throw new Error('unreachable');
    const next = applyReset(job, c.stages, NOW);
    expect(nextStage(next)).toBe('silhouettes');
    expect(next.skins.doneShips).toHaveLength(40);
  });

  it('a silhouette reset re-opens its catalog phase, or the new outlines would be skipped', () => {
    const base = pausedInModels(older('silhouettes'));
    const job: UploadJobState = {
      ...base,
      catalog: { ...base.catalog, donePhases: ['codex_ships', 'codex_silhouettes'], cursor: null },
    };
    const next = applyReset(job, ['silhouettes'], NOW);
    expect(next.catalog.donePhases).toEqual(['codex_ships']);
    expect(sentFor(next, 'codex_silhouettes')).toBe(0);
    expect(sentFor(next, 'codex_ships')).toBe(Number.POSITIVE_INFINITY);

    const midPhase: UploadJobState = {
      ...base,
      catalog: { ...base.catalog, cursor: { phase: 'codex_silhouettes', sent: 4000 } },
    };
    expect(applyReset(midPhase, ['silhouettes'], NOW).catalog.cursor).toBeNull();
    // A hull-only reset leaves the catalog cursor alone.
    expect(applyReset(job, ['skins'], NOW).catalog).toEqual(job.catalog);
  });

  it('a changed step that had not run yet only takes the new origin', () => {
    const job: UploadJobState = {
      ...pausedInModels(older('hulls')),
      skins: { status: 'pending', doneShips: [] },
    };
    const c = resumeCompat({ job, current: NOW });
    expect(c).toEqual({ action: 'reset', stages: [], changed: ['hulls'] });
    if (c.action !== 'reset') throw new Error('unreachable');
    expect(applyReset(job, c.stages, NOW)).toEqual({ ...job, origin: NOW });
  });

  it('a job from before origins existed resumes only under the uploader that made its extract', () => {
    const legacy = pausedInModels(null);
    expect(resumeCompat({ job: legacy, current: NOW, extractToolVersion: '0.81.4' })).toEqual({ action: 'keep' });
    expect(resumeCompat({ job: legacy, current: NOW, extractToolVersion: '0.81.3' })).toEqual({
      action: 'restart',
      changed: [],
      reason: 'unknown-origin',
    });
    expect(resumeCompat({ job: legacy, current: NOW, extractToolVersion: null }).action).toBe('restart');
  });

  it('lists exactly the subthemes whose revision moved', () => {
    expect(changedSubthemes(older('weapons', 'silhouettes'), NOW)).toEqual(['weapons', 'silhouettes']);
    expect(changedSubthemes(NOW, NOW)).toEqual([]);
  });
});

describe('the job origin is durable', () => {
  function io(): TextIO {
    let data: string | null = null;
    return { read: () => data, write: (t) => (data = t), remove: () => (data = null) };
  }

  it('survives a save/load round trip', () => {
    const store = new UploadJobStore(io());
    store.save(createJob('j1', 'C:/out', NAT, 1, NOW));
    expect(store.load()?.origin).toEqual(NOW);
  });

  it('a job written without one loads with origin null', () => {
    const store = new UploadJobStore(io());
    store.save(createJob('j1', 'C:/out', NAT, 1));
    expect(store.load()?.origin).toBeNull();
  });
});
