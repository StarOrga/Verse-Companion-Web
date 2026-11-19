import { Component, signal } from '@angular/core';
import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { RouteLoadRecoveryService } from '../../core/route-load-recovery.service';
import { DeferErrorComponent } from './defer-error.component';

@Component({ selector: 'sc-probe-viewer', standalone: true, template: '<p class="viewer">viewer</p>' })
class ProbeViewerComponent {}

@Component({
  standalone: true,
  imports: [ProbeViewerComponent, DeferErrorComponent],
  template: `
    @defer (on immediate) {
      <sc-probe-viewer />
    } @placeholder {
      <div class="ph"></div>
    } @error {
      <sc-defer-error source="probe" [quiet]="quiet()" (failed)="failures = failures + 1" />
    }
  `,
})
class HostComponent {
  readonly quiet = signal(false);
  failures = 0;
}

/**
 * #367: a `@defer` block whose chunk did not load renders its `@error` branch —
 * the shared hint with a reload action — and hands the failure to the
 * one-shot stale-chunk recovery, instead of NG0750 and a placeholder forever.
 */
describe('DeferErrorComponent', () => {
  let recover: ReturnType<typeof vi.fn>;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    recover = vi.fn().mockReturnValue('hint');
    reload = vi.fn();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService(), { provide: RouteLoadRecoveryService, useValue: { recoverFromStaleChunk: recover, reload } }],
      deferBlockBehavior: DeferBlockBehavior.Manual,
    });
  });

  async function renderError(quiet: boolean) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.quiet.set(quiet);
    fixture.detectChanges();
    const [block] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Error);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders the hint with a reload action in the @error branch', async () => {
    const fixture = await renderError(false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.viewer')).toBeNull();
    expect(el.querySelector('sc-defer-error .msg')?.textContent).toContain('common.deferError.message');
    const button = el.querySelector<HTMLButtonElement>('sc-defer-error button');
    expect(button).not.toBeNull();
    button!.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('hands the failure to the recovery once and tells the host', async () => {
    const fixture = await renderError(false);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.failures).toBe(1);
  });

  it('quiet renders nothing visible but still recovers', async () => {
    const fixture = await renderError(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('sc-defer-error .msg')).toBeNull();
    expect(el.querySelector('sc-defer-error button')).toBeNull();
    expect(recover).toHaveBeenCalledTimes(1);
  });
});
