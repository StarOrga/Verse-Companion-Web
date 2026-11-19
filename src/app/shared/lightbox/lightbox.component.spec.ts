import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { userEvent } from 'vitest/browser';
import { LightboxComponent } from './lightbox.component';

describe('LightboxComponent', () => {
  let fixture: ComponentFixture<LightboxComponent>;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LightboxComponent],
      providers: [provideRouter([]), provideTranslateService()],
    });
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(LightboxComponent);
    fixture.componentRef.setInput('image', {
      title: 'Idris', sourceUrl: '/o.jpg', previewUrl: '/p.jpg', articleUrl: 'https://example.com/a',
    });
    fixture.componentRef.setInput('prev', { commands: ['/verse/gallery', 'a'] });
    fixture.componentRef.setInput('next', { commands: ['/verse/gallery', 'c'] });
    fixture.detectChanges();
  });

  const press = (key: string): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    return ev;
  };

  it('ArrowRight / ArrowLeft navigate to the neighbours and replace the history entry', () => {
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    press('ArrowRight');
    expect(nav).toHaveBeenCalledWith(['/verse/gallery', 'c'], { replaceUrl: true });
    press('ArrowLeft');
    expect(nav).toHaveBeenCalledWith(['/verse/gallery', 'a'], { replaceUrl: true });
  });

  it('ignores arrows with a modifier and in text fields', () => {
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    input.remove();
    expect(nav).not.toHaveBeenCalled();
  });

  it('renders prev/next, download and RSI as real anchors', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('a.edge[href]').length).toBe(2);
    expect(el.querySelector('a.ab[download]')?.getAttribute('href')).toBe('/o.jpg');
    expect(el.querySelector('a.ab:not([download])')?.getAttribute('href')).toBe('https://example.com/a');
  });

  it('does not close on a click beside the picture (it has its own close button)', () => {
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    const scrim = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.root.overlay');
    expect(scrim).not.toBeNull();
    scrim!.click();
    expect(closed).toBe(0);
  });

  it('emits closed from the close button', () => {
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.lb-x')?.click();
    expect(closed).toBe(1);
  });

  // Batch note #2: in full screen the outermost right pixel column did not turn the page, the left edge did.
  // The document keeps its scrollbar gutter reserved (styles.scss: html { scrollbar-gutter: stable }), so the
  // fullscreen box ended a gutter short of the screen edge. Forced classic gutter here, real fullscreen, real edge.
  it('in full screen the rightmost pixel column is the "next" edge (no scrollbar gutter left over)', async () => {
    const gutter = document.createElement('style');
    gutter.textContent = 'html { scrollbar-gutter: stable; overflow-y: scroll; }';
    document.head.appendChild(gutter);
    try {
      // The test browser hides scrollbars (Playwright's --hide-scrollbars), so the gutter only exists on a
      // host with classic scrollbars; there the counterfactual below runs too.
      const classicGutter = document.documentElement.clientWidth < window.innerWidth;
      const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.tools button.ib')!;
      expect(btn).not.toBeNull();
      await userEvent.click(btn);
      await vi.waitFor(() => expect(document.fullscreenElement).not.toBeNull(), { timeout: 3000 });
      fixture.detectChanges();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const html = document.documentElement;
      const x = window.innerWidth - 1;
      const y = Math.round(window.innerHeight / 2);
      expect(html.style.getPropertyValue('scrollbar-gutter')).toBe('auto');
      expect(html.clientWidth).toBe(window.innerWidth);
      expect(document.elementFromPoint(x, y)?.closest('a.edge.r')).not.toBeNull();
      expect(document.elementFromPoint(0, y)?.closest('a.edge.l')).not.toBeNull();
      if (classicGutter) {
        // Root cause, shown: with the gutter reserved again the same column misses the edge.
        html.style.removeProperty('scrollbar-gutter');
        html.style.removeProperty('overflow');
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        expect(html.clientWidth).toBeLessThan(window.innerWidth);
        expect(document.elementFromPoint(x, y)?.closest('a.edge.r') ?? null).toBeNull();
        html.style.setProperty('scrollbar-gutter', 'auto');
        html.style.setProperty('overflow', 'hidden');
      }
      await document.exitFullscreen();
      await vi.waitFor(() => expect(html.style.getPropertyValue('scrollbar-gutter')).toBe(''));
      expect(html.style.getPropertyValue('overflow')).toBe('');
    } finally {
      gutter.remove();
    }
  });
});
