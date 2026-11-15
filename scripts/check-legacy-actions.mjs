#!/usr/bin/env node
// ============================================================
// check-legacy-actions.mjs — one action control: scAction
//
// WHY (issue #970)
// ----------------
// The app had five button systems (.sc-btn / .sc-btn-primary, .btn,
// .link-btn, page-local .cta / .act). #970 moved every real action to the
// one action control `scAction` (src/app/shared/action/) in slices; this
// guard runs in `prebuild` so a new legacy button fails `npm run build`
// instead of reopening the drift.
//
// SCOPE
// -----
// - Every src/app/**/*.ts and *.html except *.spec.ts (specs may build
//   throwaway host templates).
// - A static `class="…"` attribute whose token list holds sc-btn,
//   sc-btn-primary, btn or link-btn (the whole token: back-btn, fold-btn
//   or lg-btn stay free), and the `[class.sc-btn]`-style bindings of the
//   same tokens.
// - Comments are blanked first (shared stripComments of check-native-ui),
//   so a comment that names the old class does not count.
// - Not flagged on purpose: bespoke designed controls with their own class
//   names (stage CTAs, holo controls, row CTAs in the quick search) — they
//   are not the legacy systems this guard retires.
// - A line that must keep a legacy class carries the comment
//   `legacy-action: exception — <why>` on the same line.
//
// USAGE
//   node scripts/check-legacy-actions.mjs   # scan src/app
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stripComments } from './check-native-ui.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'src', 'app');

export const LEGACY_TOKENS = ['sc-btn', 'sc-btn-primary', 'btn', 'link-btn'];
const HINT = 'use scAction (src/app/shared/action/sc-action.directive.ts): tier primary | secondary | tertiary';
const EXCEPTION = /legacy-action:\s*exception/;

/** All findings in one file's text: [{ line, match }]. */
export function findLegacyActions(text) {
  const clean = stripComments(text);
  const lines = text.split('\n');
  const hits = [];
  const push = (index, match) => {
    const line = clean.slice(0, index).split('\n').length;
    if (EXCEPTION.test(lines[line - 1] ?? '')) return;
    hits.push({ line, match });
  };
  const classAttr = /(?<![\w.[-])class="([^"]*)"/g;
  let m;
  while ((m = classAttr.exec(clean)) !== null) {
    const legacy = m[1].split(/\s+/).filter((t) => LEGACY_TOKENS.includes(t));
    if (legacy.length) push(m.index, `class="${m[1].trim()}"`);
  }
  const binding = /\[class\.(sc-btn-primary|sc-btn|link-btn|btn)\]/g;
  while ((m = binding.exec(clean)) !== null) push(m.index, m[0]);
  return hits.sort((a, b) => a.line - b.line);
}

function listSources(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSources(full));
    else if (/\.(ts|html)$/.test(entry.name) && !entry.name.endsWith('.spec.ts')) files.push(full);
  }
  return files;
}

function scan() {
  const findings = [];
  for (const file of listSources(SCAN_ROOT)) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    for (const hit of findLegacyActions(readFileSync(file, 'utf8'))) findings.push({ rel, ...hit });
  }
  if (findings.length === 0) {
    console.log('check-legacy-actions: no legacy .sc-btn / .btn / .link-btn action controls in src/app.');
    return;
  }
  console.error(`check-legacy-actions: legacy button classes found — ${HINT}\n`);
  for (const f of findings) console.error(`  ${f.rel}:${f.line}  ${f.match}`);
  console.error(`\n${findings.length} finding(s).`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) scan();
