import { APP_LANGUAGES } from './locale.types';
import { intlLanguageTag, normalizeLanguage, regionForLanguage } from './region.data';

describe('normalizeLanguage', () => {
  it('returns every app language for its own code, whatever the case', () => {
    for (const lang of APP_LANGUAGES) {
      expect(normalizeLanguage(lang)).toBe(lang);
      expect(normalizeLanguage(lang.toUpperCase())).toBe(lang);
    }
  });

  it('maps browser tags onto the file that serves them', () => {
    expect(normalizeLanguage('de-AT')).toBe('de');
    expect(normalizeLanguage('en_US')).toBe('en');
    expect(normalizeLanguage('es-ES')).toBe('es');
    expect(normalizeLanguage('es')).toBe('es');
    expect(normalizeLanguage('es-MX')).toBe('es-419');
    expect(normalizeLanguage('es-419')).toBe('es-419');
    expect(normalizeLanguage('pt-PT')).toBe('pt-BR');
    expect(normalizeLanguage('zh-CN')).toBe('zh-Hans');
    expect(normalizeLanguage('zh-Hans-CN')).toBe('zh-Hans');
    expect(normalizeLanguage('zh-TW')).toBe('zh-Hant');
    expect(normalizeLanguage('hi-IN')).toBe('hi');
    expect(normalizeLanguage('hi')).toBe('hi');
    expect(normalizeLanguage('zh-HK')).toBe('zh-Hant');
    expect(normalizeLanguage('zh-Hant')).toBe('zh-Hant');
    expect(normalizeLanguage('tr-TR')).toBe('tr');
  });

  it('accepts the legacy profile codes of the old dropdown', () => {
    expect(normalizeLanguage('pt')).toBe('pt-BR');
    expect(normalizeLanguage('zh')).toBe('zh-Hans');
    expect(normalizeLanguage('fr')).toBe('fr');
  });

  it('rejects languages without a translation file', () => {
    expect(normalizeLanguage('sv-SE')).toBeNull();
    expect(normalizeLanguage('')).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
  });
});

describe('intlLanguageTag / regionForLanguage', () => {
  it('gives every app language a home region and an Intl-valid tag', () => {
    for (const lang of APP_LANGUAGES) {
      const tag = `${intlLanguageTag(lang)}-${regionForLanguage(lang)}`;
      expect(() => new Intl.DateTimeFormat(tag)).not.toThrow();
      expect(Intl.getCanonicalLocales(tag).length).toBe(1);
    }
  });
});
