import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { PATH_ICONS } from '../item-path/path-icons';
import { UndoToastComponent } from './undo-toast.component';
import { UndoToastService } from './undo-toast.service';

describe('UndoToastComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideTranslateService({})] }));

  it('renders only while an offer is pending and its button undoes it', () => {
    const svc = TestBed.inject(UndoToastService);
    const commit = vi.fn().mockName('commit');
    const onUndo = vi.fn().mockName('onUndo');
    const f = TestBed.createComponent(UndoToastComponent);
    f.detectChanges();
    expect(f.nativeElement.querySelector('.toast')).toBeNull();

    svc.offer({ messageKey: 'starmap.guess.undoToast', messageParams: { name: 'Gladius' }, commit, onUndo });
    f.detectChanges();
    const toast = f.nativeElement.querySelector('.toast') as HTMLElement;
    expect(toast.querySelector('.scp-frame')!.getAttribute('role')).toBe('status');
    expect(toast.textContent).toContain('starmap.guess.undoToast');
    const btn = toast.querySelector('button.undo') as HTMLButtonElement;
    expect(btn.textContent).toContain('common.undo');

    btn.click();
    f.detectChanges();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('.toast')).toBeNull();
  });

  it('hover holds the window', () => {
    const svc = TestBed.inject(UndoToastService);
    const f = TestBed.createComponent(UndoToastComponent);
    svc.offer({ messageKey: 'k', commit: () => undefined, onUndo: () => undefined });
    f.detectChanges();
    const toast = f.nativeElement.querySelector('.toast') as HTMLElement;
    toast.dispatchEvent(new MouseEvent('mouseenter'));
    f.detectChanges();
    expect(svc.held()).toBe(true);
    expect(toast.classList).toContain('paused');
    toast.dispatchEvent(new MouseEvent('mouseleave'));
    expect(svc.held()).toBe(false);
    svc.undo();
  });

  it('an ordinary toast stays one line with the undo arrow', () => {
    const svc = TestBed.inject(UndoToastService);
    const f = TestBed.createComponent(UndoToastComponent);
    svc.offer({ messageKey: 'itemPath.done.wishOn', messageParams: { name: 'Polaris' }, commit: () => undefined, onUndo: () => undefined });
    f.detectChanges();
    const toast = f.nativeElement.querySelector('.toast') as HTMLElement;
    expect(toast.querySelector('.msg-detail')).toBeNull();
    expect(toast.querySelector('svg.wish-fall')).toBeNull();
    expect(toast.querySelectorAll('.scp-sym svg path').length).toBe(2);
    svc.undo();
  });

  it('a fulfilled wish shows two lines and the shooting star in the rail', () => {
    const svc = TestBed.inject(UndoToastService);
    const f = TestBed.createComponent(UndoToastComponent);
    svc.offer({ messageKey: 'itemPath.done.ownWish', messageParams: { name: 'Polaris' }, commit: () => undefined, onUndo: () => undefined });
    f.detectChanges();
    const toast = f.nativeElement.querySelector('.toast') as HTMLElement;
    expect(toast.querySelector('.msg')!.firstChild!.textContent).toContain('itemPath.done.ownWish');
    expect(toast.querySelector('.msg-detail')!.textContent).toContain('itemPath.done.ownWishDetail');
    const star = toast.querySelector('svg.wish-fall')!;
    expect(star.querySelectorAll('path').length).toBe(PATH_ICONS.wish.length);
    expect(star.closest('.scp-sym')).not.toBeNull();
    svc.undo();
  });

  it('a fulfilled wish with more still wished keeps the remaining count in its second line', () => {
    const svc = TestBed.inject(UndoToastService);
    svc.offer({ messageKey: 'itemPath.done.ownWishLeft', messageParams: { name: 'Polaris', left: 2 }, commit: () => undefined, onUndo: () => undefined });
    expect(svc.current()?.detailKey).toBe('itemPath.done.ownWishLeftDetail');
    expect(svc.current()?.detailParams).toEqual({ name: 'Polaris', left: 2 });
    expect(svc.current()?.icon).toBe('wish');
    svc.offer({ messageKey: 'itemPath.done.hangar', commit: () => undefined, onUndo: () => undefined });
    expect(svc.current()?.detailKey).toBeUndefined();
    expect(svc.current()?.icon).toBeUndefined();
    svc.undo();
  });
});
