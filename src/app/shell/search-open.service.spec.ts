import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SearchOpenService } from './search-open.service';

describe('SearchOpenService', () => {
  const service = () => TestBed.inject(SearchOpenService);

  it('opens nothing and says so while no search surface is mounted', () => {
    expect(service().available).toBe(false);
    expect(service().open()).toBe(false);
  });

  it('calls the newest registered surface only: the bar on a page with one, the palette without', () => {
    const s = service();
    const palette = vi.fn().mockName('palette');
    const bar = vi.fn().mockName('bar');
    s.register({}, palette);
    expect(s.open()).toBe(true);
    expect(palette).toHaveBeenCalledTimes(1);
    const off = s.register({}, bar);
    expect(s.open()).toBe(true);
    expect(bar).toHaveBeenCalledTimes(1);
    expect(palette).toHaveBeenCalledTimes(1);
    off();
    s.open();
    expect(palette).toHaveBeenCalledTimes(2);
  });

  it('openAfterRender waits for the next render, then opens', async () => {
    const s = service();
    const bar = vi.fn().mockName('bar');
    s.register({}, bar);
    s.openAfterRender();
    expect(bar).not.toHaveBeenCalled();
    TestBed.inject(ApplicationRef).tick();
    await vi.waitFor(() => expect(bar).toHaveBeenCalledTimes(1));
  });
});
