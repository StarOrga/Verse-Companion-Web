#!/usr/bin/env node
// Publishes one build's silhouettes (codex_silhouettes) as shard files to R2
// (layout: supabase/functions/ingest-catalog/_silhouette-shards.ts). New builds
// are published by ingest-catalog after `finalize`; this script covers builds
// finalized before that and redoes a publish that broke off.
//
// It does not write R2 itself: it calls ingest-catalog `silhouettes_publish`,
// the one writer, one small step per call (plan, the slices, commit) - each
// call is its own worker, so none comes near the 2 s CPU limit. Nothing is
// deleted from the database; the table stays the client's fallback.
//
//   node scripts/codex-silhouettes-to-r2.mjs                 dry run: what is in the table and in R2
//   node scripts/codex-silhouettes-to-r2.mjs --apply         publish the current LIVE build
//   options: --build <uuid>   another build
//            --pause <ms>     wait between steps (default 400; raise it to go easy on the database)
//
// Env: SUPABASE_ACCESS_TOKEN (personal access token: SQL through the Management
// API, and the service key via api-keys?reveal=true unless
// SUPABASE_SERVICE_ROLE_KEY - the sb_secret_ key - is set).
// SUPABASE_PROJECT_REF (default hcnqhvzlavdycidqyaai), ASSETS_PUBLIC_URL.
// Secrets are never printed.

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const APPLY = flag('--apply');
const ONLY_BUILD = opt('--build');
const PAUSE_MS = Math.max(0, Number(opt('--pause') ?? 400) || 0);
const REF = process.env.SUPABASE_PROJECT_REF || 'hcnqhvzlavdycidqyaai';
const PAT = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const ASSETS = (process.env.ASSETS_PUBLIC_URL || 'https://sc-assets.sc-assets-worker.workers.dev').replace(/\/+$/, '');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_STEPS = 400;

function fail(msg) {
  console.error(`codex-silhouettes-to-r2: ${msg}`);
  process.exitCode = 1;
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${PAT}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API SQL: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function serviceKey() {
  const fromEnv = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (fromEnv) return fromEnv;
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
    headers: { authorization: `Bearer ${PAT}` },
  });
  if (!res.ok) throw new Error(`api-keys: HTTP ${res.status}`);
  // The edge runtime's SUPABASE_SERVICE_ROLE_KEY is the NEW secret key, not the legacy JWT.
  const key = (await res.json()).find((k) => k.type === 'secret')?.api_key;
  if (!key) throw new Error('no secret API key on the project');
  return key;
}

async function publicIndex(build) {
  try {
    const res = await fetch(`${ASSETS}/codex-silhouettes/${build}/index.json?check=${Date.now()}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** One step of the publish; a failed call is repeated twice (every step may run again). */
async function step(key, body) {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000 * attempt));
    try {
      const res = await fetch(`https://${REF}.supabase.co/functions/v1/ingest-catalog`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'silhouettes_publish', ...body }),
        signal: AbortSignal.timeout(140_000),
      });
      const answer = await res.json().catch(() => ({}));
      if (res.ok && answer.result) return answer.result;
      last = `HTTP ${res.status} ${answer.error ?? ''} ${answer.message ?? ''}`.trim();
      // A refusal of the usage gate or a bad request does not get better by asking again.
      if (res.status === 400 || res.status === 507) break;
    } catch (e) {
      last = e.message;
    }
  }
  throw new Error(`silhouettes_publish ${JSON.stringify(body.cursor ?? 'plan')}: ${last}`);
}

async function main() {
  if (!PAT) return fail('SUPABASE_ACCESS_TOKEN is not set');
  if (ONLY_BUILD && !UUID_RE.test(ONLY_BUILD)) return fail('--build must be a uuid');

  const builds = await sql(
    ONLY_BUILD
      ? `select id::text, channel, patch_version, build_number from public.codex_builds where id = '${ONLY_BUILD}'`
      : `select id::text, channel, patch_version, build_number from public.codex_builds where is_current and channel = 'LIVE' limit 1`,
  );
  if (builds.length !== 1) return fail(ONLY_BUILD ? `build ${ONLY_BUILD} not found` : 'no current LIVE build');
  const build = builds[0];
  const counts = await sql(
    `select kind, count(*)::int n from public.codex_silhouettes_rows where build_id = '${build.id}' group by 1 order by 1`,
  );
  const total = counts.reduce((sum, c) => sum + c.n, 0);
  console.log(`build ${build.id} (${build.channel} ${build.patch_version} ${build.build_number}): ${total} silhouettes`);
  for (const c of counts) console.log(`  ${c.kind.padEnd(10)} ${String(c.n).padStart(5)} rows`);
  const before = await publicIndex(build.id);
  console.log(before?.build === build.id ? `R2: generation ${before.gen} ${JSON.stringify(before.kinds)}` : 'R2: not published');
  if (!APPLY) {
    console.log('\ndry run - nothing written. --apply publishes (the table is not touched).');
    return;
  }

  const key = await serviceKey();
  const started = Date.now();
  const plan = await step(key, { build_id: build.id });
  console.log(`\nplan: generation ${plan.gen} ${JSON.stringify(plan.kinds)}`);
  let rows = 0;
  let bytes = 0;
  let commit = null;
  let next = plan.next;
  for (let n = 0; next && n < MAX_STEPS; n++) {
    if (PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS));
    const res = await step(key, { build_id: build.id, gen: plan.gen, cursor: next });
    if (next === 'commit') {
      commit = res;
    } else {
      rows += res.rows;
      bytes += res.bytes;
      console.log(`  ${res.kind.padEnd(10)} shards ${String(res.from).padStart(3)}-${String(res.to - 1).padStart(3)}  ${res.rows} rows, ${res.shapes} shapes, ${(res.bytes / 1024).toFixed(0)} kB`);
    }
    next = res.next;
  }
  if (!commit) return fail('the publish did not reach its commit');
  console.log(
    `commit: missing ${commit.missing}, verified ${commit.verified}, index ${commit.index_put}, ` +
      `older objects removed ${commit.removed_objects}${commit.superseded ? ', SUPERSEDED by a newer publish' : ''}`,
  );
  console.log(`${rows} of ${total} rows in ${(bytes / 1024 / 1024).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)} s`);

  const after = await publicIndex(build.id);
  const live = after?.build === build.id && after.gen === plan.gen;
  if (!commit.index_put || !live) return fail('the index does not name this generation - clients keep reading the table');
  if (rows !== total) fail(`${total - rows} row(s) of the table are not in the shards (changed while publishing?)`);
}

main().catch((e) => fail(e.message));
