import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { WishEmptyComponent } from './wish-empty.component';
import { WISH_SKY_DOTS, WishSkyComponent } from './wish-sky.component';

describe('WishSkyComponent', () => {
  function mount(variant?: 'hero' | 'strip' | 'backdrop') {
    const fixture = TestBed.createComponent(WishSkyComponent);
    if (variant) fixture.componentRef.setInput('variant', variant);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('is decorative: aria-hidden, ten dots staggered 0.37 s apart, two streaks', () => {
    const { host } = mount();
    expect(host.getAttribute('aria-hidden')).toBe('true');
    const dots = Array.from(host.querySelectorAll<HTMLElement>('.dot'));
    expect(dots.length).toBe(10);
    expect(WISH_SKY_DOTS.length).toBe(10);
    expect(dots.map((d) => d.style.animationDelay)).toEqual(['0s', '0.37s', '0.74s', '1.11s', '1.48s', '1.85s', '2.22s', '2.59s', '2.96s', '3.33s']);
    expect(host.querySelectorAll('.shoot').length).toBe(2);
    expect(host.querySelectorAll('.shoot2').length).toBe(1);
  });

  it('is 136 px high as the picture of the empty state and 84 px as the strip', () => {
    expect(mount().host.getBoundingClientRect().height).toBe(136);
    TestBed.resetTestingModule();
    const strip = mount('strip');
    expect(strip.host.getAttribute('data-variant')).toBe('strip');
    expect(strip.host.getBoundingClientRect().height).toBe(84);
  });

  it('as the backdrop it fills its positioned host without a frame of its own (batch note #6)', () => {
    const { host } = mount('backdrop');
    const css = getComputedStyle(host);
    expect(css.position).toBe('absolute');
    expect(css.pointerEvents).toBe('none');
    expect(getComputedStyle(host.querySelector('.sky')!).borderTopWidth).toBe('0px');
  });

  it('moves with the concept timings: dots 3.2 s ease-in-out, streaks 5 s ease-in, the second 2.6 s late', () => {
    const { host } = mount();
    const dot = getComputedStyle(host.querySelector('.dot')!);
    expect(dot.animationDuration).toBe('3.2s');
    expect(dot.animationTimingFunction).toBe('ease-in-out');
    expect(dot.animationIterationCount).toBe('infinite');
    const [s1, s2] = Array.from(host.querySelectorAll('.shoot')).map((e) => getComputedStyle(e));
    expect(s1.animationDuration).toBe('5s');
    expect(s1.animationTimingFunction).toBe('ease-in');
    expect(s1.width).toBe('96px');
    expect(s2.width).toBe('64px');
    expect(s2.animationDelay).toBe('2.6s');
  });
});

describe('WishEmptyComponent', () => {
  it('shows sky, headline, text and one primary action with the search glyph; the action emits search', () => {
    TestBed.configureTestingModule({ providers: [provideTranslateService({})] });
    const fixture = TestBed.createComponent(WishEmptyComponent);
    const search = vi.fn();
    fixture.componentInstance.searchWish.subscribe(search);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('sc-wish-sky')).not.toBeNull();
    expect(el.querySelector('.we-t')!.textContent).toContain('cart.empty');
    expect(el.querySelector('.we-x')!.textContent).toContain('cart.emptyHint');
    const go = el.querySelector<HTMLButtonElement>('button.sc-action--primary')!;
    expect(el.querySelectorAll('.sc-action--primary').length).toBe(1);
    expect(go.firstElementChild!.tagName.toLowerCase()).toBe('svg');
    expect(go.querySelectorAll('svg path').length).toBe(2);
    expect(go.textContent).toContain('cart.emptyAction');
    go.click();
    expect(search).toHaveBeenCalledTimes(1);
  });
});
