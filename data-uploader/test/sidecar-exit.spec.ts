import { describe, it, expect } from 'vitest';

import { formatExitCode, sidecarExitError, stderrLevel, StderrTail } from '../src/lib/sidecar-exit.js';

describe('sidecarExitError', () => {
  it('prefers the structured error event over everything else', () => {
    const tail = new StderrTail();
    tail.push('Traceback (most recent call last):');
    expect(sidecarExitError({ lastError: 'converter missing', code: 1, signal: null, tail })).toBe('converter missing');
  });

  it('carries the stderr tail and the exit code when the sidecar died without one', () => {
    const tail = new StderrTail(2);
    tail.push('Traceback (most recent call last):');
    tail.push('File "x.py", line 3');
    tail.push('MemoryError');
    // Only the last two lines survive a tail of two.
    expect(sidecarExitError({ code: 1, signal: null, tail })).toBe(
      'python exited with code 1 — stderr: File "x.py", line 3 / MemoryError',
    );
  });

  it('names a Windows crash status in hex', () => {
    expect(formatExitCode(3221225477)).toBe('0xC0000005');
    expect(sidecarExitError({ code: 3221225477, signal: null, tail: new StderrTail() })).toBe(
      'python exited with code 0xC0000005',
    );
  });

  it('says so when a clean exit brought no result', () => {
    expect(sidecarExitError({ code: 0, signal: null, tail: new StderrTail() })).toBe(
      "python exited 0 but emitted no 'done' event",
    );
    expect(sidecarExitError({ code: null, signal: 'SIGTERM', tail: new StderrTail() })).toBe('killed by signal SIGTERM');
  });
});

describe('stderrLevel', () => {
  it('raises crash signatures and leaves chatter at info', () => {
    expect(stderrLevel('Traceback (most recent call last):')).toBe('error');
    expect(stderrLevel('MemoryError')).toBe('error');
    expect(stderrLevel('Fatal Python error: Segmentation fault')).toBe('error');
    expect(stderrLevel('gltf-transform: optimizing')).toBe('info');
  });
});
