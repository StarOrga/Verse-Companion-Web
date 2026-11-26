import {
  COLUMN_ROWS,
  EINSATZ_COLUMNS,
  HoloMetric,
  HoloMetricId,
  buildHoloColumns,
  compareToWerk,
  defaultMissionForClass,
  groupGuns,
  holoLowerIsBetter,
  metricRow,
  selectColumnMetrics,
} from './codex-holo-columns';

function m(id: HoloMetricId, current: number | null, factory: number | null = current, saved: number | null = null, extra: Partial<HoloMetric> = {}): HoloMetric {
  return { id, labelKey: `codex.kpi.short.${id}`, current, factory, saved, gapKey: current == null ? `gap.${id}` : null, ...extra };
}

const FMT = {
  fmt: (_m: HoloMetric, v: number) => String(Math.round(v * 10) / 10),
  wasText: (f: string) => `statt ${f}`,
  savedText: (v: string) => `Gespeichert: ${v}`,
};

/** A Gladius-like fighter: every number, no tool. */
const FIGHTER: HoloMetric[] = [
  m('sustainedDps', 1180), m('burstDps', 1640), m('alpha', 412), m('missiles', 15600),
  m('shieldHp', 4320), m('shieldRegen', 216), m('hullHp', 3950), m('armorHp', 1850), m('effectiveHp', 8270),
  m('scm', 236), m('agility', 14.2), m('boost', 1140), m('maxSpeed', 1240), m('quantumRange', 1.9e9), m('quantumSpeed', 166000), m('spool', 4.5), m('mass', 50020), m('cargo', null),
  m('ir', 6400), m('emLoad', 11200), m('crossSection', 9800), m('coolingLoad', 61), m('emIdle', 4800),
];
const byId = (list: readonly HoloMetric[]) => new Map(list.map((x) => [x.id, x] as const));

describe('codex-holo-columns · Leitwert table', () => {
  it('leads every column per Einsatz as r2-d-leitwert says', () => {
    expect(EINSATZ_COLUMNS.combat.offensive).toEqual({ lead: 'sustainedDps', focus: true });
    expect(EINSATZ_COLUMNS.transport.movement).toEqual({ lead: 'cargo', then: ['quantumRange'], focus: true });
    expect(EINSATZ_COLUMNS.travel.movement).toEqual({ lead: 'quantumRange', then: ['cargo'], focus: true });
    expect(EINSATZ_COLUMNS.stealth.signature).toEqual({ lead: 'ir', then: ['emLoad'], focus: true });
    expect(EINSATZ_COLUMNS.mining.offensive.lead).toBe('miningTool');
    expect(EINSATZ_COLUMNS.salvage.offensive.lead).toBe('salvageTool');
    expect(EINSATZ_COLUMNS.transport.offensive.quiet).toBe(true);
    expect(EINSATZ_COLUMNS.salvage.signature.quiet).toBe(true);
  });

  it('"Alles" is the neutral lead for every ship: Dauer-DPS · Schild HP · SCM · IR, nothing focused or quiet', () => {
    const leads = Object.values(EINSATZ_COLUMNS.all).map((s) => s.lead);
    expect(leads).toEqual(['sustainedDps', 'shieldHp', 'scm', 'ir']);
    expect(Object.values(EINSATZ_COLUMNS.all).some((s) => s.focus || s.quiet)).toBe(false);
  });

  it('cargo leads Bewegung on Transport and Reisen, SCM again on Kampf', () => {
    const hauler = byId([...FIGHTER.filter((x) => x.id !== 'cargo'), m('cargo', 696)]);
    expect(selectColumnMetrics('transport', 'movement', hauler)).toEqual(['cargo', 'quantumRange', 'scm', 'agility']);
    expect(selectColumnMetrics('travel', 'movement', hauler).slice(0, 2)).toEqual(['quantumRange', 'cargo']);
    expect(selectColumnMetrics('combat', 'movement', hauler)[0]).toBe('scm');
  });

  it('shows four rows and hides a missing value instead of a dash row', () => {
    const list = byId(FIGHTER);
    expect(selectColumnMetrics('combat', 'offensive', list)).toEqual(['sustainedDps', 'burstDps', 'alpha', 'missiles']);
    const noSustained = byId(FIGHTER.map((x) => (x.id === 'sustainedDps' ? m('sustainedDps', null) : x)));
    const rows = selectColumnMetrics('combat', 'offensive', noSustained);
    expect(rows).not.toContain('sustainedDps');
    expect(rows[0]).toBe('burstDps');
    expect(rows.length).toBeLessThanOrEqual(COLUMN_ROWS);
  });

  it('puts the mining laser into Offensive: leading on Bergbau, under the guns otherwise', () => {
    const tool = m('miningTool', null, null, null, { text: '1 × Arbor MH1', gapKey: null });
    const both = byId([...FIGHTER, tool]);
    expect(selectColumnMetrics('mining', 'offensive', both)[0]).toBe('miningTool');
    const combat = selectColumnMetrics('combat', 'offensive', both);
    expect(combat).toEqual(['sustainedDps', 'burstDps', 'alpha', 'miningTool']);
    const unarmed = byId([tool]);
    expect(selectColumnMetrics('combat', 'offensive', unarmed)).toEqual(['miningTool']);
  });
});

describe('codex-holo-columns · comparison against Werk', () => {
  it('a row equal to Werk without a differing saved value shows only the value', () => {
    expect(compareToWerk(1180, 1180, null, false)).toBeNull();
    expect(compareToWerk(1180, 1180, 1180, false)).toBeNull();
    expect(compareToWerk(null, 1180, null, false)).toBeNull();
    expect(compareToWerk(1180, null, null, false)).toBeNull();
  });

  it('grows right when better and left when worse, per metric direction', () => {
    const dps = compareToWerk(1310, 1180, null, holoLowerIsBetter('sustainedDps'))!;
    expect(dps.tone).toBe('up');
    expect(dps.delta).toBe(130);
    expect(dps.fill).toBeGreaterThan(0);
    expect(dps.fill).toBeLessThanOrEqual(50);
    const ir = compareToWerk(7100, 6400, null, holoLowerIsBetter('ir'))!;
    expect(ir.tone).toBe('down');
    expect(ir.delta).toBe(700);
    expect(holoLowerIsBetter('coolingLoad')).toBe(true);
    expect(holoLowerIsBetter('mass')).toBe(true);
    expect(holoLowerIsBetter('crossSection')).toBe(true);
    expect(compareToWerk(9000, 10000, null, true)!.tone).toBe('up');
  });

  it('caps the fill at half the track', () => {
    expect(compareToWerk(5000, 1000, null, false)!.fill).toBe(50);
    expect(compareToWerk(1, 0, null, false)!.fill).toBe(50);
  });

  it('marks the saved value as a tick on the same bar, also on an unchanged row', () => {
    const c = compareToWerk(1310, 1180, 1250, false)!;
    expect(c.savedAt).toBeGreaterThan(50);
    expect(c.savedAt).toBeLessThan(50 + c.fill);
    const back = compareToWerk(1180, 1180, 1250, false)!;
    expect(back.tone).toBeNull();
    expect(back.fill).toBe(0);
    expect(back.delta).toBeNull();
    expect(back.savedAt).toBeGreaterThan(50);
    expect(compareToWerk(1310, 1180, 1180, false)!.savedAt).toBeNull();
  });

  it('metricRow prints the raw sign of the delta and names the saved value', () => {
    const row = metricRow(m('ir', 7100, 6400, 6800), FMT);
    expect(row.deltaText).toBe('+700');
    expect(row.cmp!.tone).toBe('down');
    expect(row.savedText).toBe('Gespeichert: 6800');
    expect(metricRow(m('shieldRegen', 470, 540), FMT).deltaText).toBe('−70');
    expect(metricRow(m('scm', 236), FMT).cmp).toBeNull();
  });

  it('a name row (tool) says what it replaced instead of a bar', () => {
    const row = metricRow(m('miningTool', null, null, null, { text: '1 × Helix I', factoryText: '1 × Arbor MH1', gapKey: null }), FMT);
    expect(row.value).toBe('1 × Helix I');
    expect(row.was).toBe('statt 1 × Arbor MH1');
    expect(row.cmp).toBeNull();
  });
});

describe('codex-holo-columns · buildHoloColumns', () => {
  it('builds the four columns in the strip order with focus and quiet from the Einsatz', () => {
    const cols = buildHoloColumns({ mission: 'transport', metrics: [...FIGHTER.filter((x) => x.id !== 'cargo'), m('cargo', 696)], ...FMT });
    expect(cols.map((c) => c.id)).toEqual(['offensive', 'defensive', 'movement', 'signature']);
    expect(cols.map((c) => [c.focus, c.quiet])).toEqual([[false, true], [true, false], [true, false], [false, true]]);
    expect(cols[1].rows[0].key).toBe('hullHp');
    expect(cols[3].rows[0].key).toBe('crossSection');
  });

  it('"Alle Werte" continues the list grouped by topic, without the rows already shown', () => {
    const cols = buildHoloColumns({
      mission: 'combat',
      metrics: FIGHTER,
      detail: { offensive: [{ topic: 'weapons', rows: [{ key: 'w1', labelKey: null, label: '2 × CF-337', value: '640', cmp: null, deltaText: null, savedText: null }] }] },
      ...FMT,
    });
    const movement = cols[2];
    expect(movement.rows.map((r) => r.key)).toEqual(['scm', 'agility', 'boost', 'maxSpeed']);
    expect(movement.groups.map((g) => g.topic)).toEqual(['quantum', 'mass']);
    expect(movement.groups.flatMap((g) => g.rows.map((r) => r.key))).toEqual(['quantumRange', 'quantumSpeed', 'spool', 'mass']);
    expect(cols[0].groups[0]).toEqual(expect.objectContaining({ topic: 'weapons' }));
    expect(cols[0].groups[0].rows[0].label).toBe('2 × CF-337');
  });

  it('counts missing values per column with their reason; a tool the ship lacks is no gap', () => {
    const cols = buildHoloColumns({
      mission: 'combat',
      metrics: [...FIGHTER, m('miningTool', null, null, null, { gapKey: null })],
      detailGaps: { defensive: [{ labelKey: 'codex.analysis.defensive.regenDelay', reasonKey: 'gap.shield' }] },
      ...FMT,
    });
    expect(cols[2].gaps).toEqual([{ labelKey: 'codex.kpi.short.cargo', reasonKey: 'gap.cargo' }]);
    expect(cols[0].gaps).toEqual([]);
    expect(cols[1].gaps.length).toBe(1);
  });

  it('ore is a gap only on Bergbau', () => {
    const metrics = [...FIGHTER, m('ore', null, null, null, { gapKey: 'gap.ore' })];
    expect(buildHoloColumns({ mission: 'combat', metrics, ...FMT })[2].gaps.map((g) => g.reasonKey)).toEqual(['gap.cargo']);
    expect(buildHoloColumns({ mission: 'mining', metrics, ...FMT })[2].gaps.map((g) => g.reasonKey)).toContain('gap.ore');
  });
});

describe('codex-holo-columns · weapon groups and the default Einsatz', () => {
  it('collapses identical guns with summed values and keeps every port', () => {
    const groups = groupGuns([
      { className: 'KLWE_S3', name: 'KLWE Laser Repeater S3', port: 'Wing L', value: 200 },
      { className: 'KLWE_S3', name: 'KLWE Laser Repeater S3', port: 'Wing R', value: 200 },
      { className: 'ATT_3', name: 'Attrition-3', port: 'Nose', value: null },
    ]);
    expect(groups.map((g) => [g.name, g.count, g.total])).toEqual([['KLWE Laser Repeater S3', 2, 400], ['Attrition-3', 1, null]]);
    expect(groups[0].ports.map((p) => p.port)).toEqual(['Wing L', 'Wing R']);
  });

  it('opens on the Einsatz of the ship class, never on one the ship is not equipped for', () => {
    const none = { hasCargo: false, hasQuantum: true, hasMining: false, hasSalvage: false };
    expect(defaultMissionForClass('combat', none)).toBe('combat');
    expect(defaultMissionForClass('transport', { ...none, hasCargo: true })).toBe('transport');
    expect(defaultMissionForClass('transport', none)).toBe('all');
    expect(defaultMissionForClass('resources', { ...none, hasMining: true })).toBe('mining');
    expect(defaultMissionForClass('resources', { ...none, hasSalvage: true })).toBe('salvage');
    expect(defaultMissionForClass('multirole', none)).toBe('all');
    expect(defaultMissionForClass('exploration', none)).toBe('all');
  });
});
