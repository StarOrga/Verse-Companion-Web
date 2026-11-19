import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The pinned build, scaled down: a 64-byte "converter" with its own digest.
const GOOD = Buffer.alloc(64, 7);
const pin = vi.hoisted(() => ({ sha: '' }));
pin.sha = createHash('sha256').update(GOOD).digest('hex');

const userData = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({ app: { getPath: () => userData.dir, isPackaged: false } }));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../src/lib/cgf-converter.js', () => ({
  CGF_CONVERTER_URL: 'https://example.test/cgf-converter.exe',
  get CGF_CONVERTER_SHA256() {
    return pin.sha;
  },
  CGF_CONVERTER_FILE: 'cgf-converter-pinned.exe',
  CGF_CONVERTER_LEGACY_FILES: ['cgf-converter-2.exe'],
  CGF_CONVERTER_MIN_BYTES: 32,
}));

function tools(): string {
  return join(userData.dir, 'tools');
}

describe('ensureConverter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    userData.dir = mkdtempSync(join(tmpdir(), 'ensure-converter-'));
    mkdirSync(tools(), { recursive: true });
    fetchMock = vi.fn(async () => new Response(GOOD, { status: 200, headers: { 'content-length': '64' } }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(userData.dir, { recursive: true, force: true });
  });

  it('keeps an installed converter that matches its pin and drops the legacy build', async () => {
    writeFileSync(join(tools(), 'cgf-converter-pinned.exe'), GOOD);
    writeFileSync(join(tools(), 'cgf-converter-2.exe'), Buffer.alloc(64, 1));
    const { ensureConverter } = await import('../src/main/skin-bridge.js');
    const dest = await ensureConverter(() => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readFileSync(dest).equals(GOOD)).toBe(true);
    expect(existsSync(join(tools(), 'cgf-converter-2.exe'))).toBe(false);
  });

  it('downloads again when the installed file is big enough but not the pinned build', async () => {
    writeFileSync(join(tools(), 'cgf-converter-pinned.exe'), Buffer.alloc(64, 9));
    const { ensureConverter } = await import('../src/main/skin-bridge.js');
    const dest = await ensureConverter(() => {});
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(readFileSync(dest).equals(GOOD)).toBe(true);
  });

  it('refuses a download that does not match the pin and leaves nothing behind', async () => {
    fetchMock.mockImplementation(async () => new Response(Buffer.alloc(64, 3), { status: 200 }));
    const { ensureConverter } = await import('../src/main/skin-bridge.js');
    await expect(ensureConverter(() => {})).rejects.toThrow(/pinned sha256/);
    expect(existsSync(join(tools(), 'cgf-converter-pinned.exe'))).toBe(false);
    expect(existsSync(join(tools(), 'cgf-converter-pinned.exe.part'))).toBe(false);
  });
});
