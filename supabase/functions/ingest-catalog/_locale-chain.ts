// The locale publish after a finalize as a chain of requests, one language each
// (_self-call.ts). It used to run on the worker that answered `finalize`, which has
// spent most of its 2 s of CPU on the ingest: for 4.10.3 LIVE (2026-11-21) that
// worker died during the publish, no language reached R2, nothing but a log line
// said so, and the translation pipeline found no English source for the build.
//
// A step publishes the first language of `langs` and hands the rest, with what it
// and the steps before it achieved (`done`), to the next request. The last step
// opens the translation jobs from `done`. English goes first: it is the source
// the translation pipeline needs and the fallback of every client.

import { LANG_RE } from './_locale-shards.ts';

export interface LocaleStepResult {
  lang: string;
  verified: boolean;
}

export interface LocaleChainBody {
  build_id: string;
  /** Languages still to publish; null = the first step, which reads them from the staging rows. */
  langs: string[] | null;
  done: LocaleStepResult[];
}

/** Every build has at most a few dozen languages; anything longer is no body of ours. */
export const LOCALE_CHAIN_MAX_LANGS = 64;

/** English first, the others in their given order, each once. */
export function orderLangs(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of list.includes('en') ? ['en', ...list] : list) {
    if (!seen.has(l)) {
      seen.add(l);
      out.push(l);
    }
  }
  return out;
}

/** The `langs` / `done` of a chain step, or null when they are malformed. */
export function parseLocaleChain(buildId: string, langs: unknown, done: unknown): LocaleChainBody | null {
  let list: string[] | null = null;
  if (langs !== undefined && langs !== null) {
    if (!Array.isArray(langs) || langs.length > LOCALE_CHAIN_MAX_LANGS) return null;
    if (!langs.every((l) => typeof l === 'string' && LANG_RE.test(l))) return null;
    list = langs as string[];
  }
  const prev: LocaleStepResult[] = [];
  if (done !== undefined && done !== null) {
    if (!Array.isArray(done) || done.length > LOCALE_CHAIN_MAX_LANGS) return null;
    for (const d of done) {
      const r = d as { lang?: unknown; verified?: unknown } | null;
      if (!r || typeof r.lang !== 'string' || !LANG_RE.test(r.lang) || typeof r.verified !== 'boolean') return null;
      prev.push({ lang: r.lang, verified: r.verified });
    }
  }
  return { build_id: buildId, langs: list, done: prev };
}
