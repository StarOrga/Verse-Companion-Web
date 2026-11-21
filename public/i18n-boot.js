// Starts the UI language table while the app bundle is still downloading, so the
// first translated paint no longer waits for the bundle before its text is even
// requested. Mirrors the signed-out steps of resolveLocale() (locale-resolution.ts).
// A wrong guess only costs one unused fetch: AppTranslateLoader then loads the
// language it really needs. External file because the CSP forbids inline scripts.
(function () {
  // Mirrors normalizeLanguage() in src/app/core/locale/region.data.ts.
  var PLAIN = ['de', 'en', 'fr', 'it', 'ja', 'ko', 'pl', 'ru', 'tr'];
  var LATAM = ['419', 'MX', 'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'GT', 'HN', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'US', 'UY', 'VE'];
  var HANT = ['HANT', 'TW', 'HK', 'MO'];

  function anyIn(list, values) {
    for (var i = 0; i < values.length; i++) if (list.indexOf(values[i]) !== -1) return true;
    return false;
  }

  function normalize(raw) {
    var parts = String(raw || '').trim().split(/[-_]/);
    var primary = parts[0].toLowerCase();
    var subtags = [];
    for (var i = 1; i < parts.length; i++) subtags.push(parts[i].toUpperCase());
    if (!primary) return null;
    if (PLAIN.indexOf(primary) !== -1) return primary;
    if (primary === 'es') return anyIn(LATAM, subtags) ? 'es-419' : 'es';
    if (primary === 'pt') return 'pt-BR';
    if (primary === 'zh') return anyIn(HANT, subtags) ? 'zh-Hant' : 'zh-Hans';
    return null;
  }

  function resolve() {
    var language = null;
    try {
      language = normalize(localStorage.getItem('sc.lang'));
    } catch (e) {
      // storage blocked: the browser signals below still apply
    }
    var tags = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (var i = 0; !language && i < tags.length; i++) language = normalize(tags[i]);
    return language || 'en';
  }

  try {
    var lang = resolve();
    window.__scI18nBoot = {
      lang: lang,
      table: fetch('i18n/' + lang + '.json')
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .catch(function () {
          return null;
        }),
    };
  } catch (e) {
    // no fetch: the loader requests the table itself
  }
})();
