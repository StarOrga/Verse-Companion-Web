import type { ShipInterior, ShipInteriorPoi } from '../codex.types';
import {
  GROUP_OF_CAT,
  INTERIOR_GROUPS,
  PRESET_GROUPS,
  cargoGapOf,
  deckOfPick,
  firstOfRow,
  interiorOverview,
  readInterior,
  relayLabel,
  roomContents,
  rolePresetOf,
  scuByDeck,
  searchEntries,
  searchScopeOf,
  startDeckOf,
} from './holo-interior';
import { buildScene3d, convexHull, deckFloors } from './holo-interior-3d';

const poi = (cat: ShipInteriorPoi['cat'], deck: string, extra: Partial<ShipInteriorPoi> = {}): ShipInteriorPoi => ({ cat, pos: [0, 0, 0], deck, ...extra });

/** A trimmed Starlancer MAX (prototype/payload-MISC_Starlancer_Max.json): two decks, 96 of 224 SCU located. */
const starlancer: ShipInterior = {
  pois: [
    poi('door', 'Starlancer_Deck_2', { cls: 'Door_RN_RoomConnector_Breachable_OpenClose', door: { kind: 'room', breachable: true, panel: [-1.5, -15.8, 1.4] } }),
    poi('door', 'Starlancer_Deck_1', { door: { kind: 'ramp', breachable: false, panel: null } }),
    poi('lift', 'Starlancer_Deck_1'),
    poi('lift', 'Starlancer_Deck_2'),
    poi('bed', 'Starlancer_Deck_2', { room: 'Room_Crew' }),
    poi('bed', 'Starlancer_Deck_2', { room: 'Room_Crew' }),
    poi('powerPlant', 'Starlancer_Deck_2', { cls: 'POWR_JUST_S03_Starlancer' }),
    poi('ladder', 'Starlancer_Deck_1', { connects: ['Starlancer_Deck_1', 'Starlancer_Deck_2'] }),
  ],
  cargoGrids: [
    { port: 'hardpoint_cargogrid_left', cls: 'MISC_Starlancer_CargoGrid', dims: [2.5, 10, 3.75], pos: [-4.5, -18, -5], scu: 48, deck: 'Starlancer_Deck_1', room: 'Room_Hold' },
    { port: 'hardpoint_cargogrid_right', cls: 'MISC_Starlancer_CargoGrid', dims: [2.5, 10, 3.75], pos: [4.5, -18, -5], scu: 48, deck: 'Starlancer_Deck_1', room: 'Room_Hold' },
  ],
  lifts: [{ at: [-5.2, -11.1], stops: [-4.44, 0.69], decks: ['Starlancer_Deck_1', 'Starlancer_Deck_2'] }],
  cargoScuLocated: 96,
  cargoGaps: [{ port: 'hardpoint_cargogrid_left_small', reason: 'noClass' }],
};
const SL_DECKS = ['Starlancer_Deck_1', 'Starlancer_Deck_2'];

describe('holo-interior', () => {
  it('every category belongs to one of the nine chip groups', () => {
    for (const g of Object.values(GROUP_OF_CAT)) expect(INTERIOR_GROUPS).toContain(g);
    expect(INTERIOR_GROUPS.length).toBe(9);
  });

  it('readInterior: absent or empty interior is null (no zeros), malformed elements are dropped', () => {
    expect(readInterior(undefined)).toBeNull();
    expect(readInterior({ pois: [], cargoGrids: [], lifts: [] })).toBeNull();
    const r = readInterior({
      pois: [poi('door', 'D1'), { cat: 'nonsense', pos: [0, 0, 0], deck: 'D1' }, { cat: 'bed', pos: [0, 0], deck: 'D1' }],
      cargoGrids: [{ port: 'g', cls: 'c', dims: [1.25, 1.25, 1.25], pos: [0, 0, 0], scu: 1, deck: 'D1' }],
      lifts: [],
      cargoScuLocated: 1,
      cargoGaps: [],
    });
    expect(r?.pois.length).toBe(1);
    expect(r?.cargoGrids.length).toBe(1);
  });

  describe('role presets (B8)', () => {
    it('maps role keys to the five groups; unknown roles fall to Sonstige', () => {
      expect(rolePresetOf('@vehicle_class_Frigate')).toBe('combat');
      expect(rolePresetOf('@vehicle_class_HeavyFighter')).toBe('combat');
      expect(rolePresetOf('@vehicle_class_MediumFreight')).toBe('cargo');
      expect(rolePresetOf('@vehicle_class_Medical')).toBe('medical');
      expect(rolePresetOf('@vehicle_class_HeavySalvage')).toBe('industry');
      expect(rolePresetOf('@vehicle_class_Mining')).toBe('industry');
      expect(rolePresetOf('@vehicle_class_Touring')).toBe('other');
      expect(rolePresetOf(null)).toBe('other');
      // No role: the career decides.
      expect(rolePresetOf(null, '@vehicle_focus_transporter')).toBe('cargo');
      expect(rolePresetOf('', '@vehicle_focus_combat')).toBe('combat');
    });

    it('carries the groups the concept names', () => {
      expect(PRESET_GROUPS.combat).toEqual(['weapons', 'doors', 'ways', 'med']);
      expect(PRESET_GROUPS.cargo).toEqual(['cargo', 'ways', 'doors']);
      expect(PRESET_GROUPS.medical).toEqual(['med', 'ways', 'doors']);
      expect(PRESET_GROUPS.industry).toEqual(['cargo', 'tech', 'ways']);
      expect(PRESET_GROUPS.other).toEqual(['ways', 'doors']);
    });

    it('a cargo preset opens on the deck with the most SCU (Starlancer: the lower deck)', () => {
      expect(startDeckOf(starlancer, 'cargo', SL_DECKS)).toBe('Starlancer_Deck_1');
      expect(startDeckOf(starlancer, 'industry', SL_DECKS)).toBe('Starlancer_Deck_1');
    });

    it('other presets open on the deck with the most preset elements, doors only as the tie-break of last resort', () => {
      const combat: ShipInterior = {
        ...starlancer,
        pois: [poi('door', 'A'), poi('door', 'A'), poi('door', 'A'), poi('weaponRack', 'B'), poi('medBed', 'B'), poi('lift', 'A')],
        cargoGrids: [{ ...starlancer.cargoGrids[0], deck: 'A' }],
      };
      expect(startDeckOf(combat, 'combat', ['A', 'B'])).toBe('B');
      expect(startDeckOf({ ...combat, pois: [poi('door', 'B')] }, 'other', ['A', 'B'])).toBe('B');
      // Nothing matches: the first deck.
      expect(startDeckOf({ ...combat, pois: [] }, 'medical', ['A', 'B'])).toBe('A');
      expect(startDeckOf(starlancer, 'cargo', [])).toBeNull();
    });
  });

  describe('deck filter state', () => {
    it('sums SCU per deck', () => {
      const m = scuByDeck(starlancer);
      expect(m.get('Starlancer_Deck_1')).toBe(96);
      expect(m.get('Starlancer_Deck_2')).toBeUndefined();
      expect(scuByDeck(null).size).toBe(0);
    });

    it('the deck of a pick', () => {
      expect(deckOfPick(starlancer, { kind: 'grid', index: 1 })).toBe('Starlancer_Deck_1');
      expect(deckOfPick(starlancer, { kind: 'poi', index: 0 })).toBe('Starlancer_Deck_2');
      expect(deckOfPick(starlancer, { kind: 'poi', index: 99 })).toBeNull();
      expect(deckOfPick(null, { kind: 'poi', index: 0 })).toBeNull();
    });
  });

  describe('cargo gap (B10)', () => {
    it('says 96 of 224 when the extract placed less than the ship holds', () => {
      expect(cargoGapOf(224, starlancer)).toEqual({ located: 96, total: 224 });
    });
    it('no gap when all is located, no SCU known or no interior', () => {
      expect(cargoGapOf(96, starlancer)).toBeNull();
      expect(cargoGapOf(null, starlancer)).toBeNull();
      expect(cargoGapOf(224, null)).toBeNull();
    });
  });

  describe('overview and rooms (B5, B6)', () => {
    it('groups by type in chip order, doors by kind, grids with their SCU, per deck', () => {
      const all = interiorOverview(starlancer, null);
      expect(all.map((b) => b.group)).toEqual(['cargo', 'ways', 'tech', 'living', 'doors']);
      expect(all[0].rows[0]).toEqual(jasmineLike({ id: 'grid', scu: 96, items: [0, 1] }));
      expect(all.find((b) => b.group === 'doors')!.rows.map((r) => r.id)).toEqual(['door:room', 'door:ramp']);
      const lower = interiorOverview(starlancer, 'Starlancer_Deck_1');
      expect(lower.map((b) => [b.group, b.count])).toEqual([['cargo', 2], ['ways', 2], ['doors', 1]]);
    });

    it('a room lists its elements and the SCU of its grids', () => {
      const hold = roomContents(starlancer, 'Room_Hold')!;
      expect(hold.scu).toBe(96);
      expect(hold.grids).toEqual([0, 1]);
      const crew = roomContents(starlancer, 'Room_Crew')!;
      expect(crew.elements).toBe(2);
      expect(crew.blocks[0].rows[0].cat).toBe('bed');
      expect(roomContents(starlancer, null)).toBeNull();
    });

    it('a row picks its first element on the deck on the table', () => {
      const ways = interiorOverview(starlancer, null).find((b) => b.group === 'ways')!;
      const lifts = ways.rows.find((r) => r.cat === 'lift')!;
      expect(firstOfRow(starlancer, lifts, 'Starlancer_Deck_2')).toEqual({ kind: 'poi', index: 3 });
      expect(firstOfRow(starlancer, lifts, null)).toEqual({ kind: 'poi', index: 2 });
    });

    it('names a relay port readably', () => {
      expect(relayLabel('hardpoint_relay_messhall_left')).toBe('Messhall Left');
      expect(relayLabel('hardpoint_relay_argo_hanger')).toBe('Argo Hanger');
    });
  });

  describe('mini search (B7)', () => {
    const entries = [
      { id: 'p1', side: 'outer' as const, label: 'Attrition-5 Repeater', terms: ['Attrition-5 Repeater', 'hardpoint_weapon_left'], count: 1, target: 1 },
      { id: 'r1', side: 'inner' as const, label: 'Raumtüren', terms: ['Raumtüren', 'Türen', 'Door_RN_RoomConnector'], count: 71, target: 2 },
      { id: 'm1', side: 'inner' as const, label: 'Cargo Bay · Main Deck', terms: ['Cargo Bay'], count: 1, target: 3 },
    ];
    it('finds outside parts and inside elements and rooms, typo-tolerant', () => {
      expect(searchEntries('tür', entries).map((e) => e.id)).toEqual(['r1']);
      expect(searchEntries('atrition', entries).map((e) => e.id)).toEqual(['p1']);
      expect(searchEntries('cargo', entries).map((e) => e.id)).toEqual(['m1']);
      expect(searchEntries('r', entries)).toEqual([]);
    });
    it('reports the scope of its hits', () => {
      expect(searchScopeOf([{ side: 'outer' }])).toBe('outer');
      expect(searchScopeOf([{ side: 'inner' }, { side: 'inner' }])).toBe('inner');
      expect(searchScopeOf([{ side: 'inner' }, { side: 'outer' }])).toBe('both');
    });
  });

  describe('3D with hull (B2)', () => {
    const decks = [
      { key: 'Starlancer_Deck_1', name: null, order: 0, rooms: [{ key: 'Room_Hold', name: null, pos: [0, -18, -5], floorZ: -5, height: 4, shapes: [[[-6, -24], [6, -24], [6, -12], [-6, -12]]] }] },
      { key: 'Starlancer_Deck_2', name: null, order: 1, rooms: [{ key: 'Room_Crew', name: null, pos: [0, 0, 0.7], floorZ: 0.7, height: 2.6, shapes: [[[-4, -6], [4, -6], [4, 6], [-4, 6]]] }] },
    ];
    it('a fallback ("Rest") deck the filter offers is drawn too, so picking it shows its floor', () => {
      const rest = { key: 'unassigned', name: null, order: 2, fallback: true, rooms: [{ key: 'Room_Odd', name: null, pos: [0, 10, 3], floorZ: 3, height: 2.5, shapes: [[[-2, 8], [2, 8], [2, 12], [-2, 12]]] }] };
      const s = buildScene3d({ decks: [...decks, rest], interior: starlancer, silhouette: null, focus: 'unassigned', groups: new Set(), pick: null, yaw: 35, pitch: 32, zoom: 1 })!;
      expect(s.decks.map((d) => d.state)).toEqual(['ghost', 'ghost', 'on']);
    });
    it('floors come from the rooms when the deck carries none', () => {
      expect(deckFloors(decks).get('Starlancer_Deck_1')).toBe(-5);
    });
    it('focuses one deck solid (with tops), the others ghosts; grids and lifts of the focus only', () => {
      const s = buildScene3d({ decks, interior: starlancer, silhouette: null, focus: 'Starlancer_Deck_1', groups: new Set(['cargo', 'ways']), pick: { kind: 'grid', index: 0 }, yaw: 35, pitch: 32, zoom: 1 })!;
      expect(s.decks.map((d) => d.state)).toEqual(['on', 'ghost']);
      expect(s.decks[0].top).not.toBe('');
      expect(s.decks[1].top).toBe('');
      expect(s.grids.length).toBe(2);
      expect(s.grids[0].sides.length).toBe(4);
      expect(s.lifts.length).toBe(1);
      expect(s.lifts[0].stops.length).toBe(2);
      expect(s.ladders.length).toBe(1);
      expect(s.rings.length).toBe(3);
      expect(s.picked).not.toBeNull();
      // Ways on: the lift icon of the focused deck, the ladder as its own line, not as an icon.
      expect(s.icons.map((i) => i.cat)).toEqual(['lift']);
    });
    it('"Alle" draws every deck equal and every element of the groups that are on', () => {
      const s = buildScene3d({ decks, interior: starlancer, silhouette: null, focus: null, groups: new Set(['living']), pick: null, yaw: 0, pitch: 60, zoom: 2 })!;
      expect(s.decks.map((d) => d.state)).toEqual(['all', 'all']);
      expect(s.icons.map((i) => i.cat)).toEqual(['bed', 'bed']);
      expect(s.lifts).toEqual([]);
      expect(s.grids.every((g) => !g.on)).toBe(true);
    });
    it('a ship without a silhouette gets the rooms\' convex hull as its ghost', () => {
      expect(convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2]]).length).toBe(4);
    });
  });
});

/** Partial match without depending on the row's other fields. */
function jasmineLike(partial: Record<string, unknown>) {
  return expect.objectContaining(partial);
}
