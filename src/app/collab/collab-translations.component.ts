import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { logWarn } from '../core/log';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { TranslationCardsComponent } from '../admin/translations/translation-cards.component';
import { TranslationLanguage, TranslationsService } from '../admin/translations/translations.service';

/**
 * `/collab/translations` — the collaborator space (roleGuard admin + collaborator).
 * Only the AI translation flash cards: collaborators review the cards of the
 * languages they speak; the rest of the pipeline stays on /admin/translations.
 * Access on the DB side: migration 20261121120000_translation_cards_collaborators.
 */
@Component({
  selector: 'sc-collab-translations',
  standalone: true,
  imports: [TranslatePipe, PageHeaderComponent, TranslationCardsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-page-header
      [eyebrow]="'collab.eyebrow' | translate"
      [title]="'nav.translations' | translate"
      [subtitle]="'collab.translations.subtitle' | translate" />
    <sc-translation-cards [languages]="languages()" />
  `,
  styles: [':host { display: block; }'],
})
export class CollabTranslationsComponent implements OnInit {
  private readonly svc = inject(TranslationsService);
  readonly languages = signal<TranslationLanguage[]>([]);

  ngOnInit(): void {
    // Without the language list the cards still work for "all languages"; only the overview stays empty.
    this.svc.listLanguages().then(
      (l) => this.languages.set(l ?? []),
      (e) => logWarn('collab-translations', 'languages load failed', e),
    );
  }
}
