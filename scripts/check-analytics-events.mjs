#!/usr/bin/env node
// ============================================================
// check-analytics-events.mjs — the event catalogue stays the only way in
//
// WHY
// ---
// Every product event the app sends is declared once in
// src/app/core/analytics/events.ts (`category:object_action`, typed props) and
// sent through `AnalyticsService.track()`. A raw `analytics.capture('foo')`
// somewhere in a component would bypass naming, typing and the descriptions
// that `npm run analytics:sync` pushes to PostHog. This guard runs in
// `prebuild` and fails the build on:
//   - `.capture(` on an analytics/posthog receiver or with a string/template
//     literal as first argument, and any `captureVerse(`, outside
//     src/app/core/analytics* (the service, the catalogue, their specs);
//   - a catalogue name that is not `category:object_action` with a verb from
//     EVENT_VERBS, whose category differs from its `area`, that is declared
//     twice, or that lacks a description;
//   - a LEGACY_EVENT_NAMES target that is not in the catalogue;
//   - a `track('<literal>'` call with a name that is not in the catalogue.
//
// USAGE
//   node scripts/check-analytics-events.mjs
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'src', 'app');
export const CATALOGUE_FILE = path.join(SCAN_ROOT, 'core', 'analytics', 'events.ts');
const ALLOWED_PREFIX = 'src/app/core/analytics';

const blank = (text) => text.replace(/[^\n]/g, ' ');

/** Blank comments, keep strings (a `//` inside 'https://…' is not a comment). */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Raw-capture findings in one source text: `[{ line, text }]`. */
export function findRawCaptures(source) {
  const clean = stripComments(source);
  const found = [];
  const re = /(?:\b([\w$.]*)\.capture\(\s*(['"`])?)|\bcaptureVerse\(/g;
  let m;
  while ((m = re.exec(clean))) {
    const isVerse = m[0].startsWith('captureVerse');
    const receiver = m[1] ?? '';
    const literalArg = !!m[2];
    if (isVerse || literalArg || /analytics|posthog/i.test(receiver)) {
      const line = clean.slice(0, m.index).split('\n').length;
      found.push({ line, text: m[0].trim() });
    }
  }
  return found;
}

/** `track('name'` literals in one source text. */
export function findTrackNames(source) {
  const clean = stripComments(source);
  return [...clean.matchAll(/\.track\(\s*'([^']+)'/g)].map((m) => ({
    name: m[1],
    line: clean.slice(0, m.index).split('\n').length,
  }));
}

/** Names declared as object keys of EVENTS in the catalogue text (to see duplicates). */
export function declaredNames(catalogueSource) {
  const clean = stripComments(catalogueSource);
  const start = clean.indexOf('export const EVENTS');
  const end = clean.indexOf('} as const;', start);
  const body = start >= 0 && end > start ? clean.slice(start, end) : '';
  return [...body.matchAll(/^\s*'([^']+)':\s*ev\b/gm)].map((m) => m[1]);
}

/** Validates the catalogue module; returns a list of problem strings. */
export function validateCatalogue({ EVENTS, EVENT_VERBS, EVENT_AREAS, LEGACY_EVENT_NAMES }, names) {
  const problems = [];
  const verbs = [...EVENT_VERBS].sort((a, b) => b.length - a.length).join('|');
  const pattern = new RegExp(`^([a-z]+):[a-z0-9]+(?:_[a-z0-9]+)*_(?:${verbs})$`);
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name)) problems.push(`duplicate catalogue name "${name}"`);
    seen.add(name);
  }
  for (const [name, def] of Object.entries(EVENTS)) {
    const m = pattern.exec(name);
    if (!m) problems.push(`"${name}" is not category:object_action with a verb from EVENT_VERBS`);
    else if (m[1] !== def.area) problems.push(`"${name}": category "${m[1]}" differs from area "${def.area}"`);
    if (!EVENT_AREAS.includes(def.area)) problems.push(`"${name}": unknown area "${def.area}"`);
    if (!def.desc || def.desc.trim().length < 10) problems.push(`"${name}": missing description`);
  }
  for (const [old, target] of Object.entries(LEGACY_EVENT_NAMES)) {
    if (!(target in EVENTS)) problems.push(`legacy "${old}" points to unknown "${target}"`);
  }
  return problems;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

export async function main() {
  const catalogue = await import(pathToFileURL(CATALOGUE_FILE).href);
  const problems = validateCatalogue(catalogue, declaredNames(readFileSync(CATALOGUE_FILE, 'utf8')));
  for (const file of walk(SCAN_ROOT)) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    const src = readFileSync(file, 'utf8');
    if (!rel.startsWith(ALLOWED_PREFIX)) {
      for (const f of findRawCaptures(src)) {
        problems.push(`${rel}:${f.line}: raw ${f.text} — send events with AnalyticsService.track() and a catalogue name (docs/analytics/event-naming.md)`);
      }
    }
    for (const t of findTrackNames(src)) {
      if (!(t.name in catalogue.EVENTS)) problems.push(`${rel}:${t.line}: track('${t.name}') is not in the catalogue`);
    }
  }
  if (problems.length) {
    console.error(`✗ analytics event guard: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ analytics events: ${Object.keys(catalogue.EVENTS).length} catalogue entries, no raw capture calls`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
