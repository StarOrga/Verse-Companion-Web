import { TestBed } from '@angular/core/testing';
import { chainArgs, fakeSupabase, FakeCall } from '../../testing/fake-supabase';
import { TranslationsService } from './translations.service';

describe('TranslationsService', () => {
  let calls: FakeCall[];

  function setup(answer: (c: FakeCall) => { data?: unknown; error?: unknown; count?: number | null }): TranslationsService {
    const fake = fakeSupabase({ answer });
    calls = fake.calls;
    TestBed.configureTestingModule({ providers: [fake.provider] });
    return TestBed.inject(TranslationsService);
  }

  it('sums the ledger of the current UTC month', async () => {
    const svc = setup(() => ({ data: [{ usd: '1.5' }, { usd: 2 }] }));
    expect(await svc.monthSpend(new Date('2026-10-29T12:00:00Z'))).toBe(3.5);
    expect(calls[0].target).toBe('translation_ledger');
    expect(chainArgs(calls[0], 'eq')).toEqual(['month', '2026-10-01']);
  });

  it('loads the singleton settings as numbers', async () => {
    const svc = setup(() => ({ data: { enabled: true, upload_cap_usd: '20', monthly_cap_usd: '190' } }));
    expect(await svc.getSettings()).toEqual({ enabled: true, upload_cap_usd: 20, monthly_cap_usd: 190 });
    expect(chainArgs(calls[0], 'eq')).toEqual(['id', 1]);
  });

  it('throws a read error instead of returning an empty list', async () => {
    const svc = setup(() => ({ error: { message: 'boom' } }));
    await expect(svc.listLanguages()).rejects.toThrow();
  });

  it('queries the glossary with search, filters and range', async () => {
    const svc = setup(() => ({ data: [], count: 120 }));
    const res = await svc.listGlossary({ search: 'hull', lang: 'de', origin: 'ai', category: null, page: 1 });
    expect(res.total).toBe(120);
    expect(chainArgs(calls[0], 'or')).toEqual(['source_term.ilike.%hull%,target_term.ilike.%hull%']);
    expect(chainArgs(calls[0], 'range')).toEqual([50, 99]);
  });

  it('flags a target edit as origin admin', async () => {
    const svc = setup(() => ({ data: null }));
    await svc.saveTarget('g1', 'Rumpf');
    const upd = chainArgs(calls[0], 'update')![0] as Record<string, unknown>;
    expect(upd['target_term']).toBe('Rumpf');
    expect(upd['origin']).toBe('admin');
    expect(chainArgs(calls[0], 'eq')).toEqual(['id', 'g1']);
  });

  it('restores the before snapshot on revert', async () => {
    const svc = setup(() => ({ data: null }));
    await svc.revert({ id: 1, glossary_id: 'g1', before: { target_term: 'Alt', locked: true, lang: 'de' }, after: null, at: '' });
    const upd = chainArgs(calls[0], 'update')![0] as Record<string, unknown>;
    expect(upd['target_term']).toBe('Alt');
    expect(upd['locked']).toBe(true);
    expect('lang' in upd).toBe(false);
  });

  it('turns an {error} answer of the orchestrator into a coded Error', async () => {
    const svc = setup(() => ({ data: { error: 'translate.no_api_key' } }));
    await expect(svc.approve('j1')).rejects.toEqual(expect.objectContaining({ code: 'translate.no_api_key' }));
    expect(calls[0].op).toBe('invoke');
    expect(calls[0].target).toBe('translate-orchestrator');
  });

  it('orders a full run with one call (the estimate is the job\'s own first step)', async () => {
    const svc = setup(() => ({ data: { ok: true, job: { id: 'j9', status: 'estimating' } } }));
    await svc.startFull('b1', 'de');
    expect(calls.length).toBe(1);
    expect((calls[0].args as { body: unknown }).body).toEqual({ op: 'start_full', build_id: 'b1', lang: 'de' });
  });

  it('Karteikarten v2: every card call is an RPC with the contract args; old answer/skip/stats/leaderboard calls are gone', async () => {
    const svc = setup((c) => ({ data: c.target === 'accept_translation_decisions' ? '7' : {} }));
    await svc.deck('de');
    await svc.answerCard('c1', { answer: 'a', exceptions: { it: 'b' } });
    await svc.answerCard('c2', { answer: 'own', own_text: '  Eigen  ', exceptions: { it: 'b' } });
    await svc.answerCard('c3', { answer: 'b', exceptions: {} });
    await svc.notMineCard('c4');
    await svc.undoCard('c4');
    await svc.vetoList('it');
    await svc.vetoDecision('k1');
    await svc.acceptDecision('k2');
    expect(await svc.acceptDecisions('it')).toBe(7);
    await svc.cardBoard();
    await svc.setMyLangs(['de', 'it']);
    expect(calls.map((c) => [c.op, c.target, c.args])).toEqual([
      ['rpc', 'translation_deck', { p_lang: 'de', p_limit: 10 }],
      ['rpc', 'answer_translation_card', { p_card_id: 'c1', p_answer: 'a', p_own_text: null, p_exceptions: { it: 'b' } }],
      ['rpc', 'answer_translation_card', { p_card_id: 'c2', p_answer: 'own', p_own_text: 'Eigen', p_exceptions: null }],
      ['rpc', 'answer_translation_card', { p_card_id: 'c3', p_answer: 'b', p_own_text: null, p_exceptions: null }],
      ['rpc', 'not_mine_translation_card', { p_card_id: 'c4' }],
      ['rpc', 'undo_translation_card', { p_card_id: 'c4' }],
      ['rpc', 'translation_veto_list', { p_lang: 'it', p_limit: 50 }],
      ['rpc', 'veto_translation_decision', { p_card_id: 'k1' }],
      ['rpc', 'accept_translation_decision', { p_card_id: 'k2' }],
      ['rpc', 'accept_translation_decisions', { p_lang: 'it' }],
      ['rpc', 'translation_card_board', undefined],
      ['rpc', 'set_translation_my_langs', { p_langs: ['de', 'it'] }],
    ]);
    const svcAny = svc as unknown as Record<string, unknown>;
    for (const gone of ['cardQueue', 'skipCard', 'cardStats', 'leaderboard']) expect(svcAny[gone]).toBeUndefined();
  });
});
