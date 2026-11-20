import {
  GLOSSARY_PAGE_SIZE,
  buildGlossaryQuery,
  canApprove,
  canCancel,
  glossarySearchFilter,
  jobErrorKey,
  langNeeds,
  parseLangSelection,
  sanitizeLangSelection,
  sumCardStats,
  toggleLang,
  jobNotes,
  jobProgress,
  judgeScore,
  monthStartUtc,
  revertPatch,
  spendPercent,
  sumLedger,
} from './translations.logic';

describe('translations.logic', () => {
  it('offers Approve only while awaiting approval', () => {
    expect(canApprove('awaiting_approval')).toBe(true);
    expect(canApprove('queued')).toBe(false);
    expect(canApprove('published')).toBe(false);
  });

  it('offers Cancel for every unfinished status only', () => {
    for (const s of ['estimating', 'awaiting_approval', 'queued', 'submitted', 'validating', 'post_editing', 'publishing']) {
      expect(canCancel(s), s).toBe(true);
    }
    for (const s of ['published', 'failed', 'cancelled', 'skipped']) {
      expect(canCancel(s), s).toBe(false);
    }
  });

  it('keys the ledger month on the UTC month start', () => {
    expect(monthStartUtc(new Date('2026-10-31T23:30:00Z'))).toBe('2026-10-01');
    expect(monthStartUtc(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });

  it('sums ledger rows, tolerating numeric strings and nulls', () => {
    expect(sumLedger([{ usd: 1.5 }, { usd: '2.25' }, { usd: null }])).toBe(3.75);
    expect(sumLedger([])).toBe(0);
  });

  it('clamps the spend share and handles a zero cap', () => {
    expect(spendPercent(95, 190)).toBe(50);
    expect(spendPercent(500, 190)).toBe(100);
    expect(spendPercent(5, 0)).toBe(0);
  });

  it('reads the judge mean from stats', () => {
    expect(judgeScore({ judge: { n: 3, mean: 4.2 } })).toBe(4.2);
    expect(judgeScore({ judge: null })).toBeNull();
    expect(judgeScore(null)).toBeNull();
  });

  it('reads how far an estimate or a publish is, and nothing for a wait', () => {
    expect(jobProgress('estimating', {})).toBe(0);
    expect(jobProgress('estimating', { est: { phase: 'rows', cursor: 77, total: 154 } })).toBe(20);
    expect(jobProgress('estimating', { est: { phase: 'diff', cursor: 8, total: 154 } })).toBe(50);
    expect(jobProgress('estimating', { est: { phase: 'shots', cursor: 23, total: 154 }, plan: { parts: 46 } })).toBe(88);
    expect(jobProgress('estimating', { est: { phase: 'complete', cursor: 0 } })).toBe(98);
    expect(jobProgress('publishing', { phase: 'rows', pos: 154, pub: { total: 154 } })).toBe(65);
    expect(jobProgress('publishing', { phase: 'join', pos: 16 })).toBe(95);
    expect(jobProgress('publishing', { phase: 'rows', pos: 8 })).toBe(35);
    expect(jobProgress('submitted', { phase: 'running' })).toBeNull();
    expect(jobProgress('published', null)).toBeNull();
    expect(jobProgress('estimating', { est: { phase: 'new phase' } })).toBeNull();
  });

  it('says why a job waits and which paid steps it left out', () => {
    const base = 'admin.translations.jobs';
    expect(jobNotes('awaiting_approval', { hold: 'full' })).toEqual([{ key: `${base}.hold.full`, params: {} }]);
    expect(jobNotes('awaiting_approval', { hold: 'monthly_cap' })).toEqual([{ key: `${base}.hold.monthly_cap`, params: {} }]);
    expect(jobNotes('awaiting_approval', { hold: 'overrun', probe: { ratio: 1.874 } })).toEqual([{ key: `${base}.hold.overrun`, params: { pct: 87 } }]);
    expect(jobNotes('awaiting_approval', { hold: 'overrun' })).toEqual([{ key: `${base}.hold.overrun`, params: { pct: 0 } }]);
    // A hold the page does not know gets no sentence, and a hold of an earlier state does not show later.
    expect(jobNotes('awaiting_approval', { hold: 'something new' })).toEqual([]);
    expect(jobNotes('submitted', { hold: 'full' })).toEqual([]);
    // The texts left without a second attempt and the judge sample left out are two things: both are said.
    expect(jobNotes('published', { capped: { reason: 'job_budget', judge: true, texts: 412 } })).toEqual([
      { key: `${base}.capped.job_budget`, params: { texts: 412 } }, { key: `${base}.capped.judge`, params: {} },
    ]);
    expect(jobNotes('publishing', { capped: { reason: 'monthly_cap', judge: false, texts: 3 } })).toEqual([{ key: `${base}.capped.monthly_cap`, params: { texts: 3 } }]);
    expect(jobNotes('post_editing', { capped: { reason: 'job_budget', judge: true, texts: 0 } })).toEqual([{ key: `${base}.capped.judge`, params: {} }]);
    expect(jobNotes('published', { capped: { reason: 'job_budget', judge: false, texts: 0 } })).toEqual([]);
    // A job that ended without a result says nothing about what it left out.
    for (const ended of ['cancelled', 'failed', 'skipped']) {
      expect(jobNotes(ended, { capped: { reason: 'job_budget', judge: true, texts: 412 } })).toEqual([]);
    }
    // A job that waits again (above its estimate) says why it waits, not what an earlier step left out.
    expect(jobNotes('awaiting_approval', { hold: 'overrun', probe: { ratio: 1.3 }, capped: { reason: 'job_budget', judge: true, texts: 5 } }))
      .toEqual([{ key: `${base}.hold.overrun`, params: { pct: 30 } }]);
    expect(jobNotes('published', null)).toEqual([]);
  });

  it('maps job errors to keys, unknown codes to the generic one', () => {
    expect(jobErrorKey('translate.nothing_to_do')).toBe('admin.translations.jobErrors.nothing_to_do');
    expect(jobErrorKey(null)).toBeNull();
    expect(jobErrorKey('translate.no_api_key')).toBe('admin.translations.jobErrors.no_api_key');
    expect(jobErrorKey('some raw failure text')).toBe('admin.translations.jobErrors.unknown');
  });

  describe('glossary query', () => {
    it('builds the or-filter over source and target', () => {
      expect(glossarySearchFilter('quantum')).toBe('source_term.ilike.%quantum%,target_term.ilike.%quantum%');
    });

    it('strips characters that could break out of the filter', () => {
      expect(glossarySearchFilter('a,b)(c*"d%')).toBe('source_term.ilike.%a b c d%,target_term.ilike.%a b c d%');
      expect(glossarySearchFilter(' ,() ')).toBeNull();
    });

    it('turns filters and page into eq pairs and a range', () => {
      const q = buildGlossaryQuery({ search: '', lang: 'de', origin: 'admin', category: 'dnt', page: 2 });
      expect(q.or).toBeNull();
      expect(q.eq).toEqual([['lang', 'de'], ['origin', 'admin'], ['category', 'dnt']]);
      expect(q.from).toBe(2 * GLOSSARY_PAGE_SIZE);
      expect(q.to).toBe(3 * GLOSSARY_PAGE_SIZE - 1);
    });

    it('adds no eq pair for unset filters', () => {
      expect(buildGlossaryQuery({ search: 'x', lang: null, origin: null, category: null, page: -1 }).eq).toEqual([]);
    });
  });

  it('restores only the editable fields from a history snapshot', () => {
    expect(revertPatch({ id: 'x', lang: 'de', target_term: 'Alt', category: 'term', origin: 'ai', locked: false, needs_retranslate: true }))
      .toEqual({ target_term: 'Alt', category: 'term', origin: 'ai', locked: false, needs_retranslate: true });
    expect(revertPatch(null)).toBeNull();
    expect(revertPatch({ id: 'x' })).toBeNull();
  });

  it('parses a saved card language choice and rejects garbage', () => {
    expect(parseLangSelection(null)).toEqual([]);
    expect(parseLangSelection('not json')).toEqual([]);
    expect(parseLangSelection('{"de":1}')).toEqual([]);
    expect(parseLangSelection('["fr"," de ","fr",3,""]')).toEqual(['de', 'fr']);
  });

  it('toggles card languages and keeps them sorted', () => {
    expect(toggleLang([], 'fr')).toEqual(['fr']);
    expect(toggleLang(['fr'], 'de')).toEqual(['de', 'fr']);
    expect(toggleLang(['de', 'fr'], 'de')).toEqual(['fr']);
  });

  it('drops unknown languages only once the language list is known', () => {
    expect(sanitizeLangSelection(['de', 'xx'], [])).toEqual(['de', 'xx']);
    expect(sanitizeLangSelection(['de', 'xx'], ['de', 'fr'])).toEqual(['de']);
  });

  it('orders the language overview by pending cards, unknown counts last', () => {
    const counts = new Map([['de', 2], ['fr', 7], ['es', 0]]);
    expect(langNeeds(['de', 'es', 'fr', 'it', 'de'], counts)).toEqual([
      { lang: 'fr', open: 7 },
      { lang: 'de', open: 2 },
      { lang: 'es', open: 0 },
      { lang: 'it', open: null },
    ]);
  });

  it('sums the card header over several languages, the streak stays per person', () => {
    expect(sumCardStats([])).toEqual({ open_count: 0, answered_today: 0, streak_days: 0 });
    expect(sumCardStats([
      { open_count: 3, answered_today: 1, streak_days: 5 },
      { open_count: 4, answered_today: 2, streak_days: 5 },
    ])).toEqual({ open_count: 7, answered_today: 3, streak_days: 5 });
  });
});
