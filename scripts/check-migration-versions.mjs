#!/usr/bin/env node
// ============================================================
// check-migration-versions.mjs — every migration has its own version
//
// WHY: the Supabase CLI keys a migration by the digits before the first `_`
// of its file name. Two files with the same prefix share one ledger row:
// `supabase db push` applies the first one and silently skips the second
// (20261115030000 was taken by posthog_single_source and
// verse_comet_announced_only at the same time — the second never reached
// prod until it was renamed).
//
// RULE: every file in supabase/migrations/*.sql starts with `<digits>_` and no
// two files share those digits. Runs in `prebuild`.
// ============================================================
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');

/**
 * @param {string[]} names file names (only `.sql` files are looked at)
 * @returns {{ duplicates: { version: string, files: string[] }[], malformed: string[] }}
 */
export function findVersionProblems(names) {
  const byVersion = new Map();
  const malformed = [];
  for (const name of names) {
    if (!name.endsWith('.sql')) continue;
    const m = /^(\d+)_/.exec(name);
    if (!m) {
      malformed.push(name);
      continue;
    }
    const list = byVersion.get(m[1]) ?? [];
    list.push(name);
    byVersion.set(m[1], list);
  }
  const duplicates = [...byVersion]
    .filter(([, files]) => files.length > 1)
    .map(([version, files]) => ({ version, files: files.sort() }));
  return { duplicates, malformed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = readdirSync(MIGRATIONS_DIR);
  const { duplicates, malformed } = findVersionProblems(names);
  for (const d of duplicates) {
    console.error(
      `check-migration-versions: version ${d.version} is used by ${d.files.join(', ')} — db push would skip all but one; give the newer file a later, unused prefix`,
    );
  }
  for (const f of malformed) {
    console.error(`check-migration-versions: ${f} has no "<digits>_" version prefix — the Supabase CLI cannot order it`);
  }
  if (duplicates.length || malformed.length) process.exitCode = 1;
  else console.log(`check-migration-versions: ${names.filter((n) => n.endsWith('.sql')).length} migrations, all versions unique`);
}
