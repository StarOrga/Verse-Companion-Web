// nachschub-names - a short name for a Nachschub (what you get, <= 28 chars) or an Einsatz (what you do, <= 40).
//
//   POST { kind: 'nachschub' | 'einsatz', locale?: 'de' | 'en', items: [{ name, qty }] }   signed-in users only
//   -> { ok: true, status: 'generated', name } | { ok: true, status: 'no_key' | 'model_failed' | 'rate_limited' }
//
// Graceful: every failure is a 200 with a status and no name; the client then uses its rule-based fallback, so the
// feature never depends on this function. The key lives only here (ANTHROPIC_API_KEY secret); model override via
// NACHSCHUB_NAMES_MODEL. verify_jwt is OFF (supabase/config.toml): with the platform gate on, every call of a
// signed-in web session was answered 401 before the handler ran. The handler requires a real, approved user
// (getUser with the bearer token + is_approved), not the bare publishable key. Output is never labelled as AI.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS, bearerToken, buildPrompt, limitOf, parseName, parseRequest, preflight } from './_names.ts';
import { callClaude } from '../_shared/ai-ledger.ts';
import { withPosthog } from '../_shared/posthog.ts';

const MODEL = Deno.env.get('NACHSCHUB_NAMES_MODEL') ?? 'claude-sonnet-5-5';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

// Per-user rate limit, kept in the memory of this function instance (no table, no extra infra): a burst from one user
// is answered with the graceful 'rate_limited' (the client uses its fallback name). It resets when the instance
// recycles and is not shared between instances, so it caps accidental loops and casual abuse, not a determined
// attacker - the platform's own limits and the model key's spend cap stay the hard stop.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const hits = new Map<string, number[]>();
function rateLimited(userId: string, now = Date.now()): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(userId, recent);
    return true;
  }
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  return false;
}

async function askClaude(prompt: string, key: string): Promise<string> {
  const body = await callClaude('nachschub-names', key, { model: MODEL, max_tokens: 80, messages: [{ role: 'user', content: prompt }] }, 15_000);
  return body.content?.find((c) => c.type === 'text')?.text ?? '';
}

Deno.serve(withPosthog('nachschub-names', async (req) => {
  const pre = preflight(req.method);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // A real signed-in user, not just the anon/publishable key.
  // The token is handed to getUser() explicitly: the client has no stored session, and reading it back from a
  // custom header depends on the header's spelling in the supabase-js version in use.
  const jwt = bearerToken(req.headers.get('authorization'));
  if (!jwt) return json({ error: 'unauthorized' }, 401);
  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: user, error } = await sb.auth.getUser(jwt);
  if (error || !user?.user) return json({ error: 'unauthorized' }, 401);
  const { data: approved, error: apprErr } = await sb.rpc('is_approved');
  if (apprErr || approved !== true) return json({ error: 'not_approved' }, 403);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const request = parseRequest(body);
  if (!request) return json({ error: 'invalid_body' }, 400);

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: true, status: 'no_key' });
  if (rateLimited(user.user.id)) return json({ ok: true, status: 'rate_limited' });
  try {
    const name = parseName(await askClaude(buildPrompt(request), key), limitOf(request.kind));
    return name ? json({ ok: true, status: 'generated', name }) : json({ ok: true, status: 'model_failed' });
  } catch (e) {
    console.error(`nachschub-names: ${(e as Error).message}`);
    return json({ ok: true, status: 'model_failed' });
  }
}));
