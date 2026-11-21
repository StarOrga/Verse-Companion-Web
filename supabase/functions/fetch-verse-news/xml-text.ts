const ENTITIES: Record<string, string> = { amp: '&', quot: '"', '#39': "'", lt: '<', gt: '>' };

/** Unwraps CDATA and decodes the five XML entities in ONE pass, so `&amp;lt;` stays the text `&lt;`. */
export function cleanXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(amp|quot|#39|lt|gt);/g, (_, name: string) => ENTITIES[name])
    .trim();
}
