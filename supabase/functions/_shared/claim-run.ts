// Atomic run claim for the verify_jwt=false cron endpoints (migration 20261116100000_claim_run.sql).
// One SQL statement decides: true = this caller owns the run, false = another claim is younger than minMs.
// Fails CLOSED: when the rpc is missing or errors, nobody runs (a paid run must never depend on a broken throttle).
// `db` is the service-role client; the rpc is service_role only.

export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** Postgres interval literal for a millisecond span (whole seconds, at least 1). */
export function intervalOf(minMs: number): string {
  return `${Math.max(1, Math.ceil(minMs / 1000))} seconds`;
}

export async function claimRun(db: RpcClient, name: string, minMs: number): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('claim_run', { p_name: name, p_min_interval: intervalOf(minMs) });
    if (error) {
      console.warn(`[claim-run] ${name}: ${error.message}`);
      return false;
    }
    return data === true;
  } catch (e) {
    console.warn(`[claim-run] ${name}: ${(e as Error).message}`);
    return false;
  }
}
