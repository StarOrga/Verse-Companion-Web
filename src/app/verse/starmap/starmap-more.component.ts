import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../../core/analytics.service';
import { logWarn } from '../../core/log';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseCommunityStars, VerseExplorerPatch, VerseExplorerState } from '../data/verse.models';
import { ConstellationFigureComponent } from './constellation-figure.component';
import {
  RenderConstellation,
  animateConstellation,
  downloadBlob,
  renderConstellationPng,
  renderKartographBadgePng,
} from './constellation-render';
import { badgeCaption } from './kartograph-badge.component';
import { RankIdeasComponent } from './rank-ideas.component';
import { shareImage } from './share-image';
import { SPLINTERS_PER_SUN, STARS_PER_PATCH, badgeQuery, communityLevels, defaultPatch, foldSplinters, hasTierReward, isLiveDay, rankProgressOf, supernovaPoints } from './starmap.model';
import { wallpaperConstellations } from './wallpaper';

/**
 * The former "Logbuch" sheet of the star map, now two parts of the rank page:
 *   - `part="series"`  the series rewards in use (supernova download, live
 *                       preview, meteor shower note) under the series road;
 *   - `part="logbook"` community constellation, sun collection, badge share
 *                       (rank reward from tier 2) and the reward ideas.
 * The rank itself lives on the rank page, its explanation in the tour.
 */
@Component({
  selector: 'sc-starmap-more',
  host: { '[attr.data-part]': 'part()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ScActionDirective, ConstellationFigureComponent, RankIdeasComponent],
  template: `
    @let st = state();
    @let p = patch();
    @if (part() === 'logbook') {
    <section class="block card community" aria-labelledby="sm-community">
      <h3 id="sm-community">{{ 'starmap.community.title' | translate }}</h3>
      <div class="community-row">
        @if (community(); as c) {
          <sc-constellation-figure class="community-fig" size="small" [points]="p.constellation?.points" [levels]="communityLevelsOf(p, c)" />
        }
        <div class="community-txt">
          @if (community(); as c) {
            <p>{{ 'starmap.community.count' | translate: { explorers: c.explorers } }}</p>
          }
          <p class="muted">{{ (p.unlocks.community ? 'starmap.community.on' : 'starmap.community.off') | translate }}</p>
        </div>
      </div>
    </section>

    <section class="block card" aria-labelledby="sm-suns">
      <h3 id="sm-suns">{{ 'starmap.suns.title' | translate }}</h3>
      @if (st.suns.length || splinterSuns().suns > 0 || splinterSuns().rest > 0) {
        <ul class="suns">
          @for (s of st.suns; track s) { <li><span class="sun-dot" aria-hidden="true"></span>{{ s }}</li> }
          @for (n of splinterSunIdx(); track n) {
            <li class="small-sun"><span class="sun-dot small" aria-hidden="true"></span>{{ 'starmap.suns.small' | translate }}</li>
          }
          @if (splinterSuns().rest > 0) {
            <li class="splinter"><span class="sun-dot splinter-dot" aria-hidden="true"></span>{{ 'starmap.suns.splinter' | translate: { n: splinterSuns().rest, per: splintersPerSun } }}</li>
          }
        </ul>
      } @else {
        <p class="muted">{{ 'starmap.suns.none' | translate }}</p>
      }
    </section>
    }

    @if (part() === 'series' && (st.rewards.supernova || st.rewards.live || st.rewards.meteor)) {
      <section class="block">
        @if (st.rewards.supernova) {
          <button type="button" scAction tier="secondary" [busy]="exporting()" [disabled]="exporting()" (click)="exportSupernova()">
            {{ 'starmap.reward.supernova.download' | translate }}
          </button>
        }
        @if (st.rewards.live) {
          <canvas #live class="live" width="640" height="360" [attr.aria-label]="'starmap.reward.live.preview' | translate" role="img"></canvas>
        }
        @if (st.rewards.meteor) {
          <p class="muted small">{{ (meteorToday() ? 'starmap.reward.meteor.today' : 'starmap.reward.meteor.notToday') | translate }}</p>
        }
        @if (exportError()) { <p class="err" role="alert">{{ exportError()! | translate }}</p> }
      </section>
    }

    @if (part() === 'logbook') {
    <section class="block card wide" aria-labelledby="sm-extras">
      <h3 id="sm-extras">{{ 'starmap.rankPage.extrasTitle' | translate }}</h3>
      @if (badgeOn()) {
        <button type="button" class="share" scAction tier="secondary" [busy]="sharing()" [disabled]="sharing()" (click)="shareBadge()">
          <svg class="ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <circle cx="18" cy="5" r="2.6" /><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="19" r="2.6" />
            <path d="M8.3 10.8 15.7 6.3M8.3 13.2l7.4 4.5" />
          </svg>
          {{ 'starmap.badge.share' | translate }}
        </button>
      } @else {
        <p class="muted">{{ 'starmap.kartograph.locked' | translate }}</p>
      }
      @if (sgStatus()) { <p class="small" role="status">{{ sgStatus()! | translate }}</p> }
      <sc-rank-ideas [tier]="tier()" />
    </section>
    }
  `,
  styles: [
    `
      /* Logbook: the rank page's card grid (same surface as the reward cards above). */
      :host { display: flex; flex-direction: column; gap: var(--sc-gap-3); }
      :host([data-part='series']) { margin-top: 10px; }
      :host([data-part='logbook']) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: stretch; }
      @media (max-width: 700px) { :host([data-part='logbook']) { grid-template-columns: minmax(0, 1fr); } }
      .block { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; min-width: 0; }
      .card { padding: 14px 16px; border-radius: 12px; border: 1px solid var(--sc-border); background: color-mix(in srgb, var(--sc-bg-1) 70%, transparent); }
      .card p { font-size: 0.85rem; line-height: 1.45; }
      .wide { grid-column: 1 / -1; }
      h3 { font: 600 0.95rem var(--sc-font-display); margin: 0; color: var(--sc-fg-0); }
      .community-row { display: flex; gap: var(--sc-gap-1); align-items: center; }
      .community-txt { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: var(--sc-fg-1); font-weight: 400; }
      h4 { font: 600 0.85rem var(--sc-font-display); margin: var(--sc-gap-2) 0 2px; color: var(--sc-fg-0); }
      p { margin: 0; }
      .muted { color: var(--sc-fg-2); }
      .small { font-size: 0.75rem; }
      .err { color: var(--sc-danger); }
      .link { color: var(--sc-accent); min-height: 36px; display: inline-flex; align-items: center; }
      .link:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
      ul { list-style: none; margin: 0; padding: 0; }
      .community-fig { flex: none; width: 96px; }
      .suns { display: flex; flex-wrap: wrap; gap: var(--sc-gap-2); }
      .suns li { display: inline-flex; align-items: center; gap: 4px; }
      .sun-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sc-warning); box-shadow: 0 0 6px var(--sc-warning); }
      .sun-dot.small { width: 5px; height: 5px; opacity: 0.85; }
      .splinter { color: var(--sc-fg-2); font-size: 0.8rem; }
      .splinter-dot { width: 3px; height: 3px; opacity: 0.6; box-shadow: none; }
      .live { display: block; width: 100%; height: auto; border-radius: 8px; }
      .ico { fill: currentColor; stroke: currentColor; stroke-width: 1.6; }
      sc-rank-ideas { width: 100%; margin-top: 6px; padding-top: 14px; border-top: 1px solid var(--sc-border); }
    `,
  ],
})
export class StarmapMoreComponent {
  readonly state = input.required<VerseExplorerState>();
  /** The patch the map shows. */
  readonly patch = input.required<VerseExplorerPatch>();
  readonly part = input<'series' | 'logbook'>('logbook');

  private readonly api = inject(VerseApiService);
  private readonly t = inject(TranslateService);
  private readonly analytics = inject(AnalyticsService);
  private readonly destroyRef = inject(DestroyRef);

  /** The reader's tier from lit stars (a reader with stars but no finished map has one too). */
  readonly tier = computed(() => rankProgressOf(this.state()).tier);
  /** The shareable badge is the tier-2 rank reward. */
  readonly badgeOn = computed(() => hasTierReward(this.tier(), 'badge'));
  /** Sun splinters folded: every 3 = one small sun, the rest shows as n of 3. Never a star. */
  readonly splinterSuns = computed(() => foldSplinters(this.state().sunSplinters));
  readonly splinterSunIdx = computed(() => Array.from({ length: this.splinterSuns().suns }, (_, i) => i));
  readonly splintersPerSun = SPLINTERS_PER_SUN;
  private readonly current = computed(() => defaultPatch(this.state()));
  /** sr-meteor only on the newest patch's LIVE day (the Starscape app's rule). */
  readonly meteorToday = computed(() => isLiveDay(this.current()?.liveAt));
  readonly community = signal<VerseCommunityStars | null>(null);
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  readonly sharing = signal(false);
  /** Status line of the badge share (link copied). */
  readonly sgStatus = signal<string | null>(null);
  private readonly liveCanvas = viewChild<ElementRef<HTMLCanvasElement>>('live');

  constructor() {
    effect(() => {
      const line = this.patch().patchLine;
      this.community.set(null);
      if (this.part() !== 'logbook') return;
      void this.api.communityStars(line).then((r) => {
        if (r.ok && this.patch().patchLine === line) this.community.set(r.data);
      });
    });
    let stop: (() => void) | null = null;
    effect(() => {
      const canvas = this.liveCanvas()?.nativeElement;
      const st = this.state();
      const p = this.current();
      stop?.();
      stop = null;
      if (!canvas || !p) return;
      stop = animateConstellation(canvas, {
        width: canvas.width,
        height: canvas.height,
        seed: p.patchLine,
        constellations: wallpaperConstellations(st, p),
        nebula: st.rewards.nebula,
        road: st.rewards.road,
        meteor: st.rewards.meteor && isLiveDay(p.liveAt),
      });
    });
    this.destroyRef.onDestroy(() => stop?.());
  }

  communityLevelsOf(p: VerseExplorerPatch, c: VerseCommunityStars): number[] {
    return communityLevels(p.offered, c.stars, c.explorers);
  }

  /** Friend badge: rank + newest constellation as an image, link to the public badge page. */
  async shareBadge(): Promise<void> {
    const st = this.state();
    const p = this.current();
    if (!p || !this.badgeOn()) return;
    this.sharing.set(true);
    const badge = { rank: this.tier(), patch: p.patchLine, stars: Math.min(STARS_PER_PATCH, p.starCount), sun: p.sun };
    const url = `${location.origin}/badge/kartograph?${new URLSearchParams(badgeQuery(badge)).toString()}`;
    try {
      const blob = await renderKartographBadgePng({
        ...badgeCaption(this.t, badge),
        constellation: wallpaperConstellations(st, p)[0],
      });
      const channel = await shareImage(blob, `sc-kartograph-${badge.rank}.png`, badgeCaption(this.t, badge).title, url);
      if (channel) this.analytics.track('verse:starscape_share', { image_id: `kartograph-${badge.rank}-${badge.patch}`, channel });
      if (channel === 'copy') {
        this.sgStatus.set('starmap.gallery.copied');
      }
    } catch (err) {
      logWarn('starmap', 'badge share failed', err);
    } finally {
      this.sharing.set(false);
    }
  }

  async exportSupernova(): Promise<void> {
    const st = this.state();
    const p = this.patch();
    // Seed contract shared with the Starscape app: 'supernova:<newest line>'.
    const newest = st.patches[0]?.patchLine ?? p.patchLine;
    const nova: RenderConstellation = { patchLine: newest, points: supernovaPoints(newest), starCount: 7, sun: false };
    this.exporting.set(true);
    this.exportError.set(null);
    try {
      const blob = await renderConstellationPng({
        seed: `supernova:${newest}`,
        constellations: [nova, ...wallpaperConstellations(st, p).slice(0, 6)],
        nebula: true,
        road: st.rewards.road,
        supernova: true,
      });
      downloadBlob(blob, `sc-supernova-${newest}-4k.png`);
    } catch (err) {
      logWarn('starmap', 'export failed', err);
      this.exportError.set('starmap.export.failed');
    } finally {
      this.exporting.set(false);
    }
  }
}
