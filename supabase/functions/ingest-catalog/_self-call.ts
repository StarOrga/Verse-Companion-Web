// One call of ingest-catalog to itself (storage.md § Silhouettes, § Lists).
//
// An edge worker has 2 s of CPU for its whole life, and the worker that answers
// `finalize` has spent most of it on the ingest before. Work that follows a
// finalize therefore runs as requests of its own: each lands on a worker with a
// fresh budget, and a worker killed over one of them costs only that one.
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

/**
 * POSTs `body` (it names its own `op`) to this function. true = the function
 * accepted it (2xx); false = both attempts failed, each logged without the key.
 */
export async function callOwnOp(
  supabaseUrl: string,
  serviceKey: string,
  body: Record<string, unknown>,
  deps: SelfCallDeps = DEFAULT_DEPS,
): Promise<boolean> {
  const what = `${String(body.op)} ${JSON.stringify({ ...body, op: undefined })}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await deps.fetch(`${supabaseUrl}/functions/v1/ingest-catalog`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await res.body?.cancel();
        return true;
      }
      deps.log(`ingest-catalog: own call ${what}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    } catch (e) {
      deps.log(`ingest-catalog: own call ${what} failed: ${(e as Error).message}`);
    }
    if (attempt === 0) await deps.wait(SELF_CALL_RETRY_MS);
  }
  return false;
}
