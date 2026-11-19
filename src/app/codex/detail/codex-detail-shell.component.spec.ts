import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { CodexDetailHeadComponent, attachPull, nextSlim } from './codex-detail-head.component';
import { CodexDetailShellComponent } from './codex-detail-shell.component';
import { detailProfileFor, detailTabs, type DetailTabData, type DetailTabId } from './codex-detail-profile';

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
    expect(detailProfileFor('ship', NONE)).toEqual({ stage: 'holo', tabs: [], strip: true });
  });
});

describe('head band attaches to the subheader (H1/H3)', () => {
  it('pulls itself up by the gap between its natural top and the capsule edge, stable once pulled', () => {
    expect(attachPull(174, 0, 84)).toBe(90);
    expect(attachPull(84, 90, 84)).toBe(90);
    expect(attachPull(60, 0, 84)).toBe(0);
  });
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
  });
});
