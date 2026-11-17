// Fakes shared by the tests of the job pipeline: a store that behaves like R2 (JSON text in, JSON text
// out, sizes counted), the jobs table, and a batch provider that "translates" by prefixing.
import { buildShards, indexKey, shardKey } from '../ingest-catalog/_locale-shards.ts';
import { tmIndexKey, tmShardKey } from './_io.ts';
import { reserveOf } from './_job.ts';

export const NEW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const OLD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * A store that keeps JSON text, like the bucket does: every read parses, every write serializes.
 * `meter` adds up what one slice moves: bytes and objects read and written.
 */
export function textStore() {
  const files = new Map();
  const meter = { read: 0, written: 0, gets: 0, puts: 0, biggest: 0, biggestKey: '' };
  const seen = (k, n) => {
    if (n > meter.biggest) {
      meter.biggest = n;
      meter.biggestKey = k;
    }
  };
  const store = {
    async getJson(k) {
      meter.gets++;
      const t = files.get(k);
      if (t === undefined) return null;
      meter.read += t.length;
      seen(k, t.length);
      return JSON.parse(t);
    },
    async putJson(k, v) {
      const t = JSON.stringify(v);
      meter.puts++;
      meter.written += t.length;
      seen(k, t.length);
      files.set(k, t);
    },
    async putText(k, t) {
      meter.puts++;
      meter.written += t.length;
      seen(k, t.length);
      files.set(k, t);
    },
    async deleteKey(k) { files.delete(k); },
    async list(prefix) { return [...files.keys()].filter((k) => k.startsWith(prefix)); },
  };
  return {
    store, files, meter,
    json: (k) => (files.has(k) ? JSON.parse(files.get(k)) : undefined),
    reset() { Object.assign(meter, { read: 0, written: 0, gets: 0, puts: 0, biggest: 0, biggestKey: '' }); },
  };
}

/** Publishes a table. Publishing a build's table again (another `gen`) removes the shards of the one before. */
export function putTable(ts, build, lang, entries, gen = 'gen001') {
  const { index, shards } = buildShards(build, lang, gen, entries);
  const dir = indexKey(build, lang).replace(/index\.json$/, '');
  for (const k of [...ts.files.keys()]) if (k.startsWith(dir)) ts.files.delete(k);
  ts.files.set(indexKey(build, lang), JSON.stringify(index));
  for (const [name, s] of shards) ts.files.set(shardKey(build, lang, gen, name), JSON.stringify(s));
  return index;
}

/** Writes a TM the way `saveTm` leaves it, without the read-modify-write per shard. */
export function putTm(ts, lang, tm) {
  const byShard = {};
  for (const [h, e] of Object.entries(tm)) (byShard[h.slice(0, 2)] ??= {})[h] = e;
  const counts = {};
  for (const [hh, s] of Object.entries(byShard)) {
    ts.files.set(tmShardKey(lang, hh), JSON.stringify(s));
    counts[hh] = Object.keys(s).length;
  }
  ts.files.set(tmIndexKey(lang), JSON.stringify({ v: 1, lang, shards: Object.keys(byShard).sort(), count: Object.keys(tm).length, counts, rev: 1 }));
}

const OPEN = ['estimating', 'queued', 'submitted', 'validating', 'post_editing', 'publishing'];

export function fakeDb({ settings = {}, glossary = [] } = {}) {
  const jobs = new Map();
  const ledger = [];
  let seq = 0;
  const db = {
    jobs, ledger, glossary,
    async listOpenJobs() { return [...jobs.values()].filter((j) => OPEN.includes(j.status)).map((j) => structuredClone(j)); },
    async listSweepJobs() { return [...jobs.values()].filter((j) => j.stats?.sweep).map((j) => structuredClone(j)); },
    async findJob(build_id, lang, mode) { const j = [...jobs.values()].find((x) => x.build_id === build_id && x.lang === lang && x.mode === mode); return j ? structuredClone(j) : null; },
    async getJob(id) { const j = jobs.get(id); return j ? structuredClone(j) : null; },
    async cas(job, patch) {
      const cur = jobs.get(job.id);
      if (!cur || cur.status !== job.status || cur.updated_at !== job.updated_at) return null;
      const next = { ...cur, ...structuredClone(patch), updated_at: `t${++seq}` };
      jobs.set(job.id, next);
      return structuredClone(next);
    },
    async insertJob(j) {
      const row = { id: `job${jobs.size + 1}`, spent_usd: 0, batch_ids: [], stats: {}, string_count: null, estimate_usd: null, error: null, created_at: 'c', updated_at: `t${++seq}`, approved_by: null, status: 'estimating', ...j };
      jobs.set(row.id, row);
      return structuredClone(row);
    },
    async getSettings() { return { enabled: true, upload_cap_usd: 1e9, monthly_cap_usd: 1e9, lore_model: null, rest_model: null, ...settings }; },
    // The folder name inside the game is not the name of the published table (that is the language code).
    async getLanguage(lang) { return { lang, cig_folder: 'german_(germany)', approved: true }; },
    async listGlossary() { return glossary.map((g) => ({ ...g })); },
    async insertGlossary(_l, rows) { glossary.push(...rows.map((r, i) => ({ ...r, id: `g${glossary.length + i}` }))); },
    async resetRetranslate() {},
    async buildEstimateSum() { return 0; },
    // As the real adapter: what the month was billed, and what the other in-flight jobs may still spend.
    async monthCommitted(_month, excludeJobId) {
      const reserved = [...jobs.values()].filter((j) => j.id !== excludeJobId && ['queued', 'submitted', 'validating', 'post_editing'].includes(j.status))
        .reduce((a, j) => a + reserveOf(j), 0);
      return ledger.reduce((a, r) => a + r.usd, 0) + reserved;
    },
    async addLedger(jobId, month, usd, ref) { if (ref && ledger.some((r) => r.jobId === jobId && r.ref === ref)) return; ledger.push({ jobId, month, usd, ref }); },
    async hasNewerPublished() { return false; },
  };
  return db;
}

/**
 * A batch provider. A main request is answered with `DE: <text>` per string; `bad(text, request)` makes
 * an answer fail QA (it drops the placeholders) on the first attempt. The judge gives 9, or `judge(sample)`.
 * `model(request)` is the model id the answer names (default: the one asked for); `lost(request)` makes a
 * request expire (no answer, no bill). `reads` lists every read of a batch and whether it was logged.
 */
export function fakeLlm({ bad = () => false, judge = () => 9, usage = () => undefined, ended = () => true, model = (r) => r.params.model, lost = () => false } = {}) {
  const batches = [];
  const reads = [];
  const llm = {
    batches,
    reads,
    async createBatch(requests) { batches.push({ id: `b${batches.length}`, requests }); return { id: `b${batches.length - 1}` }; },
    async isEnded(id) { return ended(id); },
    async cancel() {},
    async *results(id, opts) {
      reads.push({ id, record: opts?.record !== false });
      const b = batches.find((x) => x.id === id);
      for (const r of [...b.requests].reverse()) { // arbitrary order on purpose
        const msg = r.params.messages[0].content;
        if (r.custom_id !== 'j0' && lost(r)) {
          yield { custom_id: r.custom_id, type: 'expired' };
          continue;
        }
        if (r.custom_id === 'j0') {
          const sample = JSON.parse(msg);
          yield { custom_id: 'j0', type: 'succeeded', text: JSON.stringify({ r: sample.map((s) => ({ score: judge(s), back: 'x', terms: [] })) }), stop_reason: 'end_turn', usage: usage(r, 'judge') ?? { input_tokens: 100, output_tokens: 100 }, model: 'claude-opus-5-5' };
          continue;
        }
        const g = JSON.parse(msg.slice(msg.indexOf('{"g"'))).g;
        const flat = g.flatMap((x) => x.s);
        const isPost = r.custom_id.startsWith('p');
        const t = flat.map((s) => (!isPost && bad(s[1], r) ? 'DE: \n broken' : `DE: ${s[1]}`));
        yield { custom_id: r.custom_id, type: 'succeeded', text: JSON.stringify({ t }), stop_reason: 'end_turn', usage: usage(r, isPost ? 'post' : 'main') ?? { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000 }, model: model(r) };
      }
    },
  };
  return llm;
}

/** What was asked to be translated in a main or post-edit request: its `[suffix, text]` pairs, flat. */
export function askedOf(request) {
  const msg = request.params.messages[0].content;
  return JSON.parse(msg.slice(msg.indexOf('{"g"'))).g.flatMap((x) => x.s.map((s) => ({ key: x.p + s[0], text: s[1] })));
}

export function fakeDeps({ ts, db, llm, extra = {} }) {
  let clock = Date.parse('2026-11-17T12:00:00Z');
  return { db, store: ts.store, llm, now: () => new Date(clock += 1000), perfNow: () => 0, log() {}, ...extra };
}

/** The learning adapter: settings, glossary rows, cards and its own ledger, all in memory. */
export function fakeLearn({ build = NEW, glossary = [], names = [], settings = {} } = {}) {
  const ledger = [];
  const rows = glossary.map((g, i) => ({ id: `g${i}`, evidence: 0, ...g }));
  const cardRows = [];
  let style = null;
  return {
    rows, cardRows, ledger,
    async getLearnSettings() { return { enabled: true, monthly_cap_usd: 190, arbiter_model: 'claude-haiku-5-5', web_research_cap_usd: 0, revise_margin: 3, revise_budget_pct: 2, promote_min_evidence: 5, promote_min_agreement: 0.9, ...settings }; },
    async currentBuildId() { return build; },
    async codexNames() { return names; },
    async getStyle() { return style; },
    async setStyle(_l, s) { style = s; },
    async listGlossary() { return rows.map((r) => ({ ...r })); },
    async insertGlossary(_l, rs) { let n = 0; for (const r of rs) if (!rows.some((x) => x.source_term.toLowerCase() === r.source_term.toLowerCase())) { rows.push({ id: `g${rows.length}`, ...r }); n++; } return n; },
    async updateGlossary(id, patch) { Object.assign(rows.find((r) => r.id === id), patch); },
    async upsertAdminRule() {},
    async insertCard(c) { if (cardRows.some((x) => x.dedupe_key === c.dedupe_key && x.status !== 'answered')) return false; cardRows.push({ id: `c${cardRows.length}`, status: 'open', ...c }); return true; },
    async listAnsweredUnapplied() { return []; },
    async listOpenCards(_l, kinds, limit) { return cardRows.filter((c) => c.status === 'open' && kinds.includes(c.kind)).slice(0, limit); },
    async updateCardContext(id, context) { cardRows.find((c) => c.id === id).context = context; },
    async addLearnLedger(month, usd, kind, lang, ref) { if (ref && ledger.some((r) => r.ref === ref)) return; ledger.push({ month, usd, kind, lang, ref }); },
    async monthKindSpent(month, kind) { return ledger.filter((r) => r.month === month && r.kind === kind).reduce((a, r) => a + r.usd, 0); },
    async monthSpent() { return ledger.reduce((a, r) => a + r.usd, 0); },
    async listApprovedLangs() { return ['de']; },
  };
}

/** The community sources of a language and the host their pack comes from. */
/**
 * A response body as the platform hands it out: every chunk is a view of a buffer of 64 KB, and the
 * buffer of a chunk is wiped when the chunk after it is asked for. A reader that keeps chunks to join
 * them later (and so keeps 64 KB alive for every few KB that came in - the first live import died of
 * that) reads zeros here.
 */
export function chunkedBody(bytes, chunkBytes) {
  let o = 0;
  let last = null;
  return new ReadableStream({
    pull(c) {
      if (last) last.fill(0);
      if (o >= bytes.length) { c.close(); return; }
      const n = Math.min(chunkBytes, bytes.length - o);
      last = new Uint8Array(64 * 1024);
      last.set(bytes.subarray(o, o + n));
      o += n;
      c.enqueue(last.subarray(0, n));
    },
  }, { highWaterMark: 0 });
}

export function fakeSources({ build = NEW, sources = [], pack = '' } = {}) {
  const rows = new Map(sources.map((s) => [s.id, {
    lang: 'de', name: s.id, raw_url: `https://packs.example.test/${s.id}/global.ini`, resolver: null, repo_url: null,
    license: 'CC-BY-NC-SA-4.0', license_kind: 'nc_sa', attribution: s.id, game_folder: 'german_(germany)', use_cig_table: true,
    enabled: true, status: 'licensed', last_seen_commit: null, last_synced_at: null, coverage: { text_pct: 90 }, ...s,
  }]));
  const net = { gets: 0, etag: 'v1', pack };
  return {
    rows, net,
    async load(id) { const r = rows.get(id); if (!r) throw new Error('translate.source_unknown'); return { ...r }; },
    async list(lang) { return [...rows.values()].filter((r) => !lang || r.lang === lang).map((r) => ({ ...r })); },
    async liveBuild() { return build; },
    async update(id, patch) { Object.assign(rows.get(id), patch); },
    async fetchFn(_url, init) {
      if (init?.method === 'HEAD') return new Response(null, { headers: { etag: net.etag } });
      net.gets++;
      return new Response(chunkedBody(new TextEncoder().encode(net.pack), 16 * 1024), { headers: { etag: net.etag } });
    },
  };
}
