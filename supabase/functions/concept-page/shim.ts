// The SHIM — injected as the FIRST child of <head> into every hosted concept
// document, before the page's own scripts run.
//
// The concept engine (docs/concepts/*.html) was written for a local Python
// bridge and talks to it with root-relative fetches: `/decisions`,
// `/heartbeat`, `/reload`, `/draft`, `/attachments` (one of them, the
// heartbeat, as `location.origin + '/heartbeat'`). Hosted, the document does
// NOT run on this function's origin: Supabase rewrites every `text/html`
// response of an edge function on the default `*.supabase.co` domain to
// `text/plain` with `content-security-policy: default-src 'none'; sandbox`, so
// a browser only ever shows the source (admin feedback #330). The app's
// static loader `public/concept-frame.html` fetches the document as text and
// writes it into its own app-origin document instead.
//
// The engine also says goodbye on unload (`/bye`) and acknowledges a closed
// session (`/closed-ack`); both go to the function too (it answers them with
// a no-op) instead of 404ing on the app origin.
//
// An EXPIRED ticket (12 h, see index.ts) answers every bridge call with 401.
// A tab the admin left open would then miss every republish without saying
// so. On a 401 the shim sends the tab back through the app route
// `/concept/<id>`, which mints a fresh ticket and replaces itself with the
// loader again — the engine keeps its state in localStorage under the loader
// path, so nothing typed is lost. Never while a text field has focus (the
// next poll retries), and at most once a minute per concept (sessionStorage),
// so a ticket the app cannot renew never turns into a reload loop.
//
// So the shim rewrites exactly those paths — root-relative or on the
// document's own origin — to the ABSOLUTE function URL
//   <SUPABASE_URL>/functions/v1/concept-page/<id><path>?t=<ticket>
// which the function bakes in when it serves the document (`buildShim`), and
// leaves every other fetch untouched. The ticket is the one that authorised
// the document fetch, so nothing new leaks into the page. Without a baked-in
// base (an old caller) it falls back to the document's own location, the
// pre-#330 behaviour. `navigator.sendBeacon` gets the same treatment because
// the engine flushes the draft mirror through it on pagehide.
//
// Ctrl/⌘ + click notes on mock parts (admin feedback #369). In a decision /
// free round the engine's document pins (wireDocumentPins) only anchor to a
// `p`, `li`, `tr` — or, in pages built after #354, an element marked
// `[data-pin]`. The routine's concepts show most of a round as a MOCK built
// from divs/spans, so a Ctrl + click on the mock silently did nothing (a
// design round's screens take a pin anywhere — which is why the admin saw it
// work in other concepts). The shim registers a capture listener BEFORE the
// engine (it runs first in <head>): on a Ctrl/⌘ + click — or the first touch
// of a long press — on an element of the live round that has no block above
// it and is no native control or engine chrome, it marks that element
// `data-pin`, so the engine's own handler right after takes it as the block.
// Anchors need no marker on reload (the engine resolves them by tag + index +
// text). The function upgrades pages whose engine predates `[data-pin]`
// (upgrade.ts), so every hosted page gets this.
//
// Kept as a string (not a .js asset) so the function stays one self-contained
// deploy unit. Plain ES5-ish on purpose: it runs inside the page's CSP
// (`script-src 'self' 'unsafe-inline'`), not in Deno.

export interface ShimConfig {
  /** Absolute `…/functions/v1/concept-page/<id>` (no trailing slash). */
  base: string;
  /** The ticket that authorised the document load. */
  ticket: string;
}

/** JSON that is safe inside an inline <script> (no `</script>`, no U+2028/9). */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    // U+2028/U+2029 end a line inside a script in older engines.
    .replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));
}

/** The shim's body without the <script> wrapper — exported for the tests. */
export function shimSource(cfg: ShimConfig | null): string {
  return `(function () {
  var cfg = ${scriptJson(cfg ?? {})};
  var BRIDGE = /^\\/(decisions|heartbeat|reload|draft|attachments|bye|closed-ack)(\\?|$)/;
  var base = cfg.base ? String(cfg.base).replace(/\\/+$/, '')
           : location.origin + location.pathname.replace(/\\/+$/, '');
  var ticket = cfg.ticket || new URLSearchParams(location.search).get('t') || '';
  function rewrite(input) {
    var raw = typeof input === 'string' ? input
            : (typeof URL !== 'undefined' && input instanceof URL) ? input.href
            : (input && typeof input.url === 'string') ? input.url : null;
    if (raw === null) return null;
    var origin = location.origin;
    if (origin && origin !== 'null' && raw.indexOf(origin + '/') === 0) raw = raw.slice(origin.length);
    var m = BRIDGE.exec(raw);
    if (!m) return null;
    var path = '/' + m[1];
    var qs = raw.slice(path.length);
    var sep = qs.indexOf('?') === 0 ? '&' : '?';
    return base + path + qs + sep + 't=' + encodeURIComponent(ticket);
  }
  var conceptId = cfg.base ? String(cfg.base).replace(/\\/+$/, '').split('/').pop() : '';
  function remint() {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(conceptId)) return;
    var a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.isContentEditable)) return;
    var key = 'concept-remint-' + conceptId;
    try {
      var now = Date.now();
      if (now - Number(sessionStorage.getItem(key) || 0) < 60000) return;
      sessionStorage.setItem(key, String(now));
    } catch (e) { return; }
    location.replace(location.origin + '/concept/' + conceptId);
  }
  function watch(p) {
    return p.then(function (res) {
      if (res && res.status === 401) remint();
      return res;
    });
  }
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var target = rewrite(input);
    if (target === null) return origFetch(input, init);
    if (typeof input === 'string' || (typeof URL !== 'undefined' && input instanceof URL)) return watch(origFetch(target, init));
    return watch(origFetch(new Request(target, input), init));
  };
  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      var target = rewrite(String(url));
      return origBeacon(target === null ? url : target, data);
    };
  }
  // #369: mock parts take a Ctrl/⌘ + click note (see the header comment).
  var PIN_BLOCK = 'p, li, tr, [data-pin]';
  var PIN_SKIP = 'a, button, input, select, textarea, label, summary, [contenteditable=""], [contenteditable="true"], ' +
    '.upin, .dpin-layer, [data-engine-store], [data-device-clone], [data-analysis], script, template';
  function markPinTarget(t) {
    if (t && t.nodeType !== 1) t = t.parentElement;
    if (!t || !t.closest) return;
    var it = t.closest('section[data-iteration][data-active]');
    if (!it || t === it) return;
    // A design round pins on its screens itself; only its question views are documents.
    if (it.getAttribute('data-iteration-template') === 'design' && !t.closest('section[data-view]')) return;
    if (t.closest(PIN_BLOCK) || t.closest(PIN_SKIP)) return;
    var svg = t.closest('svg');
    if (svg && it.contains(svg)) t = svg;
    if (t.tagName === 'SECTION') return;
    t.setAttribute('data-pin', '');
  }
  if (document.addEventListener) {
    document.addEventListener('click', function (e) { if (e.ctrlKey || e.metaKey) markPinTarget(e.target); }, true);
    document.addEventListener('pointerdown', function (e) {
      if (e.ctrlKey || e.metaKey || (e.pointerType && e.pointerType !== 'mouse' && e.isPrimary)) markPinTarget(e.target);
    }, true);
  }
  document.documentElement.dataset.conceptHosted = '1';
})();`;
}

/** The <script> block the function puts first into <head>. */
export function buildShim(cfg: ShimConfig | null): string {
  return `<script data-concept-shim>\n${shimSource(cfg)}\n</script>`;
}

/** The location-relative shim (no baked-in base) — the pre-#330 form. */
export const SHIM = buildShim(null);
