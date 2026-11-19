import { ChangeDetectionStrategy, Component, InjectionToken, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ConceptPageService, ConceptTicketError, ConceptTicketFailure } from './concept-page.service';

type State = 'loading' | ConceptTicketError;

/**
 * `/concept/:id` — the entry link of one hosted concept page (admin feedback
 * #224, full-screen since feedback e4428abd).
 *
 * The route is `roleGuard('admin')`-gated; on top, the `concept-page` edge
 * function refuses to mint a ticket for anyone but an admin, so a leaked
 * route path alone shows nothing.
 *
 * The concept is NOT shown inside the app any more. The admin asked for no
 * intermediate page with a sub-header: a concept link (feedback board,
 * bookmark, old message) lands straight on the full-screen document, exactly
 * where the former "open in new tab" link went. So this route sits outside
 * the shell, mints the ticket and REPLACES its own history entry with the
 * app's static loader `/concept-frame/<id>.html` (public/concept-frame.html)
 * carrying the ticketed function URL in the fragment — Back skips this hop.
 * The loader fetches the document as text and writes it into itself
 * (Supabase serves html from `*.supabase.co` as `text/plain`, #330). What
 * stays visible here is only the moment of minting and the failure copies.
 */
/** `/concept-frame/<id>.html#<encoded function url>` — see public/concept-frame.html. */
export function conceptFrameUrl(id: string, documentUrl: string): string {
  return `/concept-frame/${encodeURIComponent(id.trim().toLowerCase())}.html#${encodeURIComponent(documentUrl)}`;
}

/** Leaves the app for the full-screen loader without a history entry (swapped in specs). */
export const CONCEPT_FRAME_NAVIGATE = new InjectionToken<(url: string) => void>('CONCEPT_FRAME_NAVIGATE', {
  providedIn: 'root',
  factory: () => (url: string) => window.location.replace(url),
});

@Component({
  selector: 'sc-concept-page',
  imports: [RouterLink, TranslatePipe, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="concept">
      @switch (state()) {
        @case ('loading') {
          <p class="msg" role="status">{{ 'conceptPage.loading' | translate }}</p>
        }
        @case ('forbidden') {
          <p class="msg err" role="alert">{{ 'conceptPage.forbidden' | translate }}</p>
        }
        @case ('notFound') {
          <p class="msg err" role="alert">{{ 'conceptPage.notFound' | translate }}</p>
        }
        @case ('error') {
          <p class="msg err" role="alert">{{ 'conceptPage.error' | translate }}</p>
          <button scAction tier="secondary" type="button" class="retry" (click)="retry()">
            {{ 'conceptPage.retry' | translate }}
          </button>
        }
      }
      @if (state() !== 'loading') {
        <a class="back" routerLink="/admin/feedback">
          <span aria-hidden="true">&larr;</span> {{ 'conceptPage.back' | translate }}
        </a>
      }
    </main>
  `,
  styles: [
    `
      :host { display: block; }
      .concept {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        min-height: 100vh;
        min-height: 100dvh;
        padding: 1.5rem 1rem;
        box-sizing: border-box;
        background: var(--sc-bg-0);
        color: var(--sc-fg-1);
      }
      .msg { margin: 0; text-align: center; max-width: var(--sc-measure, 60ch); }
      .msg.err { color: var(--sc-danger); }
      .back {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        min-height: 2.75rem;
        padding: 0 0.5rem;
        color: var(--sc-accent-hot);
        text-decoration: none;
      }
      .back:hover, .back:focus-visible { text-decoration: underline; }
    `,
  ],
})
export class ConceptPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly tickets = inject(ConceptPageService);
  private readonly navigate = inject(CONCEPT_FRAME_NAVIGATE);

  readonly state = signal<State>('loading');
  private id = '';

  constructor() {
    this.route.paramMap.subscribe((params) => {
      this.id = params.get('id') ?? '';
      void this.load();
    });
  }

  retry(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.id;
    this.state.set('loading');
    if (!id) {
      this.state.set('notFound');
      return;
    }
    try {
      const ticket = await this.tickets.mintTicket(id);
      this.navigate(conceptFrameUrl(id, ticket.url));
    } catch (err) {
      this.state.set(err instanceof ConceptTicketFailure ? err.kind : 'error');
    }
  }
}
