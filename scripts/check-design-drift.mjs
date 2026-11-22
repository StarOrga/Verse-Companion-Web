#!/usr/bin/env node
/**
 * Design-system drift report for the web (`src/app`) and the Data Uploader
 * (`data-uploader/src`). Report-only: prints counts and the files with the most
 * drift, always exits 0. Rules: .claude/deep-knowledge/design-system.md.
 *
 * Counted as drift (StarUI scales, decided 2026-11-21):
 *   - border-radius outside 0 / 2 / 4 / 8 / pill (999px, 50%) and not a var()
 *   - font-size below 13px
 *   - raw hex colour literals in styles
 * A line (or the line above it) carrying `ds-new:`, `ds-ok:` or `color-literal-ok:`
 * is a declared deviation and not counted; `ds-new` lines are listed as the
 * experimental register instead.
 *
 *   node scripts/check-design-drift.mjs            # summary
 *   node scripts/check-design-drift.mjs --files 20 # longer top list
 *   node scripts/check-design-drift.mjs --json     # machine-readable
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SURFACES = { web: 'src/app', uploader: 'data-uploader/src' };
const RADIUS_OK = new Set(['0', '0px', '2px', '4px', '8px', '999px', '9999px', '50%', 'inherit', 'initial', 'unset', '!important']);
const FLOOR = 13;
const PRAGMA = /(ds-new:|ds-ok:|color-literal-ok:)/;
const SKIP = new Set(['node_modules', 'dist', 'out', 'build', 'python']);

const args = process.argv.slice(2);
const topN = Number(args[args.indexOf('--files') + 1]) || 8;

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const report = {};
for (const [surface, dir] of Object.entries(SURFACES)) {
  const r = { radius: 0, font: 0, hex: 0, byFile: {}, dsNew: [] };
  for (const p of walk(join(ROOT, dir))) {
    const ext = extname(p);
    if (!['.css', '.scss', '.ts', '.html'].includes(ext) || p.endsWith('.spec.ts')) continue;
    const text = readFileSync(p, 'utf8');
    const style = ext === '.css' || ext === '.scss' || /styles?\s*:\s*[[`]/.test(text);
    if (!style && ext !== '.html') continue;
    const rel = relative(ROOT, p).replace(/\\/g, '/');
    const lines = text.split('\n');
    let n = 0;
    lines.forEach((line, i) => {
      const m = /ds-new:\s*([^*\n]+?)(?:\*\/|-->|$)/.exec(line);
      if (m) r.dsNew.push(`${rel}:${i + 1} — ${m[1].trim()}`);
      if (PRAGMA.test(line) || (i > 0 && PRAGMA.test(lines[i - 1]))) return;
      if (!style) return;
      const rad = /border(?:-[a-z-]+)?-radius\s*:\s*([^;}{]+)/.exec(line);
      if (rad) for (const v of rad[1].trim().split(/\s+/)) {
        if (!v.startsWith('var(') && !v.startsWith('calc(') && !RADIUS_OK.has(v)) { r.radius++; n++; }
      }
      const fs = /font-size\s*:\s*([\d.]+)(px|rem)\b/.exec(line);
      if (fs && (fs[2] === 'rem' ? parseFloat(fs[1]) * 16 : parseFloat(fs[1])) < FLOOR) { r.font++; n++; }
      if (!/^\s*(\/\/|\*|\/\*)/.test(line)) {
        const hex = (line.match(/#[0-9a-fA-F]{3,8}\b(?![\w-])/g) || []).filter((h) => [4, 5, 7, 9].includes(h.length));
        r.hex += hex.length; n += hex.length;
      }
    });
    if (n) r.byFile[rel] = n;
  }
  report[surface] = r;
}

if (args.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const [surface, r] of Object.entries(report)) {
    console.log(`design drift · ${surface}: radius off-scale ${r.radius} · font < ${FLOOR}px ${r.font} · hex literals ${r.hex} · ds-new ${r.dsNew.length}`);
    for (const [f, n] of Object.entries(r.byFile).sort((a, b) => b[1] - a[1]).slice(0, topN)) console.log(`  ${String(n).padStart(4)}  ${f}`);
    for (const e of r.dsNew) console.log(`  ds-new  ${e}`);
  }
  console.log('Report only. Mark deliberate deviations with ds-new / ds-ok (see .claude/deep-knowledge/design-system.md).');
}
