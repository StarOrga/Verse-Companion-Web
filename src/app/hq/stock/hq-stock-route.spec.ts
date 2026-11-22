import { placeOfName } from '../plan/map/hq-places';
import { flightMinutes, placeKind, planRoutes } from './hq-stock-route';
import { parseOrt, searchStock } from './hq-stock-search.model';

describe('hq-stock-route (#354)', () => {
  it('knows the approach kind of a place', () => {
    expect(placeKind('Port Tressler')).toBe('station');
    expect(placeKind('Stanton4_NewBabbage')).toBe('city');
    expect(placeKind('Shubin Mining SAL-2')).toBe('outpost');
  });

  it('estimates flight minutes by tier', () => {
    const pt = placeOfName('Port Tressler');
    expect(flightMinutes(pt, placeOfName('New Babbage'))).toBe(3);
    expect(flightMinutes(pt, placeOfName('Area18'))).toBe(8);
    expect(flightMinutes(pt, placeOfName('Ruin Station'))).toBe(30);
    expect(flightMinutes(null, pt)).toBeNull();
  });

  it('ranks the admin example: 15 SCU from Port Tressler puts New Babbage first', () => {
    const plans = planRoutes(
      [
        { location: 'Area18', qty: 15 },
        { location: 'New Babbage', qty: 30 },
        { location: 'Baijini Point', qty: 15 },
      ],
      15,
      placeOfName('Port Tressler'),
      { maxStops: 3, balance: 'balanced' },
    );
    expect(plans[0].stops.map((s) => s.location)).toEqual(['New Babbage']);
    expect(plans[0].minutes).toBe(9);
    expect(plans[1].stops.map((s) => s.location)).toEqual(['Baijini Point']);
  });

  it('never offers a combination with a superfluous stop and honours max stops', () => {
    const src = [
      { location: 'Lorville', qty: 30 },
      { location: 'Area18', qty: 15 },
      { location: 'Baijini Point', qty: 15 },
    ];
    const plans = planRoutes(src, 30, placeOfName('Baijini Point'), { maxStops: 3, balance: 'shortest' });
    for (const p of plans) expect(p.stops.some((s) => s.location === 'Lorville') && p.stops.length > 1).toBe(false);
    expect(planRoutes(src, 30, null, { maxStops: 1, balance: 'balanced' }).every((p) => p.stops.length === 1)).toBe(true);
    expect(planRoutes(src, 100, null, { maxStops: 3, balance: 'balanced' })).toEqual([]);
  });

  it('searches by item text and the Ort field together', () => {
    const rows = [
      { location: 'Area18', name: 'Iron', qty: 15, unit: 'scu' as const },
      { location: 'Stanton4_NewBabbage', name: 'Iron', qty: 30, unit: 'scu' as const },
      { location: 'Lorville', name: 'Copper', qty: 4, unit: 'scu' as const },
    ];
    const all = searchStock(rows, 'iron', parseOrt('', []));
    expect(all.length).toBe(1);
    expect(all[0].total).toBe(45);
    const mt = searchStock(rows, 'iron', parseOrt('microTech', []));
    expect(mt[0].rows.map((r) => r.location)).toEqual(['Stanton4_NewBabbage']);
    expect(searchStock(rows, '', parseOrt('Lorville', [])).map((g) => g.name)).toEqual(['Copper']);
  });
});
