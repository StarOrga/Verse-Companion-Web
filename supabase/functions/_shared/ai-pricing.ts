// LLM call pricing for the ai_calls ledger (contract §2). Pure module.
//
// USD per million tokens at the LIST (synchronous) rate. The Message Batches
// API bills 50 %: pass `{ batch: true }`. translate-orchestrator keeps its own
// batch table in translate-orchestrator/_cost.ts (same numbers, halved); the
// anthropic rows below are those numbers doubled, so the two never drift apart
// silently (see ai-pricing.test.ts).

export interface ModelPrice { in: number; out: number }

export const LIST_PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': { in: 8, out: 40 },
  'claude-sonnet-5-5': { in: 4, out: 20 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'grok-3-mini': { in: 0.3, out: 0.5 },
};

/** Unknown model: price like the dearest Claude so the ledger never under-reports. */
const FALLBACK: ModelPrice = LIST_PRICES['claude-opus-5-5'];
export const CACHE_READ_FACTOR = 0.1;
export const CACHE_WRITE_FACTOR = 1.25; // 5-minute cache write; the orchestrator's 1 h writes use _cost.ts
export const WEB_SEARCH_USD = 0.01;

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  web_search_requests?: number;
}

/** Model ids may carry a date suffix (`claude-haiku-4-5-20251001`). */
export function priceFor(model: string): ModelPrice {
  if (LIST_PRICES[model]) return LIST_PRICES[model];
  const base = Object.keys(LIST_PRICES).find((k) => model.startsWith(k));
  return base ? LIST_PRICES[base] : FALLBACK;
}

export function costUsd(model: string, u: TokenUsage, opts: { batch?: boolean } = {}): number {
  const p = priceFor(model);
  const factor = opts.batch ? 0.5 : 1;
  const inTok = u.input_tokens ?? 0;
  const out = u.output_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const tokens = (inTok * p.in + read * p.in * CACHE_READ_FACTOR + write * p.in * CACHE_WRITE_FACTOR + out * p.out) / 1e6;
  return Math.round((tokens * factor + (u.web_search_requests ?? 0) * WEB_SEARCH_USD) * 1e6) / 1e6;
}
