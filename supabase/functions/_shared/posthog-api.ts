// Thin PostHog REST client (personal API key, EU cloud). Never throws for HTTP failures - returns null and logs.
import { POSTHOG_HOST, SAVER_FLAG_KEY } from './posthog-guard.ts';

export const personalKey = () => Deno.env.get('POSTHOG_PERSONAL_API_KEY') ?? '';
const configuredProject = () => Deno.env.get('POSTHOG_PROJECT_ID') ?? '';
const base = () => `${POSTHOG_HOST}/api/projects/${configuredProject() || '@current'}`;

async function call(url: string, init: RequestInit = {}, key = personalKey()): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[posthog-api] ${init.method ?? 'GET'} ${url.split('?')[0]} -> ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`[posthog-api] ${url.split('?')[0]}: ${(e as Error).message}`);
    return null;
  }
}

let cachedProjectId: string | null = null;
/** Numeric project id for deep links: POSTHOG_PROJECT_ID, else resolved once via @current. */
export async function projectId(): Promise<string | null> {
  if (configuredProject()) return configuredProject();
  if (cachedProjectId) return cachedProjectId;
  if (!personalKey()) return null;
  const r = (await call(`${POSTHOG_HOST}/api/projects/@current/`)) as { id?: number } | null;
  cachedProjectId = r?.id ? String(r.id) : null;
  return cachedProjectId;
}

/** HogQL through the query API; returns the rows or null when unreachable. */
export async function hogql(query: string, name = 'guard'): Promise<unknown[][] | null> {
  const r = (await call(`${base()}/query/`, { method: 'POST', body: JSON.stringify({ name, query: { kind: 'HogQLQuery', query } }) })) as { results?: unknown[][] } | null;
  return r?.results ?? null;
}

export const billing = () => call(`${POSTHOG_HOST}/api/billing/`);

export async function pingProject(): Promise<boolean> {
  return (await call(`${POSTHOG_HOST}/api/projects/@current/`)) != null;
}

/** Reads the telemetry-saver flag; null = missing or unreachable. */
export async function getSaverFlag(): Promise<{ id: number; active: boolean } | null> {
  const r = (await call(`${base()}/feature_flags/?key=${SAVER_FLAG_KEY}`)) as { results?: { id: number; key: string; active: boolean }[] } | null;
  const f = r?.results?.find((x) => x.key === SAVER_FLAG_KEY);
  return f ? { id: f.id, active: !!f.active } : null;
}

/** Sets the flag on/off (on = active at 100 %). Creates it when missing and `on` is wanted. */
export async function setSaverFlag(on: boolean): Promise<'set' | 'created' | 'unchanged' | 'failed'> {
  const flag = await getSaverFlag();
  if (!flag) {
    if (!on) return 'unchanged';
    const made = await call(`${base()}/feature_flags/`, {
      method: 'POST',
      body: JSON.stringify({ key: SAVER_FLAG_KEY, name: 'Telemetry saver: pauses replay and heatmaps near the free quota', active: true, filters: { groups: [{ properties: [], rollout_percentage: 100 }] } }),
    });
    return made ? 'created' : 'failed';
  }
  if (flag.active === on) return 'unchanged';
  const patched = await call(`${base()}/feature_flags/${flag.id}`, {
    method: 'PATCH',
    body: JSON.stringify(on ? { active: true, filters: { groups: [{ properties: [], rollout_percentage: 100 }] } } : { active: false }),
  });
  return patched ? 'set' : 'failed';
}
