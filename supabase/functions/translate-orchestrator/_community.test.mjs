// node --test supabase/functions/translate-orchestrator/_community.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeIni, iniDecoder, lineCutter, normalizeKey, parseIni, parsePack, parseRawGithub, parseResolver, resolveSource } from './_pack.ts';
import { isPackNoise, placeholdersMatch, seedEntries } from './_seed.ts';
import { detectOverrideAlerts, writeAlerts } from './_alerts.ts';
import { buildOutreachDraft, messageLang, outreachKind } from './_outreach.ts';
import { attributionLine, buildOverlayMeta, makeOverlay } from './_io.ts';
import { diffStrings, sha256Hex } from './_diff.ts';
import { requestLearning } from './_learn_pass.ts';
import { arbitrate } from './_arbiter.ts';
import { chunkedBody } from './_testkit.mjs';

const enc = (s) => new TextEncoder().encode(s);
const sha = sha256Hex;

describe('_pack', () => {
  it('parses BOM, CRLF, ,P suffix, case and the Frontend_PU_Version header', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('Frontend_PU_Version=Pack by X\r\nItem_Name,P=Wert A\r\nUI_Foo=a=b\r\n\r\nno equals line\r\n')]);
    const p = parsePack(bytes);
    assert.equal(p.header, 'Pack by X');
    assert.equal(p.map.get('item_name'), 'Wert A');
    assert.equal(p.map.get('ui_foo'), 'a=b');
    assert.ok(!p.map.has('frontend_pu_version'));
    assert.equal(p.lines, 3);
  });
  it('decodes UTF-16 LE and BE with BOM and without', () => {
    const le = Buffer.from('﻿A=ä\n', 'utf16le');
    assert.equal(decodeIni(new Uint8Array(le)), 'A=ä\n');
    const nobom = new Uint8Array(Buffer.from('A=b\n', 'utf16le'));
    assert.equal(decodeIni(nobom), 'A=b\n');
    const be = Buffer.from('﻿A=ö\n', 'utf16le').swap16();
    assert.equal(decodeIni(new Uint8Array(be)), 'A=ö\n');
  });
  it('bytes that arrive in chunks decode to what the whole file decodes to, wherever a chunk ends', () => {
    const text = 'Frontend_PU_Version=Päck\r\nA=ä – „Zitat“ 日本語\r\nB=😀 ende\r\nC=x';
    const u16 = Buffer.from('\ufeff' + text, 'utf16le');
    const files = {
      'utf-8': enc(text),
      'utf-8 with BOM': new Uint8Array([0xef, 0xbb, 0xbf, ...enc(text)]),
      'utf-16 le with BOM': new Uint8Array(u16),
      'utf-16 be with BOM': new Uint8Array(Buffer.from(u16).swap16()),
      'utf-16 le without BOM': new Uint8Array(Buffer.from('A=b\r\nC=d ä\r\n', 'utf16le')),
      'one byte': enc('A'),
      'three bytes': enc('A=b'),
      empty: new Uint8Array(0),
    };
    for (const [name, bytes] of Object.entries(files)) {
      for (const size of [1, 2, 3, 5, 7, 64, 100_000]) {
        const dec = iniDecoder();
        let got = '';
        for (let o = 0; o < bytes.length; o += size) got += dec.push(bytes.subarray(o, o + size));
        got += dec.end();
        assert.equal(got, decodeIni(bytes), `${name} in chunks of ${size}`);
      }
    }
  });
  it('a text is cut into pieces of whole lines; together they are the text and parse to the same pack', () => {
    const lines = ['\ufeffFrontend_PU_Version=Pack'];
    for (let i = 0; i < 400; i++) lines.push(`Key_${i}${i % 9 === 0 ? ',P' : ''}=Wert ${i} ${'x'.repeat(i % 37)}`);
    lines.push('Key_3=zweite Fassung', `Long_Line=${'y'.repeat(900)}`, 'Key_last=ohne Zeilenende');
    for (const eol of ['\r\n', '\n']) {
      const text = lines.join(eol);
      for (const [size, feed] of [[200, 1], [200, 17], [200, 5000], [64, 3], [1_000_000, 50]]) {
        const cut = lineCutter(size);
        const pieces = [];
        for (let o = 0; o < text.length; o += feed) pieces.push(...cut.push(text.slice(o, o + feed)));
        const rest = cut.end();
        if (rest !== null) pieces.push(rest);
        assert.equal(pieces.join(''), text);
        assert.equal(cut.end(), null, 'nothing is handed out twice');
        for (const p of pieces.slice(0, -1)) assert.ok(p.endsWith('\n'), 'a piece ends on a line break');
        // Only a line that is longer than a piece makes a piece longer than asked for.
        for (const p of pieces.slice(0, -1)) assert.ok(p.length <= size || p.indexOf('\n') === p.length - 1, `piece of ${p.length} chars for size ${size}`);
        if (size === 200) assert.ok(pieces.length > 20, `expected many pieces, got ${pieces.length}`);
        // Piece by piece in the order of the file: the same map as one parse, a later line wins.
        const whole = parseIni(text);
        const map = new Map();
        let header = null;
        for (const p of pieces) {
          const part = parseIni(p);
          header ??= part.header;
          for (const [k, v] of part.map) map.set(k, v);
        }
        assert.deepEqual([...map].sort(), [...whole.map].sort());
        assert.equal(map.get('key_3'), 'zweite Fassung');
        assert.equal(header, 'Pack');
      }
    }
  });
  it('a download keeps no chunk: the bytes of a body in small chunks come out whole, and the cap holds', async () => {
    const bytes = enc('A=1\r\n'.repeat(50_000));
    const src = { id: 's', raw_url: 'https://packs.example.test/global.ini', resolver: null };
    const r = await resolveSource(src, async () => new Response(chunkedBody(bytes, 777), { headers: { etag: 'e1' } }));
    assert.deepEqual([r.bytes.length, r.token], [bytes.length, 'e1']);
    assert.ok(Buffer.from(r.bytes).equals(Buffer.from(bytes)));
    // The fixture bites: a reader that keeps the chunks and joins them afterwards reads wiped buffers.
    const kept = [];
    for await (const chunk of chunkedBody(bytes, 777)) kept.push(chunk);
    assert.ok(!Buffer.concat(kept).equals(Buffer.from(bytes)));
    // A zip is read into one buffer that grows; the same holds for it.
    const zipSrc = { id: 'z', raw_url: 'https://packs.example.test/data.zip', resolver: 'zip-entry:global.ini' };
    const z = await resolveSource(zipSrc, async () => new Response(chunkedBody(bytes, 5000)), undefined, (zip) => ({ 'global.ini': zip.slice() }));
    assert.ok(Buffer.from(z.bytes).equals(Buffer.from(bytes)));
    // The cap counts what arrives, not what a header promises.
    const big = new ReadableStream({
      pull(c) { c.enqueue(new Uint8Array(4 * 1024 * 1024)); },
    });
    await assert.rejects(resolveSource(src, async () => new Response(big)), /translate\.source_too_large/);
    await assert.rejects(resolveSource(src, async () => new Response('gone', { status: 404 })), /translate\.source_fetch_404/);
  });
  it('keeps the first header, last duplicate wins, plain text without trailing newline', () => {
    const p = parseIni('Frontend_PU_Version=one\nFrontend_PU_Version=two\nk=1\nK=2');
    assert.equal(p.header, 'one');
    assert.equal(p.map.get('k'), '2');
  });
  it('normalizes keys', () => {
    assert.equal(normalizeKey(' Foo_Bar,P '), 'foo_bar');
    assert.equal(normalizeKey('x,y'), 'x,y');
  });
  it('parses resolvers and raw github urls', () => {
    assert.deepEqual(parseResolver('github-release:stdblue/StarCitizenJapaneseResources:global.ini'), {
      kind: 'github-release', owner: 'stdblue', repo: 'StarCitizenJapaneseResources', asset: 'global.ini',
    });
    assert.deepEqual(parseResolver('zip-entry:data/Localization/chinese_(simplified)/global.ini'), {
      kind: 'zip-entry', path: 'data/Localization/chinese_(simplified)/global.ini',
    });
    assert.equal(parseResolver('zip-entry:../x'), null);
    assert.equal(parseResolver('nonsense'), null);
    assert.equal(parseResolver(null), null);
    const gh = parseRawGithub('https://raw.githubusercontent.com/Dymerz/StarCitizen-Localization/main/data/Localization/italian_(italy)/global.ini');
    assert.deepEqual(gh, { owner: 'Dymerz', repo: 'StarCitizen-Localization', branch: 'main', path: 'data/Localization/italian_(italy)/global.ini' });
    assert.equal(parseRawGithub('https://example.com/x'), null);
  });
});

describe('_seed', () => {
  const at = '2026-11-08T00:00:00.000Z';
  const base = { sourceId: 'rjcncpt', lic: 'CC-BY-NC-SA-4.0', at };

  it('filters CIG-valid, blank, same-as-English, NOT FOUND, missing and placeholder mismatches', async () => {
    const en = {
      a_cig: 'Hello', b_ok: 'Cargo bay', c_same: 'Same', d_blank: 'Blank', e_nf: 'Marker', f_ph: 'Hit ~mission(x) now',
      g_missing: 'Missing', h_ok2: 'Pay %s', i_empty: '',
    };
    const cig = { a_cig: 'Hallo' };
    const pack = new Map([
      ['a_cig', 'PACK-HALLO'], ['b_ok', 'Frachtraum'], ['c_same', 'Same'], ['d_blank', '  '],
      ['e_nf', '! Marker TRANSLATION NOT FOUND'], ['f_ph', 'Treffer jetzt'], ['h_ok2', 'Zahle %s'],
    ]);
    const r = await seedEntries({ ...base, en, cig, pack });
    assert.equal(r.counts.keys, 8);
    assert.equal(r.counts.skipped_cig, 1);
    assert.equal(r.counts.skipped_same, 3);
    assert.equal(r.counts.rejected_qa, 1);
    assert.equal(r.counts.missing, 1);
    assert.equal(r.counts.imported, 2);
    const hb = await sha('Cargo bay');
    assert.deepEqual(r.updates[hb], { t: 'Frachtraum', o: 'community', src: 'rjcncpt', lic: 'CC-BY-NC-SA-4.0', at });
    assert.ok(!(await sha('Hello') in r.updates));
    assert.deepEqual(r.conflicts, []);
  });

  it('matches mixed-case English keys against lower-cased pack keys', async () => {
    const r = await seedEntries({ ...base, en: { Item_Name: 'Pistol' }, cig: {}, pack: { item_name: 'Pistole' } });
    assert.equal(r.counts.imported, 1);
  });

  it('takes the most frequent translation for one English text', async () => {
    const en = { k1: 'Door', k2: 'Door', k3: 'Door' };
    const r = await seedEntries({ ...base, en, cig: {}, pack: new Map([['k1', 'Tuer'], ['k2', 'Tor'], ['k3', 'Tor']]) });
    assert.equal(Object.keys(r.updates).length, 1);
    assert.equal(Object.values(r.updates)[0].t, 'Tor');
  });

  it('reports conflicts for a different non-admin entry, never overwrites admin, keeps CIG', async () => {
    const en = { a: 'One', b: 'Two', c: 'Three', d: 'Four', e: 'Five' };
    const pack = new Map([['a', 'Eins'], ['b', 'Zwei'], ['c', 'Drei'], ['d', 'Vier'], ['e', 'Fuenf']]);
    const tm = {
      [await sha('One')]: { t: 'Ains', o: 'ai', m: 'x' },
      [await sha('Two')]: { t: 'Zwo', o: 'admin' },
      [await sha('Three')]: { t: 'Drei', o: 'community', src: 'other' },
      [await sha('Four')]: { t: 'Vieren', o: 'community', src: 'rjcncpt' },
      [await sha('Five')]: { t: 'Fuenfe', o: 'cig' },
    };
    const r = await seedEntries({ ...base, en, cig: {}, pack, tm });
    assert.equal(r.conflicts.length, 1);
    assert.equal(r.conflicts[0].key, 'a');
    assert.equal(r.conflicts[0].incumbent.o, 'ai');
    assert.equal(r.conflicts[0].challenger.t, 'Eins');
    assert.equal(r.counts.admin_kept, 1);
    assert.equal(r.counts.unchanged, 1);
    assert.equal(r.counts.cig_kept, 1);
    // the same source refreshing its own text is an update, not a dispute
    assert.equal(r.updates[await sha('Four')].t, 'Vier');
    assert.ok(!(await sha('Two') in r.updates));
    assert.ok(!(await sha('One') in r.updates));
  });

  it('is idempotent: a second run over its own result changes nothing', async () => {
    const en = { a: 'One', b: 'Two' };
    const pack = new Map([['a', 'Eins'], ['b', 'Zwei']]);
    const first = await seedEntries({ ...base, en, cig: {}, pack });
    const second = await seedEntries({ ...base, en, cig: {}, pack, tm: first.updates });
    assert.deepEqual(second.updates, {});
    assert.equal(second.counts.unchanged, 2);
  });

  it('helpers', () => {
    assert.ok(isPackNoise('A', 'A'));
    assert.ok(isPackNoise('A', ''));
    assert.ok(!isPackNoise('A', 'B'));
    assert.ok(placeholdersMatch('x ~a(b) %s', '%s y ~a(b)'));
    assert.ok(!placeholdersMatch('x %s', 'y'));
  });
});

describe('_alerts', () => {
  it('flags admin TM entries of the OLD english and admin glossary terms when en or cig changed', async () => {
    const baseEn = { k1: 'Old text', k2: 'Aegis hull', k3: 'Stable', k4: 'Gone cig', k5: 'Same en' };
    const en = { k1: 'New text', k2: 'Aegis hull v2', k3: 'Stable', k4: 'Gone cig', k5: 'Same en', k6: 'brand new' };
    const baseCig = { k4: 'Alt', k5: 'Eins' };
    const cig = { k4: 'Neu', k5: 'Eins' };
    const tm = {
      [await sha('Old text')]: { t: 'Admin Alt', o: 'admin' },
      [await sha('Gone cig')]: { t: 'Admin cig', o: 'admin' },
      [await sha('Same en')]: { t: 'Admin same', o: 'admin' },
      [await sha('Stable')]: { t: 'Admin stable', o: 'admin' },
    };
    const rows = await detectOverrideAlerts({
      baseEn, en, baseCig, cig, tm,
      adminGlossary: [
        { source_term: 'Aegis', target_term: 'Aegis', origin: 'admin' },
        { source_term: 'hull', target_term: 'Rumpf', origin: 'ai' },
      ],
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    assert.deepEqual(Object.keys(byKey).sort(), ['k1', 'k2', 'k4']);
    assert.equal(byKey.k1.admin_text, 'Admin Alt');
    assert.equal(byKey.k1.en_old, 'Old text');
    assert.equal(byKey.k1.en_new, 'New text');
    assert.equal(byKey.k2.admin_text, 'Aegis → Aegis');
    assert.equal(byKey.k4.cig_old, 'Alt');
    assert.equal(byKey.k4.cig_new, 'Neu');
  });

  it('skips a key whose NEW english already carries an admin entry', async () => {
    const tm = { [await sha('A')]: { t: 'x', o: 'admin' }, [await sha('B')]: { t: 'y', o: 'admin' } };
    const rows = await detectOverrideAlerts({ baseEn: { k: 'A' }, en: { k: 'B' }, baseCig: {}, cig: {}, tm, adminGlossary: [] });
    assert.deepEqual(rows, []);
  });

  it('writeAlerts inserts new keys and refreshes open ones without touching en_old', async () => {
    const calls = [];
    const sb = {
      from() {
        const q = {
          sel: false, ops: [],
          select() { q.sel = true; return q; },
          eq() { return q; },
          in() { return Promise.resolve({ data: [{ id: 'id1', key: 'k1' }], error: null }); },
          insert(rows) { calls.push(['insert', rows]); return Promise.resolve({ error: null }); },
          update(v) { calls.push(['update', v]); return { eq: () => Promise.resolve({ error: null }) }; },
        };
        return q;
      },
    };
    const row = (key) => ({ key, en_old: 'o', en_new: 'n', cig_old: null, cig_new: null, admin_text: 'a' });
    const r = await writeAlerts(sb, 'de', 'b1', [row('k1'), row('k2')]);
    assert.deepEqual(r, { inserted: 1, updated: 1 });
    const ins = calls.find((c) => c[0] === 'insert')[1];
    assert.equal(ins.length, 1);
    assert.equal(ins[0].key, 'k2');
    assert.equal(ins[0].lang, 'de');
    const upd = calls.find((c) => c[0] === 'update')[1];
    assert.ok(!('en_old' in upd));
  });
});

describe('_outreach', () => {
  const src = (over) => ({
    id: 'rjcncpt', lang: 'de', name: 'rjcncpt Deutsch-INI', repo_url: 'https://github.com/rjcncpt/StarCitizen-Deutsch-INI',
    license: 'CC-BY-NC-SA-4.0', license_kind: 'nc_sa', attribution: 'rjcncpt', coverage: { text_pct: 94.3, imported: 51234 }, ...over,
  });
  it('chooses the kind by licence', () => {
    assert.equal(outreachKind('nc_sa'), 'notify');
    assert.equal(outreachKind('permissive'), 'notify');
    assert.equal(outreachKind('none'), 'permission');
  });
  it('writes in the maintainer language, falls back to en', () => {
    assert.equal(messageLang('de'), 'de');
    assert.equal(messageLang('pt-BR'), 'pt-BR');
    assert.equal(messageLang('zh-Hans'), 'zh');
    assert.equal(messageLang('ko'), 'en');
    assert.equal(messageLang('pl'), 'en');
  });
  it('notify draft carries coverage, count, credit line and the NC-SA statement', () => {
    const d = buildOutreachDraft(src());
    assert.equal(d.kind, 'notify');
    assert.equal(d.message_lang, 'de');
    assert.ok(d.body.includes('94,3'));
    assert.ok(d.body.includes('51234'));
    assert.ok(d.body.includes('Community-Übersetzung: rjcncpt (CC-BY-NC-SA-4.0)'));
    assert.ok(d.body.includes('CC-BY-NC-SA 4.0'));
    assert.ok(!/\{\w+\}/.test(d.body + d.subject));
  });
  it('permission draft for unlicensed packs says the text is not used until granted', () => {
    const d = buildOutreachDraft(src({ id: 'thord82', lang: 'es', name: 'Star_citizen_ES', license: 'all rights reserved', license_kind: 'none', attribution: 'Thord82', coverage: { text_pct: 57.4 } }));
    assert.equal(d.kind, 'permission');
    assert.equal(d.message_lang, 'es');
    assert.ok(d.body.includes('Hasta recibir'));
    assert.ok(!/\{\w+\}/.test(d.body + d.subject));
  });
  it('is deterministic and complete for every language', () => {
    for (const lang of ['de', 'it', 'pt-BR', 'ja', 'ru', 'fr', 'zh-Hans', 'es', 'ko']) {
      for (const license_kind of ['nc_sa', 'permissive', 'none']) {
        const a = buildOutreachDraft(src({ lang, license_kind }));
        const b = buildOutreachDraft(src({ lang, license_kind }));
        assert.deepEqual(a, b);
        assert.ok(a.subject && a.body);
        assert.ok(!/\{\w+\}/.test(a.body + a.subject), `${lang}/${license_kind}`);
      }
    }
  });
});

describe('overlay extension and precedence', () => {
  const rows = [
    { id: 'rjcncpt', lang: 'de', name: 'rjcncpt', repo_url: 'https://github.com/rjcncpt/x', license: 'CC-BY-NC-SA-4.0', license_kind: 'nc_sa', attribution: 'rjcncpt', game_folder: 'german_(germany)', use_cig_table: true, enabled: true, status: 'licensed' },
    { id: 'n1ghter', lang: 'ru', name: 'n1ghter', repo_url: 'https://github.com/n1ghter/x', license: 'CC-BY-NC-SA-4.0', license_kind: 'nc_sa', attribution: 'n1ghter', game_folder: 'korean_(south_korea)', use_cig_table: false, enabled: true, status: 'licensed' },
    { id: 'dymerz-it', lang: 'it', name: 'Dymerz', repo_url: 'https://github.com/Dymerz/x', license: 'MIT', license_kind: 'permissive', attribution: 'Dymerz', game_folder: 'italian_(italy)', use_cig_table: true, enabled: true, status: 'licensed' },
  ];
  it('makeOverlay keeps v1 and defaults the new fields', () => {
    const o = makeOverlay('de', 'b', { k: { h: 'h', t: 't' } }, 'now');
    assert.equal(o.v, 1);
    assert.equal(o.count, 1);
    assert.deepEqual(o.sources, []);
    assert.equal(o.attribution, '');
    assert.equal(o.game_folder, null);
    assert.equal(o.use_cig_table, true);
  });
  it('lists contributing sources, the AI source, one uniform line and the ru folder flags', () => {
    const tm = { h1: { o: 'community', src: 'rjcncpt' }, h2: { o: 'ai' }, h3: { o: 'admin' } };
    const entries = { a: { h: 'h1', t: 'x' }, b: { h: 'h2', t: 'y' }, c: { h: 'h3', t: 'z' } };
    const m = buildOverlayMeta('de', entries, tm, rows);
    assert.deepEqual(m.sources.map((s) => s.id), ['rjcncpt', 'scc-ai']);
    assert.equal(m.sources[0].license, 'CC-BY-NC-SA-4.0');
    assert.equal(m.sources[1].license, 'CC-BY-NC-SA-4.0');
    assert.equal(m.attribution, 'Community-Übersetzung: rjcncpt (CC-BY-NC-SA-4.0) · KI-Ergänzung: Verse Companion');
    assert.equal(m.game_folder, 'german_(germany)');
    const ru = buildOverlayMeta('ru', { a: { h: 'h1', t: 'x' } }, { h1: { o: 'community', src: 'n1ghter' } }, rows);
    assert.equal(ru.game_folder, 'korean_(south_korea)');
    assert.equal(ru.use_cig_table, false);
    assert.equal(ru.attribution, 'Community translation: n1ghter (CC-BY-NC-SA-4.0)');
    const it = buildOverlayMeta('it', { a: { h: 'h1', t: 'x' } }, { h1: { o: 'ai' } }, rows);
    assert.deepEqual(it.sources.map((s) => s.id), ['scc-ai']);
    assert.equal(it.game_folder, 'italian_(italy)');
    assert.equal(attributionLine('de', []), '');
  });
  it('precedence: CIG-valid keys stay out of the overlay unless an admin entry exists', async () => {
    const tm = {
      [await sha('Hello')]: { t: 'Community', o: 'community', src: 's' },
      [await sha('World')]: { t: 'Admin Welt', o: 'admin' },
      [await sha('Planet')]: { t: 'Gemeinschaft', o: 'community', src: 's' },
    };
    const r = await diffStrings({
      mode: 'full',
      en: { a: 'Hello', b: 'World', c: 'Planet' },
      cig: { a: 'Hallo', b: 'Welt' },
      tm,
    });
    assert.ok(!('a' in r.reused));
    assert.equal(r.reused.b.t, 'Admin Welt');
    assert.equal(r.reused.c.t, 'Gemeinschaft');
    assert.equal(r.counts.cig, 1);
    assert.equal(r.counts.tm, 2);
  });
});

describe('without the learning adapter', () => {
  it('asking for learning and arbitrating are no-ops', async () => {
    assert.equal(await requestLearning({}, 'de', 'seed'), null);
    assert.equal((await arbitrate({}, 'de', [])).skipped, 'no_learn_db');
  });
});
