// One call of ingest-catalog to itself (storage.md § Silhouettes, § Lists).
//
// An edge worker has 2 s of CPU for its whole life, and the worker that answers
// `finalize` has spent most of it on the ingest before. Work that follows a
// finalize therefore runs as requests of its own, so a worker killed over one of
// them costs only that one. A fresh worker is likely, not promised: a worker past
// its soft CPU limit (1 s) is retired and takes no further request, one below it
// still does - then the call lands on a worker with at least a second left.
// WORKER_ID in the log lines of both sides shows which case it was.
//
// The service key goes into both headers (the gateway reads `apikey`, the
// function `authorization`). One retry; the caller decides what a failure means.

export interface SelfCallDeps {
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    body?: { cancel(): Promise<void> } | null;
  }>;
  wait: (ms: number) => Promise<void>;
  log: (message: string) => void;
}

const DEFAULT_DEPS: SelfCallDeps = {
  fetch: (url, init) => fetch(url, init),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (message) => console.error(message),
};

/** Pause before the one retry. */
export const SELF_CALL_RETRY_MS = 2000;

/** Names this worker in log lines (one value per isolate, nothing secret). */
export const WORKER_ID = crypto.randomUUID().slice(0, 8);

export interface SelfCallOptions {
  /**
   * Retry after a request that threw (reset, timeout)? Such a request may have
   * arrived all the same. true only for an op that may run twice: a step of the
   * silhouette chain is repeatable, a detached lists publish is not (two at once
   * can leave the index naming a generation the other one collected).
   * An answer with an error status is always retried: the function refused, nothing ran.
   */
  retryThrown: boolean;
}

/**
 * POSTs `body` (it names its own `op`) to this function. true = the function
 * accepted it (2xx); false = it did not, each failed attempt logged without the key.
 */
export async function callOwnOp(
  supabaseUrl: string,
  serviceKey: string,
  body: Record<string, unknown>,
  options: SelfCallOptions,
  deps: SelfCallDeps = DEFAULT_DEPS,
): Promise<boolean> {
  const what = `${String(body.op)} ${JSON.stringify({ ...body, op: undefined })}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Awaited<ReturnType<SelfCallDeps['fetch']>>;
    try {
      res = await deps.fetch(`${supabaseUrl}/functions/v1/ingest-catalog`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      deps.log(`ingest-catalog: own call ${what} failed: ${(e as Error).message}`);
      if (!options.retryThrown) return false;
      if (attempt === 0) await deps.wait(SELF_CALL_RETRY_MS);
      continue;
    }
    if (res.ok) {
      // The answer is not read; a failure to release it is no failure of the call.
      await res.body?.cancel().catch(() => undefined);
      return true;
    }
    const text = await res.text().catch(() => '');
    deps.log(`ingest-catalog: own call ${what}: HTTP ${res.status} ${text.slice(0, 160)}`);
    if (attempt === 0) await deps.wait(SELF_CALL_RETRY_MS);
  }
  return false;
}
