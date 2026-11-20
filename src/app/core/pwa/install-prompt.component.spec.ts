import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { InstallPromptComponent } from './install-prompt.component';
import { PwaInstallService } from './pwa-install.service';

describe('InstallPromptComponent', () => {
  const setup = () => {
    TestBed.configureTestingModule({ imports: [InstallPromptComponent], providers: [provideTranslateService()] });
    const pwa = TestBed.inject(PwaInstallService);
    const fixture = TestBed.createComponent(InstallPromptComponent);
    fixture.detectChanges();
    return { pwa, fixture, el: fixture.nativeElement as HTMLElement };
  };

  it('renders nothing until the service shows it, then one primary and one secondary action', () => {
    const { pwa, fixture, el } = setup();
    expect(el.querySelector('.card')).toBeNull();
    pwa.prompt.set({ trigger: 'success' });
    fixture.detectChanges();
    expect(el.querySelector('.card')).not.toBeNull();
    expect(el.querySelectorAll('button[scAction]').length).toBe(2);
    expect(el.querySelectorAll('button[tier="primary"], button.sc-action--primary').length).toBeLessThanOrEqual(1);
  });

  it('Install calls the service, Later records a dismissal', () => {
    const { pwa, fixture, el } = setup();
    const install = vi.spyOn(pwa, 'install').mockResolvedValue();
    const later = vi.spyOn(pwa, 'later').mockImplementation(() => undefined);
    pwa.prompt.set({ trigger: 'idle' });
    fixture.detectChanges();
    const [primary, secondary] = Array.from(el.querySelectorAll<HTMLButtonElement>('.actions button'));
    primary.click();
    secondary.click();
    expect(install).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('the iOS sheet shows three steps and its button closes it (= dismissal)', () => {
    const { pwa, fixture } = setup();
    const close = vi.spyOn(pwa, 'closeIosSheet');
    pwa.iosSheetOpen.set(true);
    fixture.detectChanges();
    expect(document.querySelectorAll('.steps li').length).toBe(3);
    (document.querySelector('sc-popup button[scAction]') as HTMLButtonElement).click();
    expect(close).toHaveBeenCalled();
  });
});
