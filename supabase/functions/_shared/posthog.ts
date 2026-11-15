// STUB: replaced by core-A (contract §1). Exact exported signatures, no-op bodies - the merge must resolve to core-A's file.
export function serverDistinctId(fn: string): string { return `server:${fn}`; }
export async function captureServer(_event: string, _props: Record<string, unknown>, _opts?: { fn?: string; distinctId?: string; timestamp?: string }): Promise<void> {}
export async function captureBatch(_events: { event: string; distinct_id: string; properties: Record<string, unknown>; timestamp?: string }[]): Promise<void> {}
export async function captureServerException(_fn: string, _err: unknown, _extra?: Record<string, unknown>): Promise<void> {}
export async function captureAiGeneration(_g: { fn: string; model: string; provider?: 'anthropic' | 'openai' | 'xai'; inputTokens?: number; outputTokens?: number; cacheRead?: number; cacheWrite?: number; costUsd?: number; latencyMs: number; ok: boolean; status?: number; error?: string; traceId?: string }): Promise<void> {}
export function withPosthog(_fn: string, handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> { return handler; }
