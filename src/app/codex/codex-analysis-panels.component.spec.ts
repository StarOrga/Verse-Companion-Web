import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import {
  CodexDefensivePanelComponent,
  CodexOffensivePanelComponent,
  CodexShipPanelComponent,
  ShipFactGroup,
} from './codex-analysis-panels.component';
import { formatNumber } from './codex-format';
import type { DefensivePanel, OffensivePanel } from './codex-loadout-stats';

const OFFENSIVE: OffensivePanel = {
  sources: [],
  weaponCount: 2,
  weaponRows: [
    { className: 'BEHR_LaserCannon_S3', size: 3, alpha: 120, sustainedDps: 400, burstDps: 500 },
    { className: 'KLWE_LaserRepeater_S2', size: 2, alpha: null, sustainedDps: null, burstDps: null },
  ],
  hasAlphaColumn: true,
  hasDpsColumn: true,
  footerAlpha: 120,
  footerDps: 1636.88,
  footerSustainedDps: null,
  damageChannelTotals: [{ channel: 'energy', value: 120 }],
  effectiveRange: 1800,
  longestRangeGun: null,
  mixedRangeWarning: false,
  projectileSpeed: 1200,
  missileCount: 0,
  missileRows: [],
  missileSalvoDamage: null,
  missileSalvoPartial: false,
  missileLockTime: null,
  missileLockNoteSlowest: false,
  missileRange: null,
  missileSignalTypes: [],
  gapKeys: [],
};

const DEFENSIVE: DefensivePanel = {
  shieldHp: 5000,
  shieldRegen: 40,
  fullInSeconds: null,
  regenDelay: null,
  downedDelay: null,
  shieldGeneratorCount: 1,
  mixedGeneratorNote: false,
  resistances: [{ channel: 'energy', pct: 25 }],
  armor: null,
  hullHp: null,
  effectiveHp: null,
  gapKeys: [],
};

function mount<T>(component: new () => T, inputs: Record<string, unknown>): ComponentFixture<T> {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [provideTranslateService({ fallbackLang: 'en' })],
  });
  const fixture = TestBed.createComponent(component);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  // The collapse effect writes after the first pass; render its result.
  fixture.detectChanges();
  return fixture;
}

const root = (f: ComponentFixture<unknown>): HTMLElement => f.nativeElement as HTMLElement;

/** What a click on the summary does: the details flips `open` and fires `toggle`. */
function setOpen(f: ComponentFixture<unknown>, open: boolean): void {
  const details = root(f).querySelector('details')!;
  details.open = open;
  details.dispatchEvent(new Event('toggle'));
  f.detectChanges();
}

describe('analysis panels', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('CodexOffensivePanelComponent', () => {
    it('open by default: the table shows every weapon and the peek is hidden', () => {
      const fixture = mount(CodexOffensivePanelComponent, { panel: OFFENSIVE });
      const el = root(fixture);
      expect(el.querySelector('details')!.open).toBe(true);
      expect(el.querySelectorAll('table.analysis-table tbody tr').length).toBe(2);
      expect(el.querySelector('.head-peek')).toBeNull();
    });

    it('startCollapsed folds it and shows the fold-peek with the totals, without the table', () => {
      const fixture = mount(CodexOffensivePanelComponent, { panel: OFFENSIVE, startCollapsed: true });
      const el = root(fixture);
      expect(el.querySelector('details')!.open).toBe(false);
      expect(el.querySelector('table')).toBeNull();
      const peek = el.querySelector('.head-peek')!.textContent!;
      expect(peek).toContain('codex.analysis.offensive.hintDps');
      expect(peek).toContain('codex.analysis.offensive.hintAlpha');
    });

    it('unfolding shows everything: table, damage bars, facts, and drops the peek', () => {
      const fixture = mount(CodexOffensivePanelComponent, { panel: OFFENSIVE, startCollapsed: true });
      setOpen(fixture, true);
      const el = root(fixture);
      expect(el.querySelector('.head-peek')).toBeNull();
      const rows = Array.from(el.querySelectorAll('table.analysis-table tbody tr'));
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('BEHR Laser Cannon');
      expect(rows[0].textContent).toContain('S3');
      expect(rows[1].textContent).toContain('—');
      expect(el.querySelector('tfoot')!.textContent).toContain(formatNumber(1636.88));
      expect(el.querySelectorAll('.dmg-bar-row').length).toBe(1);
      expect(el.querySelector('dl.fact-grid dd')!.textContent).toContain(`${formatNumber(1800)} m`);
    });

    // feedback #350: the missiles get their own table, apart from the gun totals
    it('lists every missile kind with its warhead and the salvo, apart from the gun table', () => {
      const fixture = mount(CodexOffensivePanelComponent, {
        panel: {
          ...OFFENSIVE,
          missileCount: 6,
          missileRows: [
            { className: 'MISL_S03_CS_FSKI_Tempest', size: 3, category: 'missile', signal: 'cs', count: 2, damage: 2500, totalDamage: 5000 },
            { className: 'MISL_S02_IR_NOVP_Rattler', size: 2, category: 'missile', signal: 'ir', count: 4, damage: 1370, totalDamage: 5480 },
          ],
          missileSalvoDamage: 10480,
          missileLockTime: 3,
          missileRange: 5000,
          missileLockNoteSlowest: true,
        },
      });
      const el = root(fixture);
      const tables = el.querySelectorAll('table.analysis-table:not(.src-table)');
      expect(tables.length).toBe(2);
      const rows = Array.from(tables[1].querySelectorAll('tbody tr'));
      expect(rows.length).toBe(2);
      expect(rows[1].textContent).toContain('S2');
      expect(rows[1].textContent).toContain('codex.missile.signal.ir');
      expect(rows[1].textContent).toContain('4×');
      expect(rows[1].textContent).toContain(formatNumber(5480));
      expect(tables[1].querySelector('tfoot')!.textContent).toContain(formatNumber(10480));
      // the gun total stays the guns' own figure
      expect(tables[0].querySelector('tfoot')!.textContent).not.toContain(formatNumber(10480));
      expect(el.textContent).toContain('codex.analysis.offensive.salvoNote');
    });

    it('lists missiles without warhead data by name and count, no damage columns', () => {
      const fixture = mount(CodexOffensivePanelComponent, {
        panel: {
          ...OFFENSIVE,
          missileCount: 4,
          missileRows: [{ className: 'MISL_S02_IR_NOVP_Rattler', size: 2, category: 'missile', signal: 'ir', count: 4, damage: null, totalDamage: null }],
        },
      });
      const el = root(fixture);
      const missiles = el.querySelectorAll('table.analysis-table:not(.src-table)')[1];
      expect(missiles.querySelectorAll('thead th').length).toBe(4);
      expect(missiles.querySelector('tfoot')).toBeNull();
      expect(el.textContent).toContain('codex.analysis.offensive.noWarheadData');
    });

    it('the folded peek names the missile salvo separately', () => {
      const fixture = mount(CodexOffensivePanelComponent, {
        panel: { ...OFFENSIVE, missileCount: 4, missileSalvoDamage: 5480 },
        startCollapsed: true,
      });
      expect(root(fixture).querySelector('.head-peek')!.textContent).toContain('codex.analysis.offensive.hintMissiles');
    });

    it('folding again brings the peek back', () => {
      const fixture = mount(CodexOffensivePanelComponent, { panel: OFFENSIVE });
      setOpen(fixture, false);
      expect(root(fixture).querySelector('.head-peek')).not.toBeNull();
      expect(root(fixture).querySelector('table')).toBeNull();
    });

    it('a mission change that asks for a fold re-folds an opened panel', () => {
      const fixture = mount(CodexOffensivePanelComponent, { panel: OFFENSIVE });
      expect(root(fixture).querySelector('details')!.open).toBe(true);
      fixture.componentRef.setInput('startCollapsed', true);
      fixture.detectChanges();
      fixture.detectChanges();
      expect(root(fixture).querySelector('details')!.open).toBe(false);
    });

    it('has no peek when nothing offensive is known, even when folded', () => {
      const fixture = mount(CodexOffensivePanelComponent, { panel: null, startCollapsed: true });
      expect(root(fixture).querySelector('.head-peek')).toBeNull();
    });

    it('says there are no stock guns instead of an empty table', () => {
      const fixture = mount(CodexOffensivePanelComponent, {
        panel: { ...OFFENSIVE, weaponRows: [], gapKeys: ['codex.summary.gap.noStockGuns'] },
      });
      expect(root(fixture).querySelector('.gap-row')!.textContent).toContain('codex.summary.gap.noStockGuns');
      expect(root(fixture).querySelector('table')).toBeNull();
    });
  });

  describe('CodexDefensivePanelComponent', () => {
    it('shows the shield facts and resistances when open', () => {
      const fixture = mount(CodexDefensivePanelComponent, { panel: DEFENSIVE });
      const el = root(fixture);
      expect(el.querySelector('dl.fact-grid dd')!.textContent).toBe(formatNumber(5000));
      expect(el.querySelector('.dmg-bar-row')!.textContent).toContain(`${formatNumber(25)} %`);
    });

    it('startCollapsed hides the body until unfolded', () => {
      const fixture = mount(CodexDefensivePanelComponent, { panel: DEFENSIVE, startCollapsed: true });
      expect(root(fixture).querySelector('h3.section-title')).toBeNull();
      setOpen(fixture, true);
      expect(root(fixture).querySelector('h3.section-title')).not.toBeNull();
    });

    it('wears the defensive area colour and symbol like its loadout blocks (#377)', () => {
      const fixture = mount(CodexDefensivePanelComponent, { panel: DEFENSIVE });
      const el = root(fixture);
      expect(el.querySelector('details')!.getAttribute('data-area')).toBe('defensive');
      expect(el.querySelector('.panel-head sc-area-symbol svg')).not.toBeNull();
    });

    it('a hull without shield generators says so', () => {
      const fixture = mount(CodexDefensivePanelComponent, { panel: { ...DEFENSIVE, shieldGeneratorCount: 0 } });
      expect(root(fixture).querySelector('.gap-row')!.textContent).toContain('codex.summary.gap.noShields');
    });
  });

  describe('CodexShipPanelComponent', () => {
    const GROUPS: ShipFactGroup[] = [
      {
        titleKey: 'codex.analysis.ship.flight',
        rows: [
          { labelKey: 'codex.ship.scm', value: '210 m/s' },
          { labelKey: 'codex.ship.boost', value: null, gapKey: 'codex.gap.noBoost' },
        ],
        note: 'Numbers are stock.',
      },
    ];

    it('renders group titles, rows, the gap dash with its reason, and the note', () => {
      const fixture = mount(CodexShipPanelComponent, { groups: GROUPS });
      const el = root(fixture);
      expect(el.querySelector('h3.section-title')!.textContent).toContain('codex.analysis.ship.flight');
      const dds = Array.from(el.querySelectorAll('dl.fact-grid dd'));
      expect(dds[0].textContent!.trim()).toBe('210 m/s');
      expect(dds[1].querySelector('.gap-dash')!.getAttribute('aria-label')).toBe('codex.gap.noBoost');
      expect(el.querySelector('p.note')!.textContent).toBe('Numbers are stock.');
    });

    it('a group carries the loadout area and symbol it belongs to (#377)', () => {
      const fixture = mount(CodexShipPanelComponent, {
        groups: [{ titleKey: 'codex.analysis.ship.signature', rows: [{ labelKey: 'codex.kpi.ir', value: '1' }] }],
      });
      const h3 = root(fixture).querySelector('h3.section-title')!;
      expect(h3.getAttribute('data-area')).toBe('signature');
      expect(h3.querySelector('sc-area-symbol svg')).not.toBeNull();
    });

    it('startCollapsed folds the body away', () => {
      const fixture = mount(CodexShipPanelComponent, { groups: GROUPS, startCollapsed: true });
      expect(root(fixture).querySelector('details')!.open).toBe(false);
      expect(root(fixture).querySelector('dl.fact-grid')).toBeNull();
    });
  });
});
