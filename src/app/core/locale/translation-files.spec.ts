import de from '../../../../public/i18n/de.json';
import en from '../../../../public/i18n/en.json';
import es from '../../../../public/i18n/es.json';
import es419 from '../../../../public/i18n/es-419.json';
import fr from '../../../../public/i18n/fr.json';
import it_ from '../../../../public/i18n/it.json';
import ja from '../../../../public/i18n/ja.json';
import ko from '../../../../public/i18n/ko.json';
import pl from '../../../../public/i18n/pl.json';
import ptBR from '../../../../public/i18n/pt-BR.json';
import ru from '../../../../public/i18n/ru.json';
import tr from '../../../../public/i18n/tr.json';
import zhHans from '../../../../public/i18n/zh-Hans.json';
import zhHant from '../../../../public/i18n/zh-Hant.json';
import { APP_LANGUAGES, type AppLanguage } from './locale.types';

/**
 * The machine-translated tables must never break a page: a key they lack falls
 * back to English (`fallbackLang: 'en'`), so completeness is NOT required — a
 * key added to de/en later simply reads English until the tables are refreshed.
 * What is required: every table exists, holds only keys English knows, and keeps
 * every interpolation and markup token of the English text.
 */
const TABLES: Record<AppLanguage, unknown> = {
  de, en, es, 'es-419': es419, fr, it: it_, ja, ko, pl, 'pt-BR': ptBR, ru, tr, 'zh-Hans': zhHans, 'zh-Hant': zhHant,
};

const TOKEN = /\{\{\s*[^}]*?\s*\}\}|<\/?[a-zA-Z][^>]*>/g;
const tokens = (s: string) => (s.match(TOKEN) ?? []).map((t) => t.replace(/\s+/g, '')).sort().join('|');

function flatten(o: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') out.set(key, v);
      else flatten(v, key, out);
    }
  }
  return out;
}

describe('UI translation tables', () => {
  const english = flatten(en);

  it('has a table for every app language', () => {
    expect(Object.keys(TABLES).sort()).toEqual([...APP_LANGUAGES].sort());
  });

  for (const lang of APP_LANGUAGES.filter((l) => l !== 'en' && l !== 'de')) {
    it(`${lang}: only English keys, same interpolations and markup`, () => {
      const table = flatten(TABLES[lang]);
      const orphans = [...table.keys()].filter((k) => !english.has(k));
      const broken = [...table.entries()]
        .filter(([k, v]) => english.has(k) && tokens(v) !== tokens(english.get(k) as string))
        .map(([k]) => k);
      expect(orphans).toEqual([]);
      expect(broken).toEqual([]);
      // A table that lost most of its content would silently read English everywhere.
      expect(table.size).toBeGreaterThan(english.size * 0.9);
    });
  }
});
