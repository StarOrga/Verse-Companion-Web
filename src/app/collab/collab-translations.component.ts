import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { TranslationCardsComponent } from '../admin/translations/translation-cards.component';

/**
 * `/collab/translations` — the collaborator space (roleGuard admin + collaborator).
 * Only the AI translation flash cards: collaborators pick the languages they speak in the
 * cards' own goal box and decide those cards; the rest of the pipeline stays on
 * /admin/translations. Access on the DB side: migration 20261122120000_translation_cards_collaborators.
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
    <sc-translation-cards />
  `,
  styles: [':host { display: block; }'],
})
export class CollabTranslationsComponent {}
