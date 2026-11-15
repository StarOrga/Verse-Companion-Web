#!/usr/bin/env node
// ============================================================
// analytics-sync.mjs — push the event catalogue to PostHog
//
// For every entry of src/app/core/analytics/events.ts this PATCHes (creating
// the definition on first use) the PostHog event definition: description,
// tags = [area], verified = true. Run it after adding or renaming an event
// (docs/analytics/event-naming.md).
//
//   POSTHOG_PERSONAL_API_KEY=phx_… npm run analytics:sync
//   npm run analytics:sync -- --dry-run     # print what would be sent
//
// Without the key it says so and exits 0 — the key is the owner's to create
// (PostHog → Settings → Personal API keys, scope `event_definition:write`).
// ============================================================

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = path.join(HERE, '..', 'src', 'app', 'core', 'analytics', 'events.ts');
const BASE = process.env.POSTHOG_API_BASE ?? 'https://eu.posthog.com/api/projects/@current/event_definitions/';

/** The payload one event definition gets. */
export function definitionPayload(name, def) {
  return { name, description: def.desc, tags: [def.area], verified: true };
}

async function api(key, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

/** Finds the definition id for an event name (null when PostHog has not seen the event yet). */
async function findId(key, name) {
  const found = await api(key, `${BASE}?search=${encodeURIComponent(name)}&limit=50`);
  return found.results?.find((d) => d.name === name)?.id ?? null;
}

export async function main(argv = process.argv.slice(2)) {
  const dry = argv.includes('--dry-run');
  const key = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
  const { EVENTS } = await import(pathToFileURL(CATALOGUE).href);
  const entries = Object.entries(EVENTS);

  if (dry) {
    for (const [name, def] of entries) console.log(JSON.stringify(definitionPayload(name, def)));
    console.log(`(dry run: ${entries.length} definitions)`);
    return;
  }
  if (!key) {
    console.log('analytics:sync skipped — POSTHOG_PERSONAL_API_KEY is not set.');
    console.log('Create a personal API key in PostHog (Settings → Personal API keys, scope event_definition:write) and re-run.');
    return;
  }

  let done = 0;
  let pending = 0;
  for (const [name, def] of entries) {
    const body = JSON.stringify(definitionPayload(name, def));
    try {
      const id = await findId(key, name);
      if (!id) {
        // PostHog creates a definition when it first sees the event; until then there is nothing to describe.
        pending++;
        console.log(`  - ${name}: not seen by PostHog yet — will sync once the event has been received`);
        continue;
      }
      await api(key, `${BASE}${id}/`, { method: 'PATCH', body });
      done++;
    } catch (error) {
      console.error(`✗ ${name}: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  }
  console.log(`analytics:sync — ${done} updated, ${pending} waiting for a first event, ${entries.length} in the catalogue`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
