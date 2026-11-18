#!/usr/bin/env node
/**
 * sync-scc-app-i18n — publish the desktop app's UI language packs under
 * `public/i18n/scc-app/` (#1055). The app's i18n pack service downloads
 * `<sccWebBase>/i18n/scc-app/<code>.json` (schema `scc-app-i18n/1`); contract:
 * `docs/contracts/scc-app-i18n-packs.md`.
 *
 * Usage:
 *   node scripts/sync-scc-app-i18n.mjs --app <path to the app checkout>
 *       runs `node scripts/i18n/packs.js export-web <tmp>` in the app repo, then syncs
 *   node scripts/sync-scc-app-i18n.mjs --from <export dir>
 *       syncs an export the app already wrote
 *
 * Every file is validated before anything is written: a pack must be JSON with
 * `schema: "scc-app-i18n/1"`, a `locale` equal to its file name and a `strings`
 * object; `index.json` must carry `schema: "scc-app-i18n-index/1"` and list exactly
 * the packs. Any other file refuses the whole sync. Packs that are no longer
 * exported are removed, so a dropped language answers 404 again.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACK_SCHEMA = 'scc-app-i18n/1';
export const INDEX_SCHEMA = 'scc-app-i18n-index/1';
const CODE = /^[a-z]{2}(-[A-Z]{2})?$/;

/** Validates an export: `{ name: text }` → `{ ok, errors, packs }` (packs = locale codes). */
export function validateExport(files) {
  const errors = [];
  const packs = [];
  let index = null;
  for (const [name, text] of Object.entries(files)) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      errors.push(`${name}: not valid JSON`);
      continue;
    }
    if (name === 'index.json') {
      if (doc?.schema !== INDEX_SCHEMA || typeof doc.locales !== 'object' || doc.locales === null) {
        errors.push(`${name}: expected schema ${INDEX_SCHEMA} with a locales map`);
      } else index = doc;
      continue;
    }
    const code = name.endsWith('.json') ? name.slice(0, -5) : '';
    if (!CODE.test(code)) {
      errors.push(`${name}: not a pack file (<code>.json)`);
      continue;
    }
    if (doc?.schema !== PACK_SCHEMA) errors.push(`${name}: schema is not ${PACK_SCHEMA}`);
    else if (doc.locale !== code) errors.push(`${name}: locale "${doc.locale}" does not match the file name`);
    else if (typeof doc.strings !== 'object' || doc.strings === null || Array.isArray(doc.strings)) errors.push(`${name}: strings is not an object`);
    else packs.push(code);
  }
  if (!index) errors.push('index.json: missing or invalid');
  else {
    const listed = Object.keys(index.locales).sort();
    const have = [...packs].sort();
    if (listed.join(',') !== have.join(',')) errors.push(`index.json: lists ${listed.join(',')} but the packs are ${have.join(',')}`);
  }
  if (packs.length === 0) errors.push('no packs found');
  return { ok: errors.length === 0, errors, packs: packs.sort() };
}

function readDir(dir) {
  const out = {};
  for (const name of readdirSync(dir)) out[name] = readFileSync(join(dir, name), 'utf8');
  return out;
}

/** Replaces `target` with the validated export; returns the written file names. */
export function syncInto(target, files) {
  const v = validateExport(files);
  if (!v.ok) throw new Error(`refusing to sync:\n  ${v.errors.join('\n  ')}`);
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(target)) if (!(name in files)) rmSync(join(target, name));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(target, name), text.endsWith('\n') ? text : `${text}\n`);
  return Object.keys(files).sort();
}

function main(argv) {
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const app = at('--app');
  let from = at('--from');
  if (!app && !from) {
    process.stderr.write('usage: node scripts/sync-scc-app-i18n.mjs --app <app checkout> | --from <export dir>\n');
    return 2;
  }
  let tmp = null;
  if (app) {
    const script = join(resolve(app), 'scripts', 'i18n', 'packs.js');
    if (!existsSync(script)) {
      process.stderr.write(`no packs.js in ${app}\n`);
      return 2;
    }
    tmp = mkdtempSync(join(tmpdir(), 'scc-app-i18n-'));
    execFileSync(process.execPath, [script, 'export-web', tmp], { cwd: resolve(app), stdio: 'inherit' });
    from = tmp;
  }
  try {
    const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
    const written = syncInto(join(repo, 'public', 'i18n', 'scc-app'), readDir(resolve(from)));
    process.stdout.write(`synced ${written.length} files to public/i18n/scc-app/\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
