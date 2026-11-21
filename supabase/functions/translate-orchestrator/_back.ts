// German back-translations of KI decisions (concept karteikarten-neu P6): the veto list shows every
// text the pipeline chose in a language nobody judges together with what it means in German, so an admin
// who cannot read Italian can still spot "Propulsore principale (Aegis Idris)". One Haiku batch per
// language and learn pass, ≤ BACK_ITEMS texts, under the monthly cap like every learning batch.

import { HAIKU_MODEL } from './_learn.ts';
import type { LearnState, LearnSummary } from './_learn.ts';
import { jsonParams, resultJson, spendBlock, submitLearnBatch } from './_learn_batch.ts';
import type { LearnDeps } from './_learn_batch.ts';
import type { LearnSettings } from './_learn_db.ts';
import type { BatchParams, BatchResult } from './_job.ts';
import { LANG_NAMES } from './_prompt.ts';

export const BACK_ITEMS = 100;
const BACK_PER_REQUEST = 50;

export interface BackItem {
  card_id: string;
  en: string;
  text: string;
}

export const BACK_SCHEMA = {
  type: 'object',
  properties: { t: { type: 'array', items: { type: 'string' } } },
  required: ['t'],
  additionalProperties: false,
};

/** One request per 50 texts: [English, chosen text] → the German meaning of the chosen text. */
export function backRequests(lang: string, items: BackItem[]): { custom_id: string; params: BatchParams }[] {
  const name = LANG_NAMES[lang] ?? lang;
  const system = `You help a German reviewer who cannot read ${name}. Each entry is [English source, ${name} translation] from the game Star Citizen. Translate the ${name} text back into German literally, so the reviewer sees what it really says (keep proper names, placeholders and tags as they are). Do not correct or improve it. Return only JSON {"t":[...]}, one German string per entry, input order.`;
  const reqs: { custom_id: string; params: BatchParams }[] = [];
  for (let g = 0; g * BACK_PER_REQUEST < items.length; g++) {
    const part = items.slice(g * BACK_PER_REQUEST, (g + 1) * BACK_PER_REQUEST);
    const chars = part.reduce((a, x) => a + x.text.length, 0);
    reqs.push({ custom_id: `b${g}`, params: jsonParams(HAIKU_MODEL, system, JSON.stringify(part.map((x) => [x.en, x.text])), BACK_SCHEMA, Math.ceil(chars * 2) + 300) });
  }
  return reqs;
}

/** card id → German text, only for complete, well-formed groups. */
export function parseBack(items: BackItem[], results: Map<string, BatchResult>): Map<string, string> {
  const out = new Map<string, string>();
  for (let g = 0; g * BACK_PER_REQUEST < items.length; g++) {
    const part = items.slice(g * BACK_PER_REQUEST, (g + 1) * BACK_PER_REQUEST);
    const o = resultJson(results.get(`b${g}`)) as { t?: unknown } | null;
    if (!o || !Array.isArray(o.t) || o.t.length !== part.length) continue;
    part.forEach((x, j) => {
      const t = String(o.t[j] ?? '').trim();
      if (t) out.set(x.card_id, t.slice(0, 500));
    });
  }
  return out;
}

/** Submits the back-translation batch of a language (KI decisions without one); `before` records the intent. */
export async function submitBack(
  d: LearnDeps, lang: string, settings: LearnSettings, state: LearnState, sum: LearnSummary, before?: () => Promise<void>,
): Promise<void> {
  if (state.back || !d.learn.listCards) return;
  const rows = await d.learn.listCards({ lang, status: ['ai'], needBack: true, limit: BACK_ITEMS });
  const items = rows.filter((c) => c.id && c.ai_text).map((c): BackItem => ({
    card_id: c.id!, en: String((c.params as { en?: string; term?: string })?.en ?? (c.params as { term?: string })?.term ?? ''), text: c.ai_text!,
  }));
  if (!items.length) return;
  const est = (items.length * 120 * 1 + 1500) / 1e6 * 5;
  const block = await spendBlock(d, settings, est);
  if (block) {
    sum.blocked.push(`back:${block}`);
    return;
  }
  await before?.();
  const id = await submitLearnBatch(d, backRequests(lang, items));
  state.back = { id, submitted_at: d.now().toISOString(), items };
  sum.back = { written: 0, ...sum.back, submitted: items.length };
}

/** Writes the back-translations of an ended batch onto their cards. */
export async function applyBack(d: LearnDeps, items: BackItem[], results: Map<string, BatchResult>): Promise<number> {
  if (!d.learn.updateCard) return 0;
  const got = parseBack(items, results);
  for (const [id, t] of got) await d.learn.updateCard(id, { ai_back: t });
  return got.size;
}
