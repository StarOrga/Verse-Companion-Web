// Claude call ledger (contract §2): one `public.ai_calls` row + one PostHog
// `$ai_generation` per model call. Metadata only, never prompt or output text.
//
// `callClaude` is the one wrapper for a direct Messages API call; call sites
// that cannot use it (batch results, OpenAI-compatible fallbacks) call
// `recordAiCall` after their own fetch. Neither ever throws on a ledger or
// PostHog failure: observing a call must not break it.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { costUsd, type TokenUsage } from './ai-pricing.ts';
import { buildAiGeneration, captureBatch, redactText, type AiGeneration } from './posthog.ts';

export interface AiCallRow {
  function: string;
  model: string;
  provider?: 'anthropic' | 'openai' | 'xai';
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_usd?: number;
  latency_ms: number;
  ok: boolean;
  status?: number;
  error?: string;
  probe?: boolean;
}

/** The DB row for an AiCallRow (defaults + error redaction), exported for tests. */
export function toDbRow(row: AiCallRow): Record<string, unknown> {
  return {
    function: row.function,
    model: row.model,
    provider: row.provider ?? 'anthropic',
    input_tokens: row.input_tokens ?? null,
    output_tokens: row.output_tokens ?? null,
    cache_read_tokens: row.cache_read_tokens ?? null,
    cache_write_tokens: row.cache_write_tokens ?? null,
    cost_usd: row.cost_usd ?? null,
    latency_ms: Math.round(row.latency_ms),
    ok: row.ok,
    status: row.status ?? null,
    error: row.error ? redactText(row.error, 300) : null,
    probe: row.probe ?? false,
  };
}

function genOf(row: AiCallRow): AiGeneration {
  return {
    fn: row.function,
    model: row.model,
    provider: row.provider,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheRead: row.cache_read_tokens,
    cacheWrite: row.cache_write_tokens,
    costUsd: row.cost_usd,
    latencyMs: row.latency_ms,
    ok: row.ok,
    status: row.status,
    error: row.error,
  };
}

/** Several rows in one insert + one PostHog batch (batch results). Never throws. */
export async function recordAiCalls(rows: AiCallRow[]): Promise<void> {
  if (rows.length === 0) return;
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const writes: Promise<unknown>[] = [captureBatch(rows.map((r) => buildAiGeneration(genOf(r))))];
  if (url && key) {
    const db = createClient(url, key, { auth: { persistSession: false } });
    writes.push(
      Promise.resolve(db.from('ai_calls').insert(rows.map(toDbRow))).then(({ error }) => {
        if (error) console.warn(`[ai-ledger] insert failed: ${redactText(error.message, 120)}`);
      }),
    );
  }
  try { await Promise.allSettled(writes); } catch { /* never throws */ }
}

export function recordAiCall(row: AiCallRow): Promise<void> {
  return recordAiCalls([row]);
}

export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function rowFromUsage(
  fn: string,
  model: string,
  usage: ClaudeUsage | undefined,
  latencyMs: number,
  extra: Partial<AiCallRow> = {},
): AiCallRow {
  const u: TokenUsage = usage ?? {};
  return {
    function: fn,
    model,
    provider: 'anthropic',
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_tokens: u.cache_read_input_tokens,
    cache_write_tokens: u.cache_creation_input_tokens,
    cost_usd: usage ? costUsd(model, u) : undefined,
    latency_ms: latencyMs,
    ok: true,
    ...extra,
  };
}

/**
 * POST one Messages API request, record the outcome, return the parsed body.
 * Throws `anthropic <status>` on a non-2xx (after recording it), so call sites
 * keep their existing error handling.
 */
export async function callClaude<T = { content?: Array<{ type: string; text?: string }> }>(
  fn: string,
  apiKey: string,
  payload: { model: string } & Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    await recordAiCall({
      function: fn, model: payload.model, latency_ms: Date.now() - started, ok: false,
      error: (e as Error)?.name === 'TimeoutError' ? 'timeout' : (e as Error)?.message ?? 'network',
    });
    throw e;
  }
  if (!res.ok) {
    await res.body?.cancel();
    await recordAiCall({ function: fn, model: payload.model, latency_ms: Date.now() - started, ok: false, status: res.status, error: `HTTP ${res.status}` });
    throw new Error(`anthropic ${res.status}`);
  }
  const body = (await res.json()) as T & { usage?: ClaudeUsage; model?: string };
  await recordAiCall(rowFromUsage(fn, body.model ?? payload.model, body.usage, Date.now() - started, { status: res.status }));
  return body;
}
