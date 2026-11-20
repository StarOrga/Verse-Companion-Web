import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { ViewportModeService } from '../../core/viewport-mode';
import { FabDialComponent } from './fab-dial.component';
import { PageCornerService } from './page-corner.service';

/** The Tools dial is drawn per viewport mode: phone, compact landscape and coarse tablet; never on a desktop. */
describe('FabDialComponent viewport modes', () => {
  function setup(mode: { phone?: boolean; compact?: boolean; tablet?: boolean }) {
    const viewport = { phone: signal(!!mode.phone), compact: signal(!!mode.compact), tablet: signal(!!mode.tablet), barOff: signal(false) };
    TestBed.configureTestingModule({
      imports: [FabDialComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ViewportModeService, useValue: viewport },
        { provide: RoleService, useValue: { isCollaborator: () => false, isAdmin: () => false } },
      ],
    });
    TestBed.inject(PageCornerService).register('share', { labelKey: 'share.label', icon: 'M1 1', run: () => undefined });
    const fixture = TestBed.createComponent(FabDialComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('is drawn on a phone, on a phone on its side and on a coarse tablet', () => {
    for (const mode of [{ phone: true }, { compact: true }, { tablet: true }]) {
      TestBed.resetTestingModule();
      expect(setup(mode).querySelector('.dial .main'), JSON.stringify(mode)).not.toBeNull();
    }
  });

  it('is not drawn on a desktop (fine pointer, wide window)', () => {
    expect(setup({}).querySelector('.dial')).toBeNull();
  });
});

describe('ViewportModeService bar-off', () => {
  afterEach(() => document.documentElement.removeAttribute('data-sc-bar-off'));

  it('stays false off a portrait phone, whatever a page sets (desktop keeps its bar)', async () => {
    document.documentElement.setAttribute('data-sc-bar-off', '');
    const svc = TestBed.inject(ViewportModeService);
    await new Promise((r) => setTimeout(r));
    expect(svc.barOff()).toBe(svc.phone() && !svc.compact());
  });
});
