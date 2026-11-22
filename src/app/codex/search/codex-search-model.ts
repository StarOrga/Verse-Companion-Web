// The Codex search — pure, framework-free parts.
// -----------------------------------------------------------------------------
// ONE Codex search runs behind Ctrl+K, the Codex landing terminal and the
// Codex search bar on every Codex page (CodexSearchEngine).
// RESULT MODEL for the fusion bar (chips, groups, rows, CTA, icons): see
// search-result-model.ts; composed by search-compose.ts; engine.result().
// This module owns what can be tested without Angular: grouping the ranked hits by kind, the
// "all N in the index" targets, display names and the recent-search store.

import type { Lang, LocalizedText } from '../codex.types';
import { cleanLocaleValue, humanizeClassName } from '../codex-format';
import {
  KIND_PRIORITY,
  PolyHitKind,
  PolySearchHit,
  UPCOMING_HIT_KIND,
  isUpcomingHit,
  polyHitLink,
  polyHitQueryParams,
  polyMatchQuality,
  polyMatchScore,
} from '../codex-poly-search';
import { normalizeSearch } from '../codex-search';
import { orderGroups } from './search-rank';

/** A route target: a routerLink array plus its query params. */
export interface SearchTarget {
  link: string[];
  queryParams: Record<string, string> | null;
  /** Optional #anchor (an HQ page, a page section). */
  fragment?: string;
}

/** One kind's slice of a search. */
export interface CodexSearchGroup {
  kind: PolyHitKind;
  /** The best hits of this kind, at most the cap. */
  hits: PolySearchHit[];
  /** Every record of this kind that matched — at least `hits.length`. What "all N in the index" promises. */
  total: number;
  /**
   * What the group header counts: distinct cards, the way the user sees them
   * (same-name variants fold into one row). Equals `total` when nothing folded.
   */
  count: number;
  /** True when only part of the matches was read: `count` is a floor ("12+"). */
  countIsFloor: boolean;
  /** Records folded into the cards — the quiet "N variants folded in" hint; 0 for none. */
  folded: number;
  /** True when `folded` only covers the rows read ("at least N"). */
  foldedIsFloor: boolean;
  /** "All N in the index" — only when the index holds more than shown. */
  more: SearchTarget | null;
}

/**
 * One entry of the result listbox. Hits, "all N" links, recent searches,
 * category shortcuts and the patch's new ships all share the arrow keys, so
 * they share one shape.
 */
export type SearchOption =
  | {
      type: 'hit'; id: string; hit: PolySearchHit; target: SearchTarget; current?: true;
      /** A ship the reader owns: its own variants as mini links — one row per ship page (C11). */
      variants?: SearchVariantLink[];
    }
  | { type: 'more'; id: string; kind: PolyHitKind; total: number; target: SearchTarget }
  | { type: 'recent'; id: string; term: string; target: SearchTarget }
  | { type: 'category'; id: string; labelKey: string; target: SearchTarget }
  | { type: 'fresh'; id: string; hit: PolySearchHit; target: SearchTarget };

/** Recent searches kept in localStorage, newest first. */
export const RECENT_SEARCHES_KEY = 'sc.codex.recentSearches';
export const RECENT_SEARCHES_MAX = 8;

/**
 * The category shortcuts an empty search field offers. Real routes, so each
 * one is an anchor (middle click opens it in a new tab).
 */
export const SEARCH_CATEGORY_SHORTCUTS: readonly { labelKey: string; target: SearchTarget }[] = [
  { labelKey: 'codex.search.bar.category.ships', target: { link: ['/codex/index'], queryParams: { kind: 'ship' } } },
  { labelKey: 'codex.search.bar.category.components', target: { link: ['/codex/index'], queryParams: { kind: 'component' } } },
  {
    labelKey: 'codex.search.bar.category.shipWeapons',
    target: { link: ['/codex/index'], queryParams: { kind: 'weapon', weaponClass: 'Ship' } },
  },
  { labelKey: 'codex.search.bar.category.fps', target: { link: ['/codex/index'], queryParams: { kind: 'weapon', wg: 'fps' } } },
  { labelKey: 'codex.search.bar.category.upcoming', target: { link: ['/codex/upcoming'], queryParams: null } },
  { labelKey: 'codex.search.bar.category.keybinds', target: { link: ['/codex/keybinds'], queryParams: null } },
];

/** Where a hit opens. */
export function hitTarget(hit: PolySearchHit): SearchTarget {
  return { link: polyHitLink(hit), queryParams: polyHitQueryParams(hit) };
}

/**
 * "All N in the index" for one kind and term. Announced ships live in their
 * own grid (`/codex/upcoming`), every datamined kind in the index.
 */
export function indexTarget(kind: PolyHitKind, term: string): SearchTarget {
  const q = term.trim();
  if (kind === UPCOMING_HIT_KIND) return { link: ['/codex/upcoming'], queryParams: q ? { q } : null };
  return { link: ['/codex/index'], queryParams: q ? { kind, q } : { kind } };
}

/** Per kind: distinct cards among the rows read, and how many rows were read. */
export interface GroupCounts {
  distinct?: Partial<Record<PolyHitKind, number>>;
  read?: Partial<Record<PolyHitKind, number>>;
}

/**
 * The header numbers of one group. The pill counts cards (deduped), the "all
 * N" link keeps the raw total. When the over-fetch did not read every match,
 * the unread rest may hold more cards: the count becomes a floor ("12+") and
 * the folded number covers only what was read.
 */
export function groupCounts(
  total: number,
  shown: number,
  distinct: number | undefined,
  read: number | undefined,
): Pick<CodexSearchGroup, 'count' | 'countIsFloor' | 'folded' | 'foldedIsFloor'> {
  if (distinct == null) return { count: total, countIsFloor: false, folded: 0, foldedIsFloor: false };
  const cards = Math.max(distinct, shown);
  const complete = read == null || read >= total;
  if (complete) {
    const count = Math.min(cards, total);
    return { count, countIsFloor: false, folded: Math.max(0, total - count), foldedIsFloor: false };
  }
  return { count: cards, countIsFloor: true, folded: Math.max(0, read - cards), foldedIsFloor: true };
}

/** Group ranked hits by kind, at most `cap` per group; the groups ordered by their best match (search-rank). */
export function groupHits(
  term: string,
  hits: readonly PolySearchHit[],
  totals: Partial<Record<PolyHitKind, number>>,
  cap: number,
  counts: GroupCounts = {},
): CodexSearchGroup[] {
  const byKind = new Map<PolyHitKind, PolySearchHit[]>();
  for (const h of hits) {
    const list = byKind.get(h.kind) ?? [];
    list.push(h);
    byKind.set(h.kind, list);
  }
  const order = [...KIND_PRIORITY, ...[...byKind.keys()].filter((k) => !KIND_PRIORITY.includes(k))];
  const groups: CodexSearchGroup[] = [];
  for (const kind of order) {
    const all = byKind.get(kind);
    if (!all?.length) continue;
    const shown = all.slice(0, Math.max(1, cap));
    const total = Math.max(totals[kind] ?? all.length, all.length);
    groups.push({
      kind,
      hits: shown,
      total,
      ...groupCounts(total, shown.length, counts.distinct?.[kind], counts.read?.[kind]),
      more: total > shown.length ? indexTarget(kind, term) : null,
    });
  }
  // The group with the best match leads; equally good groups follow the size hierarchy (#395).
  return orderGroups(groups, (g) => g.kind, (g) => bestQuality(term, g.hits));
}

/** The best match quality among a group's hits (search-quality MATCH scale). */
export function bestQuality(term: string, hits: readonly PolySearchHit[]): number {
  let best = 0;
  for (const h of hits) best = Math.max(best, polyMatchQuality(term, h));
  return best;
}

/**
 * The listbox options of a grouped result, in reading order. Run the groups
 * through {@link applyCurrentPage} first: its `current` keys mark the
 * "Du bist hier" row.
 */
export function resultOptions(
  groups: readonly CodexSearchGroup[],
  current: ReadonlySet<string> = NO_KEYS,
  variantsOf?: ShipVariantsOf,
  here: PageLocation | null = null,
): SearchOption[] {
  const out: SearchOption[] = [];
  for (const g of groups) {
    g.hits.forEach((hit, i) => {
      const vs = hit.kind === 'ship' ? variantsOf?.(hit.classNameSlug) : undefined;
      out.push({
        type: 'hit', id: `${g.kind}-${i}`, hit, target: hitTarget(hit),
        ...(current.has(hitKey(hit)) ? { current: true as const } : {}),
        ...(vs?.length ? { variants: markVariants(vs, here) } : {}),
      });
    });
    if (g.more) out.push({ type: 'more', id: `${g.kind}-more`, kind: g.kind, total: g.total, target: g.more });
  }
  return out;
}

/** How many of the patch's new ships an empty field offers. */
export const FRESH_SHIPS_SHOWN = 4;

/**
 * The listbox options of an empty field: recent searches, new ships, categories.
 * The page the reader stands on is never offered (it would lead nowhere); the
 * new ships backfill from the rest of `fresh`, so the list keeps its length.
 */
export function suggestionOptions(
  recent: readonly string[],
  fresh: readonly PolySearchHit[],
  here: PageLocation | null = null,
): SearchOption[] {
  const out: SearchOption[] = [];
  recent.forEach((term, i) =>
    out.push({ type: 'recent', id: `recent-${i}`, term, target: { link: ['/codex'], queryParams: { q: term } } }),
  );
  fresh
    .filter((hit) => !isCurrentTarget(hitTarget(hit), here))
    .slice(0, FRESH_SHIPS_SHOWN)
    .forEach((hit, i) => out.push({ type: 'fresh', id: `fresh-${i}`, hit, target: hitTarget(hit) }));
  SEARCH_CATEGORY_SHORTCUTS.forEach((c, i) => {
    if (!isCurrentTarget(c.target, here)) out.push({ type: 'category', id: `cat-${i}`, labelKey: c.labelKey, target: c.target });
  });
  return out;
}

// -- "Du bist hier" (concept 2026-11-17, note 4) ----------------------------------
// A search started on a detail page does not offer that page again: a weak
// match is hidden, a near-exact one stays at its rank, greyed, and only closes
// the search. Pure, so the fusion bar, the Codex bar and Ctrl+K share it.

/** Where the reader stands: the router path (decoded, lower case, no trailing slash) and its query. */
export interface PageLocation {
  path: string;
  query: Readonly<Record<string, string>>;
}

/**
 * Query params that only pick a VIEW of one page, never another page: the
 * personal variant (`v`), holo/classic, a loadout, a shared link, "mine" mode.
 * A ship row is the current page on any of them; its variant links say which
 * variant is open.
 */
export const VIEW_ONLY_PARAMS: ReadonlySet<string> = new Set(['v', 'view', 'loadout', 'shared', 'mine']);

const NO_KEYS: ReadonlySet<string> = new Set();

function normPath(p: string): string {
  let d = p;
  try {
    d = decodeURIComponent(p);
  } catch {
    /* a malformed escape compares as written */
  }
  d = ('/' + d.split(';')[0]).replace(/\/{2,}/g, '/').toLowerCase();
  return d.length > 1 ? d.replace(/\/+$/, '') : d;
}

/** A router URL (`/codex/ship/AEGS_Gladius?view=holo#akte`) as a page location. The fragment never matters. */
export function pageLocationOf(url: string): PageLocation {
  const noHash = (url ?? '').split('#')[0];
  const qi = noHash.indexOf('?');
  const query: Record<string, string> = {};
  if (qi !== -1) {
    new URLSearchParams(noHash.slice(qi + 1)).forEach((v, k) => {
      if (!(k in query)) query[k] = v;
    });
  }
  return { path: normPath(qi === -1 ? noHash : noHash.slice(0, qi)), query };
}

/**
 * True when `t` opens the page the reader is on: the same path, and every
 * query param of the target that names a page (not a view) equal to the URL's.
 */
export function isCurrentTarget(t: SearchTarget, here: PageLocation | null): boolean {
  if (!here) return false;
  if (normPath(t.link.join('/')) !== here.path) return false;
  for (const [k, v] of Object.entries(t.queryParams ?? {})) {
    if (VIEW_ONLY_PARAMS.has(k)) continue;
    if ((here.query[k] ?? null) !== v) return false;
  }
  return true;
}

/** A variant mini link (`?v=<config>`, or `?mine` for an own ship without a saved variant) on its ship's row. */
export interface SearchVariantLink {
  /** The saved configuration's id — the `v` of the link (`mine-<hangar id>` for the `?mine` link). */
  id: string;
  /** The variant's name; empty for the `?mine` link of a ship without a custom name (then `labelKey`). */
  label: string;
  /** i18n key shown when `label` is empty. */
  labelKey?: string;
  /**
   * `edition`: another model of the ship family (Valiant, Pirate …) — its own ship page;
   * absent / `own`: one of the reader's saved variants (`?v=`, `?mine`).
   */
  kind?: 'edition' | 'own';
  /** Edition link: the term matched this model. */
  matched?: true;
  /** Edition link: the term named this model rather than the family — shown emphasised, listed first. */
  emphasis?: true;
  target: SearchTarget;
  /** The ship's active variant: what the row itself opens and what the page shows without a `v`. */
  active: boolean;
  /** This variant is open on the page the reader is on: marked, not a navigation. */
  current?: true;
}

/**
 * True when the variant link is the variant open right now. A `v` in the URL names it; `?mine`
 * names the own ship without a saved variant. Without either, a Codex ship page shows the stock
 * ship (codex mode, codex-detail `applyLoadoutSource`) — that is the row's own state, no variant
 * is open — while an HQ ship page shows the active variant.
 */
export function isCurrentVariant(variant: Pick<SearchVariantLink, 'target' | 'active' | 'kind'>, here: PageLocation | null): boolean {
  if (!here || !isCurrentTarget(variant.target, here)) return false;
  const open = here.query['v'] ?? null;
  // Another model's page: open unless the reader looks at one of their own variants of it.
  if (variant.kind === 'edition') return !open && !('mine' in here.query);
  const own = variant.target.queryParams?.['v'] ?? null;
  if (open) return open === own;
  if (!own) return 'mine' in here.query && 'mine' in (variant.target.queryParams ?? {});
  return variant.active && !here.path.startsWith('/codex/');
}

/** The variant links with the one open on the page marked (`current`), every other one a plain link. */
export function markVariants(variants: readonly SearchVariantLink[], here: PageLocation | null | undefined): SearchVariantLink[] {
  return variants.map((v) => {
    const rest: SearchVariantLink = { ...v };
    delete rest.current;
    return isCurrentVariant(rest, here ?? null) ? { ...rest, current: true as const } : rest;
  });
}

/** The reader's own variants of a ship class (any case), every hangar ship of that class; empty = none owned. */
export type ShipVariantsOf = (shipClassName: string) => readonly SearchVariantLink[] | undefined;

/** Variant mini links shown on one row before "+n". */
export const VARIANT_LINKS_SHOWN = 4;

/** Identity of a hit in the current-page rule. */
export function hitKey(hit: Pick<PolySearchHit, 'kind' | 'classNameSlug'>): string {
  return `${hit.kind}|${hit.classNameSlug.toLowerCase()}`;
}

/** The term names the hit nearly exactly: name, name without maker or class name equals it (score 4). */
export function isNearExactHit(term: string, hit: PolySearchHit): boolean {
  return !!term.trim() && polyMatchScore(term, hit) === 4;
}

/**
 * The current-page rule for the grouped hits of the Codex bar and Ctrl+K: a
 * weak match on the current page is dropped, a near-exact one stays and is
 * returned in `current`. When nothing else would remain, the current page
 * shows greyed instead of an empty panel. Group totals stay the index's.
 */
export function applyCurrentPage(
  groups: readonly CodexSearchGroup[],
  term: string,
  here: PageLocation | null,
  linksOf?: ShipVariantsOf,
): { groups: CodexSearchGroup[]; current: ReadonlySet<string> } {
  if (!here) return { groups: [...groups], current: NO_KEYS };
  const current = new Set<string>();
  const hidden: { kind: PolyHitKind; hit: PolySearchHit }[] = [];
  const out: CodexSearchGroup[] = [];
  for (const g of groups) {
    const hits = g.hits.filter((hit) => {
      if (!isCurrentTarget(hitTarget(hit), here)) return true;
      // A family row stays (greyed) when the term named the page OR another model of the family.
      const other = hit.kind === 'ship' && !!linksOf?.(hit.classNameSlug)?.some((v) => v.kind === 'edition' && v.matched);
      if (isNearExactHit(term, hit) || other) {
        current.add(hitKey(hit));
        return true;
      }
      hidden.push({ kind: g.kind, hit });
      return false;
    });
    if (hits.length || g.more) out.push(hits.length === g.hits.length ? g : { ...g, hits });
  }
  const first = hidden[0];
  if (first && !out.some((g) => g.hits.length)) {
    current.add(hitKey(first.hit));
    const at = out.findIndex((x) => x.kind === first.kind);
    const src = at === -1 ? groups.find((x) => x.kind === first.kind)! : out[at];
    const back = { ...src, hits: [first.hit] };
    if (at === -1) out.unshift(back);
    else out[at] = back;
  }
  return { groups: out, current };
}

/** A target as a URL string — for Ctrl+Enter (new tab) and plain hrefs. */
export function targetUrl(t: SearchTarget): string {
  const path = t.link.join('/').replace(/\/{2,}/g, '/');
  const qs = t.queryParams ? new URLSearchParams(t.queryParams).toString() : '';
  const hash = t.fragment ? `#${t.fragment}` : "";
  return (qs ? `${path}?${qs}` : path) + hash;
}

/**
 * The hit's title in the app language: the payload's `{ de, en }` name, then
 * the English column, then the humanised class name — never the raw class
 * name ("AEGS_Gladius_Thruster_Main").
 */
export function hitTitle(hit: PolySearchHit, lang: Lang): string {
  const own = hit.name ? cleanLocaleValue(pick(hit.name, lang)) : '';
  return own || cleanLocaleValue(hit.nameLocalized) || humanizeClassName(hit.classNameSlug);
}

/** The manufacturer spelled out, its code as the honest fallback. */
export function hitManufacturer(hit: PolySearchHit, lang: Lang): string | null {
  return (hit.manufacturerName ? pick(hit.manufacturerName, lang) : '') || hit.manufacturerCode || null;
}

/** Liveries are items of attach type `Paints`. */
export function isLivery(hit: PolySearchHit): boolean {
  return (hit.attachType ?? '').toLowerCase() === 'paints';
}

/** The compare-tray kind of a hit, or null — announced ships have no stats. */
export function pinKindOf(hit: PolySearchHit): Exclude<PolyHitKind, typeof UPCOMING_HIT_KIND> | null {
  return isUpcomingHit(hit) ? null : (hit.kind as Exclude<PolyHitKind, typeof UPCOMING_HIT_KIND>);
}

function pick(t: LocalizedText, lang: Lang): string {
  return (lang === 'de' ? t.de || t.en : t.en || t.de) ?? '';
}

/** Read the recent searches; any storage failure reads as "none". */
export function readRecentSearches(storage: Storage | null): string[] {
  try {
    const raw = storage?.getItem(RECENT_SEARCHES_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? list.filter((t): t is string => typeof t === 'string' && !!t.trim()).slice(0, RECENT_SEARCHES_MAX)
      : [];
  } catch {
    return [];
  }
}

/** Put `term` first (case/diacritics-insensitive dedupe), cap, persist best-effort. */
export function pushRecentSearch(storage: Storage | null, list: readonly string[], term: string): string[] {
  const t = term.trim();
  if (!t) return [...list];
  const key = normalizeSearch(t);
  const next = [t, ...list.filter((x) => normalizeSearch(x) !== key)].slice(0, RECENT_SEARCHES_MAX);
  try {
    storage?.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota: the list still holds for this session */
  }
  return next;
}

/** Forget every recent search. */
export function clearRecentSearches(storage: Storage | null): void {
  try {
    storage?.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    /* nothing to do */
  }
}
