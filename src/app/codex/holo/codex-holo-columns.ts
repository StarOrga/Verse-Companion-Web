// The four Holotisch columns as value lists per Einsatz (concept
// 2026-11-23 "Schiffskategorien nach Einsatz", round 2 d2 + round 3 d1).
// -----------------------------------------------------------------------------
// PURE MODULE. It decides which rows a column shows, in which order, for the
// active Einsatz (the Leitwert table `r2-d-leitwert`), and how a row compares
// against the factory loadout (Werk) with the saved configuration marked on
// the same bar. No rank, no percentile, no patch ghost: those live in the
// side panel's "Einordnung" tab only.

import { kpiLowerIsBetter } from '../codex-loadout-stats';
import type { KpiKey, MissionId, ShipCapabilities } from '../codex-mission';
import { missionDisabledReasonKey } from '../codex-mission';
import { PERSPECTIVES, type Perspective } from '../codex-build-compare';
import type { RankClassId } from '../codex-rank';

/** A row's metric: every KPI-sheet key plus the four the columns add. */
export type HoloMetricId = KpiKey | 'coolingLoad' | 'miningTool' | 'salvageTool' | 'ore';

/** The topic a row belongs to inside "Alle Werte" (one heading each). */
export type HoloTopic =
  | 'weapons' | 'tools' | 'missiles' | 'damage'
  | 'shield' | 'hull'
  | 'flight' | 'rates' | 'quantum' | 'cargo' | 'mass'
  | 'signature' | 'cooling';

interface MetricMeta {
  area: Perspective;
  topic: HoloTopic;
}

/** Which column and which "Alle Werte" topic each metric belongs to. */
const METRIC_META: Readonly<Record<HoloMetricId, MetricMeta>> = {
  sustainedDps: { area: 'offensive', topic: 'weapons' },
  burstDps: { area: 'offensive', topic: 'weapons' },
  alpha: { area: 'offensive', topic: 'weapons' },
  missiles: { area: 'offensive', topic: 'missiles' },
  miningTool: { area: 'offensive', topic: 'tools' },
  salvageTool: { area: 'offensive', topic: 'tools' },
  shieldHp: { area: 'defensive', topic: 'shield' },
  shieldRegen: { area: 'defensive', topic: 'shield' },
  hullHp: { area: 'defensive', topic: 'hull' },
  armorHp: { area: 'defensive', topic: 'hull' },
  effectiveHp: { area: 'defensive', topic: 'hull' },
  scm: { area: 'movement', topic: 'flight' },
  maxSpeed: { area: 'movement', topic: 'flight' },
  boost: { area: 'movement', topic: 'flight' },
  agility: { area: 'movement', topic: 'flight' },
  quantumRange: { area: 'movement', topic: 'quantum' },
  quantumSpeed: { area: 'movement', topic: 'quantum' },
  spool: { area: 'movement', topic: 'quantum' },
  cargo: { area: 'movement', topic: 'cargo' },
  ore: { area: 'movement', topic: 'cargo' },
  mass: { area: 'movement', topic: 'mass' },
  ir: { area: 'signature', topic: 'signature' },
  emLoad: { area: 'signature', topic: 'signature' },
  emIdle: { area: 'signature', topic: 'signature' },
  emMax: { area: 'signature', topic: 'signature' },
  emQuantum: { area: 'signature', topic: 'signature' },
  crossSection: { area: 'signature', topic: 'signature' },
  coolingLoad: { area: 'signature', topic: 'cooling' },
};

export function holoMetricArea(id: HoloMetricId): Perspective {
  return METRIC_META[id].area;
}

export function holoMetricTopic(id: HoloMetricId): HoloTopic {
  return METRIC_META[id].topic;
}

/**
 * The one better/worse table of the columns: the KPI sheet's own
 * lower-is-better set (mass, spool, IR, every EM, cross-section) plus the
 * cooling load. A tool is a name, never a direction.
 */
export function holoLowerIsBetter(id: HoloMetricId): boolean {
  if (id === 'coolingLoad') return true;
  if (id === 'miningTool' || id === 'salvageTool' || id === 'ore') return false;
  return kpiLowerIsBetter(id);
}

/** The order a column fills with once its Einsatz rows are placed. */
export const COLUMN_ORDER: Readonly<Record<Perspective, readonly HoloMetricId[]>> = {
  offensive: ['sustainedDps', 'burstDps', 'alpha', 'missiles'],
  defensive: ['shieldHp', 'shieldRegen', 'hullHp', 'armorHp', 'effectiveHp'],
  movement: ['scm', 'agility', 'boost', 'maxSpeed', 'quantumRange', 'quantumSpeed', 'cargo', 'spool', 'mass'],
  signature: ['ir', 'emLoad', 'crossSection', 'coolingLoad', 'emIdle', 'emMax', 'emQuantum'],
};

/** The "Alle Werte" topics in reading order per column. */
export const COLUMN_TOPICS: Readonly<Record<Perspective, readonly HoloTopic[]>> = {
  offensive: ['weapons', 'tools', 'missiles', 'damage'],
  defensive: ['shield', 'hull'],
  movement: ['flight', 'rates', 'quantum', 'cargo', 'mass'],
  signature: ['signature', 'cooling'],
};

/** One column of one Einsatz: the row that leads (★ = focus), what follows it, a quiet column. */
export interface ColumnSpec {
  lead: HoloMetricId;
  then?: readonly HoloMetricId[];
  focus?: boolean;
  quiet?: boolean;
}

const NEUTRAL: Readonly<Record<Perspective, ColumnSpec>> = {
  offensive: { lead: 'sustainedDps' },
  defensive: { lead: 'shieldHp' },
  movement: { lead: 'scm' },
  signature: { lead: 'ir' },
};

/**
 * The Leitwert table (`r2-d-leitwert`, confirmed `r3-d-leitwert` = ok).
 * "Alles" is the neutral lead for every ship (`r3-d-alles` = neutral):
 * Dauer-DPS · Schild HP · SCM · IR.
 */
export const EINSATZ_COLUMNS: Readonly<Record<MissionId, Readonly<Record<Perspective, ColumnSpec>>>> = {
  all: NEUTRAL,
  combat: {
    offensive: { lead: 'sustainedDps', focus: true },
    defensive: { lead: 'shieldHp', focus: true },
    movement: { lead: 'scm' },
    signature: { lead: 'ir' },
  },
  transport: {
    offensive: { lead: 'sustainedDps', quiet: true },
    defensive: { lead: 'hullHp', focus: true },
    movement: { lead: 'cargo', then: ['quantumRange'], focus: true },
    signature: { lead: 'crossSection', quiet: true },
  },
  travel: {
    offensive: { lead: 'sustainedDps', quiet: true },
    defensive: { lead: 'hullHp' },
    movement: { lead: 'quantumRange', then: ['cargo'], focus: true },
    signature: { lead: 'coolingLoad' },
  },
  stealth: {
    offensive: { lead: 'alpha', quiet: true },
    defensive: { lead: 'shieldHp' },
    movement: { lead: 'scm' },
    signature: { lead: 'ir', then: ['emLoad'], focus: true },
  },
  mining: {
    offensive: { lead: 'miningTool', focus: true },
    defensive: { lead: 'shieldHp' },
    movement: { lead: 'quantumRange', then: ['ore'] },
    signature: { lead: 'coolingLoad', focus: true },
  },
  salvage: {
    offensive: { lead: 'salvageTool', focus: true },
    defensive: { lead: 'hullHp' },
    movement: { lead: 'cargo', focus: true },
    signature: { lead: 'coolingLoad', quiet: true },
  },
};

/** Rows a column shows before "Alle Werte" (round 2 d2: the lead and three more). */
export const COLUMN_ROWS = 4;

/**
 * One metric as the stage resolved it: the current (draft) value, the
 * factory loadout's and, when the ship has a saved configuration, the saved
 * one. A tool carries its name as `text` instead of numbers.
 */
export interface HoloMetric {
  id: HoloMetricId;
  labelKey: string;
  current: number | null;
  factory: number | null;
  saved: number | null;
  /** A name metric (the mining laser, the salvage head): "2 × Arbor MH1". */
  text?: string | null;
  /** The factory loadout's name when it differs ("statt …"). */
  factoryText?: string | null;
  /** Why the current value is missing in the game data; null = the ship simply has none (no gap). */
  gapKey: string | null;
}

/** A metric is on the list when it has a number or a name. */
export function hasValue(m: HoloMetric | undefined): boolean {
  return !!m && (m.current != null || (m.text != null && m.text !== ''));
}

// ── comparison against the factory loadout ─────────────────────────────────

/** How far a bar may reach: a 30 % change fills one half of the track. */
const FULL_SCALE = 0.3;

/** How a row reads against Werk, with the saved value as a tick (round 3 d1). */
export interface HoloRowCompare {
  /** better / worse than Werk for THIS metric; null = the current value is Werk's. */
  tone: 'up' | 'down' | null;
  /** The fill's length in % of the track (0–50): it starts at the centre mark. */
  fill: number;
  /** current − Werk; null when equal. Carries the raw sign ("+700" IR is worse). */
  delta: number | null;
  /** The saved value's tick in % of the track (50 = Werk); null = no tick. */
  savedAt: number | null;
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-9);
}

/** Offset from the centre in % of the track (0–50) for a value against Werk. */
function reach(value: number, factory: number): number {
  const rel = factory !== 0 ? Math.abs(value - factory) / Math.abs(factory) : 1;
  return Math.round(Math.min(1, rel / FULL_SCALE) * 50 * 10) / 10;
}

/**
 * The row's comparison display, or null when the row shows only its value:
 * no current value, no factory value to compare with, or the current value
 * IS Werk's and there is no differing saved value (`r3-d-gleich` = values).
 */
export function compareToWerk(
  current: number | null,
  factory: number | null,
  saved: number | null,
  lowerIsBetter: boolean,
): HoloRowCompare | null {
  if (current == null || factory == null) return null;
  const better = (v: number): boolean => (lowerIsBetter ? v < factory : v > factory);
  const savedAt =
    saved != null && !same(saved, factory) ? Math.round((50 + (better(saved) ? 1 : -1) * reach(saved, factory)) * 10) / 10 : null;
  if (same(current, factory)) {
    return savedAt == null ? null : { tone: null, fill: 0, delta: null, savedAt };
  }
  return {
    tone: better(current) ? 'up' : 'down',
    fill: reach(current, factory),
    delta: current - factory,
    savedAt,
  };
}

// ── rows per column ─────────────────────────────────────────────────────────

/** A row as the column renders it — every string resolved. */
export interface HoloColumnRow {
  key: string;
  /** i18n key of the label; `label` wins when set (a weapon's own name). */
  labelKey: string | null;
  label?: string | null;
  value: string;
  /** "statt 2 × CF-337 Panther" — the factory part a swapped name row replaced. */
  was?: string | null;
  cmp: HoloRowCompare | null;
  deltaText: string | null;
  savedText: string | null;
  /** The individual ports behind a grouped row ("8 × KLWE …"), expandable. */
  ports?: readonly { label: string; value: string }[];
}

export interface HoloColumnGroup {
  topic: HoloTopic;
  rows: readonly HoloColumnRow[];
}

/** A value the game data lacks: hidden from the list, named behind the counter. */
export interface HoloColumnGap {
  labelKey: string;
  reasonKey: string;
}

export interface HoloColumnView {
  id: Perspective;
  titleKey: string;
  /** ★ in the Leitwert table: this column leads the Einsatz. */
  focus: boolean;
  /** "leise": the column steps back for this Einsatz. */
  quiet: boolean;
  rows: readonly HoloColumnRow[];
  /** "Alle Werte": the same list continued, grouped by topic. */
  groups: readonly HoloColumnGroup[];
  gaps: readonly HoloColumnGap[];
}

/**
 * Which metrics a column lists first, in order: the Einsatz lead, its
 * "dazu" rows, then the column's own order — only metrics with a value
 * (`r2-d-luecken` = count: a missing value is hidden, not a "—" row).
 * Offensive always keeps the tools (`r3-d-werkzeug` = offensive): a ship
 * with guns and a mining laser shows both, one under the other.
 */
export function selectColumnMetrics(
  mission: MissionId,
  perspective: Perspective,
  metrics: ReadonlyMap<HoloMetricId, HoloMetric>,
  max = COLUMN_ROWS,
): HoloMetricId[] {
  const spec = EINSATZ_COLUMNS[mission][perspective];
  const wanted: HoloMetricId[] = [];
  const push = (id: HoloMetricId): void => {
    if (!wanted.includes(id) && hasValue(metrics.get(id))) wanted.push(id);
  };
  push(spec.lead);
  for (const id of spec.then ?? []) push(id);
  const tools: HoloMetricId[] = perspective === 'offensive'
    ? (['miningTool', 'salvageTool'] as const).filter((t) => hasValue(metrics.get(t)) && !wanted.includes(t))
    : [];
  const room = Math.max(1, max - tools.length);
  for (const id of COLUMN_ORDER[perspective]) {
    if (wanted.length >= room) break;
    push(id);
  }
  return [...wanted.slice(0, room), ...tools];
}

export interface HoloColumnsInput {
  mission: MissionId;
  metrics: readonly HoloMetric[];
  /** Detail rows per column ("Alle Werte"): weapons, missiles, rates …, already resolved. */
  detail?: Partial<Record<Perspective, readonly HoloColumnGroup[]>>;
  /** Detail values the game data lacks, per column. */
  detailGaps?: Partial<Record<Perspective, readonly HoloColumnGap[]>>;
  /** The metric's number as the page prints it ("1.180", "11 Gm"). */
  fmt: (m: HoloMetric, value: number) => string;
  /** The translated words around a value ("statt {{was}}", "Gespeichert: {{v}}"). */
  wasText: (factory: string) => string;
  savedText: (value: string) => string;
}

/** The row of one metric with its comparison against Werk. */
export function metricRow(m: HoloMetric, input: Pick<HoloColumnsInput, 'fmt' | 'wasText' | 'savedText'>): HoloColumnRow {
  if (m.text != null && m.current == null) {
    const was = m.factoryText != null && m.factoryText !== m.text ? input.wasText(m.factoryText || '—') : null;
    return { key: m.id, labelKey: m.labelKey, value: m.text, was, cmp: null, deltaText: null, savedText: null };
  }
  const cmp = compareToWerk(m.current, m.factory, m.saved, holoLowerIsBetter(m.id));
  const deltaText = cmp?.delta != null ? (cmp.delta > 0 ? '+' : '−') + input.fmt(m, Math.abs(cmp.delta)) : null;
  const savedText = cmp?.savedAt != null && m.saved != null ? input.savedText(input.fmt(m, m.saved)) : null;
  return {
    key: m.id,
    labelKey: m.labelKey,
    value: m.current == null ? '—' : input.fmt(m, m.current),
    cmp,
    deltaText,
    savedText,
  };
}

/** The metrics whose absence counts as a gap for this Einsatz (ore only matters when mining). */
function gapRelevant(id: HoloMetricId, mission: MissionId): boolean {
  if (id === 'miningTool' || id === 'salvageTool') return false;
  if (id === 'ore') return mission === 'mining';
  return true;
}

/** The four columns, in the strip's order (`r1`: the column logic stays). */
export function buildHoloColumns(input: HoloColumnsInput): HoloColumnView[] {
  const byId = new Map(input.metrics.map((m) => [m.id, m] as const));
  return PERSPECTIVES.map((id) => {
    const spec = EINSATZ_COLUMNS[input.mission][id];
    const shown = selectColumnMetrics(input.mission, id, byId);
    const rows = shown.map((k) => metricRow(byId.get(k)!, input));
    const rest = input.metrics.filter((m) => holoMetricArea(m.id) === id && !shown.includes(m.id) && hasValue(m));
    const detail = input.detail?.[id] ?? [];
    const groups: HoloColumnGroup[] = [];
    for (const topic of COLUMN_TOPICS[id]) {
      const own = rest.filter((m) => holoMetricTopic(m.id) === topic).map((m) => metricRow(m, input));
      const extra = detail.filter((g) => g.topic === topic).flatMap((g) => g.rows);
      if (own.length + extra.length > 0) groups.push({ topic, rows: [...own, ...extra] });
    }
    const gaps: HoloColumnGap[] = [
      ...input.metrics
        .filter((m) => holoMetricArea(m.id) === id && !hasValue(m) && m.gapKey && gapRelevant(m.id, input.mission))
        .map((m) => ({ labelKey: m.labelKey, reasonKey: m.gapKey! })),
      ...(input.detailGaps?.[id] ?? []),
    ];
    return {
      id,
      titleKey: `codex.holo.stage.perspective.${id}`,
      focus: !!spec.focus,
      quiet: !!spec.quiet,
      rows,
      groups,
      gaps,
    };
  });
}

// ── grouping identical weapons (`r2-d-gruppe` = group) ─────────────────────

/** One gun on one port, as the layout lists it. */
export interface HoloGun {
  className: string;
  name: string;
  port: string;
  /** This gun's value (sustained DPS, else burst); null = no number. */
  value: number | null;
}

export interface HoloGunGroup {
  className: string;
  name: string;
  count: number;
  /** Σ of the guns' values; null when no gun of the group has one. */
  total: number | null;
  ports: readonly HoloGun[];
}

/** "8 × KLWE Laser Repeater S3": identical guns collapsed, values summed, ports kept. */
export function groupGuns(guns: readonly HoloGun[]): HoloGunGroup[] {
  const out = new Map<string, { className: string; name: string; ports: HoloGun[] }>();
  for (const g of guns) {
    const hit = out.get(g.className) ?? { className: g.className, name: g.name, ports: [] };
    hit.ports.push(g);
    out.set(g.className, hit);
  }
  return [...out.values()].map((g) => {
    const known = g.ports.filter((p) => p.value != null);
    return {
      className: g.className,
      name: g.name,
      count: g.ports.length,
      total: known.length > 0 ? known.reduce((s, p) => s + (p.value ?? 0), 0) : null,
      ports: g.ports,
    };
  });
}

// ── the Einsatz a ship opens on (`r2-d-default` = role) ────────────────────

/**
 * The Einsatz derived from the ship's class: a fighter opens on Kampf, a
 * freighter on Transport, a resource ship on what it carries. Classes
 * without one Einsatz of their own (multirole, support, exploration,
 * competition) open on "Alles", which the picker already names after the
 * class. An Einsatz the ship is not equipped for is never the default.
 */
export function defaultMissionForClass(cls: RankClassId, caps: ShipCapabilities): MissionId {
  let wanted: MissionId = 'all';
  if (cls === 'combat') wanted = 'combat';
  else if (cls === 'transport') wanted = 'transport';
  else if (cls === 'resources') wanted = caps.hasMining ? 'mining' : caps.hasSalvage ? 'salvage' : 'all';
  return missionDisabledReasonKey(wanted, caps) ? 'all' : wanted;
}
