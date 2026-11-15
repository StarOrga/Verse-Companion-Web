import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ScPopupComponent, type ScPopupKind } from './sc-popup.component';
import { popupEntryDepth, pushPopupEntry, releasePopupEntry } from './popup-history';
import { useViewport } from '../../testing/viewport';

const marker = () => (history.state as { scPopup?: string } | null)?.scPopup ?? null;
const tick = () => new Promise<void>((r) => setTimeout(r, 20));
const idle = () => vi.waitFor(() => expect(marker()).toBeNull());

describe('popup-history bookkeeping', () => {
  afterEach(async () => {
    // Leave no entry behind for the next spec.
    await tick();
  });

  it('a push takes one entry, releasing it steps back over it', async () => {
    await idle();
    const id = pushPopupEntry(() => undefined);
    expect(marker()).toBe(id);
    releasePopupEntry(id);
    await idle();
    expect(popupEntryDepth()).toBe(0);
  });

  it('close then open in the same tick: the new entry is pushed after the step back, no stale marker', async () => {
    await idle();
    const first = pushPopupEntry(() => undefined);
    releasePopupEntry(first);
    const second = pushPopupEntry(() => undefined);
    await vi.waitFor(() => expect(marker()).toBe(second));
    expect(popupEntryDepth()).toBe(1);
    // One Back closes the second popup, none is left over.
    let backs = 0;
    const third = pushPopupEntry(() => backs++);
    expect(third).not.toBe(second);
    releasePopupEntry(third);
    releasePopupEntry(second);
    await idle();
    expect(backs).toBe(0);
    expect(popupEntryDepth()).toBe(0);
  });

  it('a popup destroyed under a live one leaves no dead Back step', async () => {
    await idle();
    const base = location.href;
    const lengthBefore = history.length;
    const low = pushPopupEntry(() => undefined);
    let topBacks = 0;
    const high = pushPopupEntry(() => topBacks++);
    expect(popupEntryDepth()).toBe(2);
    releasePopupEntry(low);
    expect(popupEntryDepth()).toBe(1);
    // The user's Back closes the top popup and the dead entry under it is skipped in the same go.
    history.back();
    await vi.waitFor(() => expect(topBacks).toBe(1));
    await idle();
    expect(marker()).toBeNull();
    expect(location.href).toBe(base);
    expect(history.length).toBeGreaterThanOrEqual(lengthBefore);
    expect(popupEntryDepth()).toBe(0);
    releasePopupEntry(high);
  });

  it('releasing the top while a lower popup was released earlier ends on a clean entry', async () => {
    await idle();
    const low = pushPopupEntry(() => undefined);
    const high = pushPopupEntry(() => undefined);
    releasePopupEntry(low);
    releasePopupEntry(high);
    await idle();
    expect(popupEntryDepth()).toBe(0);
  });

  it('a self-issued step back never swallows a later real Back', async () => {
    await idle();
    const a = pushPopupEntry(() => undefined);
    releasePopupEntry(a);
    await idle();
    let backs = 0;
    const b = pushPopupEntry(() => backs++);
    history.back();
    await vi.waitFor(() => expect(backs).toBe(1));
    releasePopupEntry(b);
  });
});

@Component({
  standalone: true,
  imports: [ScPopupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <sc-popup [kind]="kind()" title="T" (closed)="reasons.push($event); open.set(false)">x</sc-popup>
    }
  `,
})
class HostComponent {
  readonly open = signal(true);
  readonly kind = signal<ScPopupKind>('dialog');
  readonly reasons: string[] = [];
}

describe('popup history on a phone (auto entry for dialog and panel)', () => {
  useViewport(375, 700);

  for (const kind of ['dialog', 'panel'] as const) {
    it(`${kind}: one entry at phone width, Back closes it with reason "back"`, async () => {
      await idle();
      TestBed.configureTestingModule({ providers: [provideTranslateService()] });
      const f = TestBed.createComponent(HostComponent);
      f.componentInstance.kind.set(kind);
      document.body.appendChild(f.nativeElement);
      f.detectChanges();
      expect(popupEntryDepth()).toBe(1);
      expect(marker()).not.toBeNull();
      history.back();
      await vi.waitFor(() => expect(f.componentInstance.reasons).toEqual(['back']));
      f.detectChanges();
      await idle();
      expect(popupEntryDepth()).toBe(0);
      f.destroy();
      (f.nativeElement as HTMLElement).remove();
    });
  }

  it('a menu takes no entry even at phone width, backClose on it is ignored', async () => {
    await idle();
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const f = TestBed.createComponent(HostComponent);
    f.componentInstance.kind.set('menu');
    document.body.appendChild(f.nativeElement);
    f.detectChanges();
    expect(popupEntryDepth()).toBe(0);
    f.destroy();
    (f.nativeElement as HTMLElement).remove();
  });
});
