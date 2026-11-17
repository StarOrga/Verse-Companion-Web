// One search row per ship family (C11, the reader's words: "ein eintrag mit mini textlinks zu
// varianten … der zur default variante führt"). Pure; shared by the fusion bar, the Codex bar and
// Ctrl+K.
// -----------------------------------------------------------------------------
// The family is the ship page's own model row ("Standard · Dunlevy · Pirate · Valiant"):
// `resolveModelVariants` over the edition siblings `CodexService.listEditionSiblings` reads — the
// SAME source and rule the page uses, no name heuristic of the search's own. Every ship hit of a
// family folds into ONE hit: the Standard model (the row's anchor, the "default variant"), at the
// place of the family's best-ranked hit; the other models become mini links (`kind: 'edition'`),
// the ones the term matched first. Liveries are items, never in the ships group, so they stay rows.

import type { CodexListRow } from '../codex.service';
import { resolveModelVariants, type EditionKeyed } from '../codex-edition-group';
import type { PolySearchHit } from '../codex-poly-search';
import { CodexSearchGroup, SearchVariantLink, hitTarget } from './codex-search-model';

/** One model of a ship family; `label` null on the Standard model. */
export interface FamilyMember {
  classNameSlug: string;
  label: string | null;
  nameLocalized: string | null;
}

/** The family of a ship class (Standard first), or null for a ship with a single model. */
export type ShipFamilyOf = (classNameSlug: string) => readonly FamilyMember[] | null;

/** The page's model row from sibling records (`listEditionSiblings`, or the hits themselves as a floor). */
export function familyFromRows(rows: readonly EditionKeyed[], classNameSlug: string): FamilyMember[] | null {
  const opts = resolveModelVariants(rows as readonly CodexListRow[], classNameSlug);
  if (!opts || opts.length < 2) return null;
  const names = new Map(rows.map((r) => [r.classNameSlug, r.nameLocalized]));
  return opts.map((o) => ({ classNameSlug: o.classNameSlug, label: o.label, nameLocalized: names.get(o.classNameSlug) ?? null }));
}

export interface FamilyFold {
  groups: CodexSearchGroup[];
  /** Family base (lower case) → the other models as mini links, the matched ones first. */
  links: ReadonlyMap<string, SearchVariantLink[]>;
  /** Every folded member (lower case) → its family base (lower case). */
  baseOf: ReadonlyMap<string, string>;
  /** Family base (lower case) → every member class (lower case), base first. */
  members: ReadonlyMap<string, string[]>;
}

const low = (s: string): string => s.toLowerCase();

/**
 * Fold the ships group: one hit per family, at its best member's rank. When the Standard model
 * itself is not among the hits ("valiant") it is drawn from the family record. Group totals stay
 * the index's.
 */
export function foldShipFamilies(groups: readonly CodexSearchGroup[], familyOf: ShipFamilyOf | null | undefined): FamilyFold {
  const links = new Map<string, SearchVariantLink[]>();
  const baseOf = new Map<string, string>();
  const members = new Map<string, string[]>();
  if (!familyOf) return { groups: [...groups], links, baseOf, members };
  const out = groups.map((g) => {
    if (g.kind !== 'ship') return g;
    const hits: PolySearchHit[] = [];
    const at = new Map<string, number>();
    const matched = new Map<string, Set<string>>();
    const fams = new Map<string, readonly FamilyMember[]>();
    for (const hit of g.hits) {
      const fam = familyOf(hit.classNameSlug);
      const self = fam?.find((m) => low(m.classNameSlug) === low(hit.classNameSlug));
      if (!fam || !self) {
        hits.push(hit);
        continue;
      }
      const base = fam.find((m) => m.label === null) ?? fam[0];
      const key = low(base.classNameSlug);
      fams.set(key, fam);
      const seen = matched.get(key) ?? new Set<string>();
      seen.add(low(hit.classNameSlug));
      matched.set(key, seen);
      const isBase = self === base;
      const i = at.get(key);
      if (i !== undefined) {
        if (isBase) hits[i] = hit; // the real record carries the better data
        continue;
      }
      at.set(key, hits.length);
      hits.push(isBase ? hit : { ...hit, classNameSlug: base.classNameSlug, nameLocalized: base.nameLocalized ?? hit.nameLocalized, name: undefined });
    }
    for (const [key, fam] of fams) {
      const seen = matched.get(key)!;
      const baseHit = seen.has(key);
      const others = fam
        .filter((m) => low(m.classNameSlug) !== key)
        .map((m, i) => ({ m, i, hit: seen.has(low(m.classNameSlug)) }))
        .sort((a, b) => Number(b.hit) - Number(a.hit) || a.i - b.i);
      links.set(
        key,
        others.map(({ m, hit }) => ({
          id: `ed-${m.classNameSlug}`,
          kind: 'edition' as const,
          label: m.label ?? m.classNameSlug,
          target: hitTarget({ kind: 'ship', classNameSlug: m.classNameSlug } as PolySearchHit),
          active: false,
          ...(hit ? { matched: true as const } : {}),
          // The term named this model rather than the family: the link the reader is after stands out.
          ...(hit && !baseHit ? { emphasis: true as const } : {}),
        })),
      );
      const all = [key, ...others.map((o) => low(o.m.classNameSlug))];
      members.set(key, all);
      for (const m of all) baseOf.set(m, key);
    }
    return hits.length === g.hits.length && hits.every((h, i) => h === g.hits[i]) ? g : { ...g, hits };
  });
  return { groups: out, links, baseOf, members };
}

/** True when a family row's other model matched the term (it keeps the row on the Standard page). */
export function otherMemberMatched(variants: readonly SearchVariantLink[] | undefined): boolean {
  return !!variants?.some((v) => v.kind === 'edition' && v.matched);
}
