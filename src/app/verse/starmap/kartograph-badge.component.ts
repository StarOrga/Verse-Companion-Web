import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { VerseApiService } from '../data/verse-api.service';
import type { VersePoint } from '../data/verse.models';
import { BADGE_SIZE, renderKartographBadge } from './constellation-render';
import { SINGLE_STAR, KartographBadge, STARS_PER_PATCH, parseBadge } from './starmap.model';
import { ScActionDirective } from '../../shared/action/sc-action.directive';

/** Caption strings of a badge, shared by the public page and the share export. */
export function badgeCaption(t: TranslateService, b: KartographBadge): { title: string; subtitle: string } {
  return {
    title: t.instant('starmap.badge.caption', { rank: b.rank }),
    subtitle: t.instant('starmap.badge.captionSub', { patch: b.patch, stars: b.stars, total: STARS_PER_PATCH }),
  };
}

/**
 * Public Kartograph badge (`/badge/kartograph?rank&patch&stars&sun`): what a
 * friend opens from a shared link. Everything it shows travels in the link —
 * no user id, no account lookup; only the patch's constellation shape is read
 * (verse_constellations is public).
 */
@Component({
  selector: 'sc-kartograph-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, ScActionDirective],
  template: `
    @if (badge(); as b) {
      <section class="badge">
        <canvas #canvas [width]="size.width" [height]="size.height" role="img"
                [attr.aria-label]="'starmap.badge.aria' | translate: { rank: b.rank, patch: b.patch }"></canvas>
        <h1>{{ 'starmap.badge.caption' | translate: { rank: b.rank } }}</h1>
        <p class="muted">{{ 'starmap.badge.explain' | translate }}</p>
        <a scAction tier="primary" routerLink="/verse/explorer">{{ 'starmap.badge.cta' | translate }}</a>
      </section>
    } @else {
      <section class="badge">
        <p>{{ 'starmap.badge.invalid' | translate }}</p>
        <a scAction tier="secondary" routerLink="/verse">{{ 'starmap.badge.toVerse' | translate }}</a>
      </section>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .badge { display: flex; flex-direction: column; gap: var(--sc-gap-2); align-items: flex-start; max-width: 860px; }
      canvas { width: 100%; height: auto; aspect-ratio: 1200 / 630; border-radius: 12px; border: 1px solid var(--sc-border); background: var(--sc-bg-0); }
      h1 { font: 700 1.6rem var(--sc-font-display); margin: 0; color: var(--sc-fg-0); }
      .muted { color: var(--sc-fg-2); margin: 0; }
    `,
  ],
})
export class KartographBadgeComponent {
  private readonly api = inject(VerseApiService);
  private readonly t = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);

  readonly size = BADGE_SIZE;
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly badge = computed(() => parseBadge(this.query()));
  private readonly points = signal<readonly VersePoint[]>(SINGLE_STAR);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly lang = toSignal(this.t.onLangChange);

  constructor() {
    effect(() => {
      const b = this.badge();
      if (!b) return;
      void this.api.constellation(b.patch).then((r) => {
        if (r.ok && r.data?.points.length === 7) this.points.set(r.data.points);
      });
    });
    effect(() => {
      this.lang();
      const b = this.badge();
      const ctx = this.canvas()?.nativeElement.getContext('2d');
      if (!b || !ctx) return;
      renderKartographBadge(ctx, {
        ...BADGE_SIZE,
        ...badgeCaption(this.t, b),
        constellation: { patchLine: b.patch, points: this.points(), starCount: b.stars, sun: b.sun },
      });
    });
  }
}
