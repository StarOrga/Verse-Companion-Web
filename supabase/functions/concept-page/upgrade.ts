// Serve-time engine upgrade for hosted concept pages (admin feedback #369).
//
// A concept page carries its own copy of the devops concept engine, copied
// from whatever donor page was newest when the routine built it. The engine's
// document pins (Ctrl/⌘ + click notes in decision / free rounds) anchor only
// to `p`, `li`, `tr`; the project added `[data-pin]` to that list for #354 so
// mock parts can take a note, and the shim (shim.ts) marks a clicked mock part
// `data-pin` on the fly. A page built from an older donor still has the bare
// list, so there the shim's marker would be ignored and a Ctrl + click on the
// mock would keep doing nothing.
//
// `upgradeEngine` widens exactly that one literal when it is there. It is a
// plain string replacement on routine-written, trusted html (never browser
// input), applied when the function serves the document, so a page that is
// already published gets it without a republish. Anything it does not find
// verbatim stays untouched.

const OLD_BLOCK = "const BLOCK = 'p, li, tr';";
const NEW_BLOCK = "const BLOCK = 'p, li, tr, [data-pin]';";

export function upgradeEngine(html: string): string {
  return html.includes(OLD_BLOCK) ? html.split(OLD_BLOCK).join(NEW_BLOCK) : html;
}
