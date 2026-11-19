import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ShipLinkFormStore } from './ship-link-form.store';

/**
 * The rarer ship actions of the codex detail page: class name, add to hangar,
 * the RSI deep link and the "pin your own link" toggle. Shared by the classic
 * tool row and the Holotable drawer (AUD-090, AUD-116).
 *
 * Host is display:contents, so every piece stays an item of the parent's flex
 * row and the row wraps exactly as before; the spacer (classic tool row only)
 * still pushes the actions to the end of that row.
 */
@Component({
  selector: 'sc-codex-ship-actions',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showClass()) {
      <code class="cls">{{ classNameSlug() }}</code>
    }
    @if (spacer()) {
      <span class="tool-spacer"></span>
    }
    @if (showLinks()) {
    <!-- Deep-link out to the official RSI site. We have no reliable
         per-ship RSI slug (our classNameSlug is not the RSI URL slug),
         so without a pinned link this lands on the official ships
         listing rather than 404-ing on a guessed deeplink. A pinned
         value is attacker-controlled, so it is bound with [href] on a
         plain anchor and nothing else: no innerHTML, no LLM prompt. -->
    @if (links.pledgeLink(); as pledge) {
      <a scAction tier="secondary" class="rsi-link" [href]="pledge" target="_blank" rel="noopener noreferrer nofollow">
        {{ 'codex.detail.viewOnRsi' | translate }} <span aria-hidden="true">↗</span>
      </a>
    } @else {
      <a scAction tier="secondary" class="rsi-link"
         href="https://robertsspaceindustries.com/en/pledge/ships?sortField=name&sortDirection=asc"
         target="_blank" rel="noopener noreferrer">
        {{ 'codex.detail.viewOnRsi' | translate }} <span aria-hidden="true">↗</span>
      </a>
    }
    @if (auth.user()) {
      <button type="button" scAction tier="secondary" (click)="links.toggle()">
        {{ (links.myPledgeLink() ? 'codex.shipLink.edit' : 'codex.shipLink.add') | translate }}
      </button>
    }
    }
  `,
  styles: [`
    :host { display: contents; }
    .cls { font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); overflow-wrap: anywhere; }
    .tool-spacer { flex: 1 1 auto; }
    .err-inline { color: var(--sc-danger); font-size: 0.8rem; }

  `],
})
export class CodexShipActionsComponent {
  protected readonly links = inject(ShipLinkFormStore);
  protected readonly auth = inject(AuthService);

  readonly classNameSlug = input.required<string>();
  /** Classic tool row: a flexible gap pushes the actions to the row's end. */
  readonly spacer = input(false);
  /** The class name code. Off where the classic action row places only the links (#374). */
  readonly showClass = input(true);
  /** The RSI link and the pledge-link action. Off at the classic row's end: they follow "Schiff wechseln" (#374). */
  readonly showLinks = input(true);
}
