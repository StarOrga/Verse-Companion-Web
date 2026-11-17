import { Injectable, Injector, inject } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import type { ComponentType } from '@angular/cdk/portal';
import type { OutputEmitterRef } from '@angular/core';
import { logWarn } from '../../core/log';
import { ModalInertService } from '../../shared/dialog/modal-inert.service';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import { NachschubService, type NachschubResult, type WishRef } from './nachschub.service';
import type { PathGroupSurface } from './path-group-analytics';
import { WishReleaseDialogComponent, type WishReleaseChoice } from './wish-release-dialog.component';
import { WishRemovalDialogComponent, type WishRemovalChoice } from './wish-removal-dialog.component';

/**
 * ONE flow for every way to lower or remove a wish (C6) and for releasing one inside the HQ (C7): plan, ask only when
 * the change cuts into pieces assigned to an Operation (A4/A5: free pieces never open a dialog), then apply with the
 * user's quantity, split and dissolve ticks. The result carries ONE undo (A10); `announce` puts it on the app's undo
 * toast. Surfaces call `lower` / `release`; nothing else writes a wish quantity down.
 */
@Injectable({ providedIn: 'root' })
export class WishRemovalFlowService {
  private readonly nach = inject(NachschubService);
  private readonly overlay = inject(Overlay);
  private readonly inert = inject(ModalInertService);
  private readonly toast = inject(UndoToastService);
  private readonly injector = inject(Injector);
  private open = false;

  /**
   * Lower the wish `ref` by `removeQty` pieces (`removeQty` = all of it removes the wish). Free pieces go first and
   * need no question; otherwise the removal dialog opens. Resolves to the write's result (with its undo), or null
   * when the user cancelled (nothing changed) or another dialog is open.
   */
  async lower(ref: WishRef & { readonly name: string }, removeQty: number, surface: PathGroupSurface): Promise<NachschubResult | null> {
    const plan = this.nach.planWishRemoval(ref, removeQty);
    if (!plan.needsConfirm) return this.nach.applyWishRemoval(ref, removeQty, { surface });
    const choice = await this.ask<WishRemovalChoice, WishRemovalDialogComponent>(WishRemovalDialogComponent, { ref, name: ref.name, initialQty: removeQty });
    if (!choice) return null;
    return this.nach.applyWishRemoval(ref, choice.qty, { surface, ...(choice.split ? { split: choice.split } : {}), dissolve: choice.dissolve });
  }

  /**
   * "Lösen" of a wish line inside the HQ always asks (A9, C7): release (the wish stays on the wishlist), the red
   * "Auch von der Wunschliste löschen", or cancel (null). Null as well when `lineId` is no open wish line.
   */
  async release(lineId: string, name: string, surface: PathGroupSurface): Promise<NachschubResult | null> {
    const info = this.nach.releaseInfo(lineId);
    if (!info) return null;
    const choice = await this.ask<WishReleaseChoice, WishReleaseDialogComponent>(WishReleaseDialogComponent, { name, info });
    if (!choice) return null;
    return this.nach.release(lineId, { alsoRemoveWish: choice.action === 'delete', dissolve: choice.dissolve, surface });
  }

  /**
   * The undo toast of a finished write: the message of the result, a second line when an Operation went with it, the
   * result's undo behind "Rückgängig". `onFailed` hears an undo that did not go through (its i18n error key).
   */
  announce(result: NachschubResult | null, onFailed?: (key: string) => void): void {
    if (!result?.ok || !result.undo) return;
    const undo = result.undo;
    const dissolved = Number(result.params?.['dissolved'] ?? 0) > 0;
    this.toast.offer({
      messageKey: result.key,
      messageParams: result.params,
      ...(dissolved ? { detailKey: 'wishRemoval.toastDissolved' } : {}),
      commit: () => undefined,
      onUndo: () =>
        void undo().then((back) => {
          if (back.ok) return;
          logWarn('wishRemoval', 'undo failed', back.key);
          onFailed?.(back.key);
        }),
    });
  }

  /** Opens `component` in a CDK overlay like ScConfirmService does and resolves its `closed` value. */
  private ask<R, C extends { closed: OutputEmitterRef<R | null> }>(component: ComponentType<C>, inputs: Record<string, unknown>): Promise<R | null> {
    if (this.open) return Promise.resolve(null);
    this.open = true;
    const overlayRef: OverlayRef = this.overlay.create({
      hasBackdrop: true,
      backdropClass: this.inert.depth > 0 ? ['sc-dialog-backdrop', 'sc-dialog-backdrop--stacked'] : 'sc-dialog-backdrop',
      panelClass: 'sc-dialog-pane',
      positionStrategy: this.overlay.position().global().centerHorizontally().centerVertically(),
      scrollStrategy: this.overlay.scrollStrategies.block(),
      disposeOnNavigation: true,
    });
    const ref = overlayRef.attach(new ComponentPortal(component, null, this.injector));
    for (const [k, v] of Object.entries(inputs)) ref.setInput(k, v);
    ref.changeDetectorRef.detectChanges();
    return new Promise<R | null>((resolve) => {
      let settled = false;
      const finish = (value: R | null): void => {
        if (settled) return;
        settled = true;
        this.open = false;
        closedSub.unsubscribe();
        detachSub.unsubscribe();
        overlayRef.dispose();
        resolve(value);
      };
      const closedSub = ref.instance.closed.subscribe((v: R | null) => finish(v));
      const detachSub = overlayRef.detachments().subscribe(() => finish(null));
    });
  }
}
