import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import {
  AdminPerson,
  CardAnswer,
  CardStats,
  LeaderboardRow,
  TranslationCard,
  TranslationLanguage,
  TranslationsService,
} from './translations.service';
import {
  CARD_LANGS_KEY,
  DAILY_CARD_GOAL,
  contextLines,
  goalPercent,
  langNeeds,
  parseLangSelection,
  sanitizeLangSelection,
  sumCardStats,
  toggleLang,
} from './translations.logic';
import { TRANSLATIONS_TAB_STYLES } from './translations-shared.styles';

/**
 * Karteikarten tab: the last-resort questions the pipeline could not settle itself.
 * One card at a time from the prioritised queue, answer = A / B / own text, optional
 * note and "save as rule"; after an answer the impact and the points are shown.
 */
@Component({
  selector: 'sc-translation-cards',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sc-card block">
      <div class="block-head">
        <h2>{{ 'admin.translations.cards.title' | translate }}</h2>
      </div>
      <p class="hint">{{ 'admin.translations.cards.intro' | translate }}</p>
      <div class="needs" data-test="lang-needs">
        <h3 id="sc-cards-langs">{{ 'admin.translations.cards.needsTitle' | translate }}</h3>
        <div class="chips" role="group" aria-labelledby="sc-cards-langs">
          <button type="button" class="chip" data-test="lang-all" [class.on]="selected().length === 0"
                  [attr.aria-pressed]="selected().length === 0" (click)="clearLangs()">
            {{ 'admin.translations.cards.allLangs' | translate }}
          </button>
          @for (n of needs(); track n.lang) {
            <button type="button" class="chip" data-test="lang-chip" [class.on]="selected().includes(n.lang)"
                    [class.quiet]="n.open === 0" [attr.aria-pressed]="selected().includes(n.lang)"
                    [attr.aria-label]="(n.open === null ? 'admin.translations.cards.langChipUnknown' : 'admin.translations.cards.langChip')
                      | translate: { lang: n.lang, count: n.open ?? 0 }"
                    (click)="toggle(n.lang)">
              <span class="code">{{ n.lang }}</span>
              @if (n.open !== null) {
                <span class="count" [class.hot]="n.open > 0">{{ n.open }}</span>
              }
            </button>
          }
        </div>
        <p class="hint">{{ (selected().length ? 'admin.translations.cards.needsFiltered' : 'admin.translations.cards.needsHint') | translate }}</p>
      </div>
      <div class="goal" data-test="goal">
        <div class="row">
          <strong>{{ 'admin.translations.cards.goal' | translate: { done: stats().answered_today, goal: goal } }}</strong>
          <span class="grow"></span>
          <span class="pill" [class.ok]="stats().streak_days > 0">
            {{ 'admin.translations.cards.streak' | translate: { days: stats().streak_days } }}
          </span>
          <span class="pill">{{ 'admin.translations.cards.open' | translate: { count: stats().open_count } }}</span>
        </div>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="goalPct()"
             [attr.aria-label]="'admin.translations.cards.goalLabel' | translate">
          <i [style.width.%]="goalPct()"></i>
        </div>
      </div>
    </section>

    @if (flash(); as f) {
      <p class="flash" [class.err]="f.err" role="status">{{ f.key | translate }}</p>
    }

    @if (error()) {
      <div class="sc-card state error" role="alert">
        <p>{{ error()! | translate }}</p>
        <button scAction type="button" (click)="load()">{{ 'admin.translations.retry' | translate }}</button>
      </div>
    } @else if (loading()) {
      <div class="sc-card state" role="status">{{ 'admin.translations.loading' | translate }}</div>
    } @else {
      @if (result(); as r) {
        <section class="sc-card block result" data-test="result" role="status">
          <h2>{{ 'admin.translations.cards.thanks' | translate }}</h2>
          <p class="impact">{{ 'admin.translations.cards.impact' | translate: { count: r.impact ?? 0 } }}</p>
          <p class="points">{{ 'admin.translations.cards.points' | translate: { points: r.points ?? 0 } }}</p>
          <div class="row">
            <button scAction tier="primary" type="button" (click)="result.set(null)">
              {{ (current() ? 'admin.translations.cards.next' : 'admin.translations.cards.done') | translate }}
            </button>
          </div>
        </section>
      } @else if (current(); as c) {
        <section class="sc-card block card" data-test="card" [attr.aria-label]="'admin.translations.cards.title' | translate">
          <div class="row">
            <span class="pill">{{ c.lang }}</span>
            <span class="pill">{{ 'admin.translations.cards.kinds.' + c.kind | translate }}</span>
            @if (c.status === 'skipped') {
              <span class="pill warn">{{ 'admin.translations.cards.skippedBefore' | translate }}</span>
            }
            @if (c.fresh) {
              <span class="pill ok">{{ 'admin.translations.cards.fresh' | translate }}</span>
            }
            <span class="grow"></span>
            <span class="hint">{{ 'admin.translations.cards.spread' | translate: { count: c.spread } }}</span>
          </div>
          <h2 class="q">{{ c.question }}</h2>

          <div class="choices" role="radiogroup" [attr.aria-label]="'admin.translations.cards.choose' | translate">
            @for (o of options(c); track o.id) {
              <button type="button" role="radio" class="choice" [class.sel]="answer() === o.id"
                      [attr.aria-checked]="answer() === o.id" [disabled]="busy()" (click)="choose(o.id)">
                <span class="tag">{{ 'admin.translations.cards.option.' + o.id | translate }}</span>
                <span class="txt">{{ o.text }}</span>
                <span class="src">{{ o.source }}</span>
              </button>
            }
            <button type="button" role="radio" class="choice own" [class.sel]="answer() === 'own'"
                    [attr.aria-checked]="answer() === 'own'" [disabled]="busy()" (click)="choose('own')">
              <span class="tag">{{ 'admin.translations.cards.bothWrong' | translate }}</span>
            </button>
          </div>

          @if (answer() === 'own') {
            <label class="field">
              <span>{{ 'admin.translations.cards.ownText' | translate }}</span>
              <textarea class="sc-input" [value]="ownText()" (input)="ownText.set($any($event.target).value)"></textarea>
            </label>
          }
          <label class="field">
            <span>{{ 'admin.translations.cards.note' | translate }}</span>
            <textarea class="sc-input" rows="2" [value]="note()" (input)="note.set($any($event.target).value)"></textarea>
          </label>
          <label class="check">
            <input type="checkbox" [checked]="saveRule()" (change)="saveRule.set($any($event.target).checked)" />
            <span>{{ 'admin.translations.cards.saveRule' | translate }}</span>
          </label>

          <div class="row">
            <button scAction tier="primary" type="button" [busy]="busy()" [disabled]="!canSubmit() || busy()" (click)="submit()">
              {{ 'admin.translations.cards.submit' | translate }}
            </button>
            <button scAction type="button" [disabled]="busy()" (click)="skip()">
              {{ 'admin.translations.cards.skip' | translate }}
            </button>
          </div>

          <div class="ctx" data-test="context">
            <h3>{{ 'admin.translations.cards.context.title' | translate }}</h3>
            <dl class="summary">
              @if (ctx(c).key) {
                <dt>{{ 'admin.translations.cards.context.key' | translate }}</dt><dd class="mono">{{ ctx(c).key }}</dd>
              }
              @if (ctx(c).en) {
                <dt>{{ 'admin.translations.cards.context.en' | translate }}</dt><dd>{{ ctx(c).en }}</dd>
              }
              @if (ctx(c).where) {
                <dt>{{ 'admin.translations.cards.context.where' | translate }}</dt><dd>{{ ctx(c).where }}</dd>
              }
              @if (ctx(c).neighbours.length) {
                <dt>{{ 'admin.translations.cards.context.neighbours' | translate }}</dt>
                <dd>@for (n of ctx(c).neighbours; track $index) {<div>{{ n }}</div>}</dd>
              }
              @if (ctx(c).research.length) {
                <dt>{{ 'admin.translations.cards.context.research' | translate }}</dt>
                <dd>@for (n of ctx(c).research; track $index) {<div>{{ n }}</div>}</dd>
              }
            </dl>
          </div>
        </section>
      } @else {
        <div class="sc-card state empty" data-test="empty">
          <h2>{{ 'admin.translations.cards.emptyTitle' | translate }}</h2>
          <p class="hint">{{ 'admin.translations.cards.empty' | translate }}</p>
        </div>
      }
    }

    <section class="sc-card block" data-test="leaderboard">
      <h2>{{ 'admin.translations.cards.leaderboard' | translate }}</h2>
      @if (boardError()) {
        <p class="hint">{{ boardError()! | translate }}</p>
      } @else if (board().length === 0) {
        <p class="hint">{{ 'admin.translations.cards.leaderboardEmpty' | translate }}</p>
      } @else {
        <ol class="board">
          @for (b of board(); track b.answered_by; let i = $index) {
            <li>
              <span class="rank">{{ i + 1 }}</span>
              <span class="name">{{ nameOf(b.answered_by) }}</span>
              <span class="hint">{{ 'admin.translations.cards.boardAnswers' | translate: { count: b.answers } }}</span>
              <span class="grow"></span>
              <strong>{{ 'admin.translations.cards.boardPoints' | translate: { points: b.points } }}</strong>
            </li>
          }
        </ol>
      }
    </section>
  `,
  styles: [
    TRANSLATIONS_TAB_STYLES,
    `
      .goal { display: grid; gap: var(--sc-space-2); }
      .needs { display: grid; gap: var(--sc-space-2); }
      .chips { display: flex; flex-wrap: wrap; gap: var(--sc-space-2); }
      .chip {
        display: inline-flex; align-items: center; gap: var(--sc-space-2); min-height: 44px; cursor: pointer; font: inherit;
        padding: 0 var(--sc-space-3); border-radius: 999px; border: 1px solid var(--sc-border);
        background: var(--sc-bg-0); color: var(--sc-fg-1); font-size: 0.86rem;
      }
      .chip.quiet { color: var(--sc-fg-2); }
      .chip.on { border-color: var(--sc-accent); color: var(--sc-fg-0);
        background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .chip .code { font-family: var(--sc-font-mono, ui-monospace, monospace); text-transform: uppercase; }
      .chip .count { min-width: 1.6em; padding: 0 6px; border-radius: 999px; text-align: center;
        font-variant-numeric: tabular-nums; background: var(--sc-bg-1, var(--sc-bg-0)); color: var(--sc-fg-2); }
      .chip .count.hot { color: var(--sc-accent); font-weight: 600; }
      .q { font-size: 1.15rem; overflow-wrap: anywhere; }
      .choices { display: grid; gap: var(--sc-space-3); grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
      .choice {
        display: grid; gap: var(--sc-space-2); text-align: start; min-height: 48px; cursor: pointer; font: inherit;
        padding: var(--sc-space-3) var(--sc-space-4); border-radius: var(--sc-radius-md, 10px);
        border: 1px solid var(--sc-border); background: var(--sc-bg-0); color: var(--sc-fg-1);
      }
      .choice:disabled { opacity: 0.5; cursor: not-allowed; }
      .choice.sel { border-color: var(--sc-accent); color: var(--sc-fg-0);
        background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .choice .tag { font-size: 0.78rem; color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.04em; }
      .choice .txt { overflow-wrap: anywhere; }
      .choice .src { font-size: 0.8rem; color: var(--sc-fg-2); }
      .check { display: flex; gap: var(--sc-space-2); align-items: center; min-height: 44px; cursor: pointer; }
      .check input { accent-color: var(--sc-accent); width: 20px; height: 20px; }
      .ctx { display: grid; gap: var(--sc-space-2); padding-top: var(--sc-space-3); border-top: 1px solid var(--sc-border); }
      .result .impact { margin: 0; font-size: 1.1rem; }
      .result .points { margin: 0; color: var(--sc-accent); font-weight: 600; }
      .board { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sc-space-2); }
      .board li { display: flex; gap: var(--sc-space-3); align-items: baseline; padding-block: var(--sc-space-2);
        border-bottom: 1px solid var(--sc-border); flex-wrap: wrap; }
      .board .rank { min-width: 1.6em; font-weight: 700; color: var(--sc-accent); }
    `,
  ],
})
export class TranslationCardsComponent implements OnInit {
  private readonly svc = inject(TranslationsService);

  readonly languages = input<readonly TranslationLanguage[]>([]);
  readonly goal = DAILY_CARD_GOAL;

  /** The languages the reviewer can review; only cards of these are served ([] = all). Saved per browser. */
  readonly selected = signal<string[]>(readSavedLangs());
  /** Pending cards (open + skipped) per language, for the overview. */
  readonly counts = signal<Map<string, number>>(new Map());
  readonly needs = computed(() =>
    langNeeds([...this.languages().map((l) => l.lang), ...this.selected()], this.counts()),
  );
  readonly queue = signal<TranslationCard[]>([]);
  readonly stats = signal<CardStats>({ open_count: 0, answered_today: 0, streak_days: 0 });
  readonly board = signal<LeaderboardRow[]>([]);
  readonly people = signal<Map<string, AdminPerson>>(new Map());
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly boardError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly flash = signal<{ key: string; err: boolean } | null>(null);
  readonly result = signal<TranslationCard | null>(null);

  readonly answer = signal<CardAnswer | null>(null);
  readonly ownText = signal('');
  readonly note = signal('');
  readonly saveRule = signal(false);

  readonly current = computed(() => this.queue()[0] ?? null);
  readonly goalPct = computed(() => goalPercent(this.stats().answered_today));
  readonly canSubmit = computed(() => {
    const a = this.answer();
    return a === 'a' || a === 'b' || (a === 'own' && this.ownText().trim().length > 0);
  });

  private seq = 0;
  private countSeq = 0;

  constructor() {
    // The language list arrives from the parent after its own load: count per language
    // then, and drop saved languages that no longer exist.
    effect(() => {
      const codes = this.languages().map((l) => l.lang);
      untracked(() => {
        const clean = sanitizeLangSelection(this.selected(), codes);
        if (clean.length !== this.selected().length) this.setSelection(clean);
        void this.loadCounts();
      });
    });
  }

  ngOnInit(): void {
    void this.load();
    void this.loadBoard();
  }

  async load(): Promise<void> {
    const mine = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const [queue, stats] = await Promise.all([this.svc.cardQueue(this.selected()), this.statsFor(this.selected())]);
      if (mine !== this.seq) return;
      this.queue.set(queue);
      this.stats.set(stats);
      this.resetForm();
    } catch (e) {
      if (mine !== this.seq) return;
      this.error.set(toErrorKey('admin-translations', 'cards-load', e));
    } finally {
      if (mine === this.seq) this.loading.set(false);
    }
  }

  async loadBoard(): Promise<void> {
    this.boardError.set(null);
    try {
      const [board, people] = await Promise.all([this.svc.leaderboard(), this.svc.people().catch(() => new Map<string, AdminPerson>())]);
      this.board.set(board);
      this.people.set(people);
    } catch (e) {
      this.boardError.set(toErrorKey('admin-translations', 'cards-board', e));
    }
  }

  nameOf(id: string): string {
    return this.people().get(id)?.name ?? id.slice(0, 8);
  }

  options(c: TranslationCard): { id: 'a' | 'b'; text: string; source: string }[] {
    return [
      { id: 'a', text: c.option_a?.text ?? '', source: c.option_a?.source ?? '' },
      { id: 'b', text: c.option_b?.text ?? '', source: c.option_b?.source ?? '' },
    ];
  }

  ctx(c: TranslationCard) {
    const x = c.context ?? {};
    const one = (k: string) => contextLines(x[k]).join(' ');
    return {
      key: one('key'),
      en: one('en'),
      where: one('where'),
      neighbours: contextLines(x['neighbours']),
      research: contextLines(x['research']),
    };
  }

  toggle(lang: string): void {
    this.setSelection(toggleLang(this.selected(), lang));
  }

  clearLangs(): void {
    if (this.selected().length) this.setSelection([]);
  }

  private setSelection(langs: string[]): void {
    this.selected.set(langs);
    try {
      localStorage.setItem(CARD_LANGS_KEY, JSON.stringify(langs));
    } catch {
      /* private mode / quota: the choice just lasts for this visit */
    }
    this.result.set(null);
    void this.load();
  }

  /** Header numbers: all languages in one call, else the sum over the chosen ones. */
  private async statsFor(langs: readonly string[]): Promise<CardStats> {
    if (langs.length === 0) return this.svc.cardStats(null);
    if (langs.length === 1) return this.svc.cardStats(langs[0]);
    return sumCardStats(await Promise.all(langs.map((l) => this.svc.cardStats(l))));
  }

  /** Pending count per language; a failed count leaves the chip without a number (it stays usable). */
  async loadCounts(): Promise<void> {
    const mine = ++this.countSeq;
    const codes = [...new Set(this.languages().map((l) => l.lang))];
    const rows = await Promise.all(
      codes.map((l) =>
        this.svc.cardStats(l).then(
          (s) => [l, s.open_count] as const,
          () => null,
        ),
      ),
    );
    if (mine !== this.countSeq) return;
    this.counts.set(new Map(rows.filter((r): r is readonly [string, number] => r !== null)));
  }

  choose(a: CardAnswer): void {
    this.answer.set(a);
  }

  private resetForm(): void {
    this.answer.set(null);
    this.ownText.set('');
    this.note.set('');
    this.saveRule.set(false);
  }

  private async refreshStats(): Promise<void> {
    try {
      this.stats.set(await this.statsFor(this.selected()));
    } catch {
      /* the header keeps its last numbers; the next load refreshes them */
    }
  }

  async submit(): Promise<void> {
    const c = this.current();
    const a = this.answer();
    if (!c || !a || !this.canSubmit()) return;
    this.busy.set(true);
    this.flash.set(null);
    try {
      const done = await this.svc.answerCard(c.id, { answer: a, own_text: this.ownText(), note: this.note(), save_as_rule: this.saveRule() });
      this.queue.update((q) => q.filter((x) => x.id !== c.id));
      this.result.set(done);
      this.resetForm();
      await Promise.all([this.refreshStats(), this.loadBoard(), this.loadCounts()]);
    } catch (e) {
      this.flash.set({ key: toErrorKey('admin-translations', 'card-answer', e), err: true });
    } finally {
      this.busy.set(false);
    }
  }

  /** Skip moves the card to the end of the list (the server sorts skipped cards last). */
  async skip(): Promise<void> {
    const c = this.current();
    if (!c) return;
    this.busy.set(true);
    this.flash.set(null);
    try {
      const done = await this.svc.skipCard(c.id);
      this.queue.update((q) => [...q.filter((x) => x.id !== c.id), { ...c, ...done, status: 'skipped' as const }]);
      this.resetForm();
      await this.refreshStats();
    } catch (e) {
      this.flash.set({ key: toErrorKey('admin-translations', 'card-skip', e), err: true });
    } finally {
      this.busy.set(false);
    }
  }
}

function readSavedLangs(): string[] {
  try {
    return parseLangSelection(localStorage.getItem(CARD_LANGS_KEY));
  } catch {
    return [];
  }
}
