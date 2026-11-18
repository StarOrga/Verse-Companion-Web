#!/usr/bin/env node
// Measures what the Supabase instance pays for activity: memory and swap, the
// IO bursts of an idle stretch, and the IO a fixed set of catalog requests
// costs. The same procedure before and after a change is the only comparison
// that holds here - see .claude/deep-knowledge/supabase.md ("The instance swaps").
//
//   node scripts/supabase-io-probe.mjs [--idle 180] [--rounds 3] [--label before]
//
// Needs SUPABASE_ACCESS_TOKEN (the CLI token). Reads the machine metrics with the
// project's secret key, which never leaves this process and is never printed.
// Sends 5 read requests per round through the public API, nothing else.

const REF = 'hcnqhvzlavdycidqyaai';
const STEP_S = 5;
const BURST_IOPS = 100;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const IDLE_S = Number(arg('idle', 180));
const ROUNDS = Number(arg('rounds', 3));
const LABEL = arg('label', '');

const pat = process.env.SUPABASE_ACCESS_TOKEN;
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

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

function pick(text, name, device) {
  let sum = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue;
    const m = /^([a-zA-Z_:][\w:]*)(\{[^}]*\})?\s+(\S+)/.exec(line);
    if (!m || m[1] !== name) continue;
    if (device && !m[2]?.includes(`device="${device}"`)) continue;
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
      at: Date.now(),
      swapReads: pick(t, 'node_disk_reads_completed_total', 'nvme0n1'),
      swapBytes: pick(t, 'node_disk_read_bytes_total', 'nvme0n1'),
      dataBytes: pick(t, 'node_disk_read_bytes_total', 'nvme1n1') + pick(t, 'node_disk_written_bytes_total', 'nvme1n1'),
      majfault: pick(t, 'node_vmstat_pgmajfault'),
      memTotal: pick(t, 'node_memory_MemTotal_bytes'),
      memAvailable: pick(t, 'node_memory_MemAvailable_bytes'),
      swapTotal: pick(t, 'node_memory_SwapTotal_bytes'),
      swapFree: pick(t, 'node_memory_SwapFree_bytes'),
    };
  };
  const MB = 1048576;

  const api = (path, init = {}) =>
    fetch(`https://${REF}.supabase.co/rest/v1/${path}`, {
      ...init,
      headers: { apikey: publishable, authorization: `Bearer ${publishable}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });

  const first = await sample();
  console.log(`# supabase-io-probe ${LABEL} ${new Date().toISOString()}`);
  console.log(
    `memory: total ${(first.memTotal / MB).toFixed(0)} MB, available ${(first.memAvailable / MB).toFixed(0)} MB, in swap ${((first.swapTotal - first.swapFree) / MB).toFixed(0)} MB`,
  );

  // 1. Idle: how many bursts, how many swap reads, without us doing anything.
  let prev = first;
  let bursts = 0;
  let idleReads = 0;
  let idleData = 0;
  let peak = 0;
  for (let i = 0; i < Math.round(IDLE_S / STEP_S); i++) {
    await sleep(STEP_S);
    const cur = await sample();
    const iops = (cur.swapReads - prev.swapReads) / ((cur.at - prev.at) / 1000);
    if (iops > BURST_IOPS) bursts++;
    peak = Math.max(peak, iops);
    idleReads += cur.swapReads - prev.swapReads;
    idleData += cur.dataBytes - prev.dataBytes;
    prev = cur;
  }
  console.log(
    `idle ${IDLE_S} s: ${bursts} bursts over ${BURST_IOPS} reads/s (peak ${peak.toFixed(0)}), ${idleReads} swap reads (${(idleReads / IDLE_S).toFixed(1)}/s), data volume ${(idleData / MB).toFixed(1)} MB`,
  );

  // 2. A fixed set of catalog requests: 4 facet reads and the ship list.
  const builds = await (await api('codex_builds?select=id&is_current=eq.true&channel=eq.LIVE&limit=1')).json();
  const build = builds[0]?.id;
  if (!build) throw new Error('no current LIVE build');
  const shipList =
    `codex_ships?select=class_name,guid,name_localized,manufacturer_code,role,crew_size,is_variant,` +
    `p_career:payload->career,p_defaultLoadout:payload->defaultLoadout,p_flight:payload->flight,p_hull:payload->hull,` +
    `p_armorHp:payload->armorHp,p_cargoScu:payload->cargoScu,p_stats:payload->stats` +
    `&build_id=eq.${build}&is_variant=eq.false&order=name_localized.asc.nullslast,class_name.asc&limit=1000`;
  const rounds = [];
  for (let r = 0; r < ROUNDS; r++) {
    await sleep(15);
    const a = await sample();
    const t0 = Date.now();
    const codes = await Promise.all([
      ...['ship', 'weapon', 'component', 'item'].map((k) =>
        api('rpc/codex_facet_values', { method: 'POST', body: JSON.stringify({ p_build_id: build, p_kind: k }) }).then((x) => x.status),
      ),
      api(shipList).then(async (x) => {
        await x.arrayBuffer();
        return x.status;
      }),
    ]);
    const ms = Date.now() - t0;
    await sleep(8);
    const b = await sample();
    rounds.push({
      ms,
      swapReads: b.swapReads - a.swapReads,
      swapMB: (b.swapBytes - a.swapBytes) / MB,
      dataMB: (b.dataBytes - a.dataBytes) / MB,
      majfault: b.majfault - a.majfault,
      codes: codes.join('/'),
    });
  }
  for (const [i, r] of rounds.entries())
    console.log(
      `probe ${i + 1}: 5 requests in ${r.ms} ms (${r.codes}) -> ${r.swapReads} swap reads (${r.swapMB.toFixed(1)} MB), ${r.majfault} major faults, data volume ${r.dataMB.toFixed(1)} MB`,
    );
  const med = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  console.log(
    `probe median: ${med(rounds.map((r) => r.ms))} ms, ${med(rounds.map((r) => r.swapReads))} swap reads, ${med(rounds.map((r) => r.majfault))} major faults`,
  );
  const last = await sample();
  console.log(
    `memory after: available ${(last.memAvailable / MB).toFixed(0)} MB, in swap ${((last.swapTotal - last.swapFree) / MB).toFixed(0)} MB`,
  );
}

main().catch((e) => {
  console.error(`supabase-io-probe failed: ${e.message}`);
  process.exitCode = 1;
});
