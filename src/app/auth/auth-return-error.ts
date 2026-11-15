/**
 * An OAuth return that carried an auth error (e.g. the server-side sign-up gate
 * rejecting a non-allowlisted Google/Discord account).
 *
 * The browser comes back to a guarded route that redirects to `/login`, and
 * supabase-js cleans the address bar, so the parameters are gone by the time the
 * login page renders. `main.ts` snapshots them once, before bootstrap — same
 * idea as `auth-link.ts`. Only the classification is kept, never the raw
 * `error_description` text.
 */
export type AuthReturnError = 'signup_not_allowed' | 'other' | null;

const MARKER = 'signup_not_allowed';

function params(part: string): URLSearchParams | null {
  if (!part) return null;
  try {
    return new URLSearchParams(part);
  } catch {
    return null;
  }
}

/** Parse a `location.search` + `location.hash` pair (leading `?`/`#` optional). */
export function readAuthReturnError(search: string, hash: string): AuthReturnError {
  let sawError = false;
  for (const raw of [search.replace(/^\?/, ''), hash.replace(/^#/, '')]) {
    const p = params(raw);
    if (!p) continue;
    const error = p.get('error');
    const code = p.get('error_code');
    const description = p.get('error_description');
    if (!error && !code && !description) continue;
    sawError = true;
    // URLSearchParams already decodes %XX and '+'; a double-encoded value
    // (%2520) is decoded once more, defensively.
    let text = `${description ?? ''} ${code ?? ''}`;
    try {
      text = decodeURIComponent(text);
    } catch {
      /* keep the single-decoded text */
    }
    if (text.toLowerCase().replace(/\s+/g, '_').includes(MARKER)) return 'signup_not_allowed';
  }
  return sawError ? 'other' : null;
}

let captured: AuthReturnError = null;
let capturedOnce = false;

/** Snapshot the current URL once, before the app bootstraps (no-op afterwards). */
export function captureAuthReturnError(search?: string, hash?: string): AuthReturnError {
  if (capturedOnce) return captured;
  capturedOnce = true;
  const loc = typeof window === 'undefined' ? null : window.location;
  captured = readAuthReturnError(search ?? loc?.search ?? '', hash ?? loc?.hash ?? '');
  return captured;
}

/**
 * Hand the snapshot out exactly once: a second call (reload, second visit to
 * /login) gets null.
 */
export function consumeAuthReturnError(): AuthReturnError {
  const value = captured;
  captured = null;
  return value;
}

/** Test seam. */
export function resetAuthReturnError(): void {
  captured = null;
  capturedOnce = false;
}
