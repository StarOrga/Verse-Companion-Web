import { CODEX_KINDS, CodexKind, CodexListFilters, listSelect } from './codex.service';
import {
  ListSnapshotName,
  SNAPSHOT_COLUMNS,
  countFromSnapshot,
  foldSearchText,
  germanListFromSnapshot,
  germanSearchMatcher,
  itemRankRowsFromSnapshot,
  likeRegExp,
  listFromSnapshot,
  makeSnapshot,
  matchRows,
  missileRowsFromSnapshot,
  posixRegExp,
  prefixRowsFromSnapshot,
  snapshotNameFor,
} from './codex-list-engine';

type Row = Record<string, unknown>;

const CARD = ['name', 'previewImage', 'manufacturer'];
const SHIP_KEYS = [...CARD, 'sizeClass', 'career', 'dimensions'];

/** A snapshot of `name` from row objects (absent column/key = null), in the given order. */
function snap(name: ListSnapshotName, rows: Row[], payloadKeys: string[] = name === 'ship' ? SHIP_KEYS : CARD) {
  const columns = SNAPSHOT_COLUMNS[name];
  return makeSnapshot(
    name,
    columns,
    payloadKeys,
    rows.map((r) => [...columns.map((c) => r[c] ?? null), ...payloadKeys.map((k) => r[`p_${k}`] ?? null)]),
  );
}

const names = (s: ReturnType<typeof snap>, kind: CodexKind, f: CodexListFilters, mode: 'list' | 'tokens' | 'ignore' = 'list') =>
  matchRows(s, kind, f, mode)?.map((r) => r[0]) ?? null;

const ship = (class_name: string, extra: Row = {}): Row => ({ class_name, name_localized: class_name, is_variant: false, ...extra });
const item = (class_name: string, extra: Row = {}): Row => ({ class_name, name_localized: class_name, is_variant: false, ...extra });

describe('codex-list-engine', () => {
  it('keeps the snapshot columns equal to LIST_SELECT (row layout of the publisher)', () => {
    for (const kind of CODEX_KINDS) {
      expect(SNAPSHOT_COLUMNS[kind].join(', '), kind).toBe(listSelect(kind, 'none'));
    }
    expect(SNAPSHOT_COLUMNS['ship-rank']).toEqual(SNAPSHOT_COLUMNS.ship);
  });

  describe('default browse filters', () => {
    it('ship: drops variants, "!" names, wrecks/sentries/probes (ILIKE prefix, `_` = one character); keeps NULL names', () => {
      const s = snap('ship', [
        ship('AEGS_Gladius'),
        ship('AEGS_Gladius_AI', { is_variant: true }),
        ship('AEGS_Unfinished', { name_localized: '! GERMAN TRANSLATION NOT FOUND !' }),
        ship('NoName', { name_localized: null }),
        ship('salvageabledebris_avenger'),
        ship('Orbital_Sentry_1'),
        ship('OrbitalXSentry'),
        ship('probeX'),
        ship('probe'),
        ship('NullVariant', { is_variant: null }),
      ]);
      expect(names(s, 'ship', {})).toEqual(['AEGS_Gladius', 'NoName', 'probe']);
      expect(names(s, 'ship', { includeVariants: true })?.length).toBe(10);
    });

    it('item: drops nameless records and internal attach types; keeps a NULL attach type', () => {
      const s = snap('item', [
        item('Helmet', { attach_type: 'Char_Armor_Helmet' }),
        item('Seat', { attach_type: 'Seat' }),
        item('Nameless', { name_localized: null, attach_type: 'Char_Armor_Helmet' }),
        item('NoAttach', { attach_type: null }),
      ]);
      expect(names(s, 'item', {})).toEqual(['Helmet', 'NoAttach']);
    });

    it('ammunition / manufacturer / blueprint: nothing to drop', () => {
      const s = snap('ammunition', [{ class_name: 'a', name_localized: '!x' }, { class_name: 'b', name_localized: null }]);
      expect(names(s, 'ammunition', {})).toEqual(['a', 'b']);
    });
  });

  describe('filters (SQL semantics, NULL included)', () => {
    const weapons = snap('weapon', [
      item('W1', { manufacturer_code: 'BEHR', size: 3, grade: 'A', weapon_class: 'FPS', sub_type: 'Rifle', attach_type: 'WeaponPersonal' }),
      item('W2', { manufacturer_code: 'KLWE', size: 1, grade: 'B', weapon_class: 'Ship', sub_type: null, attach_type: 'WeaponGun' }),
      item('W3', { manufacturer_code: null, size: null, grade: null, weapon_class: null, sub_type: 'Pistol', attach_type: null }),
    ]);
    const table: [string, CodexListFilters, string[]][] = [
      ['eq manufacturer', { manufacturer: 'BEHR' }, ['W1']],
      ['eq size (number)', { size: 1 }, ['W2']],
      ['eq grade', { grade: 'B' }, ['W2']],
      ['eq weaponClass', { weaponClass: 'FPS' }, ['W1']],
      ['eq subType never NULL', { subType: 'Pistol' }, ['W3']],
      ['in subType never NULL', { subTypeIn: ['Rifle', 'Pistol'] }, ['W1', 'W3']],
      ['notIn subType keeps NULL', { subTypeNotIn: ['Rifle'] }, ['W2', 'W3']],
      ['eq attachType', { attachType: 'WeaponGun' }, ['W2']],
      ['in attachType never NULL', { attachTypeIn: ['WeaponGun', 'WeaponPersonal'] }, ['W1', 'W2']],
      ['notIn attachType keeps NULL', { attachTypeNotIn: ['WeaponGun'] }, ['W1', 'W3']],
      ['classNameIn', { classNameIn: ['W3', 'W1'] }, ['W1', 'W3']],
      ['classNameIn empty matches nothing', { classNameIn: [] }, []],
      ['empty string filter is no filter', { manufacturer: '', grade: '' }, ['W1', 'W2', 'W3']],
      ['empty list filter is no filter', { subTypeIn: [], attachTypeNotIn: [] }, ['W1', 'W2', 'W3']],
    ];
    for (const [label, f, want] of table) {
      it(label, () => expect(names(weapons, 'weapon', f)).toEqual(want));
    }

    it('ignores kind-scoped filters on other kinds, like the query does', () => {
      expect(names(weapons, 'weapon', { componentKind: 'Shield', category: 'x', careerIn: ['a'], crewMin: 9 })).toEqual(['W1', 'W2', 'W3']);
    });

    it('ship: size on payload.sizeClass as text, careerIn as text, crew range never NULL', () => {
      const s = snap('ship', [
        ship('S_num', { p_sizeClass: 3, p_career: 'combat', crew_size: 1 }),
        ship('S_str', { p_sizeClass: '3', p_career: 'transport', crew_size: 4 }),
        ship('S_none', { crew_size: null }),
      ]);
      expect(names(s, 'ship', { size: 3 })).toEqual(['S_num', 'S_str']);
      expect(names(s, 'ship', { careerIn: ['combat'] })).toEqual(['S_num']);
      expect(names(s, 'ship', { crewMin: 2 })).toEqual(['S_str']);
      expect(names(s, 'ship', { crewMax: 2 })).toEqual(['S_num']);
    });

    it('component kind and blueprint categories', () => {
      const c = snap('component', [item('C1', { kind: 'Shield' }), item('C2', { kind: null })]);
      expect(names(c, 'component', { componentKind: 'Shield' })).toEqual(['C1']);
      const b = snap('blueprint', [{ class_name: 'B1', category: 'FPSArmours' }, { class_name: 'B2', category: null }]);
      expect(names(b, 'blueprint', { category: 'FPSArmours' })).toEqual(['B1']);
      expect(names(b, 'blueprint', { blueprintCategoryIn: ['FPSArmours', 'x'] })).toEqual(['B1']);
    });

    it('classNameMatch / NotMatch: the vehicle-ammo POSIX regex, case-sensitive', () => {
      const a = snap('ammunition', [{ class_name: 'ammo_S3_ballistic_' }, { class_name: 'ammo_s3_x_' }, { class_name: 'pistol_ammo' }]);
      expect(names(a, 'ammunition', { classNameMatch: '_S[0-9]+_' })).toEqual(['ammo_S3_ballistic_']);
      expect(names(a, 'ammunition', { classNameNotMatch: '_S[0-9]+_' })).toEqual(['ammo_s3_x_', 'pistol_ammo']);
    });
  });

  describe('search', () => {
    const s = snap('weapon', [
      item('BEHR_P4AR', { name_localized: 'P4-AR Rifle' }),
      item('KLWE_P4XAR', { name_localized: 'P4XAR Thing' }),
      item('NoName_p4ar_class', { name_localized: null }),
      item('Other', { name_localized: 'Arrowhead' }),
    ]);

    it('matches the ILIKE token groups over name OR class name (NULL name falls back to the class)', () => {
      expect(names(s, 'weapon', { search: 'p4ar' }, 'tokens')).toEqual(['BEHR_P4AR', 'KLWE_P4XAR', 'NoName_p4ar_class']);
    });

    it('then drops the false hits the shared matcher removes (list mode), counting exactly', () => {
      expect(names(s, 'weapon', { search: 'p4ar' }, 'list')).toEqual(['BEHR_P4AR', 'NoName_p4ar_class']);
      expect(countFromSnapshot(s, 'weapon', { search: 'p4ar' }, 'list')).toBe(2);
    });

    it('is ignored in ignore mode (countByKind never searched)', () => {
      expect(countFromSnapshot(s, 'weapon', { search: 'p4ar' }, 'ignore')).toBe(4);
    });
  });

  describe('paging and records', () => {
    const rows = Array.from({ length: 7 }, (_, i) => item(`I${i}`, { attach_type: 'Char_Armor_Helmet', p_name: `n${i}` }));
    const s = snap('item', rows);

    it('slices offset/limit and returns the total', () => {
      const out = listFromSnapshot(s, 'item', {}, 3, 3);
      expect(out?.count).toBe(7);
      expect(out?.records.map((r) => r['class_name'])).toEqual(['I3', 'I4', 'I5']);
      expect(listFromSnapshot(s, 'item', {}, 3, 6)?.records.length).toBe(1);
      expect(listFromSnapshot(s, 'item', {}, 3, 9)?.records).toEqual([]);
    });

    it('builds the PostgREST record of listSelect(kind, payload): columns + p_<key> (null when absent)', () => {
      const rec = listFromSnapshot(s, 'item', {}, 1, 0)!.records[0];
      expect(Object.keys(rec)).toEqual([...SNAPSHOT_COLUMNS.item, 'p_name', 'p_previewImage', 'p_manufacturer']);
      expect(rec['p_name']).toBe('n0');
      expect(rec['p_previewImage']).toBeNull();
      expect(Object.keys(listFromSnapshot(s, 'item', { payload: 'none' }, 1, 0)!.records[0])).toEqual([...SNAPSHOT_COLUMNS.item]);
    });
  });

  describe('declines (null → the database answers)', () => {
    const s = snap('ship', [ship('A')]);
    const rank = snap('ship-rank', [ship('A')], ['career', 'defaultLoadout']);
    const table: [string, () => unknown][] = [
      ["payload 'full'", () => listFromSnapshot(s, 'ship', { payload: 'full' }, 10, 0)],
      ['a payload key the file lacks', () => listFromSnapshot(s, 'ship', { payload: ['stats'] }, 10, 0)],
      ['an untranslatable regex', () => listFromSnapshot(s, 'ship', { classNameMatch: '^(A|B)$' }, 10, 0)],
      ['an untranslatable negated regex', () => countFromSnapshot(s, 'ship', { classNameNotMatch: 'a.b' }, 'ignore')],
      ['an unknown filter key', () => countFromSnapshot(s, 'ship', { future: 1 } as CodexListFilters, 'ignore')],
      ['a column the table lacks (grade on ships)', () => countFromSnapshot(s, 'ship', { grade: 'A' }, 'ignore')],
      ['ship size on the rank file (no sizeClass)', () => countFromSnapshot(rank, 'ship', { size: 2 }, 'ignore')],
    ];
    for (const [label, run] of table) it(label, () => expect(run()).toBeNull());

    it('an unknown key set to undefined is no filter', () => {
      expect(countFromSnapshot(s, 'ship', { future: undefined } as CodexListFilters, 'ignore')).toBe(1);
    });
  });

  it('picks the ship card file, the rank slice, or none', () => {
    expect(snapshotNameFor('ship', undefined)).toBe('ship');
    expect(snapshotNameFor('ship', ['sizeClass', 'career'])).toBe('ship');
    expect(snapshotNameFor('ship', ['career', 'defaultLoadout'])).toBe('ship-rank');
    expect(snapshotNameFor('weapon', 'none')).toBe('weapon');
    expect(snapshotNameFor('weapon', 'full')).toBeNull();
  });

  it('translates like patterns and only the safe POSIX subset', () => {
    expect(likeRegExp('*p_4ar*', true).test('XP-4AR')).toBe(true);
    expect(likeRegExp('*p_4ar*', true).test('p4ar')).toBe(false);
    expect(likeRegExp('a.b*', false).test('aXb')).toBe(false);
    // A backslash escapes the next character, as in LIKE: `\_` and `\%` are literal.
    expect(likeRegExp('a\\_b%', false).test('a_bc')).toBe(true);
    expect(likeRegExp('a\\_b%', false).test('aXbc')).toBe(false);
    expect(likeRegExp('50\\%*', false).test('50% off')).toBe(true);
    expect(likeRegExp('50\\%*', false).test('500 off')).toBe(false);
    expect(likeRegExp('a\\\\b', false).test('a\\b')).toBe(true);
    expect(posixRegExp('_S[0-9]+_')?.source).toBe('_S[0-9]+_');
    expect(posixRegExp('^AEGS_')).not.toBeNull();
    for (const bad of ['a|b', '(a)', 'a.b', '\\d', '[^0-9]', 'a{2}', '']) expect(posixRegExp(bad), bad).toBeNull();
  });

  it('escapes `-` and `/` validly under the u flag (pattern and search term)', () => {
    expect(() => likeRegExp('*a-b/c*', true)).not.toThrow();
    expect(likeRegExp('*a-b/c*', true).test('XA-B/CY')).toBe(true);
    expect(likeRegExp('*a-b/c*', true).test('aXb/c')).toBe(false);
    const s = snap('weapon', [item('P4-AR/Rifle', { name_localized: 'P4-AR / Rifle' }), item('Other')]);
    expect(names(s, 'weapon', { search: 'p4-ar/rifle' })).toEqual(['P4-AR/Rifle']);
  });

  describe('cohort slices', () => {
    it('missile: the DB select shape (whole payload as a column), list order, publisher filter re-checked', () => {
      const s = snap(
        'missile',
        [
          { class_name: 'MSL_A', name_localized: 'Arrester', sub_type: 'Missile', size: 3, attach_type: 'Missile', payload: { a: 1 } },
          { class_name: 'MSL_Nameless', name_localized: null, attach_type: 'Missile' },
          { class_name: 'MSL_Other', name_localized: 'x', attach_type: 'Torpedo' },
          { class_name: 'MSL_B', name_localized: 'Bolt', sub_type: 'Rocket', size: 1, attach_type: 'Missile', payload: null },
        ],
        [],
      );
      expect(missileRowsFromSnapshot(s)).toEqual([
        { class_name: 'MSL_A', name_localized: 'Arrester', sub_type: 'Missile', size: 3, attach_type: 'Missile', payload: { a: 1 } },
        { class_name: 'MSL_B', name_localized: 'Bolt', sub_type: 'Rocket', size: 1, attach_type: 'Missile', payload: null },
      ]);
      expect(missileRowsFromSnapshot(snap('weapon', []))).toBeNull();
    });

    it('weapon-rank: wp = weaponParams, "!" names dropped', () => {
      const s = snap(
        'weapon-rank',
        [
          { class_name: 'W1', name_localized: 'Gun', sub_type: 'Gun', size: 2, p_weaponParams: { rpm: 600 } },
          { class_name: 'W2', name_localized: '!Placeholder', sub_type: 'Gun', size: 2, p_weaponParams: {} },
          { class_name: 'W3', name_localized: 'Gun ! late', sub_type: null, size: null },
        ],
        ['weaponParams'],
      );
      expect(itemRankRowsFromSnapshot(s, 'weapon')).toEqual([
        { class_name: 'W1', name_localized: 'Gun', sub_type: 'Gun', size: 2, wp: { rpm: 600 } },
        { class_name: 'W3', name_localized: 'Gun ! late', sub_type: null, size: null, wp: null },
      ]);
      expect(itemRankRowsFromSnapshot(s, 'Shield')).toBeNull();
    });

    it('component-rank: only the asked kind (payload->>kind as text), "!" names dropped', () => {
      const s = snap(
        'component-rank',
        [
          { class_name: 'C1', name_localized: 'Shield A', sub_type: 'x', size: 1, p_kind: 'Shield', p_stats: { hp: 1 } },
          { class_name: 'C2', name_localized: 'Cooler A', size: 1, p_kind: 'Cooler', p_stats: {} },
          { class_name: 'C3', name_localized: '!Shield', size: 1, p_kind: 'Shield' },
          { class_name: 'C4', name_localized: 'No kind', size: 1, p_kind: null },
        ],
        ['kind', 'stats'],
      );
      expect(itemRankRowsFromSnapshot(s, 'Shield')).toEqual([
        { class_name: 'C1', name_localized: 'Shield A', sub_type: 'x', size: 1, ck: 'Shield', stats: { hp: 1 } },
      ]);
      expect(itemRankRowsFromSnapshot(s, 'Cooler')?.map((r) => r['class_name'])).toEqual(['C2']);
      expect(itemRankRowsFromSnapshot(snap('component-rank', [], ['kind']), 'Shield')).toBeNull();
    });
  });

  describe('German-name search (codex_search mirror)', () => {
    it('folds like lower(unaccent()): umlauts, ß, ø/æ/œ/ł/đ, upper case', () => {
      expect(foldSearchText('Größe ÄÖÜ')).toBe('grosse aou');
      expect(foldSearchText('ẞ Øre Æther Œuvre Łódź Đak Café')).toBe('ss ore aether oeuvre lodz dak cafe');
      expect(foldSearchText('  two  spaces ')).toBe('  two  spaces ');
    });

    const m = (tokens: string[]) => germanSearchMatcher(tokens);

    it('ANDs the tokens; each hits the search text OR the class name', () => {
      const t = m(['schild', 'gross'])!;
      expect(t('Shield', 'Großer Schild', 'X')).toBe(true);
      expect(t('Shield', 'Schild', 'X')).toBe(false);
      expect(t('Shield', 'Schild', 'GROSS_01')).toBe(true);
      // The search text is "en de": a token may span the boundary, like in SQL.
      expect(m(['ld sch'])!('Shield', 'Schild', 'X')).toBe(true);
    });

    it('`*` is the wildcard; `%`, `_` and `\\` are literal', () => {
      expect(m(['sch*ld'])!('', 'Schutzschild', 'X')).toBe(true);
      expect(m(['abc%'])!('', 'abcd', 'X')).toBe(false);
      expect(m(['abc%'])!('', 'abc% rabatt', 'X')).toBe(true);
      expect(m(['abc_d'])!('', 'abcxd', 'X')).toBe(false);
      expect(m(['abc_d'])!('', 'x', 'ABC_D_1')).toBe(true);
      expect(m(['a\\bc'])!('', 'a\\bc', 'X')).toBe(true);
    });

    it('folds the tokens and the German name (ß, umlauts, accents)', () => {
      expect(m(['GRÖSSE'])!('', 'Größe', 'X')).toBe(true);
      expect(m(['grosse'])!('', 'GRÖẞE', 'X')).toBe(true);
      expect(m(['kuhler'])!('Cooler', 'Kühler', 'X')).toBe(true);
    });

    it('skips wildcard-only tokens, takes 8 tokens, needs one of 3+ characters', () => {
      expect(m([])).toBeNull();
      expect(m(['**', 'ab'])).toBeNull();
      expect(m(['ab', 'c*d'])).toBeNull();
      expect(m(['**', 'abc'])!('abc', null, 'X')).toBe(true);
      const nine = ['abc', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'zzz'];
      expect(m(nine)!('abc b c d e f g h', null, 'X')).toBe(true);
    });

    it('cuts a token at 60 characters', () => {
      const long = 'a'.repeat(60) + 'zzz';
      expect(m([long])!('a'.repeat(60), null, 'X')).toBe(true);
    });

    const ws = snap('weapon', [
      item('BEHR_Rifle', { name_localized: 'Rifle', p_name: 'r' }),
      item('BEHR_Rifle_Var', { name_localized: 'Rifle', is_variant: true }),
      item('KLWE_Pistol', { name_localized: 'Pistol', weapon_class: 'FPS' }),
      item('Other', { name_localized: 'Other' }),
    ]);
    const de = new Map([
      ['BEHR_Rifle', 'Gewehr'],
      ['BEHR_Rifle_Var', 'Gewehr'],
      ['KLWE_Pistol', 'Pistole Gewehrartig'],
    ]);

    it('lists the German hits through every non-search filter, list order, exact count', () => {
      const out = germanListFromSnapshot(ws, 'weapon', { search: 'gewehr' }, de, ['gewehr'], 10, 0)!;
      expect(out.records.map((r) => r['class_name'])).toEqual(['BEHR_Rifle', 'KLWE_Pistol']);
      expect(out.count).toBe(2);
      expect(out.records[0]['p_name']).toBe('r');
      const fps = germanListFromSnapshot(ws, 'weapon', { search: 'gewehr', weaponClass: 'FPS' }, de, ['gewehr'], 10, 0)!;
      expect(fps.records.map((r) => r['class_name'])).toEqual(['KLWE_Pistol']);
      const page = germanListFromSnapshot(ws, 'weapon', { search: 'gewehr', includeVariants: true }, de, ['gewehr'], 1, 1)!;
      expect(page.count).toBe(3);
      expect(page.records.map((r) => r['class_name'])).toEqual(['BEHR_Rifle_Var']);
    });

    it('returns every match above 100 (no RPC cut)', () => {
      const many = snap('weapon', Array.from({ length: 150 }, (_, i) => item(`W_${String(i).padStart(3, '0')}`, { name_localized: `Gun ${i}` })));
      const names = new Map(Array.from({ length: 150 }, (_, i) => [`W_${String(i).padStart(3, '0')}`, `Kanone ${i}`] as [string, string]));
      const out = germanListFromSnapshot(many, 'weapon', { search: 'kanone' }, names, ['kanone'], 25, 0)!;
      expect(out.count).toBe(150);
      expect(out.records.length).toBe(25);
    });

    it('declines like listFromSnapshot (full payload, missing payload key)', () => {
      expect(germanListFromSnapshot(ws, 'weapon', { payload: 'full' }, de, ['gewehr'], 10, 0)).toBeNull();
      expect(germanListFromSnapshot(ws, 'weapon', { payload: ['stats'] }, de, ['gewehr'], 10, 0)).toBeNull();
    });
  });

  describe('prefixRowsFromSnapshot (sibling reads)', () => {
    const s = snap('item', [
      item('gmni_pistol_ballistic_01_cen01', { is_variant: true }),
      item('gmni_pistol_ballistic_01', { name_localized: null }),
      item('GMNI_PISTOLXBALLISTIC_02'),
      item('gmni_rifle_01'),
    ]);

    it('matches the ILIKE prefix (`_` one character, case-insensitive), every row, sorted by class name, no payload', () => {
      const out = prefixRowsFromSnapshot(s, 'gmni_pistol_ballistic', 200)!;
      expect(out.map((r) => r['class_name'])).toEqual([
        'GMNI_PISTOLXBALLISTIC_02',
        'gmni_pistol_ballistic_01',
        'gmni_pistol_ballistic_01_cen01',
      ]);
      expect(Object.keys(out[0])).toEqual([...SNAPSHOT_COLUMNS.item]);
    });

    it('declines above the limit (the database would cut by its own collation)', () => {
      expect(prefixRowsFromSnapshot(s, 'gmni', 3)).toBeNull();
      expect(prefixRowsFromSnapshot(s, 'gmni', 4)?.length).toBe(4);
    });
  });
});
