import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ScQtyStepperComponent } from './qty-stepper.component';

@Component({
  standalone: true,
  imports: [ScQtyStepperComponent],
  template: `
    <sc-qty-stepper id="plain" [value]="n()" [max]="3" groupLabel="Menge" lessLabel="Weniger" moreLabel="Mehr"
                    (valueChange)="n.set($event)" />
    <sc-qty-stepper id="custom" [value]="2" [min]="0" lessLabel="L" moreLabel="M"><span class="own">2 / 5</span></sc-qty-stepper>
  `,
})
class HostComponent {
  readonly n = signal(1);
}

describe('ScQtyStepperComponent', () => {
  function mount() {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const plain = el.querySelector<HTMLElement>('#plain')!;
    const [less, more] = Array.from(plain.querySelectorAll<HTMLButtonElement>('button'));
    return { f, el, plain, less, more };
  }

  it('is a labelled group with two labelled buttons', () => {
    const { plain, less, more } = mount();
    expect(plain.getAttribute('role')).toBe('group');
    expect(plain.getAttribute('aria-label')).toBe('Menge');
    expect(less.getAttribute('aria-label')).toBe('Weniger');
    expect(more.getAttribute('aria-label')).toBe('Mehr');
  });

  it('steps within [min, max] and disables the button at each bound', () => {
    const { f, plain, less, more } = mount();
    expect(less.disabled).toBe(true);
    more.click();
    f.detectChanges();
    expect(plain.querySelector('.qs-val')?.textContent?.trim()).toBe('2');
    more.click();
    f.detectChanges();
    expect(f.componentInstance.n()).toBe(3);
    expect(more.disabled).toBe(true);
    less.click();
    f.detectChanges();
    expect(f.componentInstance.n()).toBe(2);
    expect(less.disabled).toBe(false);
  });

  it('shows projected content instead of the bare value', () => {
    const { el } = mount();
    expect(el.querySelector('#custom .qs-val .own')?.textContent).toBe('2 / 5');
  });
});
