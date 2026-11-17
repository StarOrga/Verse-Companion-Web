// Cost model with measured ratios (pilot 2026-10-29, countTokens on real chunks).
// Prices are USD per million tokens at the Message Batches rate (50 % of list).

export const PRICES = {
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-opus-5-5': { in: 4, out: 20 },
  // Batch rate for prompts up to 100k tokens (the learning step never sends more); checked 2026-11-08.
  'claude-haiku-5-5': { in: 0.05, out: 0.25 },
} as const;

/** Web search tool: USD 10 per 1 000 searches, billed on top of tokens, same in batches (docs 2026-11-08). */
export const WEB_SEARCH_USD = 0.01;

export type ModelId = keyof typeof PRICES;

/** Input tokens per character, keys and JSON framing included. */
export const INPUT_TOK_PER_CHAR = 0.9;
/** Target output tokens per English character (German measured; other languages use the default until measured). */
export const OUTPUT_TOK_PER_CHAR: Record<string, number> = { de: 0.87 };
export const OUTPUT_TOK_PER_CHAR_DEFAULT = 0.87;
/** Opus 5.5 cannot switch thinking off: extra output tokens. */
export const OPUS_THINKING_FACTOR = 1.3;
/** JSON array framing per string (`"…",`). */
export const OUTPUT_TOK_PER_STRING = 3;
export const CACHE_READ_FACTOR = 0.1;
export const CACHE_WRITE_1H_FACTOR = 2;

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
}

export function priceOf(model: string): { in: number; out: number } {
  return PRICES[model as ModelId] ?? PRICES['claude-opus-5-5'];
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars * INPUT_TOK_PER_CHAR);
}

export interface ChunkCostInput {
  model: string;
  /** Characters of keys + masked text sent in the user message. */
  inputChars: number;
  /** Characters of English text to translate. */
  enChars: number;
  strings: number;
}

export function estimateOutputTokens(lang: string, c: Pick<ChunkCostInput, 'model' | 'enChars' | 'strings'>): number {
  const per = OUTPUT_TOK_PER_CHAR[lang] ?? OUTPUT_TOK_PER_CHAR_DEFAULT;
  const base = c.enChars * per + c.strings * OUTPUT_TOK_PER_STRING;
  return Math.ceil(c.model === 'claude-opus-5-5' ? base * OPUS_THINKING_FACTOR : base);
}

/** max_tokens for one request: ≈ 2.5× the estimated output, clamped. */
export function maxTokensFor(lang: string, c: Pick<ChunkCostInput, 'model' | 'enChars' | 'strings'>): number {
  return Math.min(64_000, Math.max(2048, Math.ceil(estimateOutputTokens(lang, c) * 2.5)));
}

/** Real spend of one batch result from its `usage` (thinking tokens are inside output_tokens). */
export function usageCostUsd(model: string, u: Usage): number {
  const p = priceOf(model);
  const inTok = u.input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const out = u.output_tokens ?? 0;
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  return (inTok * p.in + read * p.in * CACHE_READ_FACTOR + write * p.in * CACHE_WRITE_1H_FACTOR + out * p.out) / 1e6 +
    searches * WEB_SEARCH_USD;
}

export interface Estimate {
  usd: number;
  inputTokens: number;
  outputTokens: number;
  byModel: Record<string, { requests: number; usd: number }>;
}

/** Per model: the number of requests and the token sums of their user messages and answers. */
export type CostTotals = Record<string, { requests: number; inTok: number; outTok: number }>;

/**
 * Estimate from per-model totals (what a sliced estimate adds up request by request). The system
 * prompt is paid as one cache write per model, then cache reads (batch caching is best effort; this
 * is the expected case, `usageCostUsd` books the truth afterwards).
 */
export function estimateFromTotals(totals: CostTotals, systemTokens: number): Estimate {
  const byModel: Estimate['byModel'] = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let usd = 0;
  for (const model of Object.keys(totals).sort()) {
    const t = totals[model];
    if (!t.requests) continue;
    const p = priceOf(model);
    const sys = systemTokens * (CACHE_WRITE_1H_FACTOR + (t.requests - 1) * CACHE_READ_FACTOR);
    const cost = ((t.inTok + sys) * p.in + t.outTok * p.out) / 1e6;
    inputTokens += t.inTok + systemTokens * t.requests;
    outputTokens += t.outTok;
    usd += cost;
    byModel[model] = { requests: t.requests, usd: cost };
  }
  return { usd, inputTokens, outputTokens, byModel };
}

/** Estimate for a set of requests (see `estimateFromTotals`). */
export function estimateJob(lang: string, chunks: ChunkCostInput[], systemTokens: number): Estimate {
  const totals: CostTotals = {};
  for (const c of chunks) {
    const t = (totals[c.model] ??= { requests: 0, inTok: 0, outTok: 0 });
    t.requests++;
    t.inTok += estimateTokens(c.inputChars);
    t.outTok += estimateOutputTokens(lang, c);
  }
  return estimateFromTotals(totals, systemTokens);
}
