// node --test supabase/functions/translate-orchestrator/_passes.test.mjs
// Background passes (learn, seed import, overlay rebuild): each must give what one run over the whole
// table gives, in slices that never hold the whole table, and a killed or failing slice must end in a
// verdict instead of repeating forever.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildShards, indexKey, shardKey } from '../ingest-catalog/_locale-shards.ts';
import { MAX_DEAD_ATTEMPTS, RUN_STALE_MS, WORKER_LIMIT_KEY } from './_attempts.ts';
import { diffStrings, isCigValid, sha256Hex } from './_diff.ts';
import { TranslateError } from './_errors.ts';
import { buildOverlayMeta, loadTm, overlayKey, roomOverlayKey, saveTm } from './_io.ts';
import {
  alignRequests, assessCandidate, dntFromNames, findMisaligned, haikuRequests, mineCandidates, planGlossary,
} from './_learn.ts';
import { tickAll } from './_machine.ts';
import { advancePass, commit, MAX_PASS_ATTEMPTS, memPasses } from './_pass.ts';
import { PASS_STEPS } from './_pass_db.ts';
import { containsStem, containsTerm } from './_qa.ts';
import { SCAN_SHARDS } from './_scan.ts';
import { seedEntries } from './_seed.ts';
import { startImport, syncSources } from './_sources.ts';
import { styleStats } from './_style.ts';

const BUILD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T0 = Date.parse('2026-11-17T12:00:00Z');
const ai = (t) => ({ t, o: 'ai' });
const com = (t, src = 'rjcncpt') => ({ t, o: 'community', src, lic: 'CC-BY-NC-SA-4.0' });
const pad = (i) => String(i).padStart(5, '0');
const FILL = ' with enough padding around it so that the English table is split into many shards'.repeat(3);

// ── fakes ────────────────────────────────────────────────────────────────────

function putTable(files, lang, entries) {
  const { index, shards } = buildShards(BUILD, lang, 'gen001', entries);
  files.set(indexKey(BUILD, lang), index);
  for (const [name, s] of shards) files.set(shardKey(BUILD, lang, 'gen001', name), s);
  return index;
}

function world({ en, cig = {}, glossary = [], names = [], settings = {}, sources = [], pack = '' } = {}) {
  const files = new Map();
  const enIndex = putTable(files, 'en', en);
  if (Object.keys(cig).length) putTable(files, 'de', cig);
  const io = { tableReads: 0, maxBytes: 0 };
  const sized = (k, v) => {
    if (k.startsWith('translation-work/')) io.maxBytes = Math.max(io.maxBytes, JSON.stringify(v).length);
  };
  const store = {
    async getJson(k) {
      if (k.startsWith('codex-locale/') && k.includes('/en/') && !k.endsWith('index.json')) io.tableReads++;
      if (!files.has(k)) return null;
      sized(k, files.get(k));
      // Table shards are immutable; cloning ~100 kB on every read is most of the suite's run time.
      return k.startsWith('codex-locale/') ? files.get(k) : structuredClone(files.get(k));
    },
    async putJson(k, v) { sized(k, v); files.set(k, structuredClone(v)); },
    async putText(k, t) { files.set(k, JSON.parse(t)); },
    async deleteKey(k) { files.delete(k); },
    async list(prefix) { return [...files.keys()].filter((k) => k.startsWith(prefix)); },
  };
  let clock = T0;
  const now = () => new Date(clock += 1000);
  const ledger = [];
  const rows = glossary.map((g, i) => ({ id: `g${i}`, evidence: 0, ...g }));
  const cardRows = [];
  let style = null;
  const learn = {
    rows, cardRows, ledger,
    async getLearnSettings() { return { enabled: true, monthly_cap_usd: 190, arbiter_model: 'claude-haiku-5-5', web_research_cap_usd: 0, revise_margin: 3, revise_budget_pct: 2, promote_min_evidence: 5, promote_min_agreement: 0.9, ...settings }; },
    async currentBuildId() { return BUILD; },
    async codexNames() { return names; },
    async getStyle() { return style; },
    async setStyle(_l, s) { style = s; },
    get style() { return style; },
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
  const batches = [];
  const llm = {
    batches,
    ended: false,
    async createBatch(requests) { batches.push({ id: `b${batches.length}`, requests }); return { id: `b${batches.length - 1}` }; },
    async isEnded() { return llm.ended; },
    async cancel() {},
    async *results() {},
  };
  const db = {
    async getSettings() { return { enabled: true, upload_cap_usd: 20, monthly_cap_usd: 190, lore_model: null, rest_model: null }; },
    async listOpenJobs() { return []; },
    // The folder name inside the game is not the name of the published table (that is the language code).
    async getLanguage(lang) { return { lang, cig_folder: 'german_(germany)', approved: true }; },
    async monthCommitted() { return ledger.reduce((a, r) => a + r.usd, 0); },
  };
  const sourceRows = new Map(sources.map((s) => [s.id, {
    lang: 'de', name: s.id, raw_url: `https://packs.example.test/${s.id}/global.ini`, resolver: null, repo_url: null,
    license: 'CC-BY-NC-SA-4.0', license_kind: 'nc_sa', attribution: s.id, game_folder: 'german_(germany)', use_cig_table: true,
    enabled: true, status: 'licensed', last_seen_commit: null, last_synced_at: null, coverage: { text_pct: 90 }, ...s,
  }]));
  const net = { gets: 0, etag: 'v1', pack };
  const sourceDb = {
    async load(id) { const r = sourceRows.get(id); if (!r) throw new TranslateError('translate.source_unknown'); return { ...r }; },
    async list(lang) { return [...sourceRows.values()].filter((r) => !lang || r.lang === lang).map((r) => ({ ...r })); },
    async liveBuild() { return BUILD; },
    async update(id, patch) { Object.assign(sourceRows.get(id), patch); },
    async fetchFn(_url, init) {
      if (init?.method === 'HEAD') return new Response(null, { headers: { etag: net.etag } });
      net.gets++;
      return new Response(new TextEncoder().encode(net.pack), { headers: { etag: net.etag } });
    },
  };
  const passes = memPasses(now);
  const logs = [];
  const deps = { db, store, llm, learn, passes, passSteps: PASS_STEPS, sources: sourceDb, now, log: (m, d) => logs.push([m, d]) };
  return { deps, files, io, learn, llm, rows, cardRows, ledger, passes, sourceRows, net, logs, enIndex, setClock: (t) => { clock = t; } };
}

/** One slice per tick, so that a test can count slices and stop between two of them. */
const ONE = { fast: true, sliceBudgetMs: 0 };

/** Ticks until no pass is open; returns how many ticks ran a slice. */
async function drain(w, until = () => false, max = 2000) {
  let n = 0;
  for (let i = 0; i < max; i++) {
    if (until()) return n;
    const open = await w.passes.listOpen();
    if (!open.length) return n;
    const r = await tickAll(w.deps, ONE);
    if (r.passes.some((p) => p.ran)) n++;
  }
  throw new Error(`passes stuck: ${JSON.stringify([...w.passes.rows.values()].map((p) => [p.kind, p.status, p.phase, p.pos, p.error]))}`);
}

const passOf = (w, kind) => [...w.passes.rows.values()].find((p) => p.kind === kind);

// ── a table with material for every learning step, spread over many shards ───

async function learningTable() {
  const en = {};
  const cig = {};
  const tm = {};
  const put = async (e, entry) => { tm[await sha256Hex(e)] = entry; };
  const groups = ['ui', 'item', 'pu', 'mission', 'dlg'];
  for (let i = 0; i < 6000; i++) {
    const g = groups[i % 5];
    const k = `${g}_line_${pad(i)}`;
    en[k] = `Sentence ${i} costs 1.5 credits and 40% more${FILL}`;
    if (i % 3 === 0) cig[k] = `Satz ${i} kostet 1,5 Credits und 40 % mehr, „du“ zahlst`;
    else if (i % 3 === 1) await put(en[k], com(`Satz ${i} kostet 1.5 Credits und 40% mehr, Sie zahlen`));
    else await put(en[k], ai(`Satz ${i} kostet 1,5 Credits`));
  }
  // C8: a term CIG decides in every group, i.e. in several slices.
  for (let i = 0; i < 5; i++) for (const g of groups) { en[`${g}_hull_${i}`] = 'Hull'; cig[`${g}_hull_${i}`] = 'Rumpf'; }
  // Contested inside CIG's own pool: no slice alone sees both variants often enough.
  for (let i = 0; i < 4; i++) { en[`ui_shield_${i}`] = 'Shield'; cig[`ui_shield_${i}`] = 'Schild'; }
  for (let i = 0; i < 4; i++) { en[`pu_shield_${i}`] = 'Shield'; cig[`pu_shield_${i}`] = 'Schutzschild'; }
  // The same spelling question in two cases: the smallest key decides the spelling.
  en.dlg_quantum_a = 'quantum drive'; cig.dlg_quantum_a = 'quantenantrieb';
  for (let i = 0; i < 6; i++) { en[`item_quantum_${i}`] = 'Quantum Drive'; cig[`item_quantum_${i}`] = 'Quantenantrieb'; }
  // Example lines and misaligned community/AI lines, in other groups than the terms.
  for (let i = 0; i < 12; i++) {
    const g = groups[i % 5];
    en[`${g}_fix_${i}`] = `Repair the Hull of ship ${i} at once`;
    await put(en[`${g}_fix_${i}`], i % 2 ? com(`Repariere den Rumpf von Schiff ${i} sofort`) : com(`Repariere die Hülle von Schiff ${i} sofort`));
    en[`${g}_raise_${i}`] = `Raise the Shield of ship ${i}`;
    await put(en[`${g}_raise_${i}`], ai(i % 2 ? `Fahre den Schild von Schiff ${i} hoch` : `Fahre den Schutzschild von Schiff ${i} hoch`));
    en[`${g}_fly_${i}`] = `Fly the Drake Cutlass to port ${i}`;
    await put(en[`${g}_fly_${i}`], ai(`Flieg die Drake Cutlass zum Hafen ${i}`));
  }
  return { en, cig, tm };
}

/** What the unsliced run computed: one pass over the whole table in key order. */
async function oneRun({ en, cig, tm, judge = [], names, glossary = [], settings }) {
  const lines = [];
  const tmLines = [];
  for (const key of Object.keys(en).sort()) {
    const e = en[key];
    if (!e || !e.trim()) continue;
    if (isCigValid(e, cig[key])) { lines.push({ key, en: e, t: cig[key], o: 'cig' }); continue; }
    const h = await sha256Hex(e);
    const hit = tm[h];
    if (!hit) continue;
    lines.push({ key, en: e, t: hit.t, o: hit.o });
    tmLines.push({ key, h, en: e, entry: hit });
  }
  const trusted = lines.filter((l) => l.o === 'cig' || l.o === 'admin');
  const stylePairs = trusted.length >= 200 ? trusted : lines.filter((l) => l.o !== 'ai');
  const style = styleStats('de', stylePairs, [...new Set(stylePairs.map((l) => l.o))].sort());
  const cands = mineCandidates([...lines, ...judge.map((j, i) => ({ key: `judge:${String(i).padStart(6, '0')}`, en: j.source, t: j.target, o: 'judge' }))]);
  const plan = planGlossary(cands, glossary, settings);
  const have = new Set([...glossary, ...plan.promote].map((g) => g.source_term.toLowerCase()));
  const dnt = dntFromNames(names, lines, settings.promote_min_evidence).filter((r) => !have.has(r.source_term.toLowerCase()));
  const exampleOf = (src, t) => {
    const out = [];
    for (const l of lines) {
      if (out.length >= 2) break;
      if (l.en.length <= 200 && l.en.toLowerCase().includes(src.toLowerCase()) && containsTerm(l.en, src) && containsStem(l.t, t)) out.push({ en: l.en, t: l.t });
    }
    return out;
  };
  const items = plan.contested.map((c) => ({
    source: c.source, a: c.a.text, b: c.b.text, a_ev: c.a_ev, b_ev: c.b_ev, total: c.total, keys: c.keys,
    examples: [...exampleOf(c.source, c.a.text), ...exampleOf(c.source, c.b.text)],
  }));
  const cigTerms = glossary.filter((g) => g.origin === 'cig' || g.origin === 'admin' || g.locked);
  const known = new Set(cigTerms.map((g) => g.source_term.toLowerCase()));
  for (const c of cands.values()) {
    if (known.has(c.source.toLowerCase())) continue;
    const a = assessCandidate(c, settings.promote_min_evidence, settings.promote_min_agreement);
    if (a.status === 'promote' && a.pool !== 'rest' && /\p{Lu}/u.test(c.source)) cigTerms.push({ source_term: c.source, target_term: a.target, category: 'term', origin: 'cig' });
  }
  return { style, rows: [...plan.promote, ...dnt], items, mis: findMisaligned(tmLines, cigTerms), cands };
}

const SETTINGS = { promote_min_evidence: 5, promote_min_agreement: 0.9, revise_margin: 3 };

describe('learning pass in slices', () => {
  it('gives what one run over the whole table gives: style, glossary rows, the Haiku and the align batch', async () => {
    const t = await learningTable();
    const names = ['Drake Cutlass', 'Aegis Avenger'];
    const judge = [{ source: 'Shield', target: 'Schild' }];
    const w = world({ en: t.en, cig: t.cig, names });
    await saveTm(w.deps.store, 'de', t.tm);
    await w.deps.store.putJson('translation-work/learn-de/judge-terms.json', judge);
    assert.ok(w.enIndex.misc + Object.values(w.enIndex.groups).reduce((a, n) => a + n, 0) > 2 * SCAN_SHARDS, 'the table must need several slices');

    await w.passes.open({ kind: 'learn', lang: 'de', reason: 'backfill' });
    const slices = await drain(w);
    const pass = passOf(w, 'learn');
    assert.equal(pass.status, 'done', pass.error);
    assert.ok(slices > 6, `expected many slices, got ${slices}`);

    const want = await oneRun({ ...t, judge, names, settings: SETTINGS });
    const { at, ...style } = w.learn.style;
    assert.ok(at);
    assert.deepEqual(style, want.style);
    assert.ok(style.decimal.comma > 0 && style.percent.spaced > 0 && style.quotes.dominant, 'the style sample must not be empty');
    const row = (r) => `${r.source_term}=>${r.target_term}|${r.category}|${r.origin}|${r.evidence}`;
    assert.deepEqual(w.rows.map(row).sort(), want.rows.map(row).sort());
    assert.ok(want.rows.some((r) => r.source_term === 'Hull' && r.target_term === 'Rumpf'));
    assert.ok(want.rows.some((r) => r.source_term === 'Drake Cutlass' && r.category === 'dnt'));
    // The spelling of the smallest key wins, wherever its slice comes in the walk.
    assert.equal(want.cands.get('quantum drive').source, 'quantum drive');

    assert.ok(want.items.length >= 1 && want.items.every((x) => x.examples.length >= 2), 'contested terms need example lines');
    const haiku = w.llm.batches.find((b) => b.requests[0].custom_id === 'f0');
    assert.deepEqual(haiku.requests, haikuRequests('de', want.items, w.rows));
    assert.ok(want.mis.length >= 6, 'some community lines must miss the CIG term');
    const align = w.llm.batches.find((b) => b.requests[0].custom_id === 'a0');
    assert.deepEqual(align.requests, alignRequests('de', 'claude-haiku-5-5', want.mis));

    const sum = pass.state.sum;
    assert.equal(sum.mined.promoted + sum.dnt, want.rows.length);
    assert.equal(sum.haiku.submitted, want.items.length);
    assert.equal(sum.align.submitted, want.mis.length);
    // Nothing is left behind, and the 0.273.4 marker is gone.
    assert.deepEqual([...w.files.keys()].filter((k) => k.includes(`/p-${pass.id}/`)), []);
  });

  it('no slice reads more than SCAN_SHARDS English shards, and no work file holds the table', async () => {
    const t = await learningTable();
    const w = world({ en: t.en, cig: t.cig, names: ['Drake Cutlass'] });
    await saveTm(w.deps.store, 'de', t.tm);
    await w.passes.open({ kind: 'learn', lang: 'de', reason: 'backfill' });
    let worst = 0;
    for (let i = 0; i < 500 && (await w.passes.listOpen()).length; i++) {
      w.io.tableReads = 0;
      await tickAll(w.deps, ONE);
      worst = Math.max(worst, w.io.tableReads);
    }
    assert.equal(passOf(w, 'learn').status, 'done');
    assert.ok(worst > 0 && worst <= SCAN_SHARDS, `a slice read ${worst} shards`);
    const table = JSON.stringify(t.en).length;
    assert.ok(w.io.maxBytes < table / 4, `largest work file ${w.io.maxBytes} of a ${table} byte table`);
  });

  it('a second request while a pass runs makes it run once more; a batch is never asked for twice', async () => {
    const t = await learningTable();
    const w = world({ en: t.en, cig: t.cig });
    await saveTm(w.deps.store, 'de', t.tm);
    const first = await w.passes.open({ kind: 'learn', lang: 'de', reason: 'publish' });
    await tickAll(w.deps, ONE);
    const again = await w.passes.open({ kind: 'learn', lang: 'de', reason: 'sync' });
    assert.equal(again.id, first.id);
    await drain(w);
    const all = [...w.passes.rows.values()];
    assert.deepEqual(all.map((p) => [p.status, p.reason]), [['done', 'publish'], ['done', 'again']]);
    // The Haiku and align batches of the first pass are still in flight: the second pass submits no second ones.
    assert.equal(w.llm.batches.filter((b) => b.requests[0].custom_id === 'f0').length, 1);
    assert.equal(w.llm.batches.filter((b) => b.requests[0].custom_id === 'a0').length, 1);
  });

  it('a request killed between the provider answer and the saved batch id is repeated once and counted', async () => {
    const t = await learningTable();
    const w = world({ en: t.en, cig: t.cig });
    await saveTm(w.deps.store, 'de', t.tm);
    await w.passes.open({ kind: 'learn', lang: 'de', reason: 'backfill' });
    await drain(w, () => passOf(w, 'learn').phase === 'submit');
    // The kill: the batch exists at the provider, the state file and the pass never heard of it.
    const real = w.deps.store.putJson;
    w.deps.store.putJson = async (k, v) => {
      if (k === 'translation-work/learn-de/state.json') throw new Error('killed');
      return real(k, v);
    };
    await tickAll(w.deps, ONE);
    w.deps.store.putJson = real;
    const mid = passOf(w, 'learn');
    assert.equal(mid.state.intent.kind, 'haiku');
    assert.equal(w.llm.batches.length, 1);
    await drain(w);
    const pass = passOf(w, 'learn');
    assert.equal(pass.status, 'done', pass.error);
    assert.equal(pass.state.sum.haiku.submitted > 0, true);
    assert.equal(w.llm.batches.filter((b) => b.requests[0].custom_id === 'f0').length, 2);
    assert.ok(w.logs.some(([m]) => m === 'translate learning batch may exist twice'));
  });

  it('a capped month walks the table and submits nothing', async () => {
    const t = await learningTable();
    const w = world({ en: t.en, cig: t.cig, settings: { monthly_cap_usd: 0 } });
    await saveTm(w.deps.store, 'de', t.tm);
    await w.passes.open({ kind: 'learn', lang: 'de', reason: 'backfill' });
    await drain(w);
    const pass = passOf(w, 'learn');
    assert.equal(pass.status, 'done');
    assert.deepEqual(pass.state.sum.blocked, ['haiku:monthly_cap', 'align:monthly_cap']);
    assert.equal(w.llm.batches.length, 0);
    assert.ok(w.rows.length > 0, 'the token-free steps still ran');
  });
});

// ── seed import ──────────────────────────────────────────────────────────────

async function seedTable() {
  const en = {};
  const cig = {};
  const packMap = new Map();
  const groups = ['ui', 'item', 'pu', 'mission', 'dlg'];
  for (let i = 0; i < 6000; i++) {
    const g = groups[i % 5];
    const k = `${g}_Line_${pad(i)}`; // mixed case: the pack has lower-cased keys
    en[k] = `Sentence ${i} for %s${FILL}`;
    if (i % 7 === 0) cig[k] = `CIG-Satz ${i} für %s`;
    if (i % 11 === 0) continue; // missing in the pack
    if (i % 13 === 0) packMap.set(k.toLowerCase(), en[k]); // same as English
    else if (i % 17 === 0) packMap.set(k.toLowerCase(), `Satz ${i} ohne Platzhalter`); // placeholder lost
    else packMap.set(k.toLowerCase() + (i % 19 === 0 ? ',P' : ''), `Satz ${i} für %s`);
  }
  // One English text in two groups (two slices): only all votes together pick the winner.
  for (let i = 0; i < 3; i++) { en[`ui_close_${i}`] = 'Close'; packMap.set(`ui_close_${i}`, 'Zu'); }
  for (let i = 3; i < 5; i++) { en[`ui_close_${i}`] = 'Close'; packMap.set(`ui_close_${i}`, 'Schließen'); }
  for (let i = 0; i < 3; i++) { en[`pu_close_${i}`] = 'Close'; packMap.set(`pu_close_${i}`, 'Schließen'); }
  // A tie: the translation of the smallest key stays.
  en.dlg_open_a = 'Open'; packMap.set('dlg_open_a', 'Öffnen');
  en.ui_open_a = 'Open'; packMap.set('ui_open_a', 'Auf');
  const tm = {};
  tm[await sha256Hex(en.item_Line_00001)] = ai('KI-Satz 1 für %s'); // conflict: AI holds another text
  tm[await sha256Hex(en.pu_Line_00002)] = { t: 'Admin-Satz', o: 'admin' }; // admin stays
  tm[await sha256Hex(en.mission_Line_00003)] = com('Alter Satz 3 für %s'); // own text changed: refresh
  tm[await sha256Hex(en.dlg_Line_00004)] = com('Satz 4 für %s'); // unchanged
  const pack = '﻿Frontend_PU_Version=Pack 1\r\n' + [...packMap].map(([k, v]) => `${k}=${v}`).join('\r\n');
  return { en, cig, tm, pack, packMap };
}

const packOf = (t) => new Map([...t.packMap].map(([k, v]) => [k.endsWith(',P') ? k.slice(0, -2) : k, v]));

describe('seed import in slices', () => {
  it('writes the TM one run over the whole table writes, then rebuilds the overlay and asks for learning', async () => {
    const t = await seedTable();
    const w = world({ en: t.en, cig: t.cig, sources: [{ id: 'rjcncpt' }], pack: t.pack });
    await saveTm(w.deps.store, 'de', t.tm);
    w.deps.learn = undefined; // the arbiter is covered by its own tests; here the TM must be the import alone
    const started = await startImport(w.deps, 'rjcncpt');
    assert.deepEqual([started.queued, started.lang, started.source_id], [true, 'de', 'rjcncpt']);
    const slices = await drain(w, () => passOf(w, 'seed').status !== 'open');
    const pass = passOf(w, 'seed');
    assert.equal(pass.status, 'done', pass.error);
    assert.ok(slices > 20, `expected many slices, got ${slices}`);
    assert.equal(w.net.gets, 1, 'the pack is downloaded once');

    const want = await seedEntries({ en: t.en, cig: t.cig, pack: packOf(t), sourceId: 'rjcncpt', lic: 'CC-BY-NC-SA-4.0', at: pass.state.at, tm: t.tm });
    const tm = await loadTm(w.deps.store, 'de');
    assert.deepEqual(tm, { ...t.tm, ...want.updates });
    assert.equal(tm[await sha256Hex('Close')].t, 'Schließen');
    assert.equal(tm[await sha256Hex('Open')].t, 'Öffnen');
    assert.equal(tm[await sha256Hex(t.en.item_Line_00001)].t, 'KI-Satz 1 für %s');
    assert.deepEqual(pass.state.counts, want.counts);
    assert.ok(want.counts.imported > 3000 && want.counts.conflicts === 1 && want.counts.admin_kept === 1 && want.counts.unchanged === 1);
    assert.ok(want.counts.skipped_cig > 0 && want.counts.missing > 0 && want.counts.skipped_same > 0 && want.counts.rejected_qa > 0);

    const src = w.sourceRows.get('rjcncpt');
    assert.equal(src.last_seen_commit, 'v1');
    assert.equal(src.last_synced_at, pass.state.at);
    assert.equal(src.coverage.imported, want.counts.imported);
    assert.equal(src.coverage.text_pct, 90, 'the seeded figure stays');
    assert.ok(src.coverage.gap_pct > 50);
    assert.deepEqual([...w.files.keys()].filter((k) => k.includes(`seed-${pass.id}`)), []);

    // The overlay follows from the TM as it is now.
    await drain(w);
    const ovl = passOf(w, 'overlay');
    assert.equal(ovl.status, 'done', ovl.error);
    const { reused } = await diffStrings({ en: t.en, cig: t.cig, tm, mode: 'full' });
    const latest = w.files.get(overlayKey('de', 'latest'));
    assert.deepEqual(latest.entries, reused);
    assert.equal(latest.count, Object.keys(reused).length);
    const meta = buildOverlayMeta('de', reused, tm, [...w.sourceRows.values()]);
    assert.deepEqual([latest.sources, latest.attribution, latest.game_folder, latest.use_cig_table], [meta.sources, meta.attribution, meta.game_folder, meta.use_cig_table]);
    assert.ok(latest.attribution.includes('rjcncpt') && latest.sources.some((s) => s.id === 'scc-ai'));
    assert.deepEqual(w.files.get(overlayKey('de', BUILD)), latest);
    assert.equal(w.files.get(roomOverlayKey('de')).count, 0);
    assert.deepEqual([...w.files.keys()].filter((k) => k.includes(`ovl-${ovl.id}`)), []);
  });

  it('with the learning adapter the conflicts reach the arbiter and a learning pass is asked for', async () => {
    const t = await seedTable();
    const w = world({ en: t.en, cig: t.cig, sources: [{ id: 'rjcncpt' }], pack: t.pack });
    await saveTm(w.deps.store, 'de', t.tm);
    await startImport(w.deps, 'rjcncpt');
    await drain(w, () => passOf(w, 'seed').status !== 'open');
    assert.equal(passOf(w, 'seed').status, 'done', passOf(w, 'seed').error);
    const arb = w.files.get('translation-work/learn-de/arbiter.json');
    assert.equal(arb.batch.items.length, 1);
    assert.equal(arb.batch.items[0].en, t.en.item_Line_00001);
    assert.deepEqual([...w.passes.rows.values()].map((p) => [p.kind, p.reason]).sort(), [['learn', 'seed'], ['overlay', 'seed'], ['seed', 'seed']]);
  });

  it('a second import of the same pack changes nothing, and a slice that runs twice writes the same TM', async () => {
    const t = await seedTable();
    const w = world({ en: t.en, cig: t.cig, sources: [{ id: 'rjcncpt' }], pack: t.pack });
    w.deps.learn = undefined;
    await startImport(w.deps, 'rjcncpt');
    // Run every apply slice twice: the second run starts from the row as it was before the first commit.
    for (let i = 0; i < 2000 && passOf(w, 'seed').status === 'open'; i++) {
      const before = structuredClone(passOf(w, 'seed'));
      await tickAll(w.deps, ONE);
      if (before.phase === 'apply') {
        const steps = { seed: PASS_STEPS.seed };
        const ghost = { ...before, id: 'ghost' };
        w.passes.rows.set('ghost', structuredClone(ghost));
        // Same work files (the pass id is part of their name), so the ghost repeats the slice of the real pass.
        const files = new Map([...w.files].filter(([k]) => k.includes(`seed-${before.id}/`)).map(([k, v]) => [k.replace(`seed-${before.id}/`, 'seed-ghost/'), v]));
        for (const [k, v] of files) w.files.set(k, v);
        await advancePass(w.deps, ghost, steps);
        w.passes.rows.delete('ghost');
        for (const k of [...w.files.keys()]) if (k.includes('seed-ghost/')) w.files.delete(k);
      }
    }
    const first = await loadTm(w.deps.store, 'de');
    const want = await seedEntries({ en: t.en, cig: t.cig, pack: packOf(t), sourceId: 'rjcncpt', lic: 'CC-BY-NC-SA-4.0', at: passOf(w, 'seed').state.at, tm: {} });
    assert.deepEqual(first, want.updates);
    await drain(w);

    const again = await startImport(w.deps, 'rjcncpt');
    await drain(w);
    const second = w.passes.rows.get(again.pass_id);
    assert.equal(second.status, 'done', second.error);
    assert.equal(second.state.counts.imported, 0);
    assert.equal(second.state.counts.unchanged, want.counts.imported);
    assert.deepEqual(await loadTm(w.deps.store, 'de'), first);
  });

  it('use_cig_table = false ignores the CIG table of the folder (another language lives there)', async () => {
    const t = await seedTable();
    const w = world({ en: t.en, cig: t.cig, sources: [{ id: 'n1ghter', use_cig_table: false }], pack: t.pack });
    w.deps.learn = undefined;
    await startImport(w.deps, 'n1ghter');
    await drain(w);
    assert.equal(passOf(w, 'seed').state.counts.skipped_cig, 0);
    const latest = w.files.get(overlayKey('de', 'latest'));
    assert.ok(Object.keys(latest.entries).includes('ui_Line_00035'), 'a key CIG translates is in the overlay when CIG is not trusted');
    assert.equal(latest.use_cig_table, false);
  });

  it('a source that is not licensed is refused before anything is fetched', async () => {
    const t = await seedTable();
    const w = world({ en: t.en, sources: [{ id: 'circuspes', status: 'awaiting_permission' }], pack: t.pack });
    await assert.rejects(() => startImport(w.deps, 'circuspes'), (e) => e instanceof TranslateError && e.key === 'translate.source_not_permitted');
    // Permission withdrawn while the pass waits: the pass ends with the verdict, no retry.
    const w2 = world({ en: t.en, sources: [{ id: 'rjcncpt' }], pack: t.pack });
    await startImport(w2.deps, 'rjcncpt');
    w2.sourceRows.get('rjcncpt').status = 'refused';
    await drain(w2);
    assert.deepEqual([passOf(w2, 'seed').status, passOf(w2, 'seed').error], ['failed', 'translate.source_not_permitted']);
    assert.equal(w2.net.gets, 0);
  });

  it('the daily sync starts a pass only for a source whose upstream changed and none while one runs', async () => {
    const t = await seedTable();
    const w = world({ en: t.en, sources: [{ id: 'rjcncpt' }, { id: 'other', last_seen_commit: 'v1', last_synced_at: 'x' }, { id: 'blocked', status: 'awaiting_permission' }], pack: t.pack });
    w.deps.learn = undefined;
    assert.deepEqual(await syncSources(w.deps), { checked: 2, changed: 1, errors: [] });
    assert.deepEqual([...w.passes.rows.values()].map((p) => [p.kind, p.source_id, p.reason]), [['seed', 'rjcncpt', 'sync']]);
    assert.deepEqual(await syncSources(w.deps), { checked: 2, changed: 0, errors: [] });
    assert.equal(passOf(w, 'seed').again, false);
    await drain(w);
    assert.deepEqual(await syncSources(w.deps), { checked: 2, changed: 0, errors: [] });
    w.net.etag = 'v2';
    assert.equal((await syncSources(w.deps)).changed, 2);
  });
});

// ── driver ───────────────────────────────────────────────────────────────────

describe('pass driver', () => {
  const small = () => world({ en: { ui_a: 'Open' } });
  const steps = (fn) => ({ learn: fn, seed: fn, overlay: fn });

  it('a stamp left by a killed request is counted; progress resets the count; three in a row fail the pass', async () => {
    const w = small();
    let p = await w.passes.open({ kind: 'learn', lang: 'de', reason: 'backfill' });
    const die = steps(async () => { throw new Error('unreachable: the request is killed before it ends'); });
    // A kill leaves the stamp behind and no trace of an error.
    const kill = async () => { p = await w.passes.cas(p, { run_at: new Date(T0).toISOString() }); w.setClock(T0 + RUN_STALE_MS + 60_000); };
    await kill();
    let o = await advancePass(w.deps, p, steps((d, pass) => commit(d, pass, { pos: pass.pos + 1 })));
    p = await w.passes.get(p.id);
    assert.deepEqual([o.ran, p.pos, p.dead, p.run_at], [true, 1, 0, null]);
    for (let i = 1; i < MAX_DEAD_ATTEMPTS; i++) {
      await kill();
      // The step itself dies again: emulate by not running it, only the stamp of the dead run counts.
      p = await w.passes.cas(p, { dead: i, run_at: new Date(T0).toISOString() });
    }
    o = await advancePass(w.deps, p, die);
    p = await w.passes.get(p.id);
    // It gives up, and deletes its work files before it ends.
    assert.deepEqual([o.ran, p.status, p.phase, p.error], [false, 'open', 'abort', WORKER_LIMIT_KEY]);
    await w.deps.store.putJson(`translation-work/learn-de/p-${p.id}/mine-0.json`, {});
    await advancePass(w.deps, p, die);
    p = await w.passes.get(p.id);
    assert.deepEqual([p.status, p.error], ['failed', WORKER_LIMIT_KEY]);
    assert.deepEqual([...w.files.keys()].filter((k) => k.includes(`/p-${p.id}/`)), []);
  });

  it('a pass killed while it cleans up after giving up ends as failed', async () => {
    const w = small();
    let p = await w.passes.open({ kind: 'seed', lang: 'de', source_id: 'x', reason: 'seed' });
    p = await w.passes.cas(p, { phase: 'abort', error: 'translate.internal', dead: MAX_DEAD_ATTEMPTS - 1, run_at: new Date(T0).toISOString() });
    w.setClock(T0 + RUN_STALE_MS + 60_000);
    await advancePass(w.deps, p, steps(async () => { throw new Error('unreachable'); }));
    p = await w.passes.get(p.id);
    assert.deepEqual([p.status, p.error], ['failed', 'translate.internal']);
  });

  it('a pass that was asked for again is followed by one with the state of that request, also when it failed', async () => {
    const w = small();
    const first = await w.passes.open({ kind: 'overlay', lang: 'de', reason: 'seed', state: { cig: 'de' } });
    // The same asker asking twice (its slice was repeated) orders nothing more.
    await w.passes.open({ kind: 'overlay', lang: 'de', reason: 'seed', token: 'seed:1', state: { cig: null } });
    assert.equal((await w.passes.get(first.id)).again, true);
    const fail = steps(async () => { throw new TranslateError('translate.no_live_build'); });
    await advancePass(w.deps, await w.passes.get(first.id), fail);
    await advancePass(w.deps, await w.passes.get(first.id), fail);
    const all = [...w.passes.rows.values()];
    assert.deepEqual(all.map((p) => [p.status, p.reason, p.state.cig]), [['failed', 'seed', 'de'], ['open', 'again', null]]);

    const w2 = small();
    const a = await w2.passes.open({ kind: 'learn', lang: 'de', reason: 'seed', token: 'seed:7' });
    const b = await w2.passes.open({ kind: 'learn', lang: 'de', reason: 'seed', token: 'seed:7' });
    assert.deepEqual([b.id, b.again], [a.id, false]);
    // The asker repeats itself minutes later, when the pass it ordered has already ended: still no second one.
    await w2.passes.cas(await w2.passes.get(a.id), { status: 'done', phase: 'done' });
    const c = await w2.passes.open({ kind: 'learn', lang: 'de', reason: 'seed', token: 'seed:7' });
    assert.deepEqual([c.id, c.status, w2.passes.rows.size], [a.id, 'done', 1]);
    // Another asker gets its own pass.
    const d = await w2.passes.open({ kind: 'learn', lang: 'de', reason: 'publish', token: 'job:9:0' });
    assert.deepEqual([d.id === a.id, d.status, w2.passes.rows.size], [false, 'open', 2]);
  });

  it('a young stamp means another request is running: nothing is done', async () => {
    const w = small();
    let p = await w.passes.open({ kind: 'learn', lang: 'de', reason: 'backfill' });
    p = await w.passes.cas(p, { run_at: new Date(T0 + 500).toISOString() });
    let ran = false;
    const o = await advancePass(w.deps, p, steps(async () => { ran = true; return null; }));
    assert.deepEqual([o.ran, ran], [false, false]);
  });

  it('an error is retried MAX_PASS_ATTEMPTS times, a translated verdict fails at once', async () => {
    const w = small();
    let p = await w.passes.open({ kind: 'learn', lang: 'de', reason: 'backfill' });
    const boom = steps(async () => { throw new Error('r2 timeout'); });
    for (let i = 1; i <= MAX_PASS_ATTEMPTS; i++) {
      await advancePass(w.deps, p, boom);
      p = await w.passes.get(p.id);
      assert.deepEqual([p.status, p.phase, p.run_at], ['open', i < MAX_PASS_ATTEMPTS ? 'start' : 'abort', null]);
      if (i < MAX_PASS_ATTEMPTS) assert.equal(p.attempts, i);
    }
    await advancePass(w.deps, p, boom);
    p = await w.passes.get(p.id);
    assert.deepEqual([p.status, p.error], ['failed', 'translate.internal']);
    let q = await w.passes.open({ kind: 'overlay', lang: 'de', reason: 'seed' });
    const verdict = steps(async () => { throw new TranslateError('translate.no_live_build'); });
    await advancePass(w.deps, q, verdict);
    q = await w.passes.get(q.id);
    assert.deepEqual([q.status, q.phase, q.error], ['open', 'abort', 'translate.no_live_build']);
    await advancePass(w.deps, q, verdict);
    q = await w.passes.get(q.id);
    assert.deepEqual([q.status, q.error], ['failed', 'translate.no_live_build']);
  });

  it('one heavy step per tick, and none while another request holds the lock', async () => {
    const t = await learningTable();
    const w = world({ en: t.en, cig: t.cig });
    await w.passes.open({ kind: 'learn', lang: 'de', reason: 'backfill' });
    await w.passes.open({ kind: 'overlay', lang: 'de', reason: 'seed' });
    let held = true;
    const released = [];
    w.deps.lock = { claim: async () => (held ? null : 'mine'), release: async (token) => { released.push(token); } };
    let r = await tickAll(w.deps, ONE);
    assert.deepEqual([r.heavy, r.passes.length, released], [false, 0, []]);
    held = false;
    r = await tickAll(w.deps, ONE);
    assert.deepEqual([r.heavy, r.passes.map((p) => p.kind), released], [true, ['learn'], ['mine']]);
    const phases = [...w.passes.rows.values()].map((p) => p.phase);
    assert.deepEqual(phases, ['rows', 'start'], 'the second pass waits for the next tick');
    // A step that throws still gives the lock back.
    w.deps.passSteps = { ...PASS_STEPS, learn: async () => { throw new Error('boom'); } };
    await tickAll(w.deps, ONE);
    assert.deepEqual(released, ['mine', 'mine']);
  });

  it('a request goes on with slices of the same pass while it has time, and with no other pass', async () => {
    const t = await learningTable();
    const w = world({ en: t.en, cig: t.cig });
    await w.passes.open({ kind: 'overlay', lang: 'de', reason: 'seed' });
    await w.passes.open({ kind: 'learn', lang: 'de', reason: 'backfill' });
    w.deps.perfNow = () => 0; // a clock that does not move: the budget is never used up
    const r = await tickAll(w.deps, { fast: true });
    assert.deepEqual(r.passes.map((p) => [p.kind, p.from, p.to]), [['overlay', 'start:0', 'done']]);
    assert.equal(passOf(w, 'learn').phase, 'start');
  });
});
