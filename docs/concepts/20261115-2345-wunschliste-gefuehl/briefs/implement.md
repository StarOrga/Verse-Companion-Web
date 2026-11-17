# Implement brief — Wunschliste mit Gefühl

Decisions: [`../../20261115-2345-wunschliste-gefuehl-decisions.json`](../../20261115-2345-wunschliste-gefuehl-decisions.json)
Binding spec (mock markup, CSS, keyframes): [`../rounds/01.html`](../rounds/01.html), design **`d3` "Sternschnuppe"**
(classes `.wl--d3`, `.wl-sky`, `.wl-dot`, `.wl-shoot`, `.wl-fall`, keyframes `wl-tw`, `wl-shoot`, `wl-add`, `wl-fill`,
`wl-star-in`, `wl-fall`). Parity checklist: [`../parity.md`](../parity.md).

## What the user said, word for word

### Original request (chat, before the concept)

> Warum zwei verschiedene seitenleisten icons.. und titel. Warum generell die wunschliste.
> Evaluiere bitte welches passende icons sein könnten für diesen multidimensionalen purpose. Am ende ist es für mich
> eine liste die ich primär dann mir besorge, sekundär beobachte oder geschenkt bekomme.
> Zudem bitte animieren zu suchen bei 0 Poisitonen gemerkt. Wobei positionen gemerkt auch super trocken und langweilig
> klingt... außerdem gern ein link der dazu führt das dort wo man sist die suche geöffnet wird als hätte man
> reingeklickt (landing pages suche oder subheader suche!)
> Es muss wie zum weihnachtsmann gehen, wie geschenke auspacken, wie seine amazon paket öffnen sich anfühlen auf die
> wunschliste zu schauen und seine weichnachtsliste zu definieren...

### Round 1 submission (action `implement`)

- Favourite: **design 3 · Sternschnuppe** (`favorite: "d3"`).
- General note, verbatim: > bitte emit devops agents intensiv umsetzen!
- Annotation answers: none. User pins: none. Per-design / per-screen notes: none.

The five questions pinned on design 3 stayed unanswered. They are settled by the default below, and each default is
named in the final report so the user can overrule it:

| Question on the mock | Default taken | Why |
|---|---|---|
| "„Wünsche“ ohne „Liste“: klar genug in Sätzen …?" | The name is **Wünsche** everywhere (glossary below) | The chosen design carries the name as one of its three traits |
| "Der Stern gehört heute den Erkunder-Erfolgen. Darf die Sternschnuppe trotzdem für Wünsche stehen?" | Yes | Choosing design 3 is that answer; the comment in `path-icons.ts` is updated |
| "Soll der Nachthimmel auch oben im großen Fenster stehen …?" | Yes, as mocked (84 px strip above the groups) | The approved mock shows it |
| "Soll derselbe Stern auch oben ins Symbol in der Kopfzeile fliegen?" | No, only into the path node | Not shown on the mock |
| Search link + measurement ("Fehlt dir eine Zahl?") | As described on the pin | No objection |

## Glossary (DE / EN)

| Today | New (DE) | New (EN) |
|---|---|---|
| Wunschliste (label, title, tooltip, node) | Wünsche | Wishes |
| Ganze Wunschliste | Alle Wünsche | All wishes |
| N Positionen / 1 Position (wishlist counts only) | N Wünsche / 1 Wunsch | N wishes / 1 wish |
| Auf die Wunschliste (action) | Zu den Wünschen | Add to wishes |
| auf der / deiner Wunschliste | bei deinen Wünschen | among your wishes |
| von der Wunschliste | aus deinen Wünschen | from your wishes |
| Wunschliste öffnen | Wünsche öffnen | Open wishes |
| Die Wunschliste ist leer / Noch nichts auf der Wunschliste | Wünsch dir was | Make a wish |

Sentences keep their meaning and stay natural German / English; the table fixes the term, not every sentence.
Counts of other things (Nachschub positions, inventory) keep "Positionen". The search keyword `wunschliste` /
`wishlist` keeps working and gains `wünsche` / `wishes`.

## Checklist (one line per accepted item, with its source)

Each line is judged against its quote; on a conflict the quote wins.

1. **One symbol everywhere: the shooting star.** Quote: "Warum zwei verschiedene seitenleisten icons" · mock: every
   screen of d3. Header trigger (heart today, `merkliste.component.ts:23`) and `PATH_ICONS.wish` (bookmark,
   `path-icons.ts:9`) both become the d3 icon; the header reads it from `PATH_ICONS.wish`, no second constant.
2. **News "gemerkt" keeps the bookmark, as its own glyph.** Mock: news rows on "Suche geöffnet" and "Im Codex".
   `news-list.component.ts:1411-1416` must no longer read `PATH_ICONS.wish`.
3. **One name: Wünsche.** Quote: "… und titel. Warum generell die wunschliste." · d3 trait "Name „Wünsche“".
   Glossary above, both locales, every surface.
4. **No "Positionen gemerkt".** Quote: "positionen gemerkt auch super trocken und langweilig klingt". Counts read
   "N Wünsche" / "1 Wunsch".
5. **Empty popout invites to search.** Quote: "bitte animieren zu suchen bei 0 Poisitonen gemerkt" · screen "Leer":
   night sky (136 px, twinkling dots, two shooting stars), headline "Wünsch dir was", text "Jede Sternschnuppe ein
   Wunsch. Such dir deinen ersten aus.", primary action "Wunsch suchen" with the search glyph, no footer while empty.
6. **The link opens the search of the page you are on, as if clicked into it.** Quote: "ein link der dazu führt das
   dort wo man sist die suche geöffnet wird als hätte man reingeklickt (landing pages suche oder subheader suche!)".
   Mechanism to reuse, read from the code: `QuickSearchComponent.trigger()` (`quick-search.component.ts:218`) →
   `CodexSearchHub.activate()` (`codex-search-hub.service.ts:69`, the landing terminal / slim bar / fusion search
   register there) → else the Ctrl+K palette. The popout closes first; focus ends in the search field.
7. **The large window's empty state does the same** (art, headline, action that opens the search).
8. **Filled popout.** Screen "Gefüllt": rows unchanged (thumb, name, type, stepper, Nachschub, remove); each thumb
   carries a small twinkling star (4 px, top right); footer "Alle Wünsche" + "N Wünsche".
9. **Large window.** Screen "Großes Fenster": rail shows the shooting star, title "Wünsche", an 84 px night-sky strip
   above the groups, the star dot on thumbs, status "N Wünsche · N Gruppen".
10. **Add moment in the path control.** Screen "Im Codex": on adding, a star streak flies into the wish node
    (`wl-star-in`), the node pulses (ring + scale 1.14, `wl-add`) and its icon fills (`wl-fill`). Label "Wünsche".
11. **Fulfilled moment.** Quote: "wie geschenke auspacken" · screen "Im Codex" toast: "„{{name}}“ ist da" / "Dein
    Wunsch ist in Erfüllung gegangen", its icon falls in (`wl-fall`). Source of the toast text:
    `item-path.service.ts:501` (`itemPath.done.ownWish` / `ownWishLeft`).
12. **Search results show the shooting star as the wish action**, outlined when off, filled when on (screen "Suche
    geöffnet").
13. **Reduced motion: no animation**, the static picture stays complete.
14. **Phone:** the popout is a full-screen sheet; empty state and rows work at 390 px; targets ≥ 48 px.
15. **Analytics (project rule):** `hq:wishlist_open` `{ surface: 'popout' | 'cart' }` and `hq:wish_search_open`
    `{ surface: 'popout' | 'cart' }` in `src/app/core/analytics/events.ts`; a flow `wish` in `posthog/flows.json`
    (`hq:wishlist_open` → `hq:wish_search_open` → `hq:wish_add`) and a funnel tile `{ flow: 'wish' }` on the web
    dashboard in `posthog/dashboards.json`.
16. **Rule text:** the comment in `path-icons.ts:16` ("The star is retired …") names the shooting star for wishes as
    the deliberate exception.

## Already done on this branch (do not redo)

- A light popout at its trigger shows only the accent edge (`sc-popup` `light`, commit 71327f9ed); the wishlist
  popout's title is `quick.wish`, the count stands once in the footer.

## Project rules that bind this work

`CLAUDE.md` at the repo root: ngx-translate for every string (both `public/i18n/de.json` and `en.json`), `scAction`
tiers (one `primary` per dialog), navigations are anchors and actions are buttons, colours carry access meaning
(the sky and the stars use `--sc-accent` and neutral whites only, no new colour token), `dvh` for sheets, errors via
`toErrorKey`, logging via `core/log.ts`, a new user action is a catalogue event. Unit tests are Vitest in a real
browser (`.claude/deep-knowledge/unit-tests.md`); run a test command as its own shell call.
