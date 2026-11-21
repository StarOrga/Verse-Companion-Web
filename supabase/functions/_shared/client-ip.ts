// Client address for throttle keys. Supabase's edge sits behind Cloudflare, which sets
// `cf-connecting-ip` to the real client address; prefer it. Fallback: the LAST
// `x-forwarded-for` hop (appended by the trusted proxy), never the first, which the
// client can forge. If neither header exists all callers share the 'unknown' bucket.
export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const hops = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? 'unknown';
}
