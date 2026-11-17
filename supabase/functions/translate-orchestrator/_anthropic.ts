// Message Batches adapter over the Anthropic TypeScript SDK. Deno only (npm: specifier);
// the state machine sees just the `Llm` interface, tests never import this file.

import Anthropic from 'npm:@anthropic-ai/sdk';
import type { BatchResult, Llm } from './_job.ts';
import { recordAiCalls, type AiCallRow } from '../_shared/ai-ledger.ts';
import { usageCostUsd } from './_cost.ts';

// A request must end well inside the life of an edge request (150 s) and of the heavy-work lock, or a
// second request slices beside one that still hangs in a fetch.
const CREATE_TIMEOUT_MS = 90_000;
const ASK_TIMEOUT_MS = 20_000;

/** Batch results already booked by this isolate, so a re-read of the same batch does not book twice. */
const booked = new Set<string>();

export function makeLlm(apiKey: string): Llm {
  // deno-lint-ignore no-explicit-any
  const client: any = new Anthropic({ apiKey });
  return {
    async createBatch(requests) {
      // No retry by the SDK: a create it sends again after a lost answer is a second paid batch that
      // nobody knows of. The caller counts what may exist twice (_job_run.ts: createBatch).
      const b = await client.messages.batches.create({ requests }, { maxRetries: 0, timeout: CREATE_TIMEOUT_MS });
      return { id: b.id as string };
    },
    async isEnded(id) {
      const b = await client.messages.batches.retrieve(id, { timeout: ASK_TIMEOUT_MS });
      return b.processing_status === 'ended';
    },
    async *results(id, opts): AsyncGenerator<BatchResult> {
      // Results arrive in any order: the caller keys on custom_id.
      // One ledger row per result (Batch rate, usageCostUsd), written in one go once the stream ends.
      // A read that only looks at the bill (`record: false`) logs nothing: the batch is read again
      // later, usually by another worker, and would be in the call log twice.
      const record = opts?.record !== false;
      const rows: AiCallRow[] = [];
      try {
        for await (const row of await client.messages.batches.results(id)) {
          const r = row.result;
          const fresh = record && !booked.has(id + ':' + row.custom_id);
          if (record) booked.add(id + ':' + row.custom_id);
          if (r.type !== 'succeeded') {
            if (fresh) rows.push({ function: 'translate-orchestrator', model: 'unknown', latency_ms: 0, ok: false, error: r.type });
            yield { custom_id: row.custom_id, type: r.type };
            continue;
          }
          const text = (r.message.content ?? [])
            .filter((c: { type: string }) => c.type === 'text')
            .map((c: { text: string }) => c.text)
            .join('');
          const u = r.message.usage ?? {};
          if (fresh) {
            rows.push({
              function: 'translate-orchestrator', model: r.message.model, input_tokens: u.input_tokens, output_tokens: u.output_tokens,
              cache_read_tokens: u.cache_read_input_tokens, cache_write_tokens: u.cache_creation_input_tokens,
              cost_usd: usageCostUsd(r.message.model, u), latency_ms: 0, ok: true,
            });
          }
          yield {
            custom_id: row.custom_id,
            type: 'succeeded',
            text,
            stop_reason: r.message.stop_reason,
            usage: r.message.usage,
            model: r.message.model,
          };
        }
      } finally {
        await recordAiCalls(rows);
      }
    },
    async cancel(id) {
      await client.messages.batches.cancel(id);
    },
  };
}
