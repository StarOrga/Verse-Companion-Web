/**
 * Setup for every spec (`npm test`, Vitest in a real Chromium); runs in the
 * browser before each spec file, after the builder's own TestBed setup (which
 * already loaded `zone.js/testing`).
 *
 * 1. Zone's Vitest patch. `fakeAsync` / `tick` / `flush` need every spec to
 *    run inside a ProxyZone. `zone.js/testing` only patches Jasmine / Mocha /
 *    Jest; Vitest's globals are wrapped by this separate plugin, which the
 *    builder does not load. Without it every `fakeAsync` spec fails with
 *    "Expected to be running in 'ProxyZone'" (21 of 21 in the pilot).
 *
 * 2. No spec may open a real browser tab. Navigations are real anchors in this
 *    app (CLAUDE.md), so plenty of specs check that a Ctrl/⌘/Shift/middle
 *    click falls through to the browser — and if the spec then lets the
 *    browser act on it, an actual tab opens. Under Karma that tab came to the
 *    front, the test page went hidden and rendered no frames for the rest of
 *    the run, and frame-driven specs elsewhere timed out (2026-09-25, #660).
 *    Under Playwright the page stays visible, but a stray tab is still a spec
 *    bug: a link click that would open a tab or window and that nobody
 *    prevented fails the spec that made it, by name. The fix is on the spec's
 *    side — swallow the default action once the code under test has had its
 *    say, e.g. with a `preventDefault()` listener on `window` (see the
 *    HangarPicker spec).
 */
import 'zone.js/plugins/vitest-patch';

interface LinkClick {
  event: MouseEvent;
  href: string;
}

const linkClicks: LinkClick[] = [];

/** Would the browser open this click's link somewhere other than this page? */
function opensElsewhere(event: MouseEvent, link: Element): boolean {
  return event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1 || link.getAttribute('target') === '_blank';
}

function watch(event: Event): void {
  if (!(event instanceof MouseEvent)) return;
  const link = event.composedPath().find((node): node is Element => node instanceof Element && node.matches('a[href], area[href]'));
  if (link && opensElsewhere(event, link)) linkClicks.push({ event, href: link.getAttribute('href') ?? '' });
}

// The setup file runs once per spec file in the same page (isolate: false),
// so the capture listeners are installed only once.
const GUARD = Symbol.for('verse-companion/new-tab-guard');
const host = globalThis as typeof globalThis & { [GUARD]?: true };
if (!host[GUARD]) {
  host[GUARD] = true;
  window.addEventListener('click', watch, true);
  window.addEventListener('auxclick', watch, true);
}

// 3. No spec may write to the cloud database. A spec that lets the real
//    Supabase client run (no `fakeSupabase().provider`) sends its RPCs and
//    inserts to the live project: codex-search-engine.spec.ts logged
//    search_log_miss('gladius') on every run — 1292 fake "misses" by
//    2026-11-15. Every non-GET request to the project host is refused here and
//    fails the spec that sent it; reads stay untouched.
const SUPABASE_HOST = 'supabase.co';
const cloudWrites: string[] = [];
const FETCH_GUARD = Symbol.for('verse-companion/cloud-write-guard');
const fetchHost = globalThis as typeof globalThis & { [FETCH_GUARD]?: true };
if (!fetchHost[FETCH_GUARD]) {
  fetchHost[FETCH_GUARD] = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.includes(SUPABASE_HOST) && method !== 'GET' && method !== 'HEAD') {
      cloudWrites.push(`${method} ${url}`);
      return Promise.resolve(new Response('{"message":"blocked by vitest-setup"}', { status: 503 }));
    }
    // 4. Codex list snapshots (CodexListSnapshots) never come from the live
    //    assets Worker in a spec: every CodexService a spec builds sees "not
    //    published" (404), the state before the first publish, and reads the
    //    database double as before. Specs of the reader inject their own fetch.
    //    The silhouette shards (CodexSilhouetteShards) follow the same rule.
    if (url.includes('/codex-lists/') || url.includes('/codex-silhouettes/')) {
      return Promise.resolve(new Response('not found', { status: 404 }));
    }
    return realFetch(input, init);
  };
}

beforeEach(() => {
  linkClicks.length = 0;
  cloudWrites.length = 0;
});

afterEach(() => {
  const writes = cloudWrites.splice(0);
  if (writes.length === 0) return;
  throw new Error(
    `This spec sent a write or an RPC to the cloud database (${writes.join(', ')}). ` +
      'Provide fakeSupabase().provider (src/app/testing/fake-supabase.ts) instead of the real client.',
  );
});

afterEach(() => {
  for (const { event, href } of linkClicks.splice(0)) {
    if (event.defaultPrevented) continue;
    throw new Error(
      `A ${event.type} on <a href="${href}"> reached the browser, which opens a REAL tab or window: ` +
        'the test page drops to the background and renders no more frames. ' +
        'Prevent the default action once the code under test has seen the click.',
    );
  }
});
