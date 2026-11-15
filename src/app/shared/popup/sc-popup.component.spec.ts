import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import de from '../../../../public/i18n/de.json';
import en from '../../../../public/i18n/en.json';
import { ScPopupComponent, type ScPopupAccess, type ScPopupKind, type ScPopupSize } from './sc-popup.component';
import { ModalInertService } from '../dialog/modal-inert.service';
import { popupEntryDepth } from './popup-history';
import { useViewport } from '../../testing/viewport';

@Component({
  standalone: true,
  imports: [ScPopupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <sc-popup
        [kind]="kind()"
        title="Ziel für Quantanium"
        eyebrow="Nachschub"
        [size]="size()"
        [access]="access()"
        [backClose]="backClose()"
        (closed)="onClosed($event)"
      >
        <div class="content" [style.height.px]="contentH()">Inhalt</div>
        <ng-container popupActions>
          <button type="button" class="save">Speichern</button>
          <button type="button" class="cancel">Abbrechen</button>
        </ng-container>
        <span popupStatus class="status">3 von 5</span>
      </sc-popup>
    }
    @if (second()) {
      <sc-popup kind="dialog" size="s" title="Wirklich?" class="second" [backClose]="secondBack()" (closed)="secondReasons.push($event); second.set(false)">
        <p>Frage</p>
      </sc-popup>
    }
  `,
})
class HostComponent {
  readonly open = signal(true);
  readonly second = signal(false);
  readonly kind = signal<ScPopupKind>('dialog');
  readonly size = signal<ScPopupSize | null>(null);
  readonly access = signal<ScPopupAccess>(null);
  readonly contentH = signal(40);
  readonly backClose = signal<boolean | null>(null);
  readonly secondBack = signal<boolean | null>(null);
  readonly secondReasons: string[] = [];
  readonly reasons: string[] = [];
  onClosed(r: string): void {
    this.reasons.push(r);
    this.open.set(false);
  }
}

describe('ScPopupComponent', () => {
  const frame = (root: ParentNode = document) => root.querySelector<HTMLElement>('sc-popup .scp-frame')!;
  const settle = async () => {
    await new Promise<void>((r) => setTimeout(r));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  };

  function mount(setup?: (h: HostComponent) => void) {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const fixture = TestBed.createComponent(HostComponent);
    setup?.(fixture.componentInstance);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => document.querySelectorAll('sc-popup').forEach((e) => e.closest('div[ng-version], ng-component')?.remove()));

  const kinds: { kind: ScPopupKind; head: boolean; close: boolean; eyebrow: boolean; size: string }[] = [
    { kind: 'menu', head: false, close: false, eyebrow: false, size: 'menu' },
    { kind: 'panel', head: true, close: true, eyebrow: true, size: 's' },
    { kind: 'dialog', head: true, close: true, eyebrow: true, size: 'm' },
    { kind: 'large', head: true, close: true, eyebrow: true, size: 'area' },
    { kind: 'notice', head: false, close: false, eyebrow: false, size: '' },
  ];
  for (const k of kinds) {
    it(`${k.kind}: head ${k.head}, ✕ ${k.close}, eyebrow ${k.eyebrow}, width tier ${k.size || 'toast'}`, async () => {
      const f = mount((h) => h.kind.set(k.kind));
      await settle();
      const el = frame(f.nativeElement);
      expect(el.dataset['kind']).toBe(k.kind);
      expect(!!el.querySelector('.scp-h')).toBe(k.head);
      expect(!!el.querySelector('.scp-x')).toBe(k.close);
      expect(!!el.querySelector('.scp-ev')).toBe(k.eyebrow);
      expect(el.querySelector('.scp-rail .scp-sym svg')).not.toBeNull();
      if (k.size) expect(el.dataset['size']).toBe(k.size);
      // Exactly one heading, also for kinds without a visible head.
      expect(el.querySelectorAll('h2').length).toBe(1);
      expect(el.querySelector('h2')!.textContent!.trim()).toBe('Ziel für Quantanium');
      f.destroy();
    });
  }

  it('the rail is narrow (36px) on menu and notice, 46px otherwise', async () => {
    for (const [kind, w] of [['menu', 36], ['notice', 36], ['dialog', 46]] as const) {
      const f = mount((h) => h.kind.set(kind));
      await settle();
      expect(Math.round(frame(f.nativeElement).querySelector<HTMLElement>('.scp-rail')!.getBoundingClientRect().width)).toBe(w);
      f.destroy();
      TestBed.resetTestingModule();
    }
  });

  it('the ✕ is a tertiary scAction with aria-label and closes with reason "close"', async () => {
    const f = mount();
    await settle();
    const x = frame(f.nativeElement).querySelector<HTMLButtonElement>('.scp-x')!;
    expect(x.classList).toContain('sc-action--tertiary');
    expect(x.getAttribute('aria-label')).toBe('common.dialog.close');
    expect(x.hasAttribute('title')).toBe(false);
    x.click();
    f.detectChanges();
    expect(f.componentInstance.reasons).toEqual(['close']);
    expect(f.nativeElement.querySelector('sc-popup')).toBeNull();
    f.destroy();
  });

  it('a scrim click does not close a modal', async () => {
    const f = mount();
    await settle();
    const scrim = f.nativeElement.querySelector('.scp-scrim') as HTMLElement;
    expect(scrim).not.toBeNull();
    scrim.click();
    scrim.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    f.detectChanges();
    expect(f.componentInstance.reasons).toEqual([]);
    expect(f.nativeElement.querySelector('sc-popup')).not.toBeNull();
    f.destroy();
  });

  it('Escape closes with reason "escape"', async () => {
    const f = mount();
    await settle();
    frame(f.nativeElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    f.detectChanges();
    expect(f.componentInstance.reasons).toEqual(['escape']);
    f.destroy();
  });

  it('a dialog is modal: aria-modal, labelled by its title, page inert', async () => {
    const f = mount();
    await settle();
    const el = frame(f.nativeElement);
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(el.getAttribute('aria-labelledby')!)!.textContent!.trim()).toBe('Ziel für Quantanium');
    expect(TestBed.inject(ModalInertService).depth).toBe(1);
    f.destroy();
  });

  it('a press on the scrim keeps focus in the frame, so Escape still closes', async () => {
    const f = mount();
    await settle();
    const fr = frame(f.nativeElement);
    const inFrame = () => fr.contains(document.activeElement);
    expect(inFrame()).toBe(true);
    const scrim = f.nativeElement.querySelector('.scp-scrim') as HTMLElement;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    scrim.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    scrim.click();
    expect(inFrame()).toBe(true);
    // a press inside the frame is left alone (text selection, button focus)
    const inner = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    fr.querySelector('.content')!.dispatchEvent(inner);
    expect(inner.defaultPrevented).toBe(false);
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    f.detectChanges();
    expect(f.componentInstance.reasons).toEqual(['escape']);
    f.destroy();
  });

  it('a panel is not modal and has no scrim', async () => {
    const f = mount((h) => h.kind.set('panel'));
    await settle();
    expect(frame(f.nativeElement).hasAttribute('aria-modal')).toBe(false);
    expect(f.nativeElement.querySelector('.scp-scrim')).toBeNull();
    expect(TestBed.inject(ModalInertService).depth).toBe(0);
    f.destroy();
  });

  it('only the body scrolls: head and footer stay inside the max height', async () => {
    const f = mount((h) => h.contentH.set(4000));
    await settle();
    const el = frame(f.nativeElement);
    const body = el.querySelector<HTMLElement>('.scp-b')!;
    expect(el.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight);
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    expect(getComputedStyle(body).overflowY).toBe('auto');
    const foot = el.querySelector<HTMLElement>('.scp-f')!.getBoundingClientRect();
    expect(foot.bottom).toBeLessThanOrEqual(el.getBoundingClientRect().bottom);
    expect(el.querySelector('.scp-h')!.getBoundingClientRect().top).toBeGreaterThanOrEqual(el.getBoundingClientRect().top);
    f.destroy();
  });

  it('footer: actions left in source order, status right; hidden while empty', async () => {
    const f = mount();
    await settle();
    const el = frame(f.nativeElement);
    const save = el.querySelector('.save')!.getBoundingClientRect();
    const cancel = el.querySelector('.cancel')!.getBoundingClientRect();
    const status = el.querySelector('.status')!.getBoundingClientRect();
    expect(save.left).toBeLessThan(cancel.left);
    expect(status.left).toBeGreaterThan(cancel.right);
    f.componentInstance.second.set(true);
    f.detectChanges();
    await settle();
    const second = f.nativeElement.querySelector('sc-popup.second .scp-f') as HTMLElement;
    expect(getComputedStyle(second).display).toBe('none');
    f.destroy();
  });

  it('stacking: the second modal layer does not darken further', async () => {
    const f = mount();
    await settle();
    f.componentInstance.second.set(true);
    f.detectChanges();
    await settle();
    const first = f.nativeElement.querySelector('sc-popup:not(.second)') as HTMLElement;
    const second = f.nativeElement.querySelector('sc-popup.second') as HTMLElement;
    expect(first.dataset['layer']).toBe('1');
    expect(second.dataset['layer']).toBe('2');
    expect(getComputedStyle(second.querySelector('.scp-scrim')!).backgroundImage).toBe('none');
    expect(getComputedStyle(first.querySelector('.scp-scrim')!).backgroundImage).not.toBe('none');
    // Escape reaches only the topmost layer.
    second.querySelector<HTMLElement>('.scp-frame')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    f.detectChanges();
    expect(f.componentInstance.second()).toBe(false);
    expect(f.componentInstance.reasons).toEqual([]);
    f.destroy();
  });

  it('role edge: admin red, collab copper, sr-only text, no visible role words', async () => {
    for (const [access, token] of [['admin', '--sc-accent-hot'], ['collab', '--sc-accent-collab']] as const) {
      const f = mount((h) => h.access.set(access));
      await settle();
      const el = frame(f.nativeElement);
      const want = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
      const probe = document.createElement('i');
      probe.style.color = want;
      document.body.appendChild(probe);
      expect(getComputedStyle(el).borderTopColor).toBe(getComputedStyle(probe).color);
      probe.remove();
      const sr = el.querySelector('.sc-sr-only')!;
      expect(sr.textContent!.trim()).toBe(`common.popup.access.${access}`);
      // The rail keeps the kind colour.
      expect(getComputedStyle(el.querySelector('.scp-rail')!).borderRightColor).not.toBe(getComputedStyle(el).borderTopColor);
      f.destroy();
      TestBed.resetTestingModule();
    }
  });

  it('a notice never takes focus and has no ✕', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    const f = mount((h) => h.kind.set('notice'));
    await settle();
    expect(document.activeElement).toBe(btn);
    expect(frame(f.nativeElement).getAttribute('role')).toBe('status');
    f.destroy();
    btn.remove();
  });

  it('ships its keys in both catalogues', () => {
    const get = (cat: unknown, key: string) =>
      key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], cat);
    for (const key of ['common.dialog.close', 'common.popup.access.admin', 'common.popup.access.collab']) {
      expect(typeof get(de, key), `de ${key}`).toBe('string');
      expect(typeof get(en, key), `en ${key}`).toBe('string');
    }
  });
  describe('back gesture (r1-back: first the window, then the page)', () => {
    const marker = () => (history.state as { scPopup?: string } | null)?.scPopup ?? null;
    const idle = async () => {
      await vi.waitFor(() => expect(marker()).toBeNull());
    };

    it('a large window pushes one entry; back closes it and the page stays', async () => {
      await idle();
      const url = location.href;
      const f = mount((h) => h.kind.set('large'));
      await settle();
      expect(popupEntryDepth()).toBe(1);
      expect(marker()).not.toBeNull();
      history.back();
      await vi.waitFor(() => expect(f.componentInstance.reasons).toEqual(['back']));
      expect(location.href).toBe(url);
      expect(popupEntryDepth()).toBe(0);
      f.destroy();
    });

    it('closing through the ✕ pops the entry again, no stale entry', async () => {
      await idle();
      const f = mount((h) => h.kind.set('large'));
      await settle();
      expect(marker()).not.toBeNull();
      frame(f.nativeElement).querySelector<HTMLButtonElement>('.scp-x')!.click();
      f.detectChanges();
      await idle();
      expect(popupEntryDepth()).toBe(0);
      expect(f.componentInstance.reasons).toEqual(['close']);
      f.destroy();
    });

    it('a dialog at desktop width, a menu and a URL-owning popup get no entry', async () => {
      await idle();
      for (const setup of [
        (h: HostComponent) => h.kind.set('dialog'),
        (h: HostComponent) => h.kind.set('menu'),
        (h: HostComponent) => (h.kind.set('large'), h.backClose.set(false)),
      ]) {
        const f = mount(setup);
        await settle();
        expect(popupEntryDepth()).toBe(0);
        expect(marker()).toBeNull();
        f.destroy();
        TestBed.resetTestingModule();
      }
    });

    it('back closes only the topmost popup', async () => {
      await idle();
      const f = mount((h) => (h.kind.set('large'), h.secondBack.set(true)));
      await settle();
      f.componentInstance.second.set(true);
      f.detectChanges();
      await settle();
      expect(popupEntryDepth()).toBe(2);
      history.back();
      await vi.waitFor(() => expect(f.componentInstance.secondReasons).toEqual(['back']));
      f.detectChanges();
      expect(f.componentInstance.reasons).toEqual([]);
      expect(f.nativeElement.querySelector('sc-popup:not(.second)')).not.toBeNull();
      expect(popupEntryDepth()).toBe(1);
      history.back();
      await vi.waitFor(() => expect(f.componentInstance.reasons).toEqual(['back']));
      f.destroy();
    });
  });
});

describe('ScPopupComponent on a phone', () => {
  useViewport(375, 700);

  it('keeps the footer clear of the feedback launcher and gives checkboxes a 48 px hit area', async () => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const fixture = TestBed.createComponent(PhoneHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const root = fixture.nativeElement as HTMLElement;
    const footer = root.querySelector<HTMLElement>('.scp-f')!;
    const clear = parseFloat(getComputedStyle(footer).paddingInlineEnd);
    expect(clear).toBeGreaterThanOrEqual(56 + 12);
    const status = root.querySelector<HTMLElement>('.scp-st')!.getBoundingClientRect();
    expect(status.right).toBeLessThanOrEqual(window.innerWidth - clear + 1);
    const box = root.querySelector<HTMLInputElement>('input[type=checkbox]')!.getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(48);
    fixture.destroy();
    root.remove();
  });
});

@Component({
  standalone: true,
  imports: [ScPopupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-popup kind="dialog" title="Wunschliste" eyebrow="Merkliste" [backClose]="false">
      <label><input type="checkbox" /> Position</label>
      <span popupStatus>3 von 5 gewählt</span>
    </sc-popup>
  `,
})
class PhoneHostComponent {}

@Component({
  standalone: true,
  imports: [ScPopupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="slot" style="position: relative; width: 300px; height: 260px">
      <sc-popup kind="panel" size="fill" [bodyFill]="true" [float]="float" [backClose]="false" title="Fill" style="display: block; height: 100%; --sc-popup-body-gap: 7px">
        <div class="inner">x</div>
      </sc-popup>
    </div>
  `,
})
class FillHostComponent {
  float = false;
}

describe('ScPopupComponent fill / bodyFill / float', () => {
  function mountFill(float: boolean) {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const fixture = TestBed.createComponent(FillHostComponent);
    fixture.componentInstance.float = float;
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  }

  it('size="fill" sizes the frame by its host and bodyFill makes the body a flex column', () => {
    const f = mountFill(false);
    const root = f.nativeElement as HTMLElement;
    const fr = root.querySelector<HTMLElement>('.scp-frame')!;
    expect(fr.dataset['size']).toBe('fill');
    const slot = root.querySelector<HTMLElement>('.slot')!.getBoundingClientRect();
    expect(Math.round(fr.getBoundingClientRect().width)).toBe(Math.round(slot.width));
    expect(Math.round(fr.getBoundingClientRect().height)).toBe(Math.round(slot.height));
    const body = getComputedStyle(root.querySelector('.scp-b')!);
    expect(body.display).toBe('flex');
    expect(body.flexDirection).toBe('column');
    expect(body.rowGap).toBe('7px');
    f.destroy();
    root.remove();
  });

  describe('on a phone', () => {
    useViewport(375, 700);

    it('a float popup stays a card, a normal panel goes full screen', () => {
      const f = mountFill(true);
      const root = f.nativeElement as HTMLElement;
      expect(getComputedStyle(root.querySelector('.scp-frame')!).position).toBe('relative');
      f.destroy();
      root.remove();
      TestBed.resetTestingModule();
      const g = mountFill(false);
      const gr = g.nativeElement as HTMLElement;
      expect(getComputedStyle(gr.querySelector('.scp-frame')!).position).toBe('fixed');
      g.destroy();
      gr.remove();
    });
  });
});
