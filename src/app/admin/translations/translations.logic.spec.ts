import {
  GLOSSARY_PAGE_SIZE,
  buildGlossaryQuery,
  canApprove,
  canCancel,
  canStartFullRun,
  hasOpenFullRun,
  jobCoverage,
  languageCoverage,
  glossarySearchFilter,
  jobErrorKey,
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

  describe('language coverage', () => {
    const counts = { keys: 1010, blank: 10, cig: 200, tm: 300, forced: 0, todo: 40, unchanged: 460 };
    const at = '2026-11-20T10:00:00Z';

    it('counts CIG translations and TM hits over the non-blank keys of an estimate', () => {
      expect(jobCoverage({ lang: 'de', status: 'awaiting_approval', stats: { counts }, created_at: at }))
        .toEqual({ pct: 50, covered: 500, total: 1000, missing: 500, at });
    });

    it('uses the overlay of a published job instead of the TM hits, dated at its publish', () => {
      const pub = '2026-11-21T08:00:00Z';
      const c = jobCoverage({ lang: 'de', status: 'published', stats: { counts, overlay_count: 799, published_at: pub }, created_at: at });
      expect(c).toEqual({ pct: 99, covered: 999, total: 1000, missing: 1, at: pub });
    });

    it('rounds down, so 100 % means nothing is missing, and never exceeds the table', () => {
      const c = jobCoverage({ lang: 'de', status: 'published', stats: { counts, overlay_count: 5000 }, created_at: at });
      expect(c).toEqual({ pct: 100, covered: 1000, total: 1000, missing: 0, at });
    });

    it('has no figure while a job still counts, without counts, or for an empty table', () => {
      expect(jobCoverage({ lang: 'de', status: 'estimating', stats: { counts }, created_at: at })).toBeNull();
      expect(jobCoverage({ lang: 'de', status: 'skipped', stats: null, created_at: at })).toBeNull();
      expect(jobCoverage({ lang: 'de', status: 'queued', stats: { counts: { keys: 5, blank: 5 } }, created_at: at })).toBeNull();
    });

    it('takes the newest job of the language that measured one', () => {
      const jobs = [
        { lang: 'fr', status: 'queued', stats: { counts: { ...counts, cig: 0, tm: 0 } }, created_at: at },
        { lang: 'de', status: 'estimating', stats: {}, created_at: at },
        { lang: 'de', status: 'queued', stats: { counts }, created_at: at },
        { lang: 'de', status: 'published', stats: { counts, overlay_count: 800 }, created_at: at },
      ];
      expect(languageCoverage(jobs, 'de')?.pct).toBe(50);
      expect(languageCoverage(jobs, 'fr')?.pct).toBe(0);
      expect(languageCoverage(jobs, 'it')).toBeNull();
    });

    it('knows an unfinished full run of a language', () => {
      const jobs = [
        { lang: 'de', mode: 'full', status: 'published' },
        { lang: 'de', mode: 'delta', status: 'queued' },
        { lang: 'fr', mode: 'full', status: 'awaiting_approval' },
      ];
      expect(hasOpenFullRun(jobs, 'de')).toBe(false);
      expect(hasOpenFullRun(jobs, 'fr')).toBe(true);
    });

    it('offers a full run only to approved languages with a gap or no figure yet, and none while one runs', () => {
      const gap = { pct: 40, covered: 400, total: 1000, missing: 600, at };
      const full = { pct: 100, covered: 1000, total: 1000, missing: 0, at };
      expect(canStartFullRun(true, gap, false)).toBe(true);
      expect(canStartFullRun(true, null, false)).toBe(true);
      expect(canStartFullRun(true, full, false)).toBe(false);
      expect(canStartFullRun(true, gap, true)).toBe(false);
      expect(canStartFullRun(false, gap, false)).toBe(false);
    });
  });
});
