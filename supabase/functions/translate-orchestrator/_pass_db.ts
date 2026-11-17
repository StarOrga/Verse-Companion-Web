// Postgres adapter of the passes (table `translation_passes`, migration 20261117150000).
// Runs with the service-role client; RLS is bypassed, auth happens in index.ts.

import type { Pass, PassDb, PassRequest } from './_pass.ts';
import { learnStep } from './_learn_pass.ts';
import { overlayStep } from './_overlay.ts';
import type { PassKind, PassStep } from './_pass.ts';
import { seedStep } from './_seed_pass.ts';

// deno-lint-ignore no-explicit-any
type Client = any;

/** The step of every pass kind (the tick hands this to `advancePass`). */
export const PASS_STEPS: Record<PassKind, PassStep> = { learn: learnStep, seed: seedStep, overlay: overlayStep };

function fail(e: { message?: string } | null): never {
  throw new Error(e?.message ?? 'db error');
}

export function makePassDb(sb: Client, now: () => Date): PassDb {
  const T = 'translation_passes';
  const insert = (req: PassRequest) =>
    sb.from(T).insert({
      kind: req.kind, lang: req.lang, source_id: req.source_id ?? null, reason: req.reason, state: req.state ?? {},
    }).select('*').maybeSingle();
  return {
    async listOpen() {
      const { data, error } = await sb.from(T).select('*').eq('status', 'open').order('created_at');
      if (error) fail(error);
      return (data ?? []) as Pass[];
    },
    async get(id) {
      const { data, error } = await sb.from(T).select('*').eq('id', id).maybeSingle();
      if (error) fail(error);
      return (data as Pass | null) ?? null;
    },
    async cas(pass, patch) {
      const { data, error } = await sb.from(T)
        .update({ ...patch, updated_at: now().toISOString() })
        .eq('id', pass.id).eq('status', pass.status).eq('updated_at', pass.updated_at)
        .select('*').maybeSingle();
      if (error) fail(error);
      return (data as Pass | null) ?? null;
    },
    async open(req) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const ins = await insert(req);
        if (!ins.error && ins.data) return ins.data as Pass;
        // 23505 on translation_passes_one_open: one is running. It is told to run once more; `updated_at`
        // stays as it is, so the slice in flight keeps its compare-and-set.
        if (ins.error && ins.error.code !== '23505') fail(ins.error);
        let q = sb.from(T).update({ again: true }).eq('kind', req.kind).eq('lang', req.lang).eq('status', 'open');
        q = req.source_id ? q.eq('source_id', req.source_id) : q.is('source_id', null);
        const { data, error } = await q.select('*').maybeSingle();
        if (error) fail(error);
        if (data) return data as Pass;
        // It ended between the two statements: insert again.
      }
      throw new Error('translate pass could not be opened');
    },
  };
}
