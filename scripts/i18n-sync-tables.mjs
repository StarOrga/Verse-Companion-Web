#!/usr/bin/env node
/**
 * i18n-sync-tables — keeps the machine-translated UI tables in step with en.json.
 *
 *   node scripts/i18n-sync-tables.mjs           drop keys English no longer has, report missing ones
 *   node scripts/i18n-sync-tables.mjs --check   exit 1 when a table carries a key English lacks
 *   node scripts/i18n-sync-tables.mjs --missing <lang>
 *                                               print the English strings <lang> still lacks as JSON
 *                                               ({ "a.b.c": "English text" }), the work list for a refresh
 *
 * de.json and en.json are written by hand and never touched. The other tables are the
 * APP_LANGUAGES of src/app/core/locale/locale.types.ts; a key they lack reads English at
 * runtime (fallbackLang), so missing keys are a refresh task, not an error. Orphans are
 * removed because translation-files.spec.ts refuses them. Key order follows en.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'public', 'i18n');
const TABLES = ['es', 'es-419', 'fr', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'tr', 'zh-Hans', 'zh-Hant'];

const read = (lang) => JSON.parse(readFileSync(join(DIR, `${lang}.json`), 'utf8'));

/** Rebuilds `table` in the key order of `en`, dropping what `en` lacks. Counts kept/dropped/missing. */
function align(en, table, stats, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(en)) {
    const t = table?.[k];
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      if (typeof t === 'string') out[k] = t;
      else stats.missing.push(key);
    } else if (v && typeof v === 'object') {
      const child = align(v, t && typeof t === 'object' ? t : {}, stats, key);
      if (Object.keys(child).length) out[k] = child;
    }
  }
  if (table && typeof table === 'object') {
    for (const k of Object.keys(table)) if (!(k in en)) stats.dropped.push(prefix ? `${prefix}.${k}` : k);
    for (const [k, v] of Object.entries(table)) {
      if (k in en && typeof en[k] === 'string' && typeof v !== 'string') stats.dropped.push(prefix ? `${prefix}.${k}` : k);
    }
  }
  return out;
}

const args = process.argv.slice(2);
const en = read('en');

if (args[0] === '--missing') {
  const lang = args[1];
  if (!TABLES.includes(lang)) {
    console.error(`unknown table ${lang}; one of ${TABLES.join(', ')}`);
    process.exitCode = 2;
  } else {
    const stats = { missing: [], dropped: [] };
    align(en, read(lang), stats);
    const get = (p) => p.split('.').reduce((a, k) => a?.[k], en);
    process.stdout.write(JSON.stringify(Object.fromEntries(stats.missing.map((p) => [p, get(p)])), null, 2) + '\n');
  }
} else {
  const check = args.includes('--check');
  let orphans = 0;
  for (const lang of TABLES) {
    const stats = { missing: [], dropped: [] };
    const aligned = align(en, read(lang), stats);
    orphans += stats.dropped.length;
    if (!check && stats.dropped.length) writeFileSync(join(DIR, `${lang}.json`), JSON.stringify(aligned, null, 2) + '\n');
    console.log(`${lang.padEnd(8)} dropped ${stats.dropped.length}  missing ${stats.missing.length}`);
  }
  if (check && orphans) {
    console.error(`${orphans} key(s) English no longer has — run node scripts/i18n-sync-tables.mjs`);
    process.exitCode = 1;
  }
}
