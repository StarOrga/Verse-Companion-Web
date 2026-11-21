// process-p4k — analyzes a P4K upload metadata row, downloads the file head from
// Storage, runs lightweight heuristics (channel/version sanity, header magic,
// estimated entry count from CryEngine PAK signature), then writes the result
// back via service_role. JWT verification is on — only the uploader's session
// can trigger processing for their own row.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { withPosthog } from '../_shared/posthog.ts';
import { parseHeader } from './_parse.ts';

const HEAD_BYTES = 64 * 1024;

interface RequestBody { upload_id: string }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(withPosthog('process-p4k', async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization');
  if (!supabaseUrl || !serviceKey) return json({ error: 'env missing' }, 500);
  if (!authHeader) return json({ error: 'auth missing' }, 401);

  // Identify caller via anon client + bearer token.
  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'unauthenticated' }, 401);

  // Service client for full access.
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let body: RequestBody;
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body.upload_id) return json({ error: 'upload_id required' }, 400);

  const { data: row, error: rowErr } = await admin
    .from('p4k_uploads')
    .select('*')
    .eq('id', body.upload_id)
    .single();
  if (rowErr || !row) return json({ error: 'upload not found' }, 404);
  if (row.user_id !== userData.user.id) return json({ error: 'forbidden' }, 403);

  // Mark processing.
  const { error: procErr } = await admin.from('p4k_uploads').update({ status: 'processing' }).eq('id', row.id);
  if (procErr) return json({ error: 'status_update_failed', message: procErr.message }, 500);

  try {
    // Fetch only the header via a signed URL + Range request, never the whole (multi-GB) file.
    const { data: signed, error: signErr } = await admin.storage
      .from('p4k-uploads')
      .createSignedUrl(row.storage_path, 60);
    if (signErr || !signed?.signedUrl) throw signErr ?? new Error('sign failed');
    const res = await fetch(signed.signedUrl, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
    if (!res.ok) throw new Error(`header fetch failed: ${res.status}`);
    // A server that ignores Range answers 200 with the full body: cap what we keep in memory.
    const buf = new Uint8Array(await res.arrayBuffer()).subarray(0, HEAD_BYTES);
    const result = parseHeader(buf, row);

    const { error: doneErr } = await admin.from('p4k_uploads').update({
      status: 'done',
      result,
      processed_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (doneErr) throw new Error(`result not saved: ${doneErr.message}`);

    return json({ ok: true, result });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    const { error: failErr } = await admin.from('p4k_uploads').update({
      status: 'failed',
      error: msg,
      processed_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (failErr) console.error('[process-p4k] could not mark upload failed', failErr.message);
    return json({ ok: false, error: msg }, 500);
  }
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
