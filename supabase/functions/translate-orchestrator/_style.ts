// C3 learned style: regex statistics over a language's trusted pairs, stored in
// `translation_languages.style` and rendered into the system prompt on top of the static STYLE
// block. Pure (node --test + Deno). Only CIG and admin pairs teach style — CIG is the house style
// the precedence rule follows; community pairs count only while CIG gives too little evidence
// (ru: the game has no Russian CIG table).

export interface StylePair {
  key: string;
  en: string;
  t: string;
}

export interface LearnedStyle {
  v: 1;
  /** Pairs the statistics were taken from. */
  n: number;
  /** Which origins taught it, e.g. ['cig','admin'] or ['cig','admin','community']. */
  from: string[];
  /** Informal vs formal address hits; ratio = informal / (informal + formal); null without hits. */
  address: { informal: number; formal: number; ratio: number | null } | null;
  /** Decimal numbers in the target: comma vs point; share = comma / all. */
  decimal: { comma: number; point: number; share: number | null };
  /** "40 %" vs "40%": share with a space. */
  percent: { spaced: number; tight: number; share: number | null };
  /** Quote style counts in the target and the dominant one. */
  quotes: { counts: Record<string, number>; dominant: string | null };
  /** Per key prefix (first `_` segment): share of targets in full upper case where the English is not. */
  upper: Record<string, { n: number; share: number }>;
  at?: string;
}

/** Address pronouns per language: informal / formal. German formal only capitalised mid-sentence. */
const ADDRESS: Record<string, { informal: RegExp; formal: RegExp }> = {
  de: { informal: /(?<![\p{L}])(du|dich|dir|dein|deine|deinen|deinem|deiner|deines)(?![\p{L}])/giu, formal: /(?<=[\p{L}\p{N},;:] )(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?![\p{L}])/gu },
  fr: { informal: /(?<![\p{L}])(tu|toi|ton|ta|tes)(?![\p{L}])/giu, formal: /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/giu },
  es: { informal: /(?<![\p{L}])(tú|tu|tus|te|ti)(?![\p{L}])/giu, formal: /(?<![\p{L}])(usted|ustedes|su|sus)(?![\p{L}])/giu },
  it: { informal: /(?<![\p{L}])(tu|ti|tuo|tua|tuoi|tue)(?![\p{L}])/giu, formal: /(?<=[\p{L}\p{N},;:] )(Lei|Suo|Sua|Suoi|Sue)(?![\p{L}])/gu },
  'pt-BR': { informal: /(?<![\p{L}])(você|vocês|seu|sua|te)(?![\p{L}])/giu, formal: /(?<![\p{L}])(o senhor|a senhora)(?![\p{L}])/giu },
  ru: { informal: /(?<![\p{L}])(ты|тебя|тебе|твой|твоя|твои)(?![\p{L}])/giu, formal: /(?<![\p{L}])(вы|вас|вам|ваш|ваша|ваши)(?![\p{L}])/giu },
};

const QUOTES: Record<string, RegExp> = {
  '„“': /„[^“”"]{1,200}[“”]/gu,
  '«»': /«[^»]{1,200}»/gu,
  '»«': /»[^«]{1,200}«/gu,
  '“”': /“[^”„]{1,200}”/gu,
  '""': /"[^"]{1,200}"/gu,
  '「」': /「[^」]{1,200}」/gu,
};

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const share = (a: number, b: number) => (a + b ? Math.round((a / (a + b)) * 1000) / 1000 : null);

function isUpper(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, '');
  return letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/**
 * The raw counts behind a LearnedStyle. Sums only, so the counts of two sets of pairs add up to the
 * counts of their union: a pass takes them slice by slice and merges (`mergeStyleCounts`).
 */
export interface StyleCounts {
  n: number;
  informal: number;
  formal: number;
  comma: number;
  point: number;
  spaced: number;
  tight: number;
  q: Record<string, number>;
  /** head -> [strings, of them in full upper case] */
  up: Record<string, [number, number]>;
}

export const emptyStyleCounts = (): StyleCounts => ({ n: 0, informal: 0, formal: 0, comma: 0, point: 0, spaced: 0, tight: 0, q: {}, up: {} });

export function styleCounts(lang: string, pairs: StylePair[]): StyleCounts {
  const addr = ADDRESS[lang];
  const c = emptyStyleCounts();
  c.n = pairs.length;
  for (const p of pairs) {
    const t = p.t;
    if (addr) {
      c.informal += count(t, addr.informal);
      c.formal += count(t, addr.formal);
    }
    // Decimal numbers only where the English has one (so "1.000" thousands groups do not count).
    if (/\d\.\d/.test(p.en)) {
      c.comma += count(t, /\d,\d/g);
      c.point += count(t, /\d\.\d/g);
    }
    if (/\d\s?%/.test(p.en)) {
      c.spaced += count(t, /\d[\s  ]%/g);
      c.tight += count(t, /\d%/g);
    }
    for (const [name, re] of Object.entries(QUOTES)) {
      const n = count(t, re);
      if (n) c.q[name] = (c.q[name] ?? 0) + n;
    }
    if (!isUpper(p.en) && /\p{L}{3}/u.test(t)) {
      const head = p.key.split('_', 1)[0].toLowerCase();
      const s = (c.up[head] ??= [0, 0]);
      s[0]++;
      if (isUpper(t)) s[1]++;
    }
  }
  return c;
}

export function mergeStyleCounts(a: StyleCounts, b: StyleCounts): StyleCounts {
  const out: StyleCounts = {
    n: a.n + b.n, informal: a.informal + b.informal, formal: a.formal + b.formal, comma: a.comma + b.comma,
    point: a.point + b.point, spaced: a.spaced + b.spaced, tight: a.tight + b.tight, q: { ...a.q }, up: {},
  };
  for (const [k, n] of Object.entries(b.q)) out.q[k] = (out.q[k] ?? 0) + n;
  for (const src of [a.up, b.up]) {
    for (const [h, [n, u]] of Object.entries(src)) {
      const s = (out.up[h] ??= [0, 0]);
      s[0] += n;
      s[1] += u;
    }
  }
  return out;
}

export function styleFromCounts(lang: string, c: StyleCounts, from: string[] = []): LearnedStyle {
  const upper: LearnedStyle['upper'] = {};
  // Largest families first; ties by name, so the result does not depend on the order the pairs came in.
  const heads = Object.entries(c.up).sort((a, b) => b[1][0] - a[1][0] || (a[0] < b[0] ? -1 : 1)).slice(0, 40);
  for (const [head, [n, u]] of heads) {
    if (n >= 20) upper[head] = { n, share: Math.round((u / n) * 1000) / 1000 };
  }
  const dominant = Object.entries(c.q).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
  return {
    v: 1,
    n: c.n,
    from,
    address: ADDRESS[lang] ? { informal: c.informal, formal: c.formal, ratio: share(c.informal, c.formal) } : null,
    decimal: { comma: c.comma, point: c.point, share: share(c.comma, c.point) },
    percent: { spaced: c.spaced, tight: c.tight, share: share(c.spaced, c.tight) },
    quotes: { counts: c.q, dominant },
    upper,
  };
}

export function styleStats(lang: string, pairs: StylePair[], from: string[] = []): LearnedStyle {
  return styleFromCounts(lang, styleCounts(lang, pairs), from);
}

/** Minimum hits before a statistic becomes an instruction (below it the static STYLE decides). */
const MIN_HITS = 20;
/** A preference is stated only when it is clear (≥ 80 % one way); mixed usage stays unstated. */
const CLEAR = 0.8;

/** Prompt lines from a learned style; '' when nothing is clear enough. */
export function styleBlock(style: LearnedStyle | null | undefined): string {
  if (!style || style.v !== 1 || !style.n) return '';
  const out: string[] = [];
  const a = style.address;
  if (a && a.ratio !== null && a.informal + a.formal >= MIN_HITS) {
    if (a.ratio >= CLEAR) out.push(`- Address the player informally (${pct(a.ratio)} of the reference translations do).`);
    else if (a.ratio <= 1 - CLEAR) out.push(`- Address the player formally (${pct(1 - a.ratio)} of the reference translations do).`);
  }
  const d = style.decimal;
  if (d.share !== null && d.comma + d.point >= MIN_HITS) {
    if (d.share >= CLEAR) out.push('- Decimal separator: comma ("1,5").');
    else if (d.share <= 1 - CLEAR) out.push('- Decimal separator: point ("1.5").');
  }
  const p = style.percent;
  if (p.share !== null && p.spaced + p.tight >= MIN_HITS) {
    if (p.share >= CLEAR) out.push('- Put a space before the percent sign ("40 %").');
    else if (p.share <= 1 - CLEAR) out.push('- No space before the percent sign ("40%").');
  }
  const qs = style.quotes;
  const qTotal = Object.values(qs.counts).reduce((x, y) => x + y, 0);
  if (qs.dominant && qTotal >= MIN_HITS && (qs.counts[qs.dominant] ?? 0) / qTotal >= CLEAR) {
    out.push(`- Quotation marks: ${qs.dominant[0]}…${qs.dominant[1]}.`);
  }
  const upHeads = Object.entries(style.upper).filter(([, s]) => s.share >= CLEAR).map(([h]) => h);
  if (upHeads.length) out.push(`- Strings whose key starts with ${upHeads.map((h) => `"${h}_"`).join(', ')} are written in full upper case.`);
  if (!out.length) return '';
  return `Learned from ${style.n} official/admin translations of this language (follow these over the general rules above):\n${out.join('\n')}`;
}

function pct(x: number): string {
  return `${Math.round(x * 100)} %`;
}
