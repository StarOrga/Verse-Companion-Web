import { Injectable, inject, signal } from '@angular/core';

import { CodexService } from '../../codex/codex.service';
import { logWarn } from '../../core/log';
import { SupabaseClientProvider } from '../../core/supabase.client';

/**
 * Item → blueprint link for the Bestand "Ersatz" alternatives (#1057).
 *
 * A material sits in many blueprints (as output of one, as ingredient of several), so the lookup returns a SET of
 * blueprint class names. An item without any known blueprint returns an empty list = UNKNOWN, never "no blueprint".
 * Sources: `codex_blueprints.output_class_name` (blueprint = `class_name`) and
 * `codex_blueprint_ingredients.ingredient_class_name` (blueprint = `blueprint_class_name`).
 */

export type BlueprintIndex = ReadonlyMap<string, ReadonlySet<string>>;

/** Blueprint class names that produce or accept this item; empty = unknown. */
export function blueprintsOf(className: string | null | undefined, index: BlueprintIndex): readonly string[] {
  if (!className) return [];
  const set = index.get(className);
  return set ? [...set] : [];
}

const OUT_CHUNK = 200;
// An ingredient like a common ore sits in many blueprints; keep the answer under PostgREST's 1000-row cap.
const ING_CHUNK = 25;

@Injectable({ providedIn: 'root' })
export class BlueprintLinkService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly codex = inject(CodexService);

  private readonly index = signal<BlueprintIndex>(new Map());
  private readonly requested = new Set<string>();

  /** Reactive: read inside a computed/template, call {@link load} to fill it. */
  blueprintsOf(className: string | null | undefined): readonly string[] {
    return blueprintsOf(className, this.index());
  }

  /** Fetches the blueprint links for these items once; a failure leaves them unknown and retryable. */
  async load(classNames: readonly string[]): Promise<void> {
    const todo = [...new Set(classNames)].filter((c) => c && !this.requested.has(c));
    if (todo.length === 0) return;
    const build = await this.codex.loadCurrentBuild();
    if (!build) return;
    for (const c of todo) this.requested.add(c);
    const next = new Map<string, Set<string>>();
    for (const [k, v] of this.index()) next.set(k, new Set(v));
    const add = (item: string | null | undefined, bp: string | null | undefined): void => {
      if (!item || !bp) return;
      const set = next.get(item) ?? new Set<string>();
      set.add(bp);
      next.set(item, set);
    };
    const failed = new Set<string>();
    for (let i = 0; i < todo.length; i += OUT_CHUNK) {
      const slice = todo.slice(i, i + OUT_CHUNK);
      const { data, error } = await this.sb.client
        .from('codex_blueprints')
        .select('class_name, output_class_name')
        .eq('build_id', build.id)
        .in('output_class_name', slice);
      if (error) {
        for (const c of slice) failed.add(c);
        logWarn('blueprint-link', 'outputs load failed', error);
        continue;
      }
      for (const row of (data ?? []) as { class_name?: string | null; output_class_name?: string | null }[]) add(row.output_class_name, row.class_name);
    }
    for (let i = 0; i < todo.length; i += ING_CHUNK) {
      const slice = todo.slice(i, i + ING_CHUNK);
      const { data, error } = await this.sb.client
        .from('codex_blueprint_ingredients')
        .select('blueprint_class_name, ingredient_class_name')
        .eq('build_id', build.id)
        .in('ingredient_class_name', slice);
      if (error) {
        for (const c of slice) failed.add(c);
        logWarn('blueprint-link', 'ingredients load failed', error);
        continue;
      }
      for (const row of (data ?? []) as { blueprint_class_name?: string | null; ingredient_class_name?: string | null }[]) add(row.ingredient_class_name, row.blueprint_class_name);
    }
    // Not requested for good: a later call retries these.
    for (const c of failed) this.requested.delete(c);
    this.index.set(next);
  }
}
