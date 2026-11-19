#!/usr/bin/env node
// Measures what the Supabase instance pays for activity: memory and swap, then
// per minute how much it reads from the swap volume and the data volume - first
// while we do nothing, then while a fixed set of catalog requests runs every
// 15 seconds. The same procedure before and after a change is the only
// comparison that holds here - see .claude/deep-knowledge/supabase.md ("The
// instance swaps").
//
//   node scripts/supabase-io-probe.mjs [--idle 5] [--load 3] [--label before]
//                                       (minutes)
//
// The machine metrics refresh ONCE A MINUTE (every counter, CPU seconds
// included, jumps in one step). A finer trace shows 59 seconds of nothing and
// one "burst", which is the refresh and not an event on the machine - that
// artifact was read as a 63-second idle burst on 2026-11-18. So this script
// only ever compares one refresh with the next.
//
// A minute means nothing without knowing who else used the instance in it:
// read `edge_logs` for the same window (requests per minute by user agent)
// before comparing two runs.
//
// Needs SUPABASE_ACCESS_TOKEN (the CLI token). Reads the machine metrics with the
// project's secret key, which never leaves this process and is never printed.
// Sends 5 read requests per round through the public API, nothing else.

const REF = 'hcnqhvzlavdycidqyaai';
const POLL_S = 10;
const ROUND_EVERY_S = 15;
const MB = 1048576;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const IDLE_MIN = Number(arg('idle', 5));
const LOAD_MIN = Number(arg('load', 3));
const LABEL = arg('label', '');

const pat = process.env.SUPABASE_ACCESS_TOKEN;
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const median = (xs) => (xs.length ? [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] : 0);

async function keys() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
    headers: { authorization: `Bearer ${pat}` },
  });
  if (!res.ok) throw new Error(`api-keys ${res.status}`);
  const list = await res.json();
  return {
    secret: list.find((k) => k.type === 'secret')?.api_key,
    publishable: list.find((k) => k.type === 'publishable')?.api_key,
  };
}

function pick(text, name, filter) {
  let sum = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue;
    const m = /^([a-zA-Z_:][\w:]*)(\{[^}]*\})?\s+(\S+)/.exec(line);
    if (!m || m[1] !== name) continue;
    if (filter && !m[2]?.includes(filter)) continue;
    sum += Number(m[3]);
  }
  return sum;
}

async function main() {
  if (!pat) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const { secret, publishable } = await keys();
  const auth = Buffer.from(`service_role:${secret}`).toString('base64');

  const sample = async () => {
    const res = await fetch(`https://${REF}.supabase.co/customer/v1/privileged/metrics`, {
      headers: { authorization: `Basic ${auth}` },
    });
    if (!res.ok) throw new Error(`metrics ${res.status}`);
    const t = await res.text();
    return {
      cpu: pick(t, 'node_cpu_seconds_total'),
      iowait: pick(t, 'node_cpu_seconds_total', 'mode="iowait"'),
      swapReadBytes: pick(t, 'node_disk_read_bytes_total', 'device="nvme0n1"'),
      swapIn: pick(t, 'node_vmstat_pswpin'),
      swapOut: pick(t, 'node_vmstat_pswpout'),
      dataRead: pick(t, 'node_disk_read_bytes_total', 'device="nvme1n1"'),
      dataWritten: pick(t, 'node_disk_written_bytes_total', 'device="nvme1n1"'),
      memTotal: pick(t, 'node_memory_MemTotal_bytes'),
      memAvailable: pick(t, 'node_memory_MemAvailable_bytes'),
      swapTotal: pick(t, 'node_memory_SwapTotal_bytes'),
      swapFree: pick(t, 'node_memory_SwapFree_bytes'),
    };
  };
  const memory = (s) =>
    `available ${(s.memAvailable / MB).toFixed(0)} of ${(s.memTotal / MB).toFixed(0)} MB, in swap ${((s.swapTotal - s.swapFree) / MB).toFixed(0)} MB`;

  /** Waits for the next refresh of the metrics (the CPU counter moves) and returns that sample. */
  const nextRefresh = async (prev, during = async () => {}) => {
    for (;;) {
      await during();
      await sleep(POLL_S);
      const cur = await sample();
      if (cur.cpu !== prev.cpu) return cur;
    }
  };
  /** One refresh-to-refresh window, normalised to one minute by the CPU seconds that passed. */
  const window = (a, b) => {
    const cpus = 2;
    const minutes = (b.cpu - a.cpu) / cpus / 60 || 1;
    return {
      swapReadMB: (b.swapReadBytes - a.swapReadBytes) / MB / minutes,
      swapIn: (b.swapIn - a.swapIn) / minutes,
      swapOut: (b.swapOut - a.swapOut) / minutes,
      dataReadMB: (b.dataRead - a.dataRead) / MB / minutes,
      dataWrittenMB: (b.dataWritten - a.dataWritten) / MB / minutes,
      iowaitPct: ((b.iowait - a.iowait) / (b.cpu - a.cpu || 1)) * 100,
    };
  };
  const line = (name, ws) => {
    const col = (k, digits = 1) => `${median(ws.map((w) => w[k])).toFixed(digits)} (max ${Math.max(...ws.map((w) => w[k])).toFixed(digits)})`;
    console.log(
      `${name}, per minute over ${ws.length} min, median (max): swap volume read ${col('swapReadMB')} MB · pages swapped in ${col('swapIn', 0)} / out ${col('swapOut', 0)} · data volume read ${col('dataReadMB')} MB, written ${col('dataWrittenMB')} MB · iowait ${col('iowaitPct')} %`,
    );
  };

  const api = (path, init = {}) =>
    fetch(`https://${REF}.supabase.co/rest/v1/${path}`, {
      ...init,
      headers: { apikey: publishable, authorization: `Bearer ${publishable}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });

  let prev = await sample();
  console.log(`# supabase-io-probe ${LABEL} ${new Date().toISOString()}`);
  console.log(`memory: ${memory(prev)}`);
  prev = await nextRefresh(prev); // align to a refresh; this partial minute is not counted

  // 1. Without us.
  const idle = [];
  for (let i = 0; i < IDLE_MIN; i++) {
    const cur = await nextRefresh(prev);
    idle.push(window(prev, cur));
    prev = cur;
  }
  if (idle.length) line('idle', idle);

  // 2. The same catalog requests every 15 s: 4 facet reads and the ship list of the rank cohort.
  if (LOAD_MIN > 0) {
    const builds = await (await api('codex_builds?select=id&is_current=eq.true&channel=eq.LIVE&limit=1')).json();
    const build = builds[0]?.id;
    if (!build) throw new Error('no current LIVE build');
    const shipList =
      `codex_ships?select=class_name,guid,name_localized,manufacturer_code,role,crew_size,is_variant,` +
      `p_career:payload->career,p_defaultLoadout:payload->defaultLoadout,p_flight:payload->flight,p_hull:payload->hull,` +
      `p_armorHp:payload->armorHp,p_cargoScu:payload->cargoScu,p_stats:payload->stats` +
      `&build_id=eq.${build}&is_variant=eq.false&order=name_localized.asc.nullslast,class_name.asc&limit=1000`;
    const rounds = [];
    let last = 0;
    const round = async () => {
      if (Date.now() - last < ROUND_EVERY_S * 1000) return;
      last = Date.now();
      const t0 = Date.now();
      const codes = await Promise.all([
        ...['ship', 'weapon', 'component', 'item'].map((k) =>
          api('rpc/codex_facet_values', { method: 'POST', body: JSON.stringify({ p_build_id: build, p_kind: k }) }).then((x) => x.status),
        ),
        api(shipList).then(async (x) => {
          await x.arrayBuffer();
          return x.status;
        }),
      ]).catch(() => [0]);
      rounds.push({ ms: Date.now() - t0, failed: codes.filter((c) => c !== 200).length });
    };
    const load = [];
    for (let i = 0; i < LOAD_MIN; i++) {
      const cur = await nextRefresh(prev, round);
      load.push(window(prev, cur));
      prev = cur;
    }
    line('under load', load);
    console.log(
      `requests: ${rounds.length} rounds of 5, median ${median(rounds.map((r) => r.ms))} ms per round (max ${Math.max(...rounds.map((r) => r.ms))}), ${rounds.reduce((n, r) => n + r.failed, 0)} of ${rounds.length * 5} answers not 200`,
    );
  }
  console.log(`memory after: ${memory(prev)}`);
}

main().catch((e) => {
  console.error(`supabase-io-probe failed: ${e.message}`);
  process.exitCode = 1;
});
