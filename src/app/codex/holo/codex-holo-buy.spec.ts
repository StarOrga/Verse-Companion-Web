import { describe, expect, it } from 'vitest';
import { groupShops, haveOf, rankShops, shopSource, toShopRows } from './codex-holo-buy';
import { placeOfName } from '../../hq/plan/map/hq-places';

const opts = [
  { price: 1364000, priceAvg: null, terminal: 'Teach’s Ship Shop', location: 'Levski, Delamar, Nyx', system: 'Nyx', planet: 'Delamar', place: 'Levski' },
  { price: 1312000, priceAvg: null, terminal: 'New Deal', location: 'Lorville, Hurston, Stanton', system: 'Stanton', planet: 'Hurston', place: 'Lorville' },
  { price: 1338000, priceAvg: null, terminal: 'Astro Armada', location: 'Area 18, ArcCorp, Stanton', system: 'Stanton', planet: 'ArcCorp', place: 'Area 18' },
  { price: 1400000, priceAvg: null, terminal: 'Omega Pro', location: 'Everus Harbor, Hurston, Stanton', system: 'Stanton', planet: 'Hurston', place: 'Everus Harbor' },
];

describe('holo buy tab logic', () => {
  const rows = toShopRows(opts);

  it('ranks cheapest first without a position', () => {
    expect(rankShops(rows, null)[0].terminal).toBe('New Deal');
  });

  it('ranks nearest first when the reader position is known', () => {
    const here = placeOfName('Area 18', 'Stanton');
    expect(rankShops(rows, here)[0].terminal).toBe('Astro Armada');
  });

  it('groups by system, planet, place', () => {
    const g = groupShops(rows);
    expect(g.map((x) => `${x.system}/${x.planet}`)).toEqual(['Nyx/Delamar', 'Stanton/ArcCorp', 'Stanton/Hurston']);
    expect(g[2].rows.map((r) => r.terminal)).toEqual(['Omega Pro', 'New Deal']);
  });

  it('builds the wishlist source text', () => {
    expect(shopSource(rows[1])).toBe('New Deal · Lorville · Hurston');
  });

  it('counts the stock of a needed class over all places', () => {
    const need = { className: 'Irradiated_Pearl', name: 'Irradiated Pearl', qty: 3 };
    expect(haveOf(need, [{ class_name: 'irradiated_pearl', qty: 1 }, { class_name: 'irradiated_pearl', qty: 1 }, { class_name: 'x', qty: 9 }])).toBe(2);
  });
});
