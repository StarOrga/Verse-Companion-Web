import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StageGesturesDirective, clampPan, clampScale, pinchView } from './stage-gestures.directive';

@Component({
  standalone: true,
  imports: [StageGesturesDirective],
  template: `<div id="host" [scStageGestures]="on" [scStageGesturesStill]="true" style="width:400px;height:300px;position:fixed;top:0;left:0"><button id="pin" type="button">pin</button></div>`,
})
class HostComponent {
  on = true;
  readonly g = viewChild.required(StageGesturesDirective);
}

function ptr(el: Element, type: string, id: number, x: number, y: number, pointerType = 'touch'): void {
  el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType, bubbles: true, cancelable: true, isPrimary: id === 1 }));
}

describe('stage gestures', () => {
  function setup() {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    return { f, g: f.componentInstance.g(), host: f.nativeElement.querySelector('#host') as HTMLElement, pin: f.nativeElement.querySelector('#pin') as HTMLElement };
  }

  it('pure maths: scale clamps to 1..4, pan stays on the frame, identity below 1', () => {
    expect(clampScale(0.2)).toBe(1);
    expect(clampScale(9)).toBe(4);
    expect(clampPan({ x: 999, y: -999, s: 2 }, 400, 300)).toEqual({ s: 2, x: 300, y: -225 });
    expect(clampPan({ x: 50, y: 50, s: 1 }, 400, 300)).toEqual({ x: 0, y: 0, s: 1 });
    const v = pinchView({ x: 0, y: 0, s: 1 }, { x: 0, y: 0 }, 100, { x: 0, y: 0 }, 200);
    expect(v.s).toBe(2);
  });

  it('two fingers spreading zoom the stage', () => {
    const { host, g } = setup();
    ptr(host, 'pointerdown', 1, 150, 150);
    ptr(host, 'pointerdown', 2, 250, 150);
    ptr(host, 'pointermove', 1, 100, 150);
    ptr(host, 'pointermove', 2, 300, 150);
    expect(g.current().s).toBeCloseTo(2, 1);
    ptr(host, 'pointerup', 1, 100, 150);
    ptr(host, 'pointerup', 2, 300, 150);
  });

  it('one finger below the slop is a tap: nothing moves, the pin press stays a click', () => {
    const { host, pin, g } = setup();
    const clicked = vi.fn();
    pin.addEventListener('click', clicked);
    ptr(pin, 'pointerdown', 1, 50, 50);
    ptr(pin, 'pointermove', 1, 53, 52);
    ptr(pin, 'pointerup', 1, 53, 52);
    pin.click();
    expect(g.current().s).toBe(1);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(host.classList).not.toContain('gesturing');
  });

  it('a drag that started on a pin does not press it on release', () => {
    const { pin } = setup();
    const clicked = vi.fn();
    pin.addEventListener('click', clicked);
    ptr(pin, 'pointerdown', 1, 50, 50);
    ptr(pin, 'pointermove', 1, 90, 50);
    ptr(pin, 'pointerup', 1, 90, 50);
    pin.click();
    expect(clicked).not.toHaveBeenCalled();
  });

  it('a double tap on empty stage resets a zoomed view', () => {
    const { host, g } = setup();
    ptr(host, 'pointerdown', 1, 150, 150);
    ptr(host, 'pointerdown', 2, 250, 150);
    ptr(host, 'pointermove', 2, 330, 150);
    ptr(host, 'pointerup', 1, 150, 150);
    ptr(host, 'pointerup', 2, 330, 150);
    expect(g.current().s).toBeGreaterThan(1.2);
    for (let i = 0; i < 2; i++) { ptr(host, 'pointerdown', 1, 200, 200); ptr(host, 'pointerup', 1, 200, 200); }
    expect(g.current()).toEqual({ x: 0, y: 0, s: 1 });
  });

  it('ignores the mouse (desktop keeps its parallax)', () => {
    const { host, g } = setup();
    ptr(host, 'pointerdown', 1, 150, 150, 'mouse');
    ptr(host, 'pointerdown', 2, 250, 150, 'mouse');
    ptr(host, 'pointermove', 2, 380, 150, 'mouse');
    expect(g.current().s).toBe(1);
  });
});
