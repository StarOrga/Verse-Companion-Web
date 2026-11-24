// sc-events-sync — RSI's own pages as a second, fresh source (feedback #400).
//
// Pure parsing, no network: index.ts fetches, this file reads.
//
// Why: the Star Citizen Wiki API mirrors comm-links with a lag of days to weeks
// (2026-11-23: newest mirrored id 21431 from Nov 2 while RSI had published the
// whole IAE 2956 run, ids 21386–21462). Neither the IAE dates nor its official
// artwork could be found from the mirror alone. Three RSI surfaces fill that gap:
//
//   1. the comm-link hub list  POST /api/hub/getCommlinkItems  → id, href, title,
//      list thumbnail, relative age ("2 weeks ago");
//   2. the article page        GET  /comm-link/<channel>/<id>-<slug>  → og:image
//      (the editorial hero) and `data-platform-client-props` whose
//      `content.htmlUrl` points at the article body;
//   3. the article body        GET  /alexandria/html/…  → the real text (dates)
//      and every picture as signed `/i/<sha1>/…/<file>` paths.
//
// The event image is picked from the edition's posts: an artwork whose FILE
// NAME says it is the schedule ("iae2956-schedule-16x9-72dpi.jpg", inside the
// "Countdown To IAE 2956" post) beats everything, because that is the picture
// a reader opens an event for; otherwise the event post's og:image.
//
// Runs under `node --test` (erasable TS only).

export const RSI_BASE = 'https://robertsspaceindustries.com';

export interface HubItem {
  id: number;
  /** Absolute RSI url of the article. */
  url: string;
  title: string;
  /** List thumbnail (`channel_item_full`), '' when none. */
  thumb: string;
  /** Approximate publish time, derived from the hub's relative age. */
  publishedAt: string;
}

export interface ArticleImage {
  /** Absolute, signed RSI url of the full-size picture. */
  url: string;
  /** File name without the format extension ("iae2956-schedule-16x9-72dpi"). */
  name: string;
}

export type EventImageKind = 'schedule' | 'hero';

export interface EventImage {
  url: string;
  kind: EventImageKind;
  /** The RSI article the picture comes from. */
  from: string;
}

const decode = (s: string) => s
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|&#160;/g, ' ');

/** Only RSI-hosted urls survive: every page we read is untrusted input. */
export function rsiAbsolute(raw: string): string | null {
  const v = decode(raw.trim()).split('\\/').join('/');
  if (!v) return null;
  try {
    const u = new URL(v, RSI_BASE);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    if (u.hostname !== 'robertsspaceindustries.com' && u.hostname !== 'media.robertsspaceindustries.com') return null;
    return u.toString();
  } catch {
    return null;
  }
}

const UNIT_DAYS: Record<string, number> = { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };

/** "5 hours ago" / "1 week ago" → an ISO time `now` minus that age; unknown → `now`. */
export function ageToIso(age: string, now: number): string {
  const m = /(\d+|an?)\s+(minute|hour|day|week|month|year)s?\s+ago/i.exec(age);
  if (!m) return new Date(now).toISOString();
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  return new Date(now - n * UNIT_DAYS[m[2].toLowerCase()] * 86_400_000).toISOString();
}

/** The `data` HTML of a getCommlinkItems answer → its articles, in list order. */
export function parseHubItems(html: string, now: number): HubItem[] {
  const out: HubItem[] = [];
  for (const block of html.split(/<a\s+class="content-block2/).slice(1)) {
    const href = /href="([^"]+)"/.exec(block)?.[1] ?? '';
    const url = rsiAbsolute(href);
    const id = Number(/\/(\d+)-[^/]*$/.exec(href)?.[1] ?? NaN);
    const title = decode(/<div class="title[\s"][^>]*>([\s\S]*?)<\/div>/.exec(block)?.[1] ?? '').replace(/\s+/g, ' ').trim();
    if (!url || !Number.isInteger(id) || id <= 0 || !title || !/\/comm-link\//.test(url)) continue;
    const thumb = rsiAbsolute(/background-image:url\('([^']+)'\)/.exec(block)?.[1] ?? '') ?? '';
    const age = /time_ago">[^<]*<span class="value">([^<]*)</.exec(block)?.[1] ?? '';
    out.push({ id, url, title, thumb, publishedAt: ageToIso(age, now) });
  }
  return out;
}

/** og:image of an RSI page (the editorial hero), RSI-hosted only. */
export function ogImage(pageHtml: string): string | null {
  const m = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(pageHtml)
    ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(pageHtml);
  return m ? rsiAbsolute(m[1]) : null;
}

/** The article body url (`content.htmlUrl` in `data-platform-client-props`), RSI-hosted only. */
export function articleBodyUrl(pageHtml: string): string | null {
  const m = /htmlUrl(?:&quot;|")\s*:\s*(?:&quot;|")([^"&]+)(?:&quot;|")/.exec(pageHtml);
  if (!m) return null;
  const url = rsiAbsolute(m[1]);
  return url && new URL(url).pathname.startsWith('/alexandria/') ? url : null;
}

/** Visible text of an article body — what the date matcher reads. */
export function bodyText(bodyHtml: string): string {
  return decode(
    bodyHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|li|h\d|template)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, 60000);
}

/**
 * Every picture of an article body, once per file, as its full-size signed url.
 * RSI lists each picture in several crops (`resize(3000,…)`, `resize(1500,…)`,
 * a portrait cut, a 4-px blur placeholder) plus the untouched original
 * `/i/<sha1>/<token>/<file>`; the original wins, the widest landscape resize
 * otherwise. webp twins of a jpg/png collapse onto the same name.
 */
export function articleImages(bodyHtml: string): ArticleImage[] {
  const text = decode(bodyHtml).split('\\/').join('/');
  const best = new Map<string, { url: string; score: number }>();
  for (const m of text.matchAll(/\/i\/[0-9a-f]{40}\/[^"'\s<>]+?\.(?:jpe?g|png|webp)(?=["'\s<>)]|$)/gi)) {
    const path = m[0];
    const file = path.split('/').pop() ?? '';
    const name = file.replace(/\.(jpe?g|png|webp)$/i, '');
    if (!name) continue;
    const resize = /resize\((\d+),(\d+),/.exec(path);
    // original > landscape resize by width > portrait; webp loses a tie to jpg/png.
    let score = resize ? Number(resize[1]) * (Number(resize[1]) >= Number(resize[2]) ? 1 : 0.01) : 1e9;
    if (resize && Number(resize[1]) < 64) continue; // blur placeholder
    if (/\.webp$/i.test(file)) score -= 0.5;
    const url = rsiAbsolute(path);
    if (!url) continue;
    const prev = best.get(name);
    if (!prev || score > prev.score) best.set(name, { url, score });
  }
  return [...best].map(([name, v]) => ({ url: v.url, name }));
}

/** A picture whose file name says it is the event's schedule / calendar. */
export const SCHEDULE_IMAGE = /schedule|calendar|line-?up/i;

/**
 * The event image from the edition's articles. `articles` in priority order
 * (the event's own post first): a schedule artwork anywhere wins; otherwise the
 * first article's og:image.
 */
export function pickEventImage(articles: ReadonlyArray<{ url: string; og: string | null; images: readonly ArticleImage[] }>): EventImage | null {
  for (const a of articles) {
    const s = a.images.find((i) => SCHEDULE_IMAGE.test(i.name));
    if (s) return { url: s.url, kind: 'schedule', from: a.url };
  }
  const hero = articles.find((a) => a.og);
  return hero ? { url: hero.og!, kind: 'hero', from: hero.url } : null;
}

/** In-game year named in a title ("IAE 2956 Finale" → 2956), or null. */
export function titleYear(title: string): number | null {
  const m = /\b(29[4-9]\d)\b/.exec(title);
  return m ? Number(m[1]) : null;
}

/** Which of an edition's posts to open first: the ones that usually carry the schedule. */
export function articlePriority(title: string): number {
  if (/schedule|free[- ]?fly/i.test(title)) return 0;
  if (/countdown|save the date/i.test(title)) return 1;
  if (/\babout\b|guide|faq/i.test(title)) return 2;
  return 3;
}
