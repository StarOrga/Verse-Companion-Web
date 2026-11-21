/**
 * How a Python sidecar (skin export, silhouette build) that ended without a
 * result is described. Pure, so the wording is unit-testable.
 *
 * LIVE 4.10.3, 2026-11-21 01:53: the skin export stopped at armor package
 * 1/4456 and main.log held nothing about it — the bridges handed stderr to the
 * renderer only, and the exit code never reached the log. The run then closed
 * as "nothing to do". The stderr tail and the exit code now travel with the
 * error, and the caller writes it to main.log.
 */

/** stderr lines that mean the interpreter is going down, not chatter. */
const FATAL_LINE =
  /Traceback|Error:|Exception|MemoryError|ModuleNotFoundError|ImportError|UnicodeEncodeError|SyntaxError|Fatal Python error/;

/** Log level for one stderr line: a crash signature is an error, the rest is info. */
export function stderrLevel(line: string): 'error' | 'info' {
  return FATAL_LINE.test(line) ? 'error' : 'info';
}

/** The last few stderr lines, for the exit message. */
export class StderrTail {
  private readonly lines: string[] = [];
  constructor(private readonly max = 12) {}

  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.max) this.lines.shift();
  }

  get size(): number {
    return this.lines.length;
  }

  toString(): string {
    return this.lines.join(' / ');
  }
}

/**
 * Windows reports NTSTATUS crash codes as large unsigned numbers
 * (3221225477); in hex (0xC0000005) they can be looked up.
 */
export function formatExitCode(code: number | null): string {
  if (code === null) return 'null';
  return code >= 0x80000000 ? `0x${code.toString(16).toUpperCase()}` : String(code);
}

/** The error of a sidecar that exited without its `done` result. */
export function sidecarExitError(opts: {
  lastError?: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  tail: StderrTail;
}): string {
  // A structured error event says what went wrong in the sidecar's own words.
  if (opts.lastError) return opts.lastError;
  const how = opts.signal
    ? `killed by signal ${opts.signal}`
    : opts.code === 0
      ? "python exited 0 but emitted no 'done' event"
      : `python exited with code ${formatExitCode(opts.code)}`;
  return opts.tail.size ? `${how} — stderr: ${opts.tail.toString()}` : how;
}
