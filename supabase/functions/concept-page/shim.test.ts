// Tests for shim.ts (#330). The shim is browser code kept as a string, so it
// runs here in a node:vm context with a fake window/location/fetch. Pure logic,
// no Deno APIs:
//   node --test supabase/functions/concept-page/shim.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildShim, shimSource, SHIM } from './shim.ts';

const ID = '2e0b5a3c-9b1f-4c6e-8d1a-0f7e6c5b4a39';
const BASE = `https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/concept-page/${ID}`;

/** Runs the shim in a fake browser at `href`; returns the patched fetch/beacon + call logs. */
function run(source: string, href: string) {
  const loc = new URL(href);
  const fetched: string[] = [];
  const beacons: string[] = [];
  const dataset: Record<string, string> = {};
  const window = {
    fetch: (input: unknown) => {
      fetched.push(typeof input === 'string' ? input : String((input as { url?: string }).url ?? input));
      return Promise.resolve('ok');
    },
  } as { fetch: (input: unknown, init?: unknown) => Promise<unknown> };
  const navigator = {
    sendBeacon: (url: string) => {
      beacons.push(url);
      return true;
    },
  } as { sendBeacon: (url: string, data?: unknown) => boolean };
  const ctx = vm.createContext({
    window,
    navigator,
    location: { origin: loc.origin === 'null' ? 'null' : loc.origin, pathname: loc.pathname, search: loc.search },
    document: { documentElement: { dataset } },
    URLSearchParams,
    URL,
    Request: class {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
    },
  });
  vm.runInContext(source, ctx);
  return { window, navigator, fetched, beacons, dataset };
}

test('rewrites the bridge paths to the baked-in absolute function URL + ticket', () => {
  const env = run(shimSource({ base: BASE, ticket: 'tick+et' }), `https://app.example/concept-frame/${ID}.html#x`);
  env.window.fetch('/decisions');
  env.window.fetch('/reload?since=3');
  env.window.fetch('/heartbeat');
  env.window.fetch('/draft');
  assert.deepEqual(env.fetched, [
    `${BASE}/decisions?t=tick%2Bet`,
    `${BASE}/reload?since=3&t=tick%2Bet`,
    `${BASE}/heartbeat?t=tick%2Bet`,
    `${BASE}/draft?t=tick%2Bet`,
  ]);
  assert.equal(env.dataset.conceptHosted, '1');
});

test('rewrites the engine\'s absolute `location.origin + /heartbeat` too', () => {
  const env = run(shimSource({ base: BASE, ticket: 't1' }), `https://app.example/concept-frame/${ID}.html`);
  env.window.fetch('https://app.example/heartbeat?tab=a');
  assert.deepEqual(env.fetched, [`${BASE}/heartbeat?tab=a&t=t1`]);
});

test('leaves every other fetch untouched', () => {
  const env = run(shimSource({ base: BASE, ticket: 't1' }), `https://app.example/concept-frame/${ID}.html`);
  env.window.fetch('/i18n/de.json');
  env.window.fetch('https://other.example/decisions');
  env.window.fetch('/decisionsX');
  assert.deepEqual(env.fetched, ['/i18n/de.json', 'https://other.example/decisions', '/decisionsX']);
});

test('sendBeacon gets the same rewrite', () => {
  const env = run(shimSource({ base: BASE, ticket: 't1' }), `https://app.example/concept-frame/${ID}.html`);
  env.navigator.sendBeacon('/draft', '{}');
  env.navigator.sendBeacon('/elsewhere', '{}');
  assert.deepEqual(env.beacons, [`${BASE}/draft?t=t1`, '/elsewhere']);
});

test('without a baked-in base it falls back to the document location (pre-#330 form)', () => {
  const env = run(shimSource(null), `${BASE}?t=old`);
  env.window.fetch('/decisions');
  assert.deepEqual(env.fetched, [`${BASE}/decisions?t=old`]);
  assert.match(SHIM, /^<script data-concept-shim>/);
});

test('a hostile ticket cannot break out of the inline script', () => {
  const html = buildShim({ base: BASE, ticket: '</script><script>alert(1)</script>\u2028' });
  assert.equal(html.match(/<\/script>/g)?.length, 1, 'only the closing tag of the shim itself');
  assert.ok(!html.includes('\u2028'));
  const env = run(shimSource({ base: BASE, ticket: '</script>' }), `https://app.example/x.html`);
  env.window.fetch('/reload');
  assert.deepEqual(env.fetched, [`${BASE}/reload?t=${encodeURIComponent('</script>')}`]);
});

// ── #369: Ctrl/⌘ + click on a mock part ─────────────────────────────────────

/** A tiny element tree with just enough closest()/matches() for the shim's selectors. */
type FakeEl = {
  nodeType: number; tagName: string; parentElement: FakeEl | null; attrs: Record<string, string>; cls: string[];
  closest(sel: string): FakeEl | null; matches(sel: string): boolean; contains(n: FakeEl): boolean;
  getAttribute(k: string): string | null; setAttribute(k: string, v: string): void;
};
function simple(el: FakeEl, sel: string): boolean {
  const m = /^([a-z0-9]*)((?:\[[^\]]+\]|\.[a-z0-9-]+)*)$/i.exec(sel.trim());
  if (!m) return false;
  if (m[1] && m[1].toUpperCase() !== el.tagName) return false;
  for (const part of m[2].match(/\[[^\]]+\]|\.[a-z0-9-]+/gi) ?? []) {
    if (part.startsWith('.')) { if (!el.cls.includes(part.slice(1))) return false; continue; }
    const [k, v] = part.slice(1, -1).split('=');
    if (!(k in el.attrs)) return false;
    if (v !== undefined && el.attrs[k] !== v.replace(/"/g, '')) return false;
  }
  return true;
}
function el(tag: string, attrs: Record<string, string> = {}, parent: FakeEl | null = null, cls: string[] = []): FakeEl {
  const n: FakeEl = {
    nodeType: 1, tagName: tag.toUpperCase(), parentElement: parent, attrs, cls,
    matches: (sel) => sel.split(',').some((s) => simple(n, s)),
    closest: (sel) => { for (let c: FakeEl | null = n; c; c = c.parentElement) if (c.matches(sel)) return c; return null; },
    contains: (o) => { for (let c: FakeEl | null = o; c; c = c.parentElement) if (c === n) return true; return false; },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = v; },
  };
  return n;
}

/** Runs the shim with a document that records its listeners; returns a dispatcher. */
function runPins() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const ctx = vm.createContext({
    window: { fetch: () => Promise.resolve('ok') },
    navigator: {},
    location: { origin: 'https://app.example', pathname: `/concept-frame/${ID}.html`, search: '' },
    document: {
      documentElement: { dataset: {} },
      addEventListener: (t: string, fn: (e: unknown) => void) => { (listeners[t] ||= []).push(fn); },
    },
    URLSearchParams, URL, Request: class {},
  });
  vm.runInContext(shimSource({ base: BASE, ticket: 't' }), ctx);
  return (type: string, e: Record<string, unknown>) => (listeners[type] ?? []).forEach((fn) => fn(e));
}

test('a Ctrl/⌘ + click on a mock part of the live round marks it data-pin for the engine', () => {
  const fire = runPins();
  const it = el('section', { 'data-iteration': '2', 'data-active': '', 'data-iteration-template': 'decision' });
  const mock = el('div', {}, el('div', {}, it), ['mock-row']);
  fire('click', { ctrlKey: true, target: mock });
  assert.equal(mock.attrs['data-pin'], '');
  const meta = el('span', {}, it);
  fire('click', { metaKey: true, target: meta });
  assert.equal(meta.attrs['data-pin'], '');
  const touch = el('div', {}, it);
  fire('pointerdown', { pointerType: 'touch', isPrimary: true, target: touch });
  assert.equal(touch.attrs['data-pin'], '', 'the long press decides at pointerdown');
});

test('never marks plain clicks, blocks, native controls, engine chrome or other rounds', () => {
  const fire = runPins();
  const it = el('section', { 'data-iteration': '2', 'data-active': '' });
  const plain = el('div', {}, it);
  fire('click', { target: plain });
  fire('pointerdown', { pointerType: 'mouse', isPrimary: true, target: plain });
  assert.ok(!('data-pin' in plain.attrs));
  const inP = el('span', {}, el('p', {}, it));
  const inBtn = el('span', {}, el('button', {}, it));
  const inPin = el('div', {}, el('div', {}, it, ['upin']));
  const frozen = el('div', {}, el('section', { 'data-iteration': '1' }));
  const design = el('div', {}, el('section', { 'data-iteration': '3', 'data-active': '', 'data-iteration-template': 'design' }));
  for (const t of [inP, inBtn, inPin, frozen, design, it]) {
    fire('click', { ctrlKey: true, target: t });
    assert.ok(!('data-pin' in t.attrs), t.tagName);
  }
});
