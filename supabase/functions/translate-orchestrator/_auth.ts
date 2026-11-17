// Who is calling translate-orchestrator by key alone (a user JWT is resolved separately in index.ts).
//   service -> the service-role key: every op
//   public  -> the project's anon / publishable key: `tick` and `sync_sources` only
//   null    -> anything else (a user session token, or nothing)
import { safeEqual } from '../_shared/safe-equal.ts';

export type KeyKind = 'service' | 'public' | null;

export function classifyToken(token: string, op: string, serviceKey: string, anonKey: string): KeyKind {
  if (!token) return null;
  if (serviceKey && safeEqual(token, serviceKey)) return 'service';
  if (op !== 'tick' && op !== 'sync_sources') return null;
  if ((anonKey && safeEqual(token, anonKey)) || token.startsWith('sb_publishable_')) return 'public';
  return null;
}
