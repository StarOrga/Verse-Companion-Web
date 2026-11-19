import { ScPopupMotionDirective } from '../shared/popup-motion/sc-popup-motion.directive';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ToastSlotDirective } from '../shared/toast-stack/toast-stack';
import { TranslatePipe } from '@ngx-translate/core';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { formatAppSize } from '../shell/apps-menu.component';
import { SCC_INSTALLER_URL } from '../news/verse-status-chip.component';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { ScPopupComponent } from '../shared/popup/sc-popup.component';
import { APP_NOTICE_DELAY_MS, AppNoticeService, NoticeApp } from './app-notice.service';
import { DesktopReleaseService, RingRelease } from './desktop-release.service';
import { ShellChromeService } from '../shell/fusion-bar/shell-chrome.service';

/** The entrance's "rest" beat (header, Patches, notices) when the hub sets none. */
const APP_NOTICE_REST_BEAT_MS = 4300;

const STARSCAPE_FALLBACK_URL =
  'https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/wallpaper-app-latest/starscape-wallpaper.exe';

/**
 * `<sc-app-notice app="scc|starscape">` - the app notification toast, bottom
 * right in the look of the star toast. Appears after the host page has been
 * shown for 3 s without interruption (the component lives exactly as long as
 * the page), collapsed to one line; a click anywhere on it expands the app
 * info with a real download anchor. The x snoozes the app for ~14 days; if it
 * is ignored it simply returns on the next visit. Renders nothing on a device
 * that cannot install a desktop app.
 */
@Component({
  selector: 'sc-app-notice',
  standalone: true,
  imports: [ScPopupMotionDirective, ToastSlotDirective, TranslatePipe, ScActionDirective, ScPopupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="toast" scToastSlot scPopupMotion scPopupMotionOrigin="br" animate.leave="pm-out"
           [class.open]="expanded()" (click)="expand()">
        <sc-popup kind="notice" [title]="'appNotice.aria' | translate">
          @if (app() === 'scc') {
            <img popupIcon src="icons/brand/vc-mark.svg" alt="" width="22" height="22" />
          } @else {
            <svg popupIcon viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
          }
          <button type="button" class="head" (click)="toggle($event)" [attr.aria-expanded]="expanded()">
            <small>{{ 'appNotice.eyebrow' | translate }}</small>
            <b>{{ 'appNotice.' + app() + '.line' | translate }}</b>
          </button>
          <div class="more" [attr.inert]="expanded() ? null : ''">
            <div class="more-in">
              <p>{{ 'appNotice.' + app() + '.desc' | translate }}</p>
              <span class="meta">{{ meta() }}</span>
              <span class="acts">
                <a scAction tier="primary" class="dl" [href]="href()" rel="noopener noreferrer" download>{{ 'appNotice.download' | translate }}</a>
                <!-- A notice carries no X (r1-close): the snooze lives in the expanded part, next to the download. -->
                <button type="button" scAction tier="secondary" class="later" (click)="dismiss($event)">{{ 'appNotice.later' | translate }}</button>
              </span>
            </div>
          </div>
        </sc-popup>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    /* Phones: no desktop-app notice. */
    @media (max-width: 749px) { :host { display: none; } }
    /* Position only (bottom right, above the launcher); frame, width, rail and symbol come from <sc-popup kind="notice">. */
    .toast {
      position: fixed; z-index: 1440; cursor: pointer;
      inset-inline-end: var(--sc-toast-end, 24px);
      bottom: calc(var(--sc-toast-bottom, var(--sc-fab-clear-block, 80px)) + var(--sc-toast-offset, 0px));
    }
    .toast.open { cursor: default; }
    .toast img[popupIcon] { width: 22px; height: 22px; }
    .head {
      display: grid; gap: 2px; min-width: 0; inline-size: 100%; text-align: start; padding: 4px 0; min-height: var(--sc-tap-min, 44px);
      align-content: center; background: none; border: 0; color: inherit; font: inherit; cursor: inherit; border-radius: 6px;
    }
    .head small { font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.18em; text-transform: uppercase; color: var(--sc-accent); }
    .head b { font-size: 0.92rem; font-weight: 600; color: var(--sc-fg-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .toast.open .head b { white-space: normal; }
    .head:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    .more {
      grid-column: 1 / -1; display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.26s ease;
    }
    .toast.open .more { grid-template-rows: 1fr; }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .more-in { overflow: hidden; display: grid; gap: 8px; justify-items: start; min-height: 0; }
    .toast.open .more-in { padding-top: 10px; }
    .more-in p { margin: 0; font-size: max(0.82rem, var(--sc-fs-floor)); line-height: 1.4; color: var(--sc-fg-1); }
    .meta { font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }
    @media (prefers-reduced-motion: reduce) {
      .more { transition: none; }
    }
  `],
})
export class AppNoticeComponent {
  readonly app = input.required<NoticeApp>();

  private readonly notices = inject(AppNoticeService);
  private readonly device = inject(DesktopCapabilityService);
  private readonly chrome = inject(ShellChromeService);
  private readonly releases = inject(DesktopReleaseService);

  readonly visible = signal(false);
  readonly expanded = signal(false);
  private readonly release = signal<RingRelease | null>(null);
  private loaded = false;

  readonly href = computed(() =>
    this.app() === 'scc' ? SCC_INSTALLER_URL : (this.release()?.url ?? STARSCAPE_FALLBACK_URL),
  );
  readonly meta = computed(() => {
    const r = this.release();
    const parts = ['Windows'];
    if (r) {
      parts.push(`v${r.version}`);
      const size = formatAppSize(r.sizeBytes);
      if (size) parts.push(size);
    }
    return parts.join(' · ');
  });

  constructor() {
    // Presence timer: leaving the page destroys the component and cancels it.
    let due = false;
    let beat: ReturnType<typeof setTimeout> | null = null;
    let introAt: number | null = null;
    const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // During the Verse entrance the notice belongs to its "rest" beat (header, Patches ... at
    // 4.3 s), never before the search (QA D12): it waits for that beat of the running entrance.
    const show = (): void => {
      if (!due || this.visible() || beat) return;
      const intro = this.chrome.heroIntro();
      if (intro?.full) {
        if (intro.hold) return;
        const wait = (introAt ?? now()) + (intro.headerAtMs ?? APP_NOTICE_REST_BEAT_MS) - now();
        if (wait > 0) {
          beat = setTimeout(() => {
            beat = null;
            reveal();
          }, wait);
          return;
        }
      }
      reveal();
    };
    const reveal = (): void => {
      if (!this.visible() && this.device.canInstall() && !this.notices.isSnoozed(this.app())) this.visible.set(true);
    };
    effect(() => {
      const intro = this.chrome.heroIntro();
      untracked(() => {
        if (intro?.full && !intro.hold && introAt === null) introAt = now();
        show();
      });
    });
    const timer = setTimeout(() => {
      due = true;
      show();
    }, APP_NOTICE_DELAY_MS);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(timer);
      if (beat) clearTimeout(beat);
    });
  }

  expand(): void {
    if (this.expanded()) return;
    this.expanded.set(true);
    void this.load();
  }

  toggle(ev: Event): void {
    ev.stopPropagation();
    const next = !this.expanded();
    this.expanded.set(next);
    if (next) void this.load();
  }

  dismiss(ev: Event): void {
    ev.stopPropagation();
    this.notices.snooze(this.app());
    this.visible.set(false);
    this.expanded.set(false);
  }

  private async load(): Promise<void> {
    if (this.loaded || this.app() !== 'starscape') return;
    this.loaded = true;
    const res = await this.releases.ringsFor('starscape', ['stable']);
    this.release.set(res.releases[0] ?? null);
  }
}
