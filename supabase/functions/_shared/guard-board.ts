// Board writer of the PostHog guard (service role). Applies the H5 rules: max 3 new machine items per UTC day,
// the same external_ref = one item (repeat → system thread message), overflow → one summary item per day.
// Imported by posthog-signal and service-health (Deno only; the decisions live in posthog-guard.ts and are tested).
import { MAX_MACHINE_ITEMS_PER_DAY, buildSummaryBody, decideBoardAction, isSummaryRef, summaryRef, utcDay, type Origin } from './posthog-guard.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export interface MachineFinding {
  origin: Exclude<Origin, 'human'>;
  ref: string;
  /** Complete German Markdown body (buildItemBody). */
  body: string;
  /** One line for the summary / thread message when the item is not created. */
  line: string;
  /** Quota items: one per product per period, even after the first one was shipped. */
  oncePerPeriod?: boolean;
}

export type FileResult = { action: 'created' | 'appended' | 'skipped' | 'overflow'; id?: string };

async function addSystemMessage(db: Db, feedbackId: string, body: string) {
  const { error } = await db.from('admin_feedback_messages').insert({ feedback_id: feedbackId, author_id: null, is_system: true, body });
  if (error) console.warn(`[guard-board] system message failed: ${error.message}`);
}

export async function fileFinding(db: Db, f: MachineFinding, now = new Date()): Promise<FileResult> {
  const day = utcDay(now);
  const open = await db.from('admin_feedback').select('id').eq('external_ref', f.ref).in('status', ['open', 'in_progress', 'needs_input']).limit(1);
  const existingOpen = open.data?.[0]?.id as string | undefined;
  let anyExists = false;
  if (f.oncePerPeriod && !existingOpen) {
    const any = await db.from('admin_feedback').select('id').eq('external_ref', f.ref).limit(1);
    anyExists = !!any.data?.length;
  }
  const since = `${day}T00:00:00.000Z`;
  const cnt = await db.from('admin_feedback').select('id, external_ref', { count: 'exact' }).neq('origin', 'human').gte('created_at', since);
  const newToday = ((cnt.data ?? []) as { external_ref: string | null }[]).filter((r) => !isSummaryRef(r.external_ref)).length;

  const action = decideBoardAction({ existingOpen: !!existingOpen, existingAnyStatus: anyExists, oncePerPeriod: !!f.oncePerPeriod, newToday, cap: MAX_MACHINE_ITEMS_PER_DAY });

  if (action === 'append' && existingOpen) {
    await addSystemMessage(db, existingOpen, `Erneut aufgetreten (${now.toISOString().slice(0, 16).replace('T', ' ')} UTC): ${f.line}`);
    return { action: 'appended', id: existingOpen };
  }
  if (action === 'skip') return { action: 'skipped' };
  if (action === 'create') {
    const ins = await db.from('admin_feedback').insert({ author_id: null, body: f.body, status: 'open', origin: f.origin, external_ref: f.ref }).select('id').single();
    if (ins.error) {
      // 23505 = a parallel run created the same open ref first → treat as a repeat.
      if (ins.error.code === '23505') {
        const again = await db.from('admin_feedback').select('id').eq('external_ref', f.ref).in('status', ['open', 'in_progress', 'needs_input']).limit(1);
        const id = again.data?.[0]?.id as string | undefined;
        if (id) { await addSystemMessage(db, id, `Erneut aufgetreten: ${f.line}`); return { action: 'appended', id }; }
      }
      console.warn(`[guard-board] insert failed: ${ins.error.message}`);
      return { action: 'skipped' };
    }
    return { action: 'created', id: ins.data.id as string };
  }
  // overflow → one summary item per day
  const ref = summaryRef(day);
  const sum = await db.from('admin_feedback').select('id, body').eq('external_ref', ref).in('status', ['open', 'in_progress', 'needs_input']).limit(1);
  const row = sum.data?.[0] as { id: string; body: string } | undefined;
  if (row) {
    await addSystemMessage(db, row.id, `Weiterer Fund: ${f.line}`);
    return { action: 'overflow', id: row.id };
  }
  const ins = await db.from('admin_feedback').insert({ author_id: null, body: buildSummaryBody(day, [f.line]), status: 'open', origin: f.origin, external_ref: ref }).select('id').single();
  if (ins.error) console.warn(`[guard-board] summary insert failed: ${ins.error.message}`);
  return { action: 'overflow', id: ins.data?.id };
}

/** Throttle for the verify_jwt=false cron endpoints: true when the mode ran less than minMs ago. Stamps on pass. */
export async function throttled(db: Db, mode: string, minMs: number, now = new Date()): Promise<boolean> {
  const r = await db.from('guard_runs').select('last_run_at').eq('mode', mode).maybeSingle();
  const last = r.data?.last_run_at ? Date.parse(r.data.last_run_at) : 0;
  if (now.getTime() - last < minMs) return true;
  await db.from('guard_runs').upsert({ mode, last_run_at: now.toISOString() });
  return false;
}
