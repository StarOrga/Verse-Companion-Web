import { describe, it, expect } from 'vitest';
import {
  JOB_STALL_MS,
  SKIN_STALL_MS,
  jobStallReport,
  newStallTracker,
  noteStallEvent,
  stallCounter,
  stallTimeoutFor,
} from '../src/lib/job-stall.js';

describe('stallTimeoutFor', () => {
  it('gives the 3D build a window longer than its longest tool call (900 s)', () => {
    expect(stallTimeoutFor('skin')).toBe(SKIN_STALL_MS);
    expect(SKIN_STALL_MS).toBeGreaterThan(900_000);
  });

  it('keeps 5 min for the raw extraction', () => {
    expect(stallTimeoutFor('extract')).toBe(JOB_STALL_MS);
    expect(JOB_STALL_MS).toBe(300_000);
  });
});

describe('stall tracker', () => {
  it('remembers the last phase, counter and log line', () => {
    const t = newStallTracker();
    noteStallEvent(t, { type: 'phase', phase: 'bundle' });
    noteStallEvent(t, { type: 'progress', stage: 'armor-packages', current: 133, total: 4456 });
    noteStallEvent(t, { type: 'log', level: 'info', message: '  convert Data/Objects/a.cgf ' });
    noteStallEvent(t, { type: 'pulse' });
    expect(t.phase).toBe('bundle');
    expect(stallCounter(t)).toBe('armor-packages 133/4456');
    expect(t.lastLog).toBe('convert Data/Objects/a.cgf');
  });

  it('shows a counter without a total as a running count', () => {
    const t = newStallTracker();
    noteStallEvent(t, { type: 'progress', stage: 'open', current: 7 });
    expect(stallCounter(t)).toBe('open 7');
    noteStallEvent(t, { type: 'progress', stage: 'open' });
    expect(stallCounter(t)).toBe('open');
  });
});

describe('jobStallReport', () => {
  it('carries the waited time, phase, counter and last log line', () => {
    const t = newStallTracker();
    noteStallEvent(t, { type: 'phase', phase: 'bundle' });
    noteStallEvent(t, { type: 'progress', stage: 'armor-packages', current: 133, total: 4456 });
    noteStallEvent(t, { type: 'log', level: 'info', message: 'convert C:/Users/jerry/x/a.cgf' });
    const r = jobStallReport('skin', 'skin-1', 1_234_567, t);
    expect(r.name).toBe('JobStall');
    // Stage name only — no counters in the grouping text.
    expect(r.message).toBe('skin job made no progress for 1235s (armor-packages)');
    expect(r.extra).toEqual({
      kind: 'skin',
      jobId: 'skin-1',
      idleMs: 1_234_567,
      timeoutMs: SKIN_STALL_MS,
      phase: 'bundle',
      counter: 'armor-packages 133/4456',
      lastLog: 'convert C:/Users/<user>/x/a.cgf',
    });
  });

  it('falls back to the phase, then to the bare message', () => {
    const t = newStallTracker();
    expect(jobStallReport('extract', 'j', 300_000, t).message).toBe('extract job made no progress for 300s');
    noteStallEvent(t, { type: 'phase', phase: 'discover' });
    expect(jobStallReport('extract', 'j', 300_000, t).message).toBe('extract job made no progress for 300s (discover)');
  });
});
