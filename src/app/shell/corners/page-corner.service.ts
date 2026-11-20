import { DestroyRef, Injectable, Signal, signal } from '@angular/core';

/** One entry of the phone's Tools dial that a page registers (ship page: share, QR hand-off ...). */
export interface CornerAction {
  readonly id: string;
  /** Inline SVG path data (24x24 viewBox, stroked). */
  readonly icon: string;
  /** i18n key of the label (chip beside the button, aria-label). */
  readonly labelKey: string;
  readonly run: () => void;
  /** Lower first; the view switch is 0, β is 100. */
  readonly order?: number;
}

/** What a page hands the view FAB: which view is on and how to switch. */
export interface PageViewToggle {
  /** true = Holotisch, false = Klassisch. */
  readonly holo: Signal<boolean>;
  readonly toggle: () => void;
}

/** What a page hands the share FAB: the URL that captures its whole state, optionally its own popover. */
export interface PageShare {
  readonly url: () => string;
  /** The page shows its own share popover (ship page: link + save & share, #645) instead of a direct share. */
  readonly open?: (trigger: HTMLElement) => void;
  /** Whether that popover is open (aria-expanded on the FAB). */
  readonly expanded?: Signal<boolean>;
}

/**
 * The bottom-right corner belongs to the shell (launcher, β, view toggle, share), but two of its
 * buttons act for the page on screen: a ship page registers its Klassisch | Holotisch switch and
 * its share URL while it lives (concept codex-kopf-besitz, C4/C9). Nothing registered = the
 * view FAB is not drawn and the share FAB shares URL + section anchor.
 */
@Injectable({ providedIn: 'root' })
export class PageCornerService {
  private readonly viewReg = signal<PageViewToggle | null>(null);
  private readonly shareReg = signal<PageShare | null>(null);
  private readonly actionList = signal<readonly CornerAction[]>([]);
  readonly view = this.viewReg.asReadonly();
  /** Extra dial actions of the page on screen, sorted by `order`. */
  readonly actions = this.actionList.asReadonly();
  readonly share = this.shareReg.asReadonly();

  /** Registers (or with `null` withdraws) the page's view switch; withdrawn with `owner` too. */
  setView(reg: PageViewToggle | null, owner?: DestroyRef): void {
    this.viewReg.set(reg);
    if (reg && owner) owner.onDestroy(() => this.viewReg() === reg && this.viewReg.set(null));
  }

  setShare(reg: PageShare | null, owner?: DestroyRef): void {
    this.shareReg.set(reg);
    if (reg && owner) owner.onDestroy(() => this.shareReg() === reg && this.shareReg.set(null));
  }

  /** Adds (or replaces, same id) a dial action; returns the unregister function. Pages register on phone / compact instead of drawing their own FAB. */
  register(id: string, action: Omit<CornerAction, 'id'>): () => void {
    const entry: CornerAction = { id, ...action };
    this.actionList.update((l) => [...l.filter((a) => a.id !== id), entry].sort((a, b) => (a.order ?? 50) - (b.order ?? 50)));
    return () => this.actionList.update((l) => (l.includes(entry) ? l.filter((a) => a !== entry) : l));
  }

  /** Withdraws only what this page registered (a newer page may already own the corner). */
  release(view: PageViewToggle | null, share: PageShare | null): void {
    if (view && this.viewReg() === view) this.viewReg.set(null);
    if (share && this.shareReg() === share) this.shareReg.set(null);
  }
}
