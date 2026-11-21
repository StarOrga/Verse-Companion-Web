/**
 * The typed product-event catalogue — the ONE list of what the app may send to
 * PostHog. `AnalyticsService.track()` accepts only these names, with exactly
 * these properties; `scripts/check-analytics-events.mjs` (prebuild) keeps the
 * list honest and `npm run analytics:sync` pushes the descriptions to PostHog.
 *
 * Naming: `category:object_action` — present-tense verb from {@link EVENT_VERBS},
 * snake_case, category = the entry's `area`. Rules, property rules and "how to
 * add an event": docs/analytics/event-naming.md.
 *
 * Properties never carry personal data (no e-mail, no name, no free text, no
 * ids of other people) — keys, kinds, counts and positions only.
 *
 * Erasable TypeScript only and no imports: the guard and the sync script load
 * this file directly with Node's type stripping.
 */

/** Product areas — also the `category` prefix of every event name. */
export const EVENT_AREAS = [
  'app', 'auth', 'codex', 'hangar', 'hq', 'verse', 'news', 'social', 'search', 'settings', 'feedback', 'desktop', 'admin',
] as const;
export type EventArea = (typeof EVENT_AREAS)[number];

/** The fixed present-tense verb list; an event name's last word(s) must be one of these. */
export const EVENT_VERBS = [
  'view', 'open', 'close', 'create', 'add', 'remove', 'update', 'change', 'submit', 'send', 'start', 'finish', 'fail',
  'share', 'search', 'select', 'toggle', 'import', 'export', 'earn', 'request', 'sign_in', 'sign_out', 'show', 'accept', 'deselect',
  'assign', 'release',
] as const;
export type EventVerb = (typeof EVENT_VERBS)[number];

/** Phantom type: the property object an event carries (`undefined` = no properties). */
export interface EventDef<P> {
  readonly area: EventArea;
  /** One German line — shown in PostHog as the event definition's description. */
  readonly desc: string;
  /** Type-level only; never set at runtime. */
  readonly __props?: P;
}

function ev<P = undefined>(area: EventArea, desc: string): EventDef<P> {
  return { area, desc };
}

/** Top-level nav items with a β switch (`BetaService`). */
export type BetaArea = 'verse' | 'codex' | 'shell';

export const EVENTS = {
  // --- app ---------------------------------------------------------------
  'app:error_show': ev<{ key: string; scope: string }>('app', 'Ein Fehlerzustand wurde angezeigt (errors.*-Schlüssel und Bereich, nie der Fehlertext).'),
  'app:install_prompt_show': ev<{ trigger: 'success' | 'idle' | 'manual'; platform: 'android-native' | 'ios' | 'other' }>('app', 'Die Karte zum Installieren der App wurde angezeigt (Auslöser: nach einer gelungenen Aktion, im Leerlauf oder von Hand).'),
  'app:install_prompt_accept': ev<{ platform: 'android-native' | 'ios' | 'other' }>('app', 'Auf der Installieren-Karte wurde Installieren gewählt (öffnet den System-Dialog bzw. die iOS-Anleitung).'),
  'app:install_prompt_close': ev<{ platform: 'android-native' | 'ios' | 'other'; dismissals: number }>('app', 'Die Installieren-Karte oder der System-Dialog wurde abgelehnt (Anzahl bisheriger Ablehnungen steuert die Pause).'),
  'app:install_finish': ev<{ platform: 'android-native' | 'ios' | 'other' }>('app', 'Die App wurde installiert (appinstalled).'),
  'app:tools_dial_open': ev<{ mode: 'phone' | 'compact' | 'tablet'; actions: number }>('app', 'Der Werkzeug-Knopf (Fächer aus Ansicht, Beta, Teilen) wurde auf einem Handy oder Tablet geöffnet.'),

  // --- auth --------------------------------------------------------------
  'auth:user_sign_in': ev<{ provider: 'email' | 'google' | 'discord' }>('auth', 'Anmeldung erfolgreich (Anbieter).'),
  'auth:user_sign_out': ev('auth', 'Abmeldung durchgeführt.'),
  'auth:access_request': ev<{ duplicate: boolean }>('auth', 'Zugang angefragt (duplicate = Adresse war schon bekannt).'),

  'auth:login_view': ev('auth', 'Die Anmeldeseite wurde angezeigt (Einstieg des Login-Trichters).'),
  'auth:provider_select': ev<{ provider: 'email' | 'google' | 'discord' }>('auth', 'Ein Anmeldeweg wurde gewählt (Anbieter), noch vor dem Ergebnis.'),
  'auth:session_start': ev<{ role: string }>('auth', 'Eine angemeldete Sitzung hat begonnen (einmal je Seitenaufruf, Rolle als Eigenschaft).'),

  // --- codex -------------------------------------------------------------
  'codex:entry_view': ev<{ kind: string; class_name: string }>('codex', 'Eine Codex-Detailseite wurde geöffnet (Schiff, Bauteil, Waffe, Mission, Bauplan; Art + Klassenname).'),
  'codex:section_view': ev<{ section: 'fps' | 'keybinds' | 'upcoming' | 'upcoming_entry' }>('codex', 'Ein Codex-Abschnitt abseits der Detailseiten wurde geöffnet.'),
  'codex:compare_start': ev<{ kind: string; count: number }>('codex', 'Der Vergleich wurde möglich: das zweite Objekt liegt im Vergleichsfach.'),
  'codex:holotable_open': ev<{ kind: string }>('codex', 'Der Holotisch einer Detailseite wurde bewusst eingeschaltet.'),
  'codex:part_select': ev<{ source: 'model' | 'list' | 'keyboard' }>('codex', 'Ein Bauteil wurde auf dem Holotisch gewählt (Quelle: Klick aufs 3D-Modell, Liste im Seitenpanel oder Tastatur).'),
  'codex:part_deselect': ev<{ via: 'empty' | 'again' | 'panel' | 'escape' }>('codex', 'Die Bauteil-Auswahl auf dem Holotisch wurde aufgehoben (Klick ins Leere, zweiter Klick aufs Bauteil, Zurück im Seitenpanel oder Escape).'),
  'codex:detail_tab_select': ev<{ kind: string; tab: 'einordnung' | 'werte' | 'bezug' | 'verbaut' | 'aenderungen' | 'bauteile' }>('codex', 'Im Seitenpanel einer Detailseite (Holotisch-Beta, Gegenstand oder Schiff) wurde ein Reiter gewählt (Art, Reiter; bauteile nur beim Schiff).'),
  'codex:buy_open': ev<{ kind: string; tab_remembered: boolean }>('codex', 'Der Reiter Kaufen der Holotisch-Akte wurde geöffnet (Art; ob er die gemerkte Wahl war).'),
  'codex:wish_add': ev<{ kind: string; source: 'shop' | 'wikelo' }>('codex', 'Ein Eintrag wurde aus dem Reiter Kaufen auf die Wunschliste gesetzt (Quelle: Laden oder Wikelo-Tausch).'),
  'codex:deck_select': ev<{ ship: string; deck: string; view: '2d' | '3d' }>('codex', 'Im Holotisch wurde im Deck-Filter ein Deck gewählt (Schiff, Deck-Schlüssel oder hull/all, Ansicht 2D oder 3D).'),
  'codex:interior_filter_toggle': ev<{ group: string; on: boolean }>('codex', 'Im Holotisch wurde eine Innen-Elementgruppe (Fracht, Wege, Medizin …) ein- oder ausgeschaltet.'),
  'codex:immersive_open': ev<{ surface: 'holo' | '3d' | 'schema'; orientation: 'landscape' | 'portrait' }>('codex', 'Die Vollbild-Ansicht des Holotisch-Modells wurde per Knopf geöffnet (Ansicht, Ausrichtung des Geräts).'),
  'codex:immersive_close': ev<{ via: 'button' | 'escape' | 'back' }>('codex', 'Die Vollbild-Ansicht des Holotisch-Modells wurde verlassen (Schließen-Knopf, Escape oder Zurück-Geste).'),
  'codex:stats_sheet_change': ev<{ snap: 'peek' | 'half' | 'full' }>('codex', 'Das Werteblatt am unteren Rand des Holotisch-Handys rastete auf einer Höhe ein (Einrastpunkt).'),
  'codex:interior_element_select': ev<{ ship: string; kind: string; deck: string }>('codex', 'Im Holotisch wurde ein Innen-Element gewählt (Schiff, Art des Elements, Deck).'),
  'codex:parts_search': ev<{ scope: 'outer' | 'inner' | 'both'; hits: number }>('codex', 'Die Bauteile-Suche des Holotischs lieferte ein Ergebnis (Außen-, Innen- oder beide Treffer, Anzahl; nie der Suchtext).'),
  'codex:filter_change': ev<{ kind: string; filter_count: number }>('codex', 'Im Codex-Index wurden Filter angewendet (Art, Anzahl aktiver Filter, nie die Werte).'),
  'codex:ship_link_create': ev<{ shipSlug: string }>('codex', 'Ein Codex-Schiff wurde mit einem Hangar-Schiff verknüpft.'),
  'codex:ship_link_remove': ev<{ shipSlug: string }>('codex', 'Die Verknüpfung eines Codex-Schiffs wurde gelöst.'),
  'codex:ship_link_update': ev<{ shipSlug: string }>('codex', 'Eine Schiffsverknüpfung wurde zur bevorzugten befördert.'),

  // --- hangar ------------------------------------------------------------
  'hangar:ship_add': ev<{ ship_class: string; status: string; ship_count: number }>('hangar', 'Ein Schiff wurde dem Hangar hinzugefügt.'),
  'hangar:ship_remove': ev<{ ship_class: string; status: string; ship_count: number }>('hangar', 'Ein Schiff wurde aus dem Hangar entfernt.'),
  'hangar:flagship_select': ev<{ ship_class: string }>('hangar', 'Ein Flaggschiff wurde gewählt.'),
  'hangar:ship_config_update': ev<{ role: string }>('hangar', 'Die Konfiguration eines Hangar-Schiffs wurde gespeichert.'),
  'hangar:loadout_create': ev<{ role: string }>('hangar', 'Ein Loadout wurde angelegt.'),
  'hangar:fleet_import': ev<{ ships_imported: number; total_in_file: number; source: 'extension' | 'file' }>('hangar', 'Eine Flotte wurde importiert (Datei oder Erweiterung).'),
  'hangar:extension_import': ev<{ ships_offered: number }>('hangar', 'Die Browser-Erweiterung hat Schiffe zum Import übergeben.'),

  'hangar:loadout_share': ev<{ channel: 'link' }>('hangar', 'Ein Loadout wurde als Link geteilt (nie der Token).'),

  // --- hq ----------------------------------------------------------------
  'hq:page_view': ev<{ page: string }>('hq', 'Eine Seite des Hangar-Headquarters wurde geöffnet (Start, Inventar, Jetzt, Planen, Statistik).'),
  'hq:plan_create': ev<{ steps: number }>('hq', 'Ein Einsatz wurde geplant (Anzahl Schritte).'),
  'hq:plan_update': ev<{ change: 'status' | 'step' | 'remove' }>('hq', 'Ein Einsatz wurde geändert (Status, Schritt oder entfernt).'),
  'hq:inventory_add': ev<{ unit: 'pcs' | 'scu' }>('hq', 'Ein Bestand wurde ins Inventar gebucht.'),
  'hq:supply_add': ev<{ qty: number }>('hq', 'Ein Posten einer Operation wurde angelegt.'),
  'hq:wish_add': ev<{ kind: string }>('hq', 'Ein Eintrag wurde zu den Wünschen gelegt.'),
  'hq:wishlist_open': ev<{ surface: 'popout' | 'cart' }>('hq', 'Die Wünsche wurden geöffnet (Popout in der Kopfzeile oder großes Fenster).'),
  'hq:wish_search_open': ev<{ surface: 'popout' | 'cart' }>('hq', 'Aus den leeren Wünschen heraus wurde die Suche geöffnet.'),
  'hq:events_view': ev('hq', 'Der Ereignis-Abschnitt des HQ wurde angezeigt.'),
  'hq:spot_update': ev('hq', 'Ein gespeicherter Spot wurde auf der Spots-Seite umbenannt.'),
  'hq:spot_remove': ev('hq', 'Ein gespeicherter Spot wurde auf der Spots-Seite gelöscht.'),
  'hq:path_group_assign': ev<{ surface: 'codex' | 'hq' | 'wishlist'; created: boolean }>('hq', 'Stücke eines Wunschs wurden einer Operation zugeordnet (Ort; created = dafür eine neue Operation angelegt).'),
  'hq:plain_lines_select': ev<{ choice: 'adopt' | 'keep'; count: number }>('hq', 'Zu alten Zeilen einer Operation wurde die Frage "Sind das Wünsche?" beantwortet (als Wünsche führen oder so lassen; Anzahl Zeilen).'),
  'hq:path_group_release': ev<{ surface: 'codex' | 'hq' | 'wishlist'; pieces: number; dissolved: boolean }>('hq', 'Zugeordnete Stücke eines Wunschs haben ihre Operation verlassen (Ort, Anzahl Stücke; dissolved = eine Operation wurde mit aufgelöst).'),

  // --- search ------------------------------------------------------------
  'search:palette_open': ev<{ surface: 'palette' | 'codex_bar' }>('search', 'Die Suche wurde geöffnet (Palette oder Codex-Leiste).'),
  'search:result_open': ev<{ area: string; rank: number; new_tab: boolean; current: boolean; variant: boolean }>('search', 'Ein Suchtreffer wurde geöffnet (Bereich, Rang in der Liste; nie der Suchtext). current: die ausgegraute Zeile „Du bist hier“ (schließt nur die Suche); variant: ein Minilink einer Schiffszeile (ein anderes Modell der Familie wie Valiant/Pirate oder eine eigene Variante „Meine …“); area ist dann ship.'),
  'search:miss_show': ev<{ area: string; term: string }>('search', 'Eine Suche blieb ohne Treffer: Bereich und Suchtext (getrimmt, klein, max. 80 Zeichen; einmal je Begriff und Sitzung) — die einzige Stelle, an der ein Suchtext gesendet wird.'),

  // --- settings ----------------------------------------------------------
  'settings:username_update': ev('settings', 'Der Benutzername wurde gespeichert.'),
  'settings:send_on_enter_toggle': ev<{ on: boolean }>('settings', 'Enter-sendet im Composer wurde umgeschaltet.'),
  'settings:feedback_fab_toggle': ev<{ on: boolean }>('settings', 'Der Feedback-Knopf wurde ein- oder ausgeblendet.'),
  'settings:routine_tint_toggle': ev<{ on: boolean }>('settings', 'Die Routine-Färbung wurde umgeschaltet.'),
  'settings:codex_non_usable_toggle': ev<{ on: boolean }>('settings', 'Nicht nutzbare Codex-Einträge wurden ein- oder ausgeblendet.'),
  'settings:language_change': ev<{ lang: string }>('settings', 'Die Sprache wurde geändert (Einstellung, auch „auto“).'),
  'settings:region_change': ev<{ region: string }>('settings', 'Die Region wurde geändert (Einstellung, auch „auto“).'),
  'settings:beta_toggle': ev<{ area: BetaArea; enabled: boolean }>('settings', 'Der β-Schalter eines Navigationspunkts wurde umgelegt.'),

  // --- verse -------------------------------------------------------------
  'verse:top_open': ev<{ key: string; kind: string; rank: number; pinned: boolean }>('verse', 'Ein Eintrag der Briefing-Top-Liste wurde geöffnet.'),
  'verse:door_open': ev<{ door: 'news' | 'patches' | 'gallery' }>('verse', 'Eines der drei Tore (News, Patches, Galerie) wurde geöffnet.'),
  'verse:star_earn': ev<{ patch_line: string; star_key: string; sun?: boolean }>('verse', 'Ein Explorer-Stern wurde verdient (sun = Kometentreffer).'),
  'verse:starscape_share': ev<{ image_id: string; channel: 'native' | 'copy' }>('verse', 'Ein Starscape-Bild wurde geteilt.'),
  'verse:gallery_filter_select': ev<{ filter: 'all' | 'newest' | 'top' | 'mine' }>('verse', 'In der Galerie wurde eine Ansicht gewählt (Alle, Neueste, Community Top, Sammlung = mine).'),
  'verse:briefing_view': ev('verse', 'Das Verse-Briefing (Startseite des Verse-Hubs) wurde angezeigt.'),
  'verse:starmap_open': ev<{ page: 'explorer' | 'constellations' }>('verse', 'Die Sternenkarte oder die eigenen Sternbilder wurden geöffnet.'),
  'verse:patch_open': ev<{ line: string }>('verse', 'Eine Patch-Linie im Verse-Hub wurde geöffnet.'),

  // --- news --------------------------------------------------------------
  'news:article_open': ev('news', 'Ein News-Artikel wurde geöffnet (kein Titel, keine ID).'),
  'news:filter_select': ev<{ filter: 'all' | 'comm-link' | 'youtube' | 'spectrum' | 'patch' | 'events' | 'saved' }>('news', 'In Verse News wurde eine Kategorie gewählt (Quelle, Events oder Gesammelt).'),
  'news:event_open': ev<{ surface: 'news_top' | 'news_bottom' | 'hub'; phase: 'running' | 'upcoming' }>('news', 'Ein Ingame-Event aus einem Event-Teaser wurde geöffnet (Verse News oben/unten oder Verse-Hub).'),

  // --- social ------------------------------------------------------------
  'social:invite_create': ev('social', 'Ein persönlicher Freundes-Einladungslink wurde erzeugt (nie der Token).'),
  'social:invite_view': ev('social', 'Eine Einladungsseite wurde über einen Link geöffnet (nie der Token).'),
  'social:invite_accept': ev('social', 'Eine Einladung wurde angenommen (Freundschaft eingelöst).'),
  'social:friend_request_accept': ev('social', 'Eine Freundschaftsanfrage wurde angenommen.'),
  'social:share_create': ev<{ kind: 'einsatz' | 'ship_config' | 'loadout' }>('social', 'Etwas wurde mit Freunden geteilt (Einsatz, Schiffsvariante, Loadout).'),
  'social:shared_open': ev<{ kind: 'loadout' | 'hangar_loadout' | 'kartograph_badge' }>('social', 'Ein geteilter Inhalt wurde über einen Link geöffnet (nie der Token).'),

  // --- feedback ----------------------------------------------------------
  'feedback:composer_open': ev<{ surface: string }>('feedback', 'Das Feedback-Fenster wurde geöffnet.'),
  'feedback:item_submit': ev<{ kind: string; length_bucket: 'short' | 'medium' | 'long'; attachments: number }>('feedback', 'Ein Feedback wurde abgeschickt (Art, Längen-Klasse, Anzahl Anhänge; nie der Text).'),
  'feedback:reply_view': ev('feedback', 'Eine Antwort auf das eigene Feedback wurde gelesen.'),
  'feedback:dictation_start': ev<{ via: 'button' | 'hotkey' }>('feedback', 'Im Feedback-Eingabefeld wurde das Diktieren per Mikrofon gestartet (Knopf oder Tastenkürzel; nie der Text).'),

  // --- desktop -----------------------------------------------------------
  'desktop:download_start': ev<{ app: 'uploader' | 'starscape'; surface: string }>('desktop', 'Der Download eines Desktop-Programms wurde angeklickt.'),
  'desktop:app_start': ev<{ app: 'scc' }>('desktop', 'Ein Desktop-Programm wurde per Deep-Link aus dem Web gestartet.'),
  'desktop:apps_view': ev<{ app: 'hub' | 'uploader' | 'starscape' | 'extension' }>('desktop', 'Eine Seite der Programme (Hub, Uploader, Starscape, Erweiterung) wurde geöffnet.'),

  // --- admin -------------------------------------------------------------
  'admin:tool_open': ev<{ tool: string }>('admin', 'Ein Admin-Werkzeug wurde geöffnet (Rolle steht als Person-Eigenschaft).'),
  'admin:user_accept': ev<{ source: 'people_list' }>('admin', 'Ein Admin hat ein selbst registriertes, nie freigeschaltetes Konto in der Personenliste freigeschaltet (nie E-Mail oder Id).'),
  'admin:translation_deck_start': ev<{ lang: string; cards: number }>('admin', 'Ein Admin hat einen Karteikarten-Stapel aufgedeckt (Sprache, Karten im Stapel).'),
  'admin:translation_card_submit': ev<{ kind: 'convention' | 'term' | 'wording'; choice: 'a' | 'b' | 'own'; exception: boolean; input: 'tap' | 'key' | 'swipe' }>('admin', 'Eine Übersetzungs-Karte wurde beantwortet (Kartenart, linke/rechte Variante oder eigener Text, mit Sprach-Ausnahme, per Tippen/Taste/Wischen).'),
  'admin:translation_card_release': ev<{ kind: 'convention' | 'term' | 'wording'; input: 'tap' | 'key' | 'swipe' }>('admin', 'Eine Karte wurde mit „Nicht meine Entscheidung“ an die KI abgegeben.'),
  'admin:translation_answer_remove': ev<{ via: 'toast' | 'key' }>('admin', 'Eine Karten-Antwort wurde rückgängig gemacht (Rückgängig-Hinweis oder Strg+Z).'),
  'admin:translation_veto_submit': ev<{ verdict: 'wrong' | 'ok' | 'own' | 'all'; unsure: boolean; input: 'tap' | 'key' | 'swipe' }>('admin', 'Eine KI-Entscheidung wurde geprüft: „Sieht falsch aus“, „Passt“, eigener Text oder „Rest übernehmen“.'),
  'admin:translation_deck_finish': ev<{ lang: string; cards: number; points: number }>('admin', 'Ein Karteikarten-Stapel wurde bis zur letzten Karte durchgespielt (beantwortete Karten, Punkte).'),
} as const;

export type EventName = keyof typeof EVENTS;

/** Property object per event; `undefined` for events without properties. */
export type EventProps = {
  [K in EventName]: (typeof EVENTS)[K] extends EventDef<infer P> ? P : never;
};

/** Arguments after the event name: required when the event has properties, absent otherwise. */
export type TrackArgs<E extends EventName> = undefined extends EventProps[E]
  ? [props?: undefined]
  : [props: EventProps[E]];

/**
 * Old event name → current name, for the PostHog actions that bridge history
 * (the PostHog project reads this; old events keep their past data under the
 * old name). Dynamic old names are listed per provider.
 */
export const LEGACY_EVENT_NAMES: Readonly<Record<string, EventName>> = {
  user_signed_in: 'auth:user_sign_in',
  user_signed_in_with_google: 'auth:user_sign_in',
  user_signed_in_with_discord: 'auth:user_sign_in',
  user_signed_out: 'auth:user_sign_out',
  access_requested: 'auth:access_request',
  ship_link_set: 'codex:ship_link_create',
  ship_link_removed: 'codex:ship_link_remove',
  ship_link_promoted: 'codex:ship_link_update',
  hangar_ship_added: 'hangar:ship_add',
  hangar_ship_removed: 'hangar:ship_remove',
  hangar_flagship_set: 'hangar:flagship_select',
  hangar_ship_config_saved: 'hangar:ship_config_update',
  hangar_loadout_created: 'hangar:loadout_create',
  hangar_fleet_imported: 'hangar:fleet_import',
  hangar_extension_handover: 'hangar:extension_import',
  settings_username_saved: 'settings:username_update',
  settings_send_on_enter_changed: 'settings:send_on_enter_toggle',
  settings_feedback_fab_changed: 'settings:feedback_fab_toggle',
  settings_routine_tint_changed: 'settings:routine_tint_toggle',
  settings_codex_non_usable_changed: 'settings:codex_non_usable_toggle',
  settings_language_changed: 'settings:language_change',
  settings_region_changed: 'settings:region_change',
  beta_toggle: 'settings:beta_toggle',
  verse_top_open: 'verse:top_open',
  verse_door_open: 'verse:door_open',
  verse_star_earned: 'verse:star_earn',
  starscape_share: 'verse:starscape_share',
};
