#!/usr/bin/env node
// Proves a registered Data Uploader release end to end, the way an installed
// build sees it:
//   1. the update feed accepts the build's release token (no 401),
//   2. the feed serves the expected version on the ring,
//   3. the feed's sha512 is the sha512 of the setup on the public mirror.
// Run it right after registering a release (ship rule 6). Background: 0.84.3 was
// built twice on 2026-11-21 and the registered row pointed at overwritten files,
// so installs of the other build could never update again.
//
//   node scripts/verify-uploader-release.mjs --version 0.84.4 --run 44909133335
//   node scripts/verify-uploader-release.mjs --version 0.84.4 --token <uuid> [--channel alpha]
//
// --run downloads the run's private `release-token` artefact via `gh`.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_BASE = 'https://hcnqhvzlavdycidqyaai.supabase.co';
const MIRROR = 'https://github.com/StarOrga/Verse-Companion-Binaries/releases/download';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function tokenFromRun(runId) {
  const dir = mkdtempSync(join(tmpdir(), 'uploader-token-'));
  try {
    execFileSync('gh', ['run', 'download', runId, '-n', 'release-token', '-D', dir], { stdio: 'ignore' });
    return readFileSync(join(dir, 'release-token.txt'), 'utf8').replace(/^﻿/, '').trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** sha512 in latest.yml is base64, the catalog row may carry hex — compare as hex. */
function toHex(sha) {
  const s = String(sha ?? '').trim();
  return /^[0-9a-f]{128}$/i.test(s) ? s.toLowerCase() : Buffer.from(s, 'base64').toString('hex');
}

function yamlField(yaml, key) {
  const m = yaml.match(new RegExp(`^${key}:\\s*['"]?([^'"\\s]+)`, 'm'));
  return m ? m[1] : null;
}

async function main() {
  const version = arg('version');
  const channel = arg('channel') ?? 'alpha';
  const runId = arg('run');
  const token = arg('token') ?? (runId ? tokenFromRun(runId) : undefined);
  if (!version || !token) {
    console.error('usage: verify-uploader-release.mjs --version <x.y.z> (--run <id> | --token <uuid>) [--channel alpha]');
    process.exitCode = 2;
    return;
  }

  const fails = [];
  const feed = await fetch(`${API_BASE}/functions/v1/desktop-latest/${channel}.yml`, {
    headers: { 'X-SC-Release-Token': token, Accept: 'application/yaml' },
  });
  const feedText = await feed.text();
  if (feed.status !== 200) {
    fails.push(`feed answered ${feed.status} for token ${token.slice(0, 8)}… (${feedText.slice(0, 120)})`);
  } else {
    const served = yamlField(feedText, 'version');
    if (served !== version) fails.push(`${channel} ring serves ${served}, expected ${version}`);
    const mirror = await fetch(`${MIRROR}/data-uploader-v${version}/latest.yml`, { redirect: 'follow' });
    if (mirror.status !== 200) {
      fails.push(`mirror latest.yml for ${version} answered ${mirror.status}`);
    } else {
      const mirrorSha = toHex(yamlField(await mirror.text(), 'sha512'));
      const feedSha = toHex(yamlField(feedText, 'sha512'));
      if (!mirrorSha || mirrorSha !== feedSha) {
        fails.push(`catalog sha512 ${feedSha.slice(0, 16)}… differs from the mirror setup ${mirrorSha.slice(0, 16)}…`);
      }
    }
  }

  if (fails.length) {
    for (const f of fails) console.error(`✗ ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ ${version} on ${channel}: token ${token.slice(0, 8)}… accepted, sha512 matches the mirror`);
}

main().catch((err) => {
  console.error(`✗ ${err?.message ?? err}`);
  process.exitCode = 1;
});
