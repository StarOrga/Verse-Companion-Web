import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { FusionSearchChipComponent } from './fusion-search-chip.component';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('FusionSearchChipComponent — X takes room only on hover / focus', () => {
  function mount() {
    TestBed.configureTestingModule({ imports: [FusionSearchChipComponent], providers: [provideTranslateService({})] });
    const fixture = TestBed.createComponent(FusionSearchChipComponent);
    fixture.componentRef.setInput('chip', { id: 'route:x', source: 'route', filter: {}, switchable: false });
    fixture.componentRef.setInput('label', 'Anvil Liberator');
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  }
  const remove = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button.cx')!;

  it('keeps the X a real button with an aria-label and collapses it while idle', () => {
    const fixture = mount();
    const cx = remove(fixture.nativeElement);
    expect(cx.tagName).toBe('BUTTON');
    expect(cx.getAttribute('aria-label')).toBeTruthy();
    expect(cx.getBoundingClientRect().width).toBe(0);
    fixture.nativeElement.remove();
  });

  it('widens for the X once the chip holds focus', async () => {
    const fixture = mount();
    const cx = remove(fixture.nativeElement);
    const idle = (fixture.nativeElement as HTMLElement).getBoundingClientRect().width;
    cx.focus();
    await wait(400);
    expect(cx.getBoundingClientRect().width).toBeGreaterThan(15);
    expect((fixture.nativeElement as HTMLElement).getBoundingClientRect().width).toBeGreaterThan(idle);
    fixture.nativeElement.remove();
  });
});
