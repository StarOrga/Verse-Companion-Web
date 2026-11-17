// Status mapping for a failure inside an R2 block of ingest-skins (#365).
//
// R2 refusing or timing out (list, get, delete, presign) is transient: the
// request is fine, so the reply is 503 + Retry-After with `transient: true`,
// which the uploader retries with backoff. A database refusal raised inside
// the same block is wrapped in `DbError` and stays a 500 — that one is ours.

/** A database error thrown inside an R2 block, so the catch keeps it a 500. */
export class DbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbError';
  }
}

/** The JSON reply for a failure caught around R2 calls: 503 transient, or 500 for a `DbError`. */
export function r2Failure(code: string, e: unknown, headers: Record<string, string>, path?: string): Response {
  const message = e instanceof Error ? e.message : String(e);
  const db = e instanceof DbError;
  const body = { error: code, ...(db ? {} : { transient: true }), message, ...(path ? { path } : {}) };
  return new Response(JSON.stringify(body), {
    status: db ? 500 : 503,
    headers: { 'content-type': 'application/json', ...(db ? {} : { 'retry-after': '2' }), ...headers },
  });
}
