/**
 * Client for the server's subtheme ledger (`list_uploader_subthemes` /
 * `record_uploader_subthemes`, migration 20261004070000). Electron-free with an
 * injectable fetch, like `sync.ts`, so the decision path is testable offline.
 *
 * Reading fails soft to `null` — `planSubthemes` turns that into "skip nothing".
 * Recording fails soft to `false` — a lost row only costs one extra upload next
 * time, never data.
 */

import { fetchWithTimeout } from './fetch-timeout.js';
import { currentRevisions, type LedgerEntry, type SubthemeKey } from './subthemes.js';

export interface LedgerKey {
  channel: string;
  patchVersion: string;
  buildNumber: string;
}

export interface LedgerClientOptions {
  apiBase: string;
  anonKey: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function headers(opts: LedgerClientOptions): Record<string, string> {
  return {
    'content-type': 'application/json',
    apikey: opts.anonKey,
    authorization: `Bearer ${opts.accessToken}`,
  };
}

export async function fetchLedger(opts: LedgerClientOptions, key: LedgerKey): Promise<LedgerEntry[] | null> {
  if (!key.buildNumber.trim()) return null;
  try {
    const res = await fetchWithTimeout(
      `${opts.apiBase}/rest/v1/rpc/list_uploader_subthemes`,
      {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify({
          p_channel: key.channel,
          p_patch_version: key.patchVersion,
          p_build_number: key.buildNumber,
        }),
      },
      opts.timeoutMs ?? 15_000,
      opts.fetchImpl ?? fetch,
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return null;
    return rows
      .filter(
        (r): r is { subtheme: string; revision: number } =>
          !!r && typeof r.subtheme === 'string' && typeof r.revision === 'number',
      )
      .map((r) => ({ subtheme: r.subtheme, revision: r.revision }));
  } catch {
    return null;
  }
}

/**
 * The id of the published (finalized, not superseded) codex build of this
 * channel + build number — what a silhouettes-only continuation attaches its
 * outlines to when the catalogue run that made the row is long gone. Same
 * visibility rule as the public read policy of `codex_builds`. Null = none
 * found or unreachable: the caller then sends nothing (never `init`s a row).
 */
export async function fetchLiveBuildId(opts: LedgerClientOptions, key: LedgerKey): Promise<string | null> {
  if (!key.buildNumber.trim()) return null;
  try {
    const q = new URLSearchParams({
      select: 'id',
      channel: `eq.${key.channel.toUpperCase()}`,
      build_number: `eq.${key.buildNumber.trim()}`,
      finalized_at: 'not.is.null',
      superseded_at: 'is.null',
      order: 'created_at.desc',
      limit: '1',
    });
    const res = await fetchWithTimeout(
      `${opts.apiBase}/rest/v1/codex_builds?${q.toString()}`,
      { method: 'GET', headers: headers(opts) },
      opts.timeoutMs ?? 15_000,
      opts.fetchImpl ?? fetch,
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as unknown;
    const id = Array.isArray(rows) ? (rows[0] as { id?: unknown } | undefined)?.id : null;
    return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function recordLedger(
  opts: LedgerClientOptions,
  key: LedgerKey,
  subthemes: readonly SubthemeKey[],
  uploaderVersion: string,
): Promise<boolean> {
  if (!key.buildNumber.trim() || subthemes.length === 0) return false;
  const all = currentRevisions();
  const revisions = Object.fromEntries(subthemes.map((k) => [k, all[k]]));
  try {
    const res = await fetchWithTimeout(
      `${opts.apiBase}/rest/v1/rpc/record_uploader_subthemes`,
      {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify({
          p_channel: key.channel,
          p_patch_version: key.patchVersion,
          p_build_number: key.buildNumber,
          p_revisions: revisions,
          p_uploader_version: uploaderVersion,
        }),
      },
      opts.timeoutMs ?? 15_000,
      opts.fetchImpl ?? fetch,
    );
    return res.ok;
  } catch {
    return false;
  }
}
