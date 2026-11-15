#!/usr/bin/env node
// ============================================================
// posthog-sourcemaps.mjs — production source maps for PostHog error tracking
//
// `ng build` (production) writes HIDDEN source maps (angular.json: no
// `//# sourceMappingURL` in the bundles). This script runs between the build
// and `postbuild` (scripts/vercel-build.sh):
//
//   1. token set (POSTHOG_CLI_TOKEN + POSTHOG_CLI_ENV_ID):
//        posthog-cli sourcemap inject  (chunk id into every bundle)
//        posthog-cli sourcemap upload  (release = the app version)
//      then re-hashes the injected bundles in ngsw.json — inject changes the
//      bytes, and a stale hash makes the service worker reject the asset.
//      Any CLI failure is logged and swallowed: telemetry never fails a deploy.
//   2. token unset: logs one line and skips the upload.
//   3. ALWAYS: deletes every .map from dist before Vercel serves it.
//
//   node scripts/posthog-sourcemaps.mjs            # as above
//   node scripts/posthog-sourcemaps.mjs --strip    # only step 3 (postbuild)
// ============================================================

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'verse-companion', 'browser');
const HOST = 'https://eu.posthog.com';
const RELEASE_NAME = 'verse-companion';

/** All files below `dir` ending in `.map`. */
export function findMaps(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findMaps(full));
    else if (entry.name.endsWith('.map')) out.push(full);
  }
  return out;
}

/** Deletes every .map under `dir`; returns how many went. */
export function stripMaps(dir) {
  const maps = findMaps(dir);
  for (const f of maps) rmSync(f, { force: true });
  return maps.length;
}

/**
 * Re-hashes the ngsw.json hashTable entries whose file bytes changed (sha1,
 * the same algorithm Angular uses). Returns the patched paths.
 */
export function rehashNgsw(dir) {
  const ngswPath = path.join(dir, 'ngsw.json');
  if (!existsSync(ngswPath)) return [];
  const ngsw = JSON.parse(readFileSync(ngswPath, 'utf8'));
  const changed = [];
  for (const [url, known] of Object.entries(ngsw.hashTable ?? {})) {
    const file = path.join(dir, ...url.split('/').filter(Boolean));
    if (!existsSync(file)) continue;
    const now = createHash('sha1').update(readFileSync(file)).digest('hex');
    if (now !== known) {
      ngsw.hashTable[url] = now;
      changed.push(url);
    }
  }
  if (changed.length) writeFileSync(ngswPath, JSON.stringify(ngsw));
  return changed;
}

/** The posthog-cli argument lists for one release. */
export function cliArgs(version, dir = DIST) {
  const common = ['--directory', dir, '--release-name', RELEASE_NAME, '--release-version', version];
  return {
    inject: ['--host', HOST, 'sourcemap', 'inject', ...common],
    upload: ['--host', HOST, 'sourcemap', 'upload', ...common],
  };
}

function runCli(args, env) {
  const bin = process.env.POSTHOG_CLI_BIN;
  const cmd = bin ?? (process.platform === 'win32' ? 'npx.cmd' : 'npx');
  const full = bin ? args : ['--yes', '@posthog/cli', ...args];
  const r = spawnSync(cmd, full, { env, stdio: 'inherit', shell: process.platform === 'win32' && !bin });
  return r.status === 0;
}

export function main(argv = process.argv.slice(2)) {
  if (!existsSync(DIST)) {
    console.log(`posthog-sourcemaps: ${DIST} does not exist — nothing to do.`);
    return;
  }
  if (!argv.includes('--strip')) {
    const token = process.env.POSTHOG_CLI_TOKEN?.trim();
    const envId = process.env.POSTHOG_CLI_ENV_ID?.trim();
    if (!token || !envId) {
      console.log('posthog-sourcemaps: POSTHOG_CLI_TOKEN / POSTHOG_CLI_ENV_ID not set — source maps are not uploaded (errors stay minified in PostHog).');
    } else {
      const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
      const env = {
        ...process.env,
        // the CLI's own names (older and newer spellings)
        POSTHOG_CLI_API_KEY: token,
        POSTHOG_CLI_PROJECT_ID: envId,
        POSTHOG_CLI_TOKEN: token,
        POSTHOG_CLI_ENV_ID: envId,
      };
      const args = cliArgs(version);
      const injected = runCli(args.inject, env);
      const uploaded = injected && runCli(args.upload, env);
      console.log(uploaded
        ? `posthog-sourcemaps: uploaded source maps for release ${version}.`
        : 'posthog-sourcemaps: WARNING — inject/upload failed, the deploy continues without source maps.');
      const patched = rehashNgsw(DIST);
      if (patched.length) console.log(`posthog-sourcemaps: re-hashed ${patched.length} bundle(s) in ngsw.json.`);
    }
  }
  console.log(`posthog-sourcemaps: removed ${stripMaps(DIST)} .map file(s) from dist.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
