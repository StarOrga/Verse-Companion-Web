import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ScSkeletonComponent } from './skeleton.component';

describe('ScSkeletonComponent', () => {
  let fixture: ComponentFixture<ScSkeletonComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ScSkeletonComponent], providers: [provideTranslateService()] });
    fixture = TestBed.createComponent(ScSkeletonComponent);
  });

  it('reserves the requested height per block and repeats it for lines', () => {
    fixture.componentRef.setInput('h', '112px');
    fixture.componentRef.setInput('lines', 4);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const blocks = el.querySelectorAll<HTMLElement>('.blk');
    expect(blocks.length).toBe(4);
    expect(Math.round(blocks[0].getBoundingClientRect().height)).toBe(112);
  });

  it('hides the blocks from assistive tech and exposes one loading status', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.getAttribute('role')).toBe('status');
    expect(el.querySelectorAll('.blk[aria-hidden="true"]').length).toBe(1);
    expect(el.querySelectorAll('.sc-sr-only').length).toBe(1);
  });
});
