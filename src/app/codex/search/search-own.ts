// The reader's own data as a search source (lines A2, C11, C12).
// -----------------------------------------------------------------------------
// Pure and client-side ONLY: hangar ships (type + own name), saved variants
// (config names), FPS/role sets and inventory items are matched in memory. The
// term never leaves the browser for this group and the data never enters the
// shared index or a request payload (#832 part 2). Signed-out readers get no
// rows because the sources are empty.

import type { HangarRoleLoadout, HangarShip, HangarShipConfig } from '../../hangar/hangar.types';
import { hqLocker, ownShipLink, ownVariantLink, hqSet, hqHangar } from '../../hq/hq-routes';
import { humanizeClassName } from '../codex-format';
import { recordScore, searchMatcher } from '../codex-search';
import type { SearchTarget, SearchVariantLink } from './codex-search-model';
import type { OwnRowType, SearchResultRow } from './search-result-model';

/** The own ship's page: its personal Codex view (active variant), not a hangar detail page. */
function ownTarget(
  ship: { id: string; shipClassName: string },
  configs: readonly { hangarShipId: string; id: string; isActive: boolean }[],
  hq: boolean,
): { link: string[]; queryParams: Record<string, string> } {
  const l = ownShipLink(ship, configs.filter((c) => c.hangarShipId === ship.id), hq);
  return { link: l.commands, queryParams: l.queryParams };
}

export type OwnMatch = Omit<Extract<SearchResultRow, { type: 'own' }>, 'cta' | 'icons'>;

/** The inventory columns the search needs. */
export interface OwnInventoryItem {
  name: string;
  class_name: string | null;
  location: string;
  qty: number;
}

export interface OwnSources {
  ships: readonly HangarShip[];
  configs: readonly HangarShipConfig[];
  sets: readonly HangarRoleLoadout[];
  items: readonly OwnInventoryItem[];
}

export interface OwnSearchResult {
  /** Best matches first, at most `limit`. */
  rows: OwnMatch[];
  /** Every match — "Alle N im HQ öffnen". */
  total: number;
}

const KIND_ORDER: Record<OwnRowType, number> = { ship: 0, config: 1, set: 2, item: 3 };

/**
 * The reader's own variants per ship class (lower case): every saved variant of every owned hangar
 * ship of that class, the active one first; a ship without a saved variant gives its `?mine` link.
 * What the catalog row of that ship carries as mini links when the own row folds into it (C11).
 */
export function ownVariantsByClass(src: Pick<OwnSources, 'ships' | 'configs'>, hq = false): Map<string, SearchVariantLink[]> {
  const out = new Map<string, SearchVariantLink[]>();
  for (const s of src.ships) {
    if (s.status !== 'owned' || !s.shipClassName) continue;
    const key = s.shipClassName.toLowerCase();
    const list = out.get(key) ?? [];
    const cfgs = src.configs
      .filter((c) => c.hangarShipId === s.id)
      .map((c, i) => ({ c, i }))
      .sort((a, b) => Number(b.c.isActive) - Number(a.c.isActive) || a.i - b.i);
    if (cfgs.length) {
      for (const { c } of cfgs) {
        const l = ownVariantLink(s, c.id, hq);
        list.push({ id: c.id, label: c.name, target: { link: l.commands, queryParams: l.queryParams }, active: c.isActive });
      }
    } else {
      const t = ownTarget(s, [], hq);
      list.push({ id: `mine-${s.id}`, label: s.customName?.trim() || '', labelKey: 'search.row.variantMine', target: t, active: true });
    }
    out.set(key, list);
  }
  return out;
}

/** Where "Alle N im HQ öffnen" leads for a set of own rows. */
export function ownMoreTarget(rows: readonly OwnMatch[], term: string): SearchTarget {
  const q = term.trim();
  const qp = q ? { q } : null;
  const first = rows[0]?.ownKind;
  if (first === 'set') return { link: [hqLocker], queryParams: qp };
  if (first === 'item') return { link: ['/hq'], queryParams: qp, fragment: 'inventar' };
  return { link: [hqHangar], queryParams: qp };
}

/**
 * Match the term against the reader's own data.
 *
 * @param nameOf Catalog name of a ship class ("Aegis Gladius"); defaults to the humanised class name.
 * @param all Without a term, list everything instead of nothing.
 * @param hq Shell beta: an own ship leads to its HQ page, not to the personal Codex view.
 */
export function searchOwn(
  term: string,
  src: OwnSources,
  opts: { limit?: number; nameOf?: (className: string) => string | null; kinds?: readonly OwnRowType[]; all?: boolean; hq?: boolean } = {},
): OwnSearchResult {
  // `all`: an empty term lists every record of the wanted kinds ("lager" alone is the whole Inventar).
  const match = searchMatcher(term) ?? (opts.all ? (): boolean => true : null);
  if (!match) return { rows: [], total: 0 };
  const limit = opts.limit ?? 5;
  const nameOf = (c: string): string => opts.nameOf?.(c) || humanizeClassName(c);
  const want = (k: OwnRowType): boolean => !opts.kinds || opts.kinds.includes(k);
  const found: { row: OwnMatch; score: number; i: number }[] = [];
  const add = (row: OwnMatch, names: (string | null)[], ids: (string | null)[] = []): void => {
    found.push({ row, score: recordScore(term, names, ids), i: found.length });
  };

  const owned = src.ships.filter((s) => s.status === 'owned');

  // ONE row per hangar ship (concept 2026-11-17, d-variant): the ship and its saved variants
  // ("Meine …", `?v=`) are one page, so a matching variant no longer adds a row of its own.
  // The row opens the active (default) variant; with two or more variants it carries them as
  // mini text links, the ones the term matched first. Only a variant matched → kind 'config'
  // (the second line names the ship), the variant's name stands beside the type.
  if (want('ship') || want('config')) {
    for (const s of owned) {
      const type = nameOf(s.shipClassName);
      const cfgs = src.configs.filter((c) => c.hangarShipId === s.id);
      const shipHit = want('ship') && match(s.customName, type, s.shipClassName);
      const cfgHits = want('config') ? cfgs.filter((c) => match(c.name)) : [];
      if (!shipHit && !cfgHits.length) continue;
      const matched = new Set(cfgHits.map((c) => c.id));
      const variants: SearchVariantLink[] | undefined =
        cfgs.length >= 2
          ? cfgs
              .map((c, i) => ({ c, i }))
              .sort((a, b) => Number(matched.has(b.c.id)) - Number(matched.has(a.c.id)) || Number(b.c.isActive) - Number(a.c.isActive) || a.i - b.i)
              .map(({ c }) => {
                const l = ownVariantLink(s, c.id, !!opts.hq);
                return { id: c.id, label: c.name, target: { link: l.commands, queryParams: l.queryParams }, active: c.isActive };
              })
          : undefined;
      const customName = s.customName?.trim() || null;
      add(
        {
          type: 'own', id: `own-ship-${s.id}`, ownKind: shipHit ? 'ship' : 'config', title: type,
          ownName: shipHit ? customName : cfgHits[0].name,
          subtitle: shipHit ? null : customName,
          classNameSlug: s.shipClassName, qty: null,
          target: ownTarget(s, src.configs, !!opts.hq),
          ...(variants ? { variants } : {}),
        },
        shipHit ? [s.customName, type, ...cfgHits.map((c) => c.name)] : cfgHits.map((c) => c.name),
        shipHit ? [s.shipClassName] : [],
      );
    }
  }
  if (want('set')) {
    for (const s of src.sets) {
      if (!match(s.name)) continue;
      add(
        {
          type: 'own', id: `own-set-${s.id}`, ownKind: 'set', title: s.name, ownName: null, subtitle: null,
          classNameSlug: null, qty: null, target: { link: hqSet(s.id), queryParams: null },
        },
        [s.name],
      );
    }
  }
  if (want('item')) {
    const seen = new Set<string>();
    for (const it of src.items) {
      if (!match(it.name, it.class_name)) continue;
      const key = `${it.name}|${it.location}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add(
        {
          type: 'own', id: `own-item-${found.length}`, ownKind: 'item', title: it.name, ownName: null,
          subtitle: it.location || null, classNameSlug: it.class_name, qty: it.qty,
          target: { link: ['/hq'], queryParams: { q: it.name }, fragment: 'inventar' },
        },
        [it.name],
        [it.class_name],
      );
    }
  }
  found.sort((a, b) => b.score - a.score || KIND_ORDER[a.row.ownKind] - KIND_ORDER[b.row.ownKind] || a.i - b.i);
  return { rows: found.slice(0, limit).map((f) => f.row), total: found.length };
}
