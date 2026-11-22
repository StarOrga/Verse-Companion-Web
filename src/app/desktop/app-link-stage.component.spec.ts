import { TestBed } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { AppLinkStageComponent } from './app-link-stage.component';
import de from '../../../public/i18n/de.json';

/**
 * The link visual is symmetric: the badge sits on the midpoint between the two
 * orbs and the streak burst starts from that same point, whatever the labels'
 * widths ("VC Web" vs "Data Uploader").
 */
describe('AppLinkStageComponent geometry', () => {
  function centre(el: Element): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  async function render(app: 'uploader' | 'starscape') {
    TestBed.configureTestingModule({ imports: [AppLinkStageComponent], providers: [provideTranslateService()] });
    const tr = TestBed.inject(TranslateService);
    tr.setTranslation('de', de);
    tr.use('de');
    const fixture = TestBed.createComponent(AppLinkStageComponent);
    fixture.componentRef.setInput('app', app);
    fixture.componentRef.setInput('phase', 'done');
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  for (const app of ['uploader', 'starscape'] as const) {
    it(`centres badge and burst between the orbs (${app})`, async () => {
      const host = await render(app);
      const web = centre(host.querySelector('.node.web sc-app-logo')!);
      const mark = centre(host.querySelector('.node.app .mark')!);
      const badge = centre(host.querySelector('.badge')!);
      const burst = host.querySelector('sc-quantum-streaks')!.getBoundingClientRect();

      expect(Math.abs(web.y - mark.y)).toBeLessThan(1);
      expect(Math.abs(badge.x - (web.x + mark.x) / 2)).toBeLessThan(1);
      expect(Math.abs(badge.y - web.y)).toBeLessThan(1);
      expect(Math.abs(burst.left - badge.x)).toBeLessThan(1);
      expect(Math.abs(burst.top - badge.y)).toBeLessThan(1);
      host.remove();
    });
  }
});
