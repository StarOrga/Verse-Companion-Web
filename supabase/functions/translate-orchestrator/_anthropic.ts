// Message Batches adapter over the Anthropic TypeScript SDK. Deno only (npm: specifier);
// the state machine sees just the `Llm` interface, tests never import this file.

import Anthropic from 'npm:@anthropic-ai/sdk';
import type { BatchResult, Llm } from './_machine.ts';
import { recordAiCalls, type AiCallRow } from '../_shared/ai-ledger.ts';
import { usageCostUsd } from './_cost.ts';

/** Batch results already booked by this isolate, so a re-read of the same batch does not book twice. */
const booked = new Set<string>();

export function makeLlm(apiKey: string): Llm {
  // deno-lint-ignore no-explicit-any
  const client: any = new Anthropic({ apiKey });
  return {
    async createBatch(requests) {
      const b = await client.messages.batches.create({ requests });
      return { id: b.id as string };
    },
    async isEnded(id) {
      const b = await client.messages.batches.retrieve(id);
      return b.processing_status === 'ended';
    },
    async *results(id): AsyncGenerator<BatchResult> {
      // Results arrive in any order: the caller keys on custom_id.
      // One ledger row per result (Batch rate, usageCostUsd), written in one go once the stream ends.
      const rows: AiCallRow[] = [];
      try {
        for await (const row of await client.messages.batches.results(id)) {
          const r = row.result;
          const fresh = !booked.has(id + ':' + row.custom_id);
          booked.add(id + ':' + row.custom_id);
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
