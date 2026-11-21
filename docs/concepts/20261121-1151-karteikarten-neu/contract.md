# Contract — Karteikarten neu (Wave 1 → Wave 2)

Server side of `briefs/implement.md` (P1–P14, data side of G1–G4). Migration
`supabase/migrations/20261121170000_translation_cards_v2.sql`; pipeline in
`supabase/functions/translate-orchestrator/` (`_card_filters.ts`, `_cards.ts`, `_back.ts`, `_learn_pass.ts`).
All RPCs are `security definer`, callable by `authenticated`, and raise `42501` for a non-admin
(`public.is_admin()`, as every translation RPC). Nothing here is writable directly: `translation_cards` and
`translation_admin_langs` change only through these RPCs (and the edge function's service role).

## Lifecycle of a card

```
pipeline pair ──P2/P1/P4/P3──► resolved ─────────────────────────────► status 'ai' (decided, vetoable)
             │                 convention pattern ─► ONE card per pattern, lang null ─► 'open' (deck of every admin whose language is in langs)
             │                 real question, language judged by an admin ─────────► 'open' (deck)
             │                 real question, language nobody judges ──────────────► 'ai' (KI decided, P6)
'open' ──answer──► 'answered' ──(next learn pass)──► applied (applied_at set, undo gone)
'open' ──not mine──► 'ai' (undecided) ──(next learn pass)──► 'ai' decided
'ai' decided ──„Sieht falsch aus“──► 'ai' undecided, the vetoed option never wins again ──► next pass decides anew
                                    (both options vetoed → 'parked': nothing is applied)
'ai' decided ──„Passt“ / back-translation present / 3 days──► taken over at the next learn pass
'folded' = an old single card that became a member of a convention card (P14). Never shown.
```

Answers and KI decisions take effect at the **next learn pass** (data upload or „Lernen“ in the Quellen tab) —
the UI says „ab nächstem Lernlauf“ (P11). Undo works until then (P13).

## Types (TypeScript, as the RPCs return them)

```ts
export type CardKind = 'convention' | 'term' | 'wording';   // DB 'meta' is returned as 'term'
export type CardStatus = 'open' | 'answered' | 'ai' | 'parked' | 'folded';
export type CardChoice = 'a' | 'b' | 'own';
export type PatternId = 'case.upper' | 'case.title' | 'compound' | 'verb.form' | 'abbr';
export type ReasonCode =
  | 'majority' | 'community' | 'ai' | 'votes' | 'bracket' | 'whitespace' | 'casing_source' | 'convention' | 'only_left';

export interface CardExample {
  lang: string;   // 'de' | 'it' | 'pt-BR' | 'ja' | 'ru' …
  key: string;    // game key, e.g. 'ui_door_open' (technical; show only as a hint)
  en: string;     // English source line (the "where" label for the example)
  text: string;   // the line WITH this option applied
}

export interface CardOption {
  text: string;            // the option itself (convention: the first example's text)
  source: string;          // 'ai' | 'community:<id>' | 'mined' | 'glossary' | 'cig' | 'admin' | 'pattern'
  votes?: number;          // term cards: how often the packs use it ("5×")
  count?: number;          // P10 „betrifft N Texte“ for this option
  examples?: CardExample[]; // P10 exactly 3 where ≥ 3 texts exist (a wording card on one string has 1)
}

export type CardParams =
  | { pattern: PatternId; langs: string[] }        // kind convention
  | { term: string; where: Where | null }           // kind term
  | { en: string; key: string; where: Where | null }; // kind wording
export type Where = 'ui' | 'item' | 'mission_lore' | 'other';

export interface KiDecision {
  choice: CardChoice;              // 'own' = neither option verbatim (e.g. a cut bracket)
  text: string;                    // the KI's text — the hero of the veto card
  basis: ReasonCode;
  reason: { code: ReasonCode; a?: number; b?: number }; // render from i18n, never prose
  unsure: boolean;                 // ⚠, sorted first
  back_de: string | null;          // German back-translation; null = still being made
  decided_at: string;
  accepted: boolean;
}

export interface Card {
  id: string;
  kind: CardKind;
  lang: string | null;             // null for convention
  langs: string[];                 // convention: every language it covers („alle 5 Sprachen“)
  params: CardParams;
  option_a: CardOption;
  option_b: CardOption;
  spread: number;                  // texts the card affects in total
  reach: number;                   // 3 UI/HUD … 0 other
  doubt: number;                   // 0..1, ranks again (P5)
  fresh: boolean;
  status: CardStatus;
  answer: CardChoice | null;
  own_text: string | null;
  exceptions: Record<string, 'a' | 'b'> | null; // convention answers only (P8)
  points: number;                  // points this card earned (20) …
  bonus: number;                   // … plus the daily-goal bonus if it filled the goal (180)
  ai: KiDecision | null;
  vetoed: CardChoice[];
  can_undo: boolean;               // the caller's last action on it is undoable right now
  created_at: string;
}

export interface Goal { done: number; target: number; full: boolean; bonus_taken: boolean }

/** Result of every action RPC that scores. */
export interface ActionResult { card: Card; points: number; bonus: number; goal: Goal }
```

## RPCs

| RPC | Args | Returns | Lines |
|---|---|---|---|
| `translation_deck` | `p_lang text`, `p_limit int = 10` (1..50) | `Deck` | P1, P4, P8, P9, P10, U2/U7 |
| `answer_translation_card` | `p_card_id uuid`, `p_answer 'a'\|'b'\|'own'`, `p_own_text text = null`, `p_exceptions jsonb = null` | `ActionResult` | P8, P11, G3, U3, U4 |
| `not_mine_translation_card` | `p_card_id uuid` | `{ card: Card; goal: Goal }` | P12 |
| `undo_translation_card` | `p_card_id uuid` | `{ card: Card; goal: Goal }` | P13, U6 |
| `translation_veto_list` | `p_lang text`, `p_limit int = 50` (1..200) | `VetoList` | P6, U11 |
| `veto_translation_decision` | `p_card_id uuid` | `ActionResult` | P6 „Sieht falsch aus“ |
| `accept_translation_decision` | `p_card_id uuid` | `ActionResult` | P6 „Passt“ |
| `accept_translation_decisions` | `p_lang text` | `number` (rows) | P6 „Rest übernehmen“ |
| `translation_my_langs` | — | `string[]` | P7 |
| `set_translation_my_langs` | `p_langs text[]` | `string[]` (sorted, deduped) | P7 |
| `translation_card_board` | — | `Board` | G1, G3, G4, U8, U9, U10 |

```ts
export interface Deck {
  lang: string;
  open_total: number;      // open cards for this language (incl. conventions covering it)
  affected_total: number;  // texts all of them affect
  deck_affected: number;   // texts the returned cards affect („Deutsch · 10 Karten · betrifft 74 Texte“)
  cards: Card[];           // deck order: convention → term → wording, then spread, reach, doubt, fresh
}

export interface VetoList {
  lang: string;
  total: number;           // KI decisions waiting (not applied, not accepted)
  unsure: number;
  items: Card[];           // unsure first, then spread; every item has `ai` set
}

export interface Board {
  rules: { points: 20; goal: 10; bonus: 180; tz: 'Europe/Berlin' };
  my_langs: string[];      // P7, default ['de']
  goal: Goal;              // „Tagesziel 2 / 10“
  streak_days: number;     // „Serie 4 Tage“
  week: {
    start: string;         // Monday (YYYY-MM-DD)
    points: number;        // „Punkte dieser Woche“ (points + bonus since Monday 00:00 Berlin)
    rank: number;          // „Platz 2“
    days: { date: string; active: boolean; today: boolean }[]; // 7 entries Mo..So
  };
  langs: {
    lang: string;
    judged: boolean;       // in my_langs → row „dein Stapel · N offen“; else „N von KI · M unsicher“
    deck_open: number;
    ai_decided: number;    // KI decisions of the language (status ai, decided)
    ai_review: number;     // of those still waiting for a veto (not applied, not accepted)
    ai_unsure: number;     // of those unsure
    ai_pending: number;    // sent to the KI path, decision due at the next learn pass
  }[];                     // judged first, then by lang
  ai_summary: { decided: number; review: number; unsure: number }; // over the not-judged languages — U9 special row
  leaderboard: { user_id: string; name: string | null; points: number; rank: number; is_me: boolean }[];
}
```

Notes for the UI

- G2: no combo exists in any output. The reward moment is `ActionResult.points/bonus/goal`.
- G4: `name` is `profiles.display_name`, else `username`, else `null` (render a neutral fallback key). The own
  row has `is_me: true` → „Du“. The gap to the next place („noch 240 Punkte bis Platz 1“) is
  `leaderboard[rank-2].points - week.points`, computed client-side.
- The leaderboard always contains the caller (0 points if nothing this week).
- „Nicht meine Entscheidung“ does not score; answers, „Sieht falsch aus“ and „Passt“ score 20 each and count
  for the daily goal; the decision that reaches 10 today carries the 180 bonus (once a day). „Rest übernehmen“
  scores nothing and cannot be undone.
- Undo restores the state before the caller's last action on that card (points and bonus included). Offer it
  while `can_undo` is true; the toast's undo calls `undo_translation_card`.
- An own text on a KI card: `answer_translation_card(id, 'own', text)` (the veto card's „Eigener Text E“).
- A convention exception: `answer_translation_card(id, 'a', null, {"it": "b"})` — keys must be in `card.langs`,
  values `'a'|'b'` and different from the answer.
- Language names come from i18n (`lang` codes), not from the server.

## Errors

| SQLSTATE | When | Suggested key |
|---|---|---|
| `42501` | caller is not an admin | `errors.translation.cards.forbidden` |
| `22023` | invalid answer, empty own text, exceptions on a non-convention / on `own` / invalid lang or value, own text on a convention, unknown language | `errors.translation.cards.invalid` |
| `P0002` | card not found / already decided / already taken over / nothing to undo | `errors.translation.cards.gone` (reload the deck) |
| `55000` | undo after a learn pass applied it | `errors.translation.cards.applied` |

## i18n templates (P9) — the server stores parameters, the UI writes the question

Proposed keys (`public/i18n/{de,en}.json`, Wave 2 owns them). `{{…}}` are the parameters named in `params`
or on the options.

| Kind / pattern | Question (`translations.cards.q.*`) | Option labels (`translations.cards.opt.*`) |
|---|---|---|
| `convention` `case.upper` | DE „Groß oder normal, wo Englisch normal schreibt?“ · EN "Capitals or normal where English writes normally?" | a „Normal“ / b „GROSS“ |
| `convention` `case.title` | „Groß- oder Kleinschreibung nach dem ersten Wort?“ | a „Satzschreibung“ / b „Jedes Wort groß“ |
| `convention` `compound` | „Zusammen oder getrennt schreiben?“ | a „Zusammen“ / b „Getrennt / mit Bindestrich“ |
| `convention` `verb.form` | „Befehlsform oder Grundform auf Knöpfen?“ | a „Befehlsform (Annulla)“ / b „Grundform (Annullare)“ |
| `convention` `abbr` | „Abkürzung oder ausgeschrieben?“ | a „Abkürzung“ / b „Ausgeschrieben“ |
| `term` | „Wie soll „{{term}}“ überall heißen?“ | the option `text` itself, `votes` as „{{votes}}×“ |
| `wording` | „Welche Übersetzung passt zu „{{en}}“?“ | the option `text` itself |

Shared fragments: `translations.cards.affects` „betrifft {{count}} Texte“; `translations.cards.when`
„ab nächstem Lernlauf“; `translations.cards.allLangs` „alle {{n}} Sprachen“ (convention, `langs.length`);
`translations.cards.where.{ui,item,mission_lore,other}`.

Reason codes of the KI card (`translations.cards.reason.<code>`, numbers from `ai.reason`):

| code | DE text | params |
|---|---|---|
| `majority` | „Mehrheit {{a}} : {{b}}“ (use the larger first) | `a`, `b` |
| `community` | „Text aus dem Community-Paket“ | — |
| `ai` | „KI-Text, kein Community-Text vorhanden“ | — |
| `votes` | „Mehr Stimmen ({{a}} : {{b}}), keine klare Mehrheit“ | `a`, `b` |
| `bracket` | „Fremder Klammerzusatz entfernt“ (e.g. a ship name) | — |
| `whitespace` | „Nur Leerzeichen bereinigt“ | — |
| `casing_source` | „Schreibweise wie im Englischen“ | — |
| `convention` | „Nach eurer Schreibweisen-Regel“ | — |
| `only_left` | „Die andere Variante wurde als falsch markiert“ | — |

## Checklist lines this serves (server side)

| Line | Where |
|---|---|
| P1 | `_card_filters.ts` `spellingPattern`, `classifyPair`; `_cards.ts` `routePair` → `upsertConvention` |
| P2 | `_card_filters.ts` `stripForeignBrackets` (resolved → KI decision `bracket`, unsure) |
| P3 | `_card_filters.ts` `clearMajority` (≥ 5 votes in total, ≥ 4 : 1) → KI decision `majority`, logged as a card row, vetoable |
| P4 | `_card_filters.ts` `verbFormPattern` (it, pt-BR, ru), `abbreviationPattern` |
| P5 | `_card_filters.ts` `disagreementDoubt` (used by `_arbiter.ts` `bothOrders`), `recomputeDoubt` (P14) |
| P6 | `_card_filters.ts` `kiDecide`; `_back.ts` back-translation batch; RPCs veto/accept/veto list |
| P7 | `translation_admin_langs`, `translation_my_langs`/`set_translation_my_langs`, `translation_judged_langs` (union, default de) |
| P8 | convention kind (lang null, `langs`), `exceptions`, `conventionPick`, `conventions.json` rule for later pairs |
| P9 | column `question` dropped; `params` + this template table |
| P10 | `CardOption.count`, `examples` (`termExamples`, `conventionExamples`) |
| P11 | application in `applyAnsweredCards` at the learn-pass start |
| P12 | `not_mine_translation_card` → KI path, `routeCards` decides; Skip and `skipped` removed |
| P13 | `undo` snapshot + `undo_translation_card` until `applied_at` |
| P14 | `cleanupOpenCards` — runs once at the first learn pass after deploy (marker `translation-work/cards/cleanup-v2.json`) |
| G1–G4 | `translation_card_board`, `translation_card_rules`, scoring in the action RPCs |

## Removed (the current UI still calls these — Wave 2 replaces them)

`translation_cards.question`, `.skipped_at`, status `skipped`; RPCs `skip_translation_card`,
`translation_card_stats`, `translation_card_leaderboard`, the 5-arg `answer_translation_card`
(note / save_as_rule). `TranslationsService.cardQueue` (direct table select ordered by `kind_rank`) should move
to `translation_deck`; `people()` is no longer needed for leaderboard names.
