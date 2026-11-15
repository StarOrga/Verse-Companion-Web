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

  it('widens for the X in its revealed state (hover / focus-within / open share one rule)', async () => {
    const fixture = mount();
    const host = fixture.nativeElement as HTMLElement;
    const cx = remove(host);
    const idle = host.getBoundingClientRect().width;
    // Hover and :focus-within cannot be driven reliably in a headless runner; the open state uses
    // the very same selector list, so it proves the revealed geometry deterministically.
    host.classList.add('open');
    for (let i = 0; i < 20 && cx.getBoundingClientRect().width <= 15; i++) await wait(50);
    expect(cx.getBoundingClientRect().width).toBeGreaterThan(15);
    expect(host.getBoundingClientRect().width).toBeGreaterThan(idle);
    host.remove();
  });
});
