import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, HostListener, OnDestroy, OnInit, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, RouterOutlet } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleService } from '../core/locale/locale.service';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { NewsService } from './news.service';
import { findInStack, findTotal, type FindGroup } from './patch-find';
import { PatchFindResultsComponent } from './patch-find-results.component';
import {
  cardImage, cardsInBucket, channelTimes, daysBetween, headlineBullets, liveLineView, ms, previewCards, ptuRows,
  roadmapChips, standInLabel, type PtuRow, type RoadmapBucket,
} from './patch-board-model';
import { PatchReadService } from './patch-read.service';
import { buildPatchStack, stackCards, type StackCard } from './patch-stack';
import { tokenizeQuery } from './patch-search';
import { computePatchForecast } from './patch-stats';
import { subVersionRows, type SubVersionRow } from './patch-timeline';
import type { RoadmapCard } from './roadmap';
import { RoadmapService, threadSlugOf } from './roadmap.service';

const DAY_MS = 86_400_000;

/**
 * `/verse/patches` — the patch board "Live first" (concept 20261110-1749,
 * round 5). Live / PTU is a switch in the URL (`?view=ptu`); Live opens with two
 * boxes (what just came to Live, what comes next) and a timeline whose rail
 * and dates hang out to the left of the page frame; PTU lists every single test
 * build. Notes carry a read state (`PatchReadService`): the newest unread note
 * is badged until the reader confirms, the content stays visible afterwards.
 *
 * The previous board (`patch-board.component.ts`) is untouched; the switch
 * between the two is `PATCH_BOARD_V2` in `patch-board-flag.ts`.
 */
@Component({
  selector: 'sc-patch-board-v2',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe, RouterLink, RouterOutlet, ScActionDirective, ScTooltipDirective, PatchFindResultsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pb">
      @if (!svc.feed() && svc.error(); as err) {
        <div class="sc-card err" role="alert">
          <span><strong>{{ 'news.errorTitle' | translate }}:</strong> {{ err | translate }}</span>
          <button scAction tier="secondary" type="button" [busy]="svc.loading()" (click)="retry()">{{ 'errors.retry' | translate }}</button>
        </div>
      } @else if (svc.loading() && !svc.feed()) {
        <p class="loading" role="status">{{ 'news.loading' | translate }}</p>
      } @else if (searching()) {
        <p class="s-summary" role="status">
          {{ 'news.patch.find.summary' | translate:{ hits: findTotal(), patches: findGroups().length, loaded: roadmap.loadedOutlineCount(), total: allSlugs().length } }}
        </p>
        @if (findGroups().length === 0) {
          <p class="empty">{{ 'news.patch.search.noHits' | translate }}</p>
        } @else {
          <sc-patch-find-results [groups]="findGroups()" [query]="searchQuery()" [tokens]="tokens()" />
        }
      } @else {
        <div class="switchrow">
          <nav class="switch" [attr.aria-label]="'news.patchBoard.switch.aria' | translate">
            <a [routerLink]="['/verse/patches']" [queryParams]="{ view: null }" queryParamsHandling="merge"
               [class.on]="view() === 'live'" [attr.aria-current]="view() === 'live' ? 'page' : null">
              {{ 'news.patchBoard.switch.live' | translate }}
              @if (liveUnread()) { <i class="dot" role="img" [attr.aria-label]="'news.patchBoard.unread' | translate"></i> }
            </a>
            <a [routerLink]="['/verse/patches']" [queryParams]="{ view: 'ptu' }" queryParamsHandling="merge"
               class="ptu" [class.on]="view() === 'ptu'" [attr.aria-current]="view() === 'ptu' ? 'page' : null">
              {{ 'news.patchBoard.switch.ptu' | translate }}
              @if (ptuUnread()) { <i class="dot" role="img" [attr.aria-label]="'news.patchBoard.unread' | translate"></i> }
            </a>
          </nav>
          <p class="switch-hint">{{ (view() === 'live' ? 'news.patchBoard.switch.liveHint' : 'news.patchBoard.switch.ptuHint') | translate }}</p>
        </div>

        @if (view() === 'live') {
          <div class="head">
            <!-- Left: what just came to Live -->
            <article class="box now" [class.unread]="liveUnread()" [attr.aria-labelledby]="'pb-now-h'">
              @if (liveHead(); as h) {
                <ng-container [ngTemplateOutlet]="art" [ngTemplateOutletContext]="{ img: liveImage(), label: stand(live()) }" />
                <div class="box-in">
                  <div class="bh">
                    <h2 id="pb-now-h">{{ 'news.patchBoard.now.title' | translate }}</h2>
                    @if (liveUnread()) { <span class="newbadge">{{ 'news.patchBoard.newForYou' | translate }}</span> }
                  </div>
                  <p class="ver"><b>{{ h.version || live()!.line }}</b> <span class="tag live">{{ 'news.patch.status.live' | translate }}</span></p>
                  <p class="when">
                    {{ 'news.patchBoard.now.since' | translate:{ date: dateLong(h.publishedAt) } }}
                    · {{ since(h.publishedAt) }}
                  </p>
                  @if (liveBullets().length) {
                    <ul class="list">
                      @for (b of liveBullets(); track b) { <li>{{ b }}</li> }
                    </ul>
                  }
                  <div class="acts">
                    <a scAction tier="primary" [routerLink]="['/verse/patches', live()!.line]" [queryParams]="{ note: h.id }">
                      {{ 'news.patchBoard.readFull' | translate }} →
                    </a>
                    @if (liveUnread()) {
                      <button scAction tier="secondary" type="button" (click)="confirm('live')">✓ {{ 'news.patchBoard.markRead' | translate }}</button>
                    } @else {
                      <span class="readnote">✓ {{ 'news.patchBoard.readOn' | translate:{ date: readOn('live') } }}</span>
                      <button scAction tier="secondary" type="button" (click)="unconfirm('live', h)">{{ 'news.patchBoard.readAgain' | translate }}</button>
                    }
                  </div>
                </div>
              } @else {
                <div class="box-in"><h2 id="pb-now-h">{{ 'news.patchBoard.now.title' | translate }}</h2><p class="when">{{ 'news.patchBoard.now.none' | translate }}</p></div>
              }
            </article>

            <!-- Right: what comes next on Live -->
            <article class="box next" aria-labelledby="pb-next-h">
              @if (next(); as n) {
                <ng-container [ngTemplateOutlet]="art" [ngTemplateOutletContext]="{ img: nextImage(), label: stand(n) }" />
                <div class="box-in">
                  <div class="bh">
                    <h2 id="pb-next-h">{{ 'news.patchBoard.next.title' | translate }}</h2>
                    <span class="tag ptu">{{ nextStatus(n) }}</span>
                  </div>
                  <p class="ver"><b>{{ 'news.patch.line' | translate:{ version: n.line } }}</b></p>
                  <p class="when">{{ nextWhen() }}</p>
                  @if (chips().length) {
                    <div class="rm-wrap">
                      <div class="chips" role="group" [attr.aria-label]="'news.patchBoard.roadmap.aria' | translate">
                        @for (c of chips(); track c.bucket) {
                          <button type="button" class="chip" [class.open]="openBucket() === c.bucket"
                                  [attr.aria-expanded]="openBucket() === c.bucket" [attr.aria-controls]="'pb-pop'"
                                  (click)="toggleBucket(c.bucket, $event)">
                            <b>{{ c.count }}</b> {{ ('news.patchBoard.roadmap.' + c.bucket) | translate }}
                          </button>
                        }
                      </div>
                      @if (openBucket(); as b) {
                        <div class="pop" id="pb-pop" role="dialog" [attr.aria-label]="('news.patchBoard.roadmap.' + b) | translate">
                          <p class="pop-h">
                            <b>{{ ('news.patchBoard.roadmap.' + b) | translate }}</b>
                            <button type="button" class="x" [attr.aria-label]="'news.patchBoard.close' | translate"
                                    [scTooltip]="'news.patchBoard.close' | translate" scTooltipTier="label" (click)="closePop()">×</button>
                          </p>
                          <ul>
                            @for (it of bucketCards(b); track it.id) { <li>{{ it.name }}@if (it.category) { <small>{{ it.category }}</small> }</li> }
                          </ul>
                        </div>
                      }
                    </div>
                    <ul class="items">
                      @for (it of preview(); track it.id) {
                        <li><i class="st" [attr.data-status]="it.status"></i>{{ it.name }}</li>
                      }
                    </ul>
                  }
                  @if (thumbs().length) {
                    <div class="thumbs" aria-hidden="true">
                      @for (t of thumbs(); track t) { <img [src]="t" alt="" loading="lazy" decoding="async" /> }
                    </div>
                  }
                  <div class="acts">
                    <a scAction tier="secondary" [routerLink]="['/verse/patches']" [queryParams]="{ view: 'ptu' }" queryParamsHandling="merge">
                      {{ 'news.patchBoard.allAbout' | translate:{ line: n.line } }} →
                    </a>
                  </div>
                </div>
              } @else {
                <div class="box-in"><h2 id="pb-next-h">{{ 'news.patchBoard.next.title' | translate }}</h2><p class="when">{{ 'news.patchBoard.next.none' | translate }}</p></div>
              }
            </article>
          </div>

          <ol class="tl" [attr.aria-label]="'news.patch.stack.aria' | translate">
            @for (card of cards(); track card.line) {
              <li class="row" [attr.data-status]="card.status">
                <div class="date">
                  <b>{{ rowDate(card) }}</b>
                  <small>{{ rowDays(card) }}</small>
                </div>
                <div class="card">
                  <ng-container [ngTemplateOutlet]="art" [ngTemplateOutletContext]="{ img: imageOf(card), label: stand(card), fade: true }" />
                  <div class="ch">
                    @if (isNext(card)) {
                      <a class="card-link" [attr.aria-label]="'news.patchBoard.allAbout' | translate:{ line: card.line }"
                         [routerLink]="['/verse/patches']" [queryParams]="{ view: 'ptu' }" queryParamsHandling="merge"></a>
                    } @else {
                      <a class="card-link" [attr.aria-label]="'news.patch.stack.openDossier' | translate:{ name: ('news.patch.line' | translate:{ version: card.line }) }"
                         [routerLink]="['/verse/patches', card.line]"></a>
                    }
                    <span class="pill" [attr.data-status]="card.status">{{ pill(card) }}</span>
                    <span class="cver">{{ 'news.patch.line' | translate:{ version: card.line } }}</span>
                    <span class="sent">{{ sentence(card) }}</span>
                  </div>
                  @if (rowsOf(card); as view2) {
                    @if (view2.latest; as top) {
                      <div class="subs">
                        <a class="sv top" [routerLink]="['/verse/patches', card.line]" [queryParams]="{ note: top.id }">
                          <span class="sl">{{ top.version }}</span>
                          <span class="svt">{{ top.title }}</span>
                          @if (isUnread(top)) { <i class="dot" role="img" [attr.aria-label]="'news.patchBoard.unread' | translate"></i> }
                          <time>{{ dateShort(top.publishedAt) }}</time>
                        </a>
                        @if (view2.earlier.length) {
                          <button type="button" class="bundle" [attr.aria-expanded]="isOpen(card.line)" (click)="toggleOpen(card.line)">
                            <span class="caret" aria-hidden="true">›</span>
                            {{ (isOpen(card.line) ? 'news.patchBoard.earlierHide' : 'news.patchBoard.earlier') | translate:{ n: view2.earlier.length } }}
                          </button>
                          @if (isOpen(card.line)) {
                            @for (r of view2.earlier; track r.id) {
                              <a class="sv" [routerLink]="['/verse/patches', card.line]" [queryParams]="{ note: r.id }">
                                <span class="sl">{{ r.version }}</span>
                                <span class="svt">{{ r.title }}</span>
                                @if (isUnread(r)) { <i class="dot" aria-hidden="true"></i> }
                                <time>{{ dateShort(r.publishedAt) }}</time>
                              </a>
                            }
                          }
                        }
                      </div>
                    }
                  }
                </div>
              </li>
            }
            @if (stack().older.length) {
              <li class="row fold">
                <button type="button" class="fold-btn" [attr.aria-expanded]="olderOpen()" (click)="olderOpen.set(!olderOpen())">
                  <span class="caret" aria-hidden="true">›</span>
                  {{ (olderOpen() ? 'news.patch.stack.olderHide' : 'news.patch.stack.older') | translate:{ n: stack().older.length, lines: olderLines() } }}
                </button>
              </li>
            }
          </ol>
        } @else {
          <!-- PTU tab: the newest test build in a box, then every build as a row -->
          @if (ptu().length === 0) {
            <p class="empty">{{ 'news.patchBoard.ptu.empty' | translate }}</p>
          } @else {
            @let top = ptu()[0];
            <div class="head one">
              <article class="box next" [class.unread]="ptuUnread()" aria-labelledby="pb-ptu-h">
                <ng-container [ngTemplateOutlet]="art" [ngTemplateOutletContext]="{ img: top.image, label: top.line }" />
                <div class="box-in">
                  <div class="bh">
                    <h2 id="pb-ptu-h">{{ 'news.patchBoard.ptu.newest' | translate }}</h2>
                    @if (ptuUnread()) { <span class="newbadge">{{ 'news.patchBoard.newForYou' | translate }}</span> }
                  </div>
                  <p class="ver"><b>{{ top.version || top.line }}</b> <span class="tag ptu">{{ ptuPill(top) }}</span></p>
                  <p class="when">{{ dateLong(top.publishedAt) }} · {{ since(top.publishedAt) }}</p>
                  @if (ptuBullets().length) {
                    <ul class="list">@for (b of ptuBullets(); track b) { <li>{{ b }}</li> }</ul>
                  }
                  <div class="acts">
                    <a scAction tier="primary" [routerLink]="['/verse/patches', top.line]" [queryParams]="{ note: top.id }">{{ 'news.patchBoard.readFull' | translate }} →</a>
                    @if (ptuUnread()) {
                      <button scAction tier="secondary" type="button" (click)="confirm('ptu')">✓ {{ 'news.patchBoard.markRead' | translate }}</button>
                    } @else {
                      <span class="readnote">✓ {{ 'news.patchBoard.readOn' | translate:{ date: readOn('ptu') } }}</span>
                      <button scAction tier="secondary" type="button" (click)="unconfirmPtu(top)">{{ 'news.patchBoard.readAgain' | translate }}</button>
                    }
                  </div>
                </div>
              </article>
              <ng-content select="[pbNext]" />
            </div>

            <ol class="tl" [attr.aria-label]="'news.patchBoard.ptu.aria' | translate">
              @for (r of ptu(); track r.id) {
                <li class="row" data-status="ptu">
                  <div class="date">
                    <b>{{ dateLong(r.publishedAt) }}</b>
                    <small>{{ since(r.publishedAt) }}</small>
                  </div>
                  <div class="card">
                    <ng-container [ngTemplateOutlet]="art" [ngTemplateOutletContext]="{ img: r.image, label: r.line, fade: true }" />
                    <button type="button" class="ch ptu-head" [attr.aria-expanded]="ptuOpen(r)" (click)="togglePtu(r.id)">
                      <span class="pill" data-status="ptu">{{ ptuPill(r) }}</span>
                      <span class="cver">{{ r.version || r.line }}</span>
                      <span class="sent">{{ r.title }}</span>
                      @if (!read.isRead('ptu', ms(r.publishedAt))) { <i class="dot" role="img" [attr.aria-label]="'news.patchBoard.unread' | translate"></i> }
                    </button>
                    @if (ptuOpen(r)) {
                      <div class="subs open">
                        @if (bulletsOf(r.url).length) {
                          <ul class="list">@for (b of bulletsOf(r.url); track b) { <li>{{ b }}</li> }</ul>
                        }
                        <a class="more" [routerLink]="['/verse/patches', r.line]" [queryParams]="{ note: r.id }">{{ 'news.patchBoard.readFull' | translate }} →</a>
                      </div>
                    }
                  </div>
                </li>
              }
            </ol>
          }
        }
      }
    </section>

    <ng-template #art let-img="img" let-label="label" let-fade="fade">
      <span class="art" [class.fade]="fade" aria-hidden="true">
        @if (img) {
          <img [src]="img" alt="" loading="lazy" decoding="async" />
        } @else {
          <span class="stand"><b>{{ label }}</b></span>
        }
      </span>
    </ng-template>

    <router-outlet />
  `,
  styles: [`
    :host { display: block; }
    .pb { display: flex; flex-direction: column; gap: 14px; }
    .loading, .err, .empty, .s-summary { padding: 14px 4px; margin: 0; color: var(--sc-fg-2); }
    .err { color: var(--sc-danger); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 16px; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--sc-accent); box-shadow: 0 0 6px var(--sc-accent); flex: none; }

    /* Live / PTU switch (a segment switch, real anchors so back works) */
    .switchrow { display: flex; align-items: center; gap: 8px 16px; flex-wrap: wrap; }
    .switch { display: inline-flex; padding: 3px; border: 1px solid var(--sc-border); border-radius: 999px; background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); }
    .switch a {
      display: inline-flex; align-items: center; gap: 8px; min-height: var(--sc-tap-min); padding: 0 18px; border-radius: 999px;
      color: var(--sc-fg-1); text-decoration: none; font-size: max(0.84rem, var(--sc-fs-floor));
    }
    .switch a:hover { color: var(--sc-fg-0); }
    .switch a.on { background: var(--sc-success); color: var(--sc-bg-0); font-weight: 700; }
    .switch a.ptu.on { background: var(--sc-accent); }
    .switch a.on .dot { background: var(--sc-bg-0); box-shadow: none; }
    .switch a:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    .switch-hint { margin: 0; color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor)); }

    /* Header boxes */
    .head { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 14px; align-items: stretch; }
    .head.one { grid-template-columns: minmax(0, 1fr); }
    .box {
      position: relative; border: 1px solid var(--sc-border); border-radius: 12px;
      background: color-mix(in srgb, var(--sc-bg-1) 94%, transparent);
    }
    .box.now { border-color: color-mix(in srgb, var(--sc-success) 55%, var(--sc-border)); background: linear-gradient(135deg, color-mix(in srgb, var(--sc-success) 10%, transparent), color-mix(in srgb, var(--sc-bg-1) 60%, transparent) 60%), color-mix(in srgb, var(--sc-bg-1) 94%, transparent); }
    .box.next { border-color: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border)); background: linear-gradient(135deg, color-mix(in srgb, var(--sc-accent) 10%, transparent), color-mix(in srgb, var(--sc-bg-1) 60%, transparent) 60%), color-mix(in srgb, var(--sc-bg-1) 94%, transparent); }
    .box.unread { box-shadow: inset 3px 0 0 var(--sc-accent), 0 0 24px -14px var(--sc-accent); }
    .box-in { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; }
    .bh { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .bh h2 { margin: 0; font-family: var(--sc-font-display); font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-fg-2); font-weight: 600; }
    .ver { margin: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ver b { font-family: var(--sc-font-display); font-size: 1.5rem; font-weight: 600; color: var(--sc-fg-0); letter-spacing: 0.02em; }
    .when { margin: 0; color: var(--sc-fg-1); font-size: max(0.8rem, var(--sc-fs-floor)); }
    .newbadge {
      display: inline-flex; align-items: center; padding: 1px 9px; border-radius: 999px; background: var(--sc-accent); color: var(--sc-bg-0);
      font-size: max(0.64rem, var(--sc-fs-floor)); font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
    }
    .tag {
      display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; white-space: nowrap;
      font-size: max(0.64rem, var(--sc-fs-floor)); font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
      color: var(--sc-fg-1); background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent);
    }
    .tag.live { color: var(--sc-bg-0); background: var(--sc-success); }
    .tag.ptu { color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 20%, transparent); }
    .list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-1); max-width: 62ch; }
    .list li { position: relative; padding-left: 16px; }
    .list li::before { content: ''; position: absolute; left: 2px; top: 0.6em; width: 6px; height: 6px; border-radius: 50%; background: var(--sc-accent); }
    .acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
    .readnote { font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-success); }

    /* Roadmap: one quiet line of chips, a compact list on click, up to four item lines */
    .rm-wrap { position: relative; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 10px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--sc-border); background: transparent; color: var(--sc-fg-2); font: inherit; font-size: max(0.74rem, var(--sc-fs-floor));
    }
    .chip b { font-family: var(--sc-font-display); font-weight: 600; color: var(--sc-fg-1); }
    .chip:hover, .chip.open { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .chip:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    .pop {
      position: absolute; z-index: 5; left: 0; top: calc(100% + 6px); width: min(320px, 100%); max-height: 220px; overflow: auto;
      padding: 8px 12px 10px; border: 1px solid var(--sc-accent); border-radius: 10px; background: var(--sc-bg-1);
      box-shadow: 0 14px 30px -12px rgba(0, 0, 0, 0.6);
    }
    .pop-h { display: flex; align-items: center; margin: 0 0 4px; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .pop-h .x { margin-left: auto; min-width: 28px; min-height: 28px; border: 0; background: transparent; color: var(--sc-fg-2); font-size: 1.1rem; cursor: pointer; }
    .pop-h .x:hover { color: var(--sc-fg-0); }
    .pop ul { margin: 0; padding: 0; list-style: none; }
    .pop li { display: flex; gap: 8px; padding: 3px 0; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-1); border-bottom: 1px solid color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .pop li small { margin-left: auto; color: var(--sc-fg-2); font-size: max(0.7rem, var(--sc-fs-floor)); white-space: nowrap; }
    .items { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .items li { display: flex; align-items: center; gap: 8px; }
    .st { width: 6px; height: 6px; border-radius: 50%; background: var(--sc-fg-2); flex: none; }
    .st[data-status='committed'] { background: var(--sc-success); }
    .st[data-status='tentative'] { background: var(--sc-accent); }
    .thumbs { display: flex; gap: 6px; }
    .thumbs img { width: 64px; height: 40px; object-fit: cover; border-radius: 5px; border: 1px solid color-mix(in srgb, var(--sc-accent) 35%, transparent); }

    /* Images: a patch image on the right fading out to the left; stand-in when there is none */
    .art { position: absolute; top: 0; right: 0; bottom: 0; width: 46%; overflow: hidden; border-radius: 0 12px 12px 0; pointer-events: none; z-index: 0;
      -webkit-mask-image: linear-gradient(to left, #000 15%, transparent 100%); mask-image: linear-gradient(to left, #000 15%, transparent 100%); opacity: 0.8; }
    .art.fade { width: 34%; opacity: 0.6; }
    .art img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .stand {
      display: flex; align-items: center; justify-content: flex-end; width: 100%; height: 100%; padding-right: 18px;
      background: repeating-linear-gradient(115deg, color-mix(in srgb, var(--sc-accent) 14%, transparent) 0 2px, transparent 2px 14px);
    }
    .stand b { font-family: var(--sc-font-display); font-size: 3.4rem; line-height: 1; color: color-mix(in srgb, var(--sc-fg-0) 16%, transparent); }
    .now .stand { background: repeating-linear-gradient(115deg, color-mix(in srgb, var(--sc-success) 16%, transparent) 0 2px, transparent 2px 14px); }

    /* Timeline: cards keep the frame width; rail + dates hang out to the left on wide screens */
    .tl { list-style: none; margin: 0; padding: 0; position: relative; display: flex; flex-direction: column; gap: 12px; }
    .row { position: relative; }
    .card { position: relative; overflow: hidden; border: 1px solid color-mix(in srgb, var(--sc-accent) 20%, var(--sc-border)); border-radius: 12px; background: color-mix(in srgb, var(--sc-bg-1) 92%, transparent); }
    .row[data-status='live'] .card { border-color: color-mix(in srgb, var(--sc-success) 55%, var(--sc-border)); background: linear-gradient(135deg, color-mix(in srgb, var(--sc-success) 10%, transparent), color-mix(in srgb, var(--sc-bg-1) 50%, transparent) 60%); }
    .row[data-status='next'] .card, .row[data-status='ptu'] .card { border-color: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border)); }
    .row[data-status='superseded'] .card, .row[data-status='other'] .card { opacity: 0.88; }
    .card:hover { border-color: var(--sc-accent); }
    .date { display: flex; flex-direction: column; gap: 1px; padding: 0 2px 4px; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .date b { font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor)); font-weight: 600; color: var(--sc-fg-0); }
    .ch {
      position: relative; z-index: 1; display: grid; grid-template-columns: 150px 170px minmax(0, 1fr) auto; align-items: center; gap: 8px 16px;
      width: 100%; padding: 12px 16px; color: inherit; font: inherit; text-align: left; background: transparent; border: 0;
    }
    button.ch { cursor: pointer; }
    .row[data-status='live'] .ch { padding-block: 16px; }
    .card-link { position: absolute; inset: 0; border-radius: 12px; }
    .card-link:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring-inset); }
    .ch:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring-inset); }
    .pill {
      display: inline-flex; justify-content: center; padding: 4px 8px; border-radius: 6px; font-family: var(--sc-font-display);
      font-size: max(0.66rem, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600; text-align: center; white-space: nowrap;
      color: var(--sc-fg-2); background: color-mix(in srgb, var(--sc-fg-2) 16%, transparent);
    }
    .pill[data-status='live'] { color: var(--sc-bg-0); background: var(--sc-success); }
    .pill[data-status='next'], .pill[data-status='ptu'] { color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 20%, transparent); }
    .cver { font-family: var(--sc-font-display); font-size: 1.15rem; font-weight: 600; color: var(--sc-fg-0); white-space: nowrap; }
    .row[data-status='live'] .cver { font-size: 1.7rem; }
    .sent { min-width: 0; color: var(--sc-fg-1); font-size: max(0.8rem, var(--sc-fs-floor)); padding-right: 30%; }
    .subs { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 2px; margin: 0 16px 12px 16px; padding-top: 6px; border-top: 1px solid color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .sv {
      display: grid; grid-template-columns: 72px minmax(0, 1fr) auto auto; gap: 10px; align-items: center; min-height: var(--sc-tap-min); padding: 4px 8px;
      border-radius: 8px; color: var(--sc-fg-1); text-decoration: none; font-size: max(0.8rem, var(--sc-fs-floor)); max-width: 70%;
    }
    .sv:hover { background: color-mix(in srgb, var(--sc-accent) 8%, transparent); color: var(--sc-fg-0); }
    .sv:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring-inset); }
    .sv.top .sl, .sv.top .svt { color: var(--sc-fg-0); font-weight: 600; }
    .sl { font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-0); }
    .svt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sv time { color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); white-space: nowrap; }
    .bundle, .more {
      display: inline-flex; align-items: center; gap: 8px; align-self: flex-start; min-height: var(--sc-tap-min); padding: 0 8px; border: 0; border-radius: 8px;
      background: transparent; color: var(--sc-fg-2); font: inherit; font-size: max(0.78rem, var(--sc-fs-floor)); cursor: pointer; text-decoration: none;
    }
    .bundle:hover, .more:hover { color: var(--sc-accent); }
    .bundle:focus-visible, .more:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    .bundle .caret { color: var(--sc-accent); transition: transform 0.16s ease; }
    .bundle[aria-expanded='true'] .caret { transform: rotate(90deg); }
    .subs.open .list { max-width: 70ch; }
    .fold-btn {
      display: flex; align-items: center; gap: 8px; width: 100%; min-height: var(--sc-tap-min); padding: 10px 16px; border: 1px dashed color-mix(in srgb, var(--sc-fg-2) 40%, transparent);
      border-radius: 10px; background: transparent; color: var(--sc-fg-2); font: inherit; font-size: max(0.78rem, var(--sc-fs-floor)); text-align: left; cursor: pointer;
    }
    .fold-btn:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .fold-btn:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    .fold-btn .caret { color: var(--sc-accent); transition: transform 0.16s ease; }
    .fold-btn[aria-expanded='true'] .caret { transform: rotate(90deg); }
    .fold .date { display: none; }

    /* Wide screens: the rail and the dates stand OUTSIDE the page frame, the cards keep its width. */
    @media (min-width: 1700px) {
      .tl::before {
        content: ''; position: absolute; left: -22px; top: 16px; bottom: 16px; width: 2px; border-radius: 2px;
        background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 55%, transparent), var(--sc-success) 40%, color-mix(in srgb, var(--sc-fg-2) 35%, transparent));
      }
      .row::before { content: ''; position: absolute; left: -27px; top: 22px; width: 12px; height: 12px; border-radius: 50%; background: var(--sc-fg-2); border: 2px solid var(--sc-bg-0); z-index: 1; }
      .row[data-status='live']::before { width: 16px; height: 16px; left: -29px; top: 20px; background: var(--sc-success); box-shadow: var(--sc-glow); }
      .row[data-status='next']::before, .row[data-status='ptu']::before { background: var(--sc-accent); }
      .date { position: absolute; right: calc(100% + 40px); top: 14px; width: 130px; text-align: right; padding: 0; }
    }
    @media (max-width: 900px) {
      .head { grid-template-columns: minmax(0, 1fr); }
      .ch { grid-template-columns: 96px minmax(0, 1fr); }
      .sent { grid-column: 1 / -1; padding-right: 0; }
      .sv { max-width: none; grid-template-columns: 60px minmax(0, 1fr) auto auto; }
      .art { width: 38%; opacity: 0.5; }
    }
  `],
})
export class PatchBoardV2Component implements OnInit, OnDestroy {
  /** Kept for the host's API parity with the previous board. */
  readonly embedded = input(false);
  readonly searchQuery = input('');
  readonly barSearch = input(true);
  /** Announced LIVE date of the next line (`YYYY-MM-DD`), when the digest carries one. */
  readonly announcedDate = input<string | null>(null);

  readonly svc = inject(NewsService);
  readonly roadmap = inject(RoadmapService);
  readonly read = inject(PatchReadService);
  private readonly t = inject(TranslateService);
  private readonly locale = inject(LocaleService);
  private readonly route = inject(ActivatedRoute, { optional: true });

  protected readonly ms = ms;
  readonly olderOpen = signal(false);
  private readonly openLines = signal<ReadonlySet<string>>(new Set());
  private readonly ptuToggled = signal<ReadonlySet<string>>(new Set());
  readonly openBucket = signal<RoadmapBucket | null>(null);
  readonly now = signal(Date.now());
  private readonly clock = setInterval(() => this.now.set(Date.now()), 60_000);

  /** `?view=ptu` selects the PTU tab; anything else is Live. */
  private readonly params = this.route ? toSignal(this.route.queryParamMap) : signal(null);
  readonly view = computed<'live' | 'ptu'>(() => (this.params()?.get('view') === 'ptu' ? 'ptu' : 'live'));

  readonly stack = computed(() => buildPatchStack(this.svc.patchLines(), this.roadmap.roadmap()));
  readonly forecast = computed(() => computePatchForecast(this.svc.patchLines()));
  readonly live = computed(() => this.stack().live);
  readonly next = computed(() => this.stack().next);
  readonly cards = computed<StackCard[]>(() => {
    const s = this.stack();
    return [s.next, s.live, s.last, ...(this.olderOpen() ? s.older : [])].filter((c): c is StackCard => c !== null);
  });
  readonly olderLines = computed(() => this.stack().older.map((c) => c.line || '…').join(' · '));

  // ---- query / search ----
  readonly tokens = computed(() => tokenizeQuery(this.searchQuery()));
  readonly searching = computed(() => this.tokens().length > 0);
  readonly findGroups = computed<FindGroup[]>(() => {
    if (!this.searching()) return [];
    const outlines = this.roadmap.outlines();
    return findInStack(stackCards(this.stack()), (slug) => outlines.get(slug) ?? null, this.tokens());
  });
  readonly findTotal = computed(() => findTotal(this.findGroups()));
  readonly allSlugs = computed<string[]>(() => {
    const out: string[] = [];
    for (const card of stackCards(this.stack())) {
      for (const e of card.group?.entries ?? []) {
        const slug = threadSlugOf(e.item.url);
        if (slug && !out.includes(slug)) out.push(slug);
      }
    }
    return out;
  });

  // ---- live header ----
  private readonly rowMap = computed(() => {
    const map = new Map<string, SubVersionRow[]>();
    for (const c of stackCards(this.stack())) map.set(c.line, subVersionRows(c, null));
    return map;
  });
  readonly liveHead = computed<SubVersionRow | null>(() => {
    const c = this.live();
    return c ? (liveLineView(this.rowMap().get(c.line) ?? []).latest) : null;
  });
  readonly liveImage = computed(() => (this.live() ? cardImage(this.live()!) : null));
  readonly nextImage = computed(() => (this.next() ? cardImage(this.next()!) : null));
  readonly liveBullets = computed(() => this.bulletsOf(this.liveHead()?.url ?? ''));
  readonly liveTimes = computed(() => channelTimes(this.svc.patchLines(), 'live'));
  readonly ptuTimes = computed(() => channelTimes(this.svc.patchLines(), 'ptu'));
  readonly liveUnread = computed(() => {
    const h = this.liveHead();
    return !!h && !this.read.isRead('live', ms(h.publishedAt));
  });
  readonly ptu = computed<PtuRow[]>(() => ptuRows(this.svc.patchLines()));
  readonly ptuUnread = computed(() => {
    const top = this.ptu()[0];
    return !!top && !this.read.isRead('ptu', ms(top.publishedAt));
  });
  readonly ptuBullets = computed(() => this.bulletsOf(this.ptu()[0]?.url ?? ''));

  // ---- roadmap ----
  private readonly nextCards = computed<readonly RoadmapCard[]>(() => this.next()?.release?.cards ?? []);
  readonly chips = computed(() => roadmapChips(this.nextCards()));
  readonly preview = computed(() => previewCards(this.nextCards(), 4));
  readonly thumbs = computed(() => this.nextCards().filter((c) => c.thumbnail).slice(0, 4).map((c) => c.thumbnail!));

  constructor() {
    effect(() => void this.roadmap.loadRoadmap());
    // First contact: the history before the newest note counts as read.
    effect(() => {
      const live = this.liveTimes();
      const ptu = this.ptuTimes();
      untracked(() => {
        this.read.ensureBaseline('live', live);
        this.read.ensureBaseline('ptu', ptu);
      });
    });
    // Contents of the notes the boxes quote, and of every open PTU row.
    effect(() => {
      const urls = [this.liveHead()?.url, this.ptu()[0]?.url, ...this.ptu().filter((r) => this.ptuOpen(r)).map((r) => r.url)];
      const slugs = urls.map((u) => threadSlugOf(u ?? '')).filter(Boolean);
      const s = this.stack();
      const seed = this.searching() ? this.allSlugs() : [s.next, s.live, s.last].flatMap((c) => (c?.group ? [threadSlugOf(c.group.entries[0]?.item.url ?? '')] : []));
      untracked(() => this.roadmap.requestOutlines([...slugs, ...seed.filter(Boolean)]));
    });
  }

  ngOnInit(): void {
    void this.svc.refresh();
    this.svc.startPolling();
  }

  ngOnDestroy(): void {
    this.svc.stopPolling();
    clearInterval(this.clock);
  }

  retry(): void {
    void this.svc.refresh();
  }

  // ---- read state ----
  confirm(channel: 'live' | 'ptu'): void {
    this.read.markRead(channel, channel === 'live' ? this.liveTimes() : this.ptuTimes());
  }
  unconfirm(channel: 'live' | 'ptu', note: SubVersionRow): void {
    this.read.markUnread(channel, ms(note.publishedAt), this.liveTimes());
  }
  unconfirmPtu(row: PtuRow): void {
    this.read.markUnread('ptu', ms(row.publishedAt), this.ptuTimes());
  }
  isUnread(row: SubVersionRow): boolean {
    return row.stage !== 'ptu' && row.stage !== 'evocati' && !this.read.isRead('live', ms(row.publishedAt));
  }
  readOn(channel: 'live' | 'ptu'): string {
    const at = this.read.readAt(channel);
    return at ? this.dateShortMs(at) : this.t.instant('news.patchBoard.readEarlier');
  }

  // ---- rows ----
  rowsOf(card: StackCard) {
    const v = liveLineView(this.rowMap().get(card.line) ?? []);
    return card.status === 'live' || card.status === 'superseded' ? v : null;
  }
  isOpen(line: string): boolean {
    return this.openLines().has(line);
  }
  toggleOpen(line: string): void {
    this.openLines.update((s) => flip(s, line));
  }
  ptuOpen(r: PtuRow): boolean {
    return r.newest !== this.ptuToggled().has(r.id);
  }
  togglePtu(id: string): void {
    this.ptuToggled.update((s) => flip(s, id));
  }
  imageOf(card: StackCard): string | null {
    return cardImage(card);
  }
  stand(card: StackCard | null): string {
    return card ? standInLabel(card.line) : '';
  }
  bulletsOf(url: string): string[] {
    const slug = threadSlugOf(url);
    return slug ? headlineBullets(this.roadmap.outlineFor(slug), 4) : [];
  }

  // ---- roadmap popover ----
  bucketCards(b: RoadmapBucket): RoadmapCard[] {
    return cardsInBucket(this.nextCards(), b);
  }
  toggleBucket(b: RoadmapBucket, ev: Event): void {
    ev.stopPropagation();
    this.openBucket.update((cur) => (cur === b ? null : b));
  }
  closePop(): void {
    this.openBucket.set(null);
  }
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closePop();
  }
  @HostListener('document:click', ['$event'])
  onDocClick(ev: Event): void {
    if (this.openBucket() && !(ev.target as HTMLElement | null)?.closest?.('.rm-wrap')) this.closePop();
  }

  // ---- words ----
  /** The line after Live: a roadmap-only one (`next`) or one already in a test ring. */
  isNext(card: StackCard): boolean {
    return card.status === 'next' || card.status === 'ptu' || card.status === 'evocati';
  }
  pill(card: StackCard): string {
    return this.isNext(card) ? this.t.instant('news.patchBoard.status.next') : this.t.instant('news.patch.status.' + card.status);
  }
  ptuPill(r: PtuRow): string {
    const stage = this.t.instant('news.patch.stage.' + r.stage);
    return r.wave === null ? stage : this.t.instant('news.patchBoard.ptu.wave', { stage, n: r.wave });
  }
  nextStatus(card: StackCard): string {
    if (!card.group || card.status === 'next') return this.t.instant('news.patch.stack.noBuild');
    return this.t.instant('news.patchBoard.next.testing', { ring: this.t.instant('news.patch.stage.' + (card.status === 'evocati' ? 'evocati' : 'ptu')) });
  }
  nextWhen(): string {
    const announced = this.announcedDate();
    if (announced) return this.t.instant('news.patchBoard.next.announced', { date: this.dateShortMs(Date.parse(announced)) });
    const est = this.forecast().find((r) => r.key === 'live');
    const noDate = this.t.instant('news.patchBoard.next.noDate');
    return est ? `${noDate} · ${this.t.instant('news.patchBoard.next.estimate', { when: this.until(Date.parse(est.at)) })}` : noDate;
  }
  rowDate(card: StackCard): string {
    switch (card.status) {
      case 'live':
      case 'superseded':
        return card.liveAt ? this.dateLongMs(card.liveAt) : this.t.instant('news.patchBoard.noDate');
      case 'next':
      case 'ptu':
      case 'evocati':
        return card.release?.quarter || this.t.instant('news.patchBoard.noDate');
      default:
        return '';
    }
  }
  rowDays(card: StackCard): string {
    if (card.status === 'live' && card.liveAt) return this.sinceN(this.daysSinceMs(card.liveAt));
    if (card.status === 'superseded' && card.liveAt && card.supersededAt) {
      return this.t.instant('news.patchBoard.daysLive', { n: Math.max(0, Math.round((card.supersededAt - card.liveAt) / DAY_MS)) });
    }
    return '';
  }
  sentence(card: StackCard): string {
    switch (card.status) {
      case 'live':
        return this.rowsOf(card)?.latest?.title ?? '';
      case 'next':
      case 'ptu':
      case 'evocati':
        return card.group ? this.nextStatus(card) : this.t.instant('news.patch.stack.noBuild');
      case 'superseded':
        return card.liveAt
          ? this.t.instant('news.patch.stack.liveSpan', { from: this.dateShortMs(card.liveAt), to: card.supersededAt ? this.dateShortMs(card.supersededAt) : '' })
          : this.t.instant('news.patch.stack.neverLive');
      default:
        return this.t.instant('news.patch.otherLine');
    }
  }

  // ---- dates ----
  daysSince(iso: string): number {
    return daysBetween(ms(iso), this.now());
  }
  private daysSinceMs(at: number): number {
    return daysBetween(at, this.now());
  }
  /** "heute" for a note from today, else "seit N Tagen" (concept finalize: no "seit 0 Tagen"). */
  since(iso: string): string {
    return this.sinceN(this.daysSince(iso));
  }
  private sinceN(n: number): string {
    return n <= 0 ? this.t.instant('news.patchBoard.today') : this.t.instant('news.patch.stack.sinceDays', { n });
  }
  dateLong(iso: string): string {
    return this.dateLongMs(ms(iso));
  }
  dateShort(iso: string): string {
    return this.dateShortMs(ms(iso));
  }
  private dateLongMs(at: number): string {
    return this.fmt(at, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  private dateShortMs(at: number): string {
    return this.fmt(at, { day: 'numeric', month: 'short' });
  }
  private fmt(at: number, opts: Intl.DateTimeFormatOptions): string {
    try {
      return new Intl.DateTimeFormat(this.locale.intlLocale(), opts).format(at);
    } catch {
      return new Date(at).toISOString().slice(0, 10);
    }
  }
  private until(atMs: number): string {
    const days = Math.round((atMs - this.now()) / DAY_MS);
    if (days === 0) return this.t.instant('news.patch.forecast.today');
    const overdue = days < 0;
    const n = Math.abs(days);
    if (n < 14) return this.t.instant(overdue ? 'news.patch.forecast.overdueDays' : 'news.patch.forecast.inDays', { n });
    return this.t.instant(overdue ? 'news.patch.forecast.overdueWeeks' : 'news.patch.forecast.inWeeks', { n: Math.round(n / 7) });
  }
}

function flip(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}
