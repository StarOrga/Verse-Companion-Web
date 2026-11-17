#!/usr/bin/env node
// ============================================================
// posthog-apply.mjs — PostHog as code
//
// Creates / updates, idempotently by name, everything an admin browses in
// PostHog: the three dashboards and their insights (posthog/dashboards.json),
// the funnels of the eight flows (posthog/flows.json), the workflow actions
// (posthog/actions.json), the legacy-name bridge actions (LEGACY_EVENT_NAMES
// in events.ts) and the `telemetry-saver` feature flag (inactive).
//
//   POSTHOG_PERSONAL_API_KEY=phx_… npm run posthog:apply
//   npm run posthog:apply -- --dry-run     # print the plan, no network
//   npm run posthog:apply -- --emit-plan   # plan as JSON on stdout (all POST), for a browser-session replay
//
// Scopes of the key: insight:write, dashboard:write, action:write,
// feature_flag:write, project:read, query:read. Without the key it says so
// and exits 0. Details + browser replay: docs/analytics/posthog-setup.md.
// ============================================================

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPlan, executePlan, fetchExisting, indexFlows } from './lib/posthog-plan.mjs';

export { buildPlan, executePlan, fetchExisting };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = (process.env.POSTHOG_API_HOST ?? 'https://eu.posthog.com').replace(/\/$/, '');

const readJson = (rel) => {
  const file = path.join(ROOT, rel);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};

/** The spec buildPlan consumes: dashboards.json + optional flows/actions + the legacy name map. */
export async function loadSpec() {
  const base = readJson('posthog/dashboards.json');
  if (!base) throw new Error('posthog/dashboards.json is missing');
  const events = await import(pathToFileURL(path.join(ROOT, 'src', 'app', 'core', 'analytics', 'events.ts')).href);
  const flows = readJson('posthog/flows.json');
  const actions = readJson('posthog/actions.json');
  if (!flows) console.warn('posthog/flows.json not found — the flow funnel tiles are skipped.');
  return { ...base, flows, actions, legacy: events.LEGACY_EVENT_NAMES };
}

/** Node transport: personal API key as bearer, small 429 back-off. */
export function nodeSender(key, host = HOST) {
  return async ({ method, path: p, body }) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${host}${p}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429 && attempt < 4) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${(await res.text()).slice(0, 300)}`);
      return res.status === 204 ? null : res.json();
    }
  };
}

export async function main(argv = process.argv.slice(2)) {
  const spec = await loadSpec();
  const dry = argv.includes('--dry-run');
  const emit = argv.includes('--emit-plan');
  const key = process.env.POSTHOG_PERSONAL_API_KEY?.trim();

  if (dry || emit) {
    const plan = buildPlan(spec);
    if (emit) {
      console.log(JSON.stringify(plan));
      return;
    }
    for (const s of plan) console.log(`${s.method.padEnd(5)} ${s.path}  [${s.kind}] ${s.name}`);
    const count = (k) => plan.filter((s) => s.kind === k).length;
    console.log(`(dry run: ${count('dashboard')} dashboards, ${count('insight')} insights, ${count('action')} actions, ${count('feature_flag')} feature flags — all POST because nothing is looked up offline)`);
    return;
  }
  if (!key) {
    console.log('posthog:apply skipped — POSTHOG_PERSONAL_API_KEY is not set.');
    console.log('Create a personal API key (docs/analytics/posthog-setup.md) and re-run, or replay the plan from a PostHog browser session.');
    return;
  }

  const send = nodeSender(key);
  const plan = buildPlan(spec, await fetchExisting(send));
  let n = 0;
  await executePlan(plan, send, (step) => console.log(`${String(++n).padStart(3)}/${plan.length} ${step.method} ${step.kind}: ${step.name}`));
  console.log(`posthog:apply done — ${plan.length} requests.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`posthog:apply failed: ${e.message}`);
    process.exitCode = 1;
  });
}

export { indexFlows };
