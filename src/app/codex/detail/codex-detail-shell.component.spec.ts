import { Component, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';

import { CodexDetailHeadComponent, attachPull, naturalTop, nextSlim } from './codex-detail-head.component';
import { CodexDetailShellComponent, CodexDetailTabsComponent } from './codex-detail-shell.component';
import { CodexDetailSlots, type DetailSlotSource, type DetailSlotState } from './codex-detail-slots';
import { SHIP_PANEL_TABS, detailProfileFor, detailTabs, type DetailTabData, type DetailTabId } from './codex-detail-profile';

const NONE: DetailTabData = { einordnung: false, werte: 1, bezug: 0, verbaut: 0, aenderungen: 0, richStage: false };

describe('detail profile (T1/T3/T4)', () => {
  it('keeps the fixed tab order and hides tabs without data', () => {
    expect(detailTabs({ ...NONE, einordnung: true, bezug: 2, verbaut: 3 }).map((t) => t.id)).toEqual(['einordnung', 'werte', 'bezug', 'verbaut']);
    expect(detailTabs(NONE).map((t) => t.id)).toEqual(['werte']);
  });

  it('gives a simple item (iron, water) the compact stage and no strip', () => {
    expect(detailProfileFor('item', NONE)).toEqual({ stage: 'compact', tabs: [{ id: 'werte', count: 0 }], strip: false });
  });

  it('gives a weapon with a comparison the item stage, and a ship the holotable with its strip', () => {
    expect(detailProfileFor('weapon', { ...NONE, einordnung: true }).stage).toBe('item');
    expect(detailProfileFor('ship', NONE)).toEqual({ stage: 'holo', tabs: [], shipTabs: SHIP_PANEL_TABS, strip: true });
  });
});

describe('Änderungen tab (oq-item-changes)', () => {
  it('shows with its count when the record has changes and is hidden without', () => {
    expect(detailTabs({ ...NONE, aenderungen: 3 }).find((t) => t.id === 'aenderungen')).toEqual({ id: 'aenderungen', count: 3 });
    expect(detailTabs(NONE).some((t) => t.id === 'aenderungen')).toBe(false);
  });
});

describe('head band attaches to the subheader (H1/H3)', () => {
  it('pulls itself up by the gap between its natural top and the capsule edge, stable once pulled', () => {
    expect(attachPull(174, 0, 84)).toBe(90);
    expect(attachPull(84, 90, 84)).toBe(90);
    expect(attachPull(60, 0, 84)).toBe(0);
  });

  it('measures the natural top on the parent, so an over-pull shrinks back instead of keeping itself (v0.282.0 overlap)', () => {
    const parent = document.createElement('div');
    parent.style.cssText = 'position: absolute; top: 120px; left: 0; width: 400px; height: 600px; display: flex; flex-direction: column; padding-top: 4px';
    const host = document.createElement('div');
    host.style.cssText = 'position: sticky; top: 84px; height: 75px; margin-top: -64px';
    parent.append(host, document.createElement('div'));
    document.body.append(parent);
    try {
      // The band's own rect is clamped to its stick line: from it, a 64 px pull looks right forever.
      expect(attachPull(host.getBoundingClientRect().top - window.scrollY, 64, 84)).toBe(64);
      const natural = naturalTop(host)! + window.scrollY;
      expect(natural).toBe(124);
      expect(attachPull(natural, 0, 84)).toBe(40);
      // Not the first child: no parent edge to measure against.
      parent.prepend(document.createElement('span'));
      expect(naturalTop(host)).toBeNull();
    } finally {
      parent.remove();
    }
  });

  it('measures through a display:contents wrapper (the ship head slotted into the shell) on the box it stands in', () => {
    const parent = document.createElement('div');
    parent.style.cssText = 'position: absolute; top: 120px; left: 0; width: 400px; height: 600px; display: flex; flex-direction: column; padding-top: 4px';
    const scope = document.createElement('div');
    scope.style.display = 'contents';
    const host = document.createElement('div');
    host.style.cssText = 'height: 75px';
    scope.append(host);
    parent.append(scope, document.createElement('div'));
    document.body.append(parent);
    try {
      expect(naturalTop(host)! + window.scrollY).toBe(124);
    } finally {
      parent.remove();
    }
  });
});

describe('detail tab pill fits its panel', () => {
  @Component({
    standalone: true,
    imports: [CodexDetailTabsComponent],
    template: `<div [style.width.px]="width()"><sc-codex-detail-tabs [tabs]="tabs" active="rank" /></div>`,
  })
  class Host {
    readonly width = signal(340);
    readonly tabs = [
      { id: 'rank', labelKey: 't.rank', icon: 'M3 3h18v18H3z', count: 0 },
      { id: 'parts', labelKey: 't.parts', icon: 'M3 3h18v18H3z', count: 0 },
      { id: 'changes', labelKey: 't.changes', icon: 'M3 3h18v18H3z', count: 3 },
    ];
  }

  for (const width of [340, 300, 460]) {
    it(`keeps every label inside its own tab at ${width} px (no overlap, no overflow)`, async () => {
      TestBed.configureTestingModule({ imports: [Host], providers: [provideTranslateService({ fallbackLang: 'de' })] });
      const t = TestBed.inject(TranslateService);
      t.setTranslation('de', { t: { rank: 'Einordnung', parts: 'Bauteile', changes: 'Änderungen' } });
      t.use('de');
      const f = TestBed.createComponent(Host);
      f.componentInstance.width.set(width);
      f.detectChanges();
      await f.whenStable();
      const el = f.nativeElement as HTMLElement;
      const list = el.querySelector<HTMLElement>('.dt-tabs')!;
      expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + 1);
      const labels = Array.from(el.querySelectorAll<HTMLElement>('.dt-label'));
      expect(labels.map((l) => l.textContent?.trim())).toEqual(['Einordnung', 'Bauteile', 'Änderungen']);
      // Each label stays inside its own tab: never into the next one, never past the pill.
      const tabs = Array.from(el.querySelectorAll<HTMLElement>('.dt-tab'));
      tabs.forEach((tab, i) => {
        expect(tab.scrollWidth).toBeLessThanOrEqual(tab.clientWidth + 1);
        const box = tab.getBoundingClientRect();
        const label = labels[i].getBoundingClientRect();
        expect(label.left).toBeGreaterThanOrEqual(box.left - 0.5);
        expect(label.right).toBeLessThanOrEqual(box.right + 0.5);
      });
      expect(tabs[2].getBoundingClientRect().right).toBeLessThanOrEqual(list.getBoundingClientRect().right + 0.5);
      TestBed.resetTestingModule();
    });
  }
});

describe('head band slim state (H2)', () => {
  it('turns slim only stuck and past the threshold, and back only near the top', () => {
    expect(nextSlim(false, 100, false)).toBe(false);
    expect(nextSlim(false, 20, true)).toBe(false);
    expect(nextSlim(false, 40, true)).toBe(true);
    expect(nextSlim(true, 20, true)).toBe(true);
    expect(nextSlim(true, 4, true)).toBe(false);
  });
});

@Component({
  standalone: true,
  imports: [CodexDetailShellComponent, CodexDetailHeadComponent],
  template: `
    <sc-codex-detail-shell [profile]="profile" [activeTab]="tab()" (tabChange)="tab.set($event)">
      <sc-codex-detail-head [name]="'P4-AR'" [kicker]="'Behring'"><b headOwn class="own">own</b></sc-codex-detail-head>
      <i shellStage class="stage"></i>
      <p class="pane">{{ tab() }}</p>
    </sc-codex-detail-shell>
  `,
})
class HostComponent {
  readonly profile = detailProfileFor('weapon', { ...NONE, einordnung: true, bezug: 1 });
  readonly tab = signal<DetailTabId>('einordnung');
}

describe('CodexDetailShellComponent', () => {
  it('renders the head band, the stage slot and a keyboard tablist', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideTranslateService({})] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('sc-codex-detail-head h1.ht-name')!.textContent!.trim()).toBe('P4-AR');
    expect(el.querySelector('sc-codex-detail-head .ht-right .own')).not.toBeNull();
    expect(el.querySelector('.sh-stage .stage')).not.toBeNull();
    const tabs = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.map((t) => t.id)).toEqual(['dt-tab-einordnung', 'dt-tab-werte', 'dt-tab-bezug']);
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.pane')!.textContent).toContain('werte');
    expect(el.querySelector('#dt-tab-werte')!.getAttribute('aria-selected')).toBe('true');
    // The panel is the shared detail panel (the holotable places the same component): frame, pill, tabpanel.
    const pane = el.querySelector('sc-codex-detail-panel.sh-panel #dt-pane[role="tabpanel"]');
    expect(pane).not.toBeNull();
    expect(pane!.getAttribute('aria-labelledby')).toBe('dt-tab-werte');
  });

  it('projects the ship holotable as a full-width stage without its own aside', async () => {
    @Component({
      standalone: true,
      imports: [CodexDetailShellComponent],
      template: `<sc-codex-detail-shell [profile]="profile" activeTab="einordnung"><i shellStage class="holo"></i><p class="pane">x</p></sc-codex-detail-shell>`,
    })
    class ShipHost {
      readonly profile = detailProfileFor('ship', NONE);
    }
    TestBed.configureTestingModule({ imports: [ShipHost], providers: [provideTranslateService({})] });
    const fixture = TestBed.createComponent(ShipHost);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('sc-codex-detail-shell')!.getAttribute('data-stage')).toBe('holo');
    expect(el.querySelector('.sh-stage .holo')).not.toBeNull();
    expect(el.querySelector('.sh-panel')).toBeNull();
    expect(el.querySelector('[role="tab"]')).toBeNull();
  });
  it('places the regions of a slotted stage in its own slots: head, table | panel with the ship tabs of the profile, views, below, strip', async () => {
    @Component({
      selector: 'sc-fake-holo-stage',
      standalone: true,
      template: `
        <div class="table">t</div>
        <ng-template #head><div class="r-head">h</div></ng-template>
        <ng-template #panelHead><div class="r-ph">ph</div></ng-template>
        <ng-template #panelBody><div class="r-body">b</div></ng-template>
        <ng-template #panelFoot><div class="r-foot">f</div></ng-template>
        <ng-template #views><div class="r-views">v</div></ng-template>
        <ng-template #below><div class="r-below">bl</div></ng-template>
        <ng-template #strip><div class="r-strip">s</div></ng-template>
      `,
    })
    class FakeStage implements DetailSlotSource {
      private readonly head = viewChild<TemplateRef<unknown>>('head');
      private readonly panelHead = viewChild<TemplateRef<unknown>>('panelHead');
      private readonly panelBody = viewChild<TemplateRef<unknown>>('panelBody');
      private readonly panelFoot = viewChild<TemplateRef<unknown>>('panelFoot');
      private readonly views = viewChild<TemplateRef<unknown>>('views');
      private readonly below = viewChild<TemplateRef<unknown>>('below');
      private readonly strip = viewChild<TemplateRef<unknown>>('strip');
      readonly slotTemplates = computed(() => {
        const [head, panelHead, panelBody, panelFoot, views, below, strip] = [this.head(), this.panelHead(), this.panelBody(), this.panelFoot(), this.views(), this.below(), this.strip()];
        return head && panelHead && panelBody && panelFoot && views && below && strip ? { head, panelHead, panelBody, panelFoot, views, below, strip } : null;
      });
      readonly slotState = signal<DetailSlotState>({ push: false, docking: false, reveal: false, dim: false, still: true, hideData: false });
      readonly panelTab = signal('rank');
      readonly panelTabCounts = signal<Record<string, number>>({ changes: 2 });
      readonly picked: string[] = [];
      constructor() { inject(CodexDetailSlots).source.set(this); }
      selectPanelTab(id: string): void { this.picked.push(id); this.panelTab.set(id); }
    }
    @Component({
      standalone: true,
      imports: [CodexDetailShellComponent, FakeStage],
      template: `<sc-codex-detail-shell [profile]="profile" activeTab="einordnung"><sc-fake-holo-stage shellStage /></sc-codex-detail-shell>`,
    })
    class SlottedHost {
      readonly profile = detailProfileFor('ship', NONE);
      readonly stage = viewChild.required(FakeStage);
    }
    TestBed.configureTestingModule({ imports: [SlottedHost], providers: [provideTranslateService({})] });
    const fixture = TestBed.createComponent(SlottedHost);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const shell = el.querySelector('sc-codex-detail-shell')!;
    expect(shell.hasAttribute('data-holo-root')).toBe(true);
    // Order: head, grid (table, panel, views), below, strip.
    const order = ['.r-head', '.sh-grid .table', '.sh-grid sc-codex-detail-panel.holo-panel', '.sh-grid .r-views', '.r-below', '.r-strip'].map((q) => shell.querySelector(q));
    expect(order.every(Boolean)).toBe(true);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shell.querySelector('.holo-panel [panelHead] .r-ph')).not.toBeNull();
    expect(shell.querySelector('.holo-panel #holo-tabpanel[role="tabpanel"] .r-body')).not.toBeNull();
    expect(shell.querySelector('.holo-panel .pfoot .r-foot')).not.toBeNull();
    expect([...shell.querySelectorAll('[role="tab"]')].map((t) => t.id)).toEqual(['holo-tab-rank', 'holo-tab-parts', 'holo-tab-changes']);
    expect(shell.querySelector('#holo-tab-changes small')?.textContent).toBe('2');
    (shell.querySelector('#holo-tab-parts') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.stage().picked).toEqual(['parts']);
    expect(shell.querySelector('#holo-tabpanel')!.getAttribute('aria-labelledby')).toBe('holo-tab-parts');
  });
});
