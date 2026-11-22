import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  CGF_CONVERTER_FILE,
  CGF_CONVERTER_LEGACY_FILES,
  CGF_CONVERTER_SHA256,
  CGF_CONVERTER_URL,
} from '../src/lib/cgf-converter.js';

describe('cgf-converter pin', () => {
  it('downloads one pinned build from the public binaries mirror', () => {
    expect(CGF_CONVERTER_URL).toMatch(
      /^https:\/\/github\.com\/StarOrga\/Verse-Companion-Binaries\/releases\/download\/[^/]+\/cgf-converter\.exe$/,
    );
    expect(CGF_CONVERTER_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never keeps the current build under a legacy name', () => {
    // A legacy name would make the size-only presence check accept the old binary.
    expect(CGF_CONVERTER_LEGACY_FILES).not.toContain(CGF_CONVERTER_FILE);
  });

  it('pins the same build as the dev fetch script and the cache alias', () => {
    const fetchTools = readFileSync(new URL('../python/tools/fetch_tools.py', import.meta.url), 'utf-8');
    expect(fetchTools).toContain(CGF_CONVERTER_SHA256);
    expect(fetchTools).toContain(CGF_CONVERTER_URL.split('/download/')[1]!.split('/')[0]!);
    const buildCache = readFileSync(new URL('../python/sc_extract/build_cache.py', import.meta.url), 'utf-8');
    expect(buildCache).toContain(CGF_CONVERTER_SHA256);
  });
});
