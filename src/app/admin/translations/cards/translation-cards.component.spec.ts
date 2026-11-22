import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../../../core/analytics.service';
import { ScConfirmService } from '../../../shared/dialog/sc-confirm.service';
import { UndoToastService } from '../../../shared/undo-toast/undo-toast.service';
import de from '../../../../../public/i18n/de.json';
import { useViewport } from '../../../testing/viewport';
import { FakeCall, FakeResult, fakeSupabase } from '../../../testing/fake-supabase';
import { TranslationCardsComponent } from '../translation-cards.component';
import type { TranslationCard } from '../translations.service';
import { board, conventionCard, deckOf, kiCard, termCard, vetoOf } from './cards.testing';

type Answer = (c: FakeCall) => FakeResult | Promise<FakeResult>;

const goal = (done: number) => ({ done, target: 10, full: done >= 10, bonus_taken: false });

/** Default backend: board + a two-card deck for German, a one-item veto list for Italian. */
function backend(cards: TranslationCard[] = [conventionCard(), termCard()], extra: Answer = () => ({ data: null })): Answer {
  return (c) => {
    switch (c.target) {
      case 'translation_card_board':
        return { data: board() };
      case 'translation_deck':
        return { data: deckOf(cards) };
      case 'translation_veto_list':
        return { data: vetoOf([kiCard()]) };
      case 'answer_translation_card':
      case 'veto_translation_decision':
      case 'accept_translation_decision': {
        const id = (c.args as { p_card_id: string }).p_card_id;
        return { data: { card: { ...termCard(id), status: 'answered', can_undo: true }, points: 20, bonus: 0, goal: goal(1) } };
      }
      case 'not_mine_translation_card':
      case 'undo_translation_card': {
        const id = (c.args as { p_card_id: string }).p_card_id;
        const back = cards.find((x) => x.id === id) ?? kiCard(id);
        return { data: { card: { ...back, can_undo: c.target === 'not_mine_translation_card' }, goal: goal(0) } };
      }
      default:
        return extra(c);
    }
  };
}

async function mount(answer: Answer, url = '/admin/translations?tab=cards') {
  const fake = fakeSupabase({ answer });
  const track = vi.fn();
  const prompt = vi.fn().mockResolvedValue('Mein Text');
  const confirm = vi.fn().mockResolvedValue(true);
  TestBed.configureTestingModule({
    providers: [
      fake.provider,
      provideTranslateService(),
      provideRouter([{ path: 'admin/translations', component: TranslationCardsComponent }, { path: '**', children: [] }]),
      { provide: AnalyticsService, useValue: { track } },
      { provide: ScConfirmService, useValue: { prompt, confirm } },
    ],
  });
  // Only the quote frame is a real string: the KI text and the moment's hero live inside it.
  const t = TestBed.inject(TranslateService);
  t.setTranslation('xx', { admin: { translations: { cards: { quoted: '„{{text}}“' } } } });
  t.use('xx');
  const harness = await RouterTestingHarness.create();
  const cmp = await harness.navigateByUrl(url, TranslationCardsComponent);
  await vi.waitFor(() => expect(cmp.loading()).toBe(false));
  harness.detectChanges();
  const el = harness.routeNativeElement as HTMLElement;
  const rpc = (name: string) => fake.calls.filter((c) => c.target === name);
  return { harness, cmp, el, fake, rpc, track, prompt, confirm };
}

const q = <T extends Element = HTMLElement>(el: HTMLElement, sel: string) => el.querySelector<T>(sel);

describe('TranslationCardsComponent (Karteikarten v2)', () => {
  afterEach(() => TestBed.inject(UndoToastService).current.set(null));

  it('starts with the closed deck and the two boxes; no start button, no bottom bar, no „Alle Tasten“ text', async () => {
    const { el, rpc, cmp } = await mount(backend());
    expect(rpc('translation_deck')[0].args).toEqual({ p_lang: 'de', p_limit: 10 });
    expect(cmp.mode()).toBe('cover');
    expect(q(el, '[data-test=cover]')).not.toBeNull();
    expect(q(el, '[data-test=goal-box]')).not.toBeNull();
    expect(q(el, '[data-test=stats-box]')).not.toBeNull();
    expect(el.querySelectorAll('button[scAction][tier=primary]').length).toBe(0);
    expect(el.textContent).not.toContain('Alle Tasten');
    expect(el.textContent).not.toMatch(/combo/i);
  });

  it('Enter turns the deck and reports the start; a tap on a half answers and shows the moment', async () => {
    const { harness, el, cmp, rpc, track } = await mount(backend());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    harness.detectChanges();
    expect(cmp.mode()).toBe('card');
    expect(track).toHaveBeenCalledWith('admin:translation_deck_start', { lang: 'de', cards: 2 });
    expect(el.textContent).toContain('admin.translations.cards.q.case_upper');

    q<HTMLButtonElement>(el, '[data-test=half-a]')!.click();
    await vi.waitFor(() => expect(cmp.moment()).not.toBeNull());
    harness.detectChanges();
    expect(rpc('answer_translation_card')[0].args).toEqual({ p_card_id: 'conv1', p_answer: 'a', p_own_text: null, p_exceptions: null });
    expect(q(el, '[data-test=moment]')).not.toBeNull();
    expect(cmp.moment()).toMatchObject({ points: 20, texts: 14, goal: goal(1) });
    expect(cmp.plus()).toBe(20);
    expect(track).toHaveBeenCalledWith('admin:translation_card_submit', { kind: 'convention', choice: 'a', exception: false, input: 'tap' });
    // The goal step lights the ring.
    expect(q(el, 'sc-goal-ring.hot')).not.toBeNull();

    cmp.endMoment();
    harness.detectChanges();
    expect(cmp.current()?.id).toBe('term1');
  });

  it('keys answer on desktop: → picks the right half, ↑ hands the card to the KI', async () => {
    const { cmp, rpc, track } = await mount(backend());
    cmp.turn();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await vi.waitFor(() => expect(rpc('not_mine_translation_card').length).toBe(1));
    await vi.waitFor(() => expect(cmp.current()?.id).toBe('term1'));
    expect(track).toHaveBeenCalledWith('admin:translation_card_release', { kind: 'convention', input: 'key' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await vi.waitFor(() => expect(rpc('answer_translation_card').length).toBe(1));
    expect((rpc('answer_translation_card')[0].args as { p_answer: string }).p_answer).toBe('b');
  });

  it('a swipe answers on a phone: left = left half, up = not mine', async () => {
    const { cmp, rpc } = await mount(backend());
    cmp.turn();
    const pe = (type: string, x: number, y: number) => ({ type, pointerType: 'touch', pointerId: 1, clientX: x, clientY: y }) as PointerEvent;
    cmp.onDown(pe('pointerdown', 200, 300));
    cmp.onMove(pe('pointermove', 120, 305));
    expect(cmp.lean()).toBe('a');
    cmp.onUp(pe('pointerup', 100, 305));
    await vi.waitFor(() => expect(rpc('answer_translation_card').length).toBe(1));
    expect((rpc('answer_translation_card')[0].args as { p_answer: string }).p_answer).toBe('a');
    // The click a swipe leaves behind does not answer the next card.
    cmp.onPick('b');
    expect(rpc('answer_translation_card').length).toBe(1);
  });

  it('undo goes through the app undo toast and the server undo RPC, and puts the card back', async () => {
    const { cmp, rpc, track } = await mount(backend());
    cmp.turn();
    await cmp.answer('a', 'tap');
    const toast = TestBed.inject(UndoToastService);
    expect(toast.current()?.messageKey).toBe('admin.translations.cards.undo.answeredRule');
    expect(cmp.pos()).toBe(1);

    toast.undo();
    await vi.waitFor(() => expect(rpc('undo_translation_card').length).toBe(1));
    await vi.waitFor(() => expect(cmp.pos()).toBe(0));
    expect(rpc('undo_translation_card')[0].args).toEqual({ p_card_id: 'conv1' });
    expect(cmp.moment()).toBeNull();
    expect(cmp.session()).toEqual([]);
    expect(cmp.goal().done).toBe(0);
    await vi.waitFor(() => expect(track).toHaveBeenCalledWith('admin:translation_answer_remove', { via: 'toast' }));
  });

  it('Ctrl+Z undoes the last answer too', async () => {
    const { cmp, rpc, track } = await mount(backend());
    cmp.turn();
    await cmp.answer('b', 'key');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await vi.waitFor(() => expect(rpc('undo_translation_card').length).toBe(1));
    await vi.waitFor(() => expect(track).toHaveBeenCalledWith('admin:translation_answer_remove', { via: 'key' }));
  });

  it('an exception for one language is sent with the answer (P8, hotkey A)', async () => {
    const { harness, el, cmp, rpc } = await mount(backend());
    cmp.turn();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    harness.detectChanges();
    expect(q(el, '[data-test=exception-sheet]')).not.toBeNull();
    q<HTMLButtonElement>(el, '[data-test=exc-it]')!.click();
    harness.detectChanges();
    expect(q(el, '[data-test=exception]')).not.toBeNull();
    await cmp.answer('a', 'tap');
    expect(rpc('answer_translation_card')[0].args).toMatchObject({ p_answer: 'a', p_exceptions: { it: 'b' } });
  });

  it('own text asks through the app prompt and is not offered on a convention card', async () => {
    const { harness, el, cmp, rpc, prompt } = await mount(backend([termCard()]));
    cmp.turn();
    harness.detectChanges();
    expect(q(el, '[data-test=act-own]')).not.toBeNull();
    await cmp.ownText('tap');
    expect(prompt).toHaveBeenCalled();
    expect(rpc('answer_translation_card')[0].args).toEqual({ p_card_id: 'term1', p_answer: 'own', p_own_text: 'Mein Text', p_exceptions: null });

    const conv = await (async () => {
      TestBed.resetTestingModule();
      return mount(backend([conventionCard()]));
    })();
    conv.cmp.turn();
    conv.harness.detectChanges();
    expect(q(conv.el, '[data-test=act-own]')).toBeNull();
    expect(q(conv.el, '[data-test=act-exception]')).not.toBeNull();
  });

  it('after the last card the deck is finished: „Alles geklärt“, the sum, when it applies, and the finish event', async () => {
    const { harness, el, cmp, track } = await mount(backend([termCard()]));
    cmp.turn();
    await cmp.answer('a', 'tap');
    cmp.endMoment();
    harness.detectChanges();
    expect(q(el, '[data-test=finish]')).not.toBeNull();
    expect(el.textContent).toContain('admin.translations.cards.finish.title');
    expect(el.textContent).toContain('admin.translations.cards.finish.when');
    expect(cmp.summary()).toEqual({ cards: 1, texts: 10, points: 20, base: 20, bonus: 0 });
    expect(track).toHaveBeenCalledWith('admin:translation_deck_finish', { lang: 'de', cards: 1, points: 20 });
  });

  it('a KI language opens its veto list as cards in the same frame; „Passt“ and „Sieht falsch aus“ score', async () => {
    const { harness, el, cmp, rpc, track } = await mount(backend(), '/admin/translations?tab=cards&lang=it');
    expect(cmp.vetoMode()).toBe(true);
    expect(rpc('translation_veto_list')[0].args).toEqual({ p_lang: 'it', p_limit: 50 });
    const card = q(el, '[data-test=veto-card]')!;
    expect(card.textContent).toContain('Propulsore principale');
    expect(card.textContent).toContain('Haupttriebwerk');
    expect(card.textContent).toContain('admin.translations.cards.reason.bracket');
    // Five lines: head, hero, meaning + reason (both in the hero block), the two answers, foot.
    expect(card.children.length).toBe(4);
    expect(card.querySelectorAll('.hero > p').length).toBe(2);
    q<HTMLButtonElement>(el, '[data-test=veto-ok]')!.click();
    await vi.waitFor(() => expect(rpc('accept_translation_decision').length).toBe(1));
    await vi.waitFor(() => expect(track).toHaveBeenCalledWith('admin:translation_veto_submit', { verdict: 'ok', unsure: true, input: 'tap' }));
    cmp.endMoment();
    harness.detectChanges();
    expect(q(el, '[data-test=veto-empty]')).not.toBeNull();
  });

  it('language rows are real anchors: a click opens that language, the KI row is the last row and has no extra button', async () => {
    const { harness, el, cmp, rpc } = await mount(backend());
    const rows = Array.from(el.querySelectorAll<HTMLAnchorElement>('[data-test=goal-box] a.lrow'));
    expect(rows.map((a) => a.getAttribute('href'))).toEqual([
      '/admin/translations?tab=cards&lang=de',
      '/admin/translations?tab=cards&lang=it',
      '/admin/translations?tab=cards&lang=ja',
      '/admin/translations?tab=cards&lang=pt-BR',
      '/admin/translations?tab=cards&lang=ru',
      '/admin/translations?tab=cards&lang=it',
    ]);
    expect(rows.at(-1)!.dataset['test']).toBe('ki-row');
    expect(q(el, '[data-test=goal-box] .langs button')).toBeNull();
    rows[2].click();
    await vi.waitFor(() => expect(cmp.lang()).toBe('ja'));
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(rpc('translation_veto_list').at(-1)?.args).toEqual({ p_lang: 'ja', p_limit: 50 });
    });
    harness.detectChanges();
    expect(rows[2].getAttribute('aria-current')).toBe('true');
  });

  it('a judged language with automatic decisions has a „N automatisch“ link; it opens them as a veto list, „Sieht falsch aus“ reopens the card (P3)', async () => {
    const withAuto = () => board({ langs: board().langs.map((l) => (l.lang === 'de' ? { ...l, ai_review: 12 } : l)) });
    const answer: Answer = (c) => {
      if (c.target === 'translation_card_board') return { data: withAuto() };
      if (c.target === 'translation_veto_list') return { data: vetoOf([kiCard('auto1', { lang: 'de' })], { lang: 'de' }) };
      if (c.target === 'veto_translation_decision') {
        return { data: { card: { ...kiCard('auto1', { lang: 'de' }), status: 'open', ai: null, can_undo: true }, points: 0, bonus: 0, goal: goal(0) } };
      }
      return backend()(c);
    };
    const { harness, el, cmp, rpc } = await mount(answer);
    const link = q<HTMLAnchorElement>(el, '[data-test=auto-de]')!;
    expect(link.getAttribute('href')).toBe('/admin/translations?tab=cards&lang=de&review=1');
    expect(q(el, '[data-test=auto-it]')).toBeNull();
    expect(q(el, '[data-test=goal-box] .langs button')).toBeNull();
    expect(cmp.vetoMode()).toBe(false);

    link.click();
    await vi.waitFor(() => expect(cmp.reviewMode()).toBe(true));
    await vi.waitFor(() => { harness.detectChanges(); expect(rpc('translation_veto_list').at(-1)?.args).toEqual({ p_lang: 'de', p_limit: 50 }); });
    await vi.waitFor(() => expect(cmp.loading()).toBe(false));
    harness.detectChanges();
    expect(cmp.vetoMode()).toBe(true);
    expect(q(el, '[data-test=veto-head]')!.textContent).toContain('admin.translations.cards.veto.headAuto');
    expect(q(el, '[data-test=auto-de]')!.getAttribute('aria-current')).toBe('true');
    expect(q(el, '[data-test=lang-de]')!.getAttribute('aria-current')).toBeNull();

    q<HTMLButtonElement>(el, '[data-test=veto-wrong]')!.click();
    await vi.waitFor(() => expect(rpc('veto_translation_decision').length).toBe(1));
    expect(rpc('veto_translation_decision')[0].args).toEqual({ p_card_id: 'auto1' });
    await vi.waitFor(() => expect(cmp.moment()).not.toBeNull());
    // A reopened card scores nothing: no „+0 Punkte“.
    harness.detectChanges();
    expect(q(el, '[data-test=moment]')!.textContent).not.toContain('plusPoints');
  });

  it('Enter turns the deck on first load although the shell search field holds the caret', async () => {
    const { harness, cmp } = await mount(backend());
    const host = document.createElement('sc-fusion-search');
    const input = document.createElement('input');
    host.append(input);
    document.body.append(host);
    try {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      harness.detectChanges();
      expect(cmp.mode()).toBe('card');
      // …and a field with typed text keeps its keys.
      input.value = 'rsi';
      cmp.turned.set(false);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(cmp.turned()).toBe(false);
    } finally {
      host.remove();
    }
  });

  it('the leaderboard shows names, „Du“ for the own row and a fallback for a missing name', async () => {
    const { el } = await mount(backend());
    const names = Array.from(el.querySelectorAll('[data-test=leaderboard] .n')).map((n) => n.textContent!.trim());
    expect(names).toEqual(['Nova', 'admin.translations.cards.stats.you', 'admin.translations.cards.stats.unnamed']);
  });

  it('a failed load shows an error state with retry, a refused answer a translated line and a reload', async () => {
    const failing = await mount((c) => (c.target === 'translation_deck' ? { error: { code: 'PGRST000', message: 'down' } } : backend()(c)));
    expect(q(failing.el, '[data-test=error]')).not.toBeNull();
    expect(q(failing.el, '[data-test=error] button')).not.toBeNull();

    TestBed.resetTestingModule();
    const refuse: Answer = (c) => (c.target === 'answer_translation_card' ? { error: { code: 'P0002', message: 'gone' } } : backend()(c));
    TestBed.resetTestingModule();
    const r = await mount(refuse);
    r.cmp.turn();
    await r.cmp.answer('a', 'tap');
    await vi.waitFor(() => expect(r.cmp.flash()).toBe('errors.translation.cards.gone'));
    expect(r.rpc('translation_deck').length).toBe(2);
  });
});

describe('TranslationCardsComponent: no text overflow with long option labels (U14)', () => {
  const LONG = 'Hochgeschwindigkeitsantriebssteuerungseinheitenwartungsprotokollselbstzerstörungssequenz';
  afterEach(() => TestBed.inject(UndoToastService).current.set(null));

  for (const width of [375, 768]) {
    describe(`at ${width}px`, () => {
      useViewport(width, 800);

      it('the swipe hint wraps inside the stage and never widens the page', async () => {
        const long = termCard('long1', { option_a: { text: LONG, source: 'mined', votes: 5, count: 9 }, option_b: { text: `${LONG}zwei`, source: 'mined', votes: 2, count: 9 } });
        const { harness, el, cmp } = await mount(backend([long]));
        // The real German strings: a missing key would render as one very long unbreakable word.
        TestBed.inject(TranslateService).setTranslation('xx', de, false);
        // The hint is a touch-only line; show it on this desktop test browser to measure it.
        const style = document.createElement('style');
        style.textContent = 'p.swipe.touch { display: flex !important; }';
        document.head.append(style);
        try {
          cmp.turn();
          harness.detectChanges();
          const swipe = q(el, 'p.swipe')!;
          const box = swipe.getBoundingClientRect();
          expect(swipe.textContent).toContain(LONG);
          expect(swipe.scrollWidth).toBeLessThanOrEqual(swipe.clientWidth);
          for (const span of Array.from(swipe.querySelectorAll('span'))) {
            const r = span.getBoundingClientRect();
            expect(r.right).toBeLessThanOrEqual(box.right + 0.5);
            expect(r.left).toBeGreaterThanOrEqual(box.left - 0.5);
          }
          const table = q(el, '.table')!;
          expect(table.getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
        } finally {
          style.remove();
        }
      });
    });
  }

  describe('Sprachen-Auswahl („Dein Stapel“ / „KI + Veto“)', () => {
    const click = (el: HTMLElement, sel: string) => q<HTMLButtonElement>(el, sel)!.click();

    it('opens the sheet from the box header with the current judgement of every language', async () => {
      const { harness, el } = await mount(backend());
      expect(q(el, '[data-test=langs-sheet]')).toBeNull();
      expect(q(el, '[data-test=langs-open]')!.getAttribute('aria-label')).toBe('admin.translations.cards.langs.open');
      click(el, '[data-test=langs-open]');
      harness.detectChanges();
      expect(q(el, '[data-test=langs-sheet]')).not.toBeNull();
      expect(q(el, '[data-test=judge-de]')!.getAttribute('aria-checked')).toBe('true');
      expect(q(el, '[data-test=ki-de]')!.getAttribute('aria-checked')).toBe('false');
      expect(q(el, '[data-test=ki-it]')!.getAttribute('aria-checked')).toBe('true');
      expect(el.querySelectorAll('[data-test^=judge-]').length).toBe(5);
    });

    it('toggling a language switches its segment without saving', async () => {
      const { harness, el, rpc } = await mount(backend());
      click(el, '[data-test=langs-open]');
      harness.detectChanges();
      click(el, '[data-test=judge-it]');
      harness.detectChanges();
      expect(q(el, '[data-test=judge-it]')!.getAttribute('aria-checked')).toBe('true');
      expect(q(el, '[data-test=ki-it]')!.getAttribute('aria-checked')).toBe('false');
      click(el, '[data-test=ki-de]');
      harness.detectChanges();
      expect(q(el, '[data-test=judge-de]')!.getAttribute('aria-checked')).toBe('false');
      expect(rpc('set_translation_my_langs').length).toBe(0);
    });

    it('save calls set_translation_my_langs with the judged list, reloads board and deck and reports the change', async () => {
      const { harness, el, rpc, track } = await mount(backend([conventionCard()], (c) => (c.target === 'set_translation_my_langs' ? { data: ['de', 'it'] } : { data: null })));
      const boards = rpc('translation_card_board').length;
      const decks = rpc('translation_deck').length;
      click(el, '[data-test=langs-open]');
      harness.detectChanges();
      click(el, '[data-test=judge-it]');
      harness.detectChanges();
      click(el, '[data-test=langs-save]');
      await vi.waitFor(() => expect(rpc('set_translation_my_langs').length).toBe(1));
      expect(rpc('set_translation_my_langs')[0].args).toEqual({ p_langs: ['de', 'it'] });
      await vi.waitFor(() => expect(rpc('translation_card_board').length).toBe(boards + 1));
      await vi.waitFor(() => expect(rpc('translation_deck').length).toBe(decks + 1));
      harness.detectChanges();
      expect(q(el, '[data-test=langs-sheet]')).toBeNull();
      expect(track).toHaveBeenCalledWith('admin:translation_langs_change', { judged: 2, ki: 3 });
    });

    it('saves an empty list when every language goes to the KI', async () => {
      const { harness, el, rpc } = await mount(backend([conventionCard()], (c) => (c.target === 'set_translation_my_langs' ? { data: [] } : { data: null })));
      click(el, '[data-test=langs-open]');
      harness.detectChanges();
      click(el, '[data-test=ki-de]');
      harness.detectChanges();
      click(el, '[data-test=langs-save]');
      await vi.waitFor(() => expect(rpc('set_translation_my_langs').length).toBe(1));
      expect(rpc('set_translation_my_langs')[0].args).toEqual({ p_langs: [] });
    });

    it('a refused save keeps the sheet open with a translated error and no reload', async () => {
      const { harness, el, rpc, track } = await mount(
        backend([conventionCard()], (c) => (c.target === 'set_translation_my_langs' ? { data: null, error: { code: '22023', message: 'unknown language' } } : { data: null })),
      );
      const boards = rpc('translation_card_board').length;
      click(el, '[data-test=langs-open]');
      harness.detectChanges();
      click(el, '[data-test=judge-it]');
      click(el, '[data-test=langs-save]');
      await vi.waitFor(() => expect(rpc('set_translation_my_langs').length).toBe(1));
      await vi.waitFor(() => {
        harness.detectChanges();
        expect(q(el, '[data-test=langs-error]')).not.toBeNull();
      });
      expect(q(el, '[data-test=langs-error]')!.textContent).toContain('errors.translation.cards.invalid');
      expect(q(el, '[data-test=langs-sheet]')).not.toBeNull();
      expect(rpc('translation_card_board').length).toBe(boards);
      expect(track).not.toHaveBeenCalledWith('admin:translation_langs_change', expect.anything());
    });

    it('Escape closes the sheet without saving', async () => {
      const { harness, el, rpc } = await mount(backend());
      click(el, '[data-test=langs-open]');
      harness.detectChanges();
      q(el, '[data-test=langs-sheet]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      harness.detectChanges();
      expect(q(el, '[data-test=langs-sheet]')).toBeNull();
      expect(rpc('set_translation_my_langs').length).toBe(0);
    });
  });

});
