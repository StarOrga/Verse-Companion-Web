// The icon family of the item path (concept gegenstand-weg E7).
// -----------------------------------------------------------------------------
// One stroke style: 24-unit viewBox, no fill, round caps and joins. The stroke
// itself comes from `svg.sc-action-icon` (styles.scss, block ACTION). A filled
// stop adds `is-filled`. The search's action icons re-export these.

export const PATH_ICONS = {
  /**
   * Wünsche: a shooting star, a four-point star top right with three trails to the bottom left
   * (concept 20261115-2345-wunschliste-gefuehl, design d3). The trails are open strokes, so
   * `is-filled` fills only the star body.
   */
  wish: ['M16 3.5l1.3 3.2 3.2 1.3-3.2 1.3L16 12.5l-1.3-3.2L11.5 8l3.2-1.3z', 'M11.5 12.5L4 20', 'M8.5 10.5L5 14', 'M13.5 15.5L10 19'],
  /** "Gemerkt" in the news (and its search rows): the bookmark. It is not a wish, so it keeps its own glyph. */
  saved: ['M7 4h10v16l-5-4-5 4z'],
  /** Operation (key stays nachschub): the Route glyph, two waypoints joined by a path. */
  nachschub: ['M5 17v-4a3 3 0 0 1 3-3h8a3 3 0 0 0 3-3', 'M5 17a2 2 0 1 0 0 4a2 2 0 1 0 0-4z', 'M19 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4z'],
  /** Inventar: a box. */
  inventar: ['M4 8l8-4 8 4v9l-8 4-8-4z', 'M4 8l8 4 8-4M12 12v9'],
  /** Hangar: a hangar with its door. */
  hangar: ['M3 20V10l9-6 9 6v10', 'M7 20v-7h10v7', 'M7 16h10'],
  /** Sammlung (blueprints, news, wallpapers): a stack of layers. The star is retired (only Explorer achievements keep one); the shooting star of `wish` is the one deliberate exception (concept 20261115-2345-wunschliste-gefuehl). */
  sammlung: ['M12 3.5l9 4.5-9 4.5L3 8z', 'M3 12.5l9 4.5 9-4.5', 'M3 17l9 4.5 9-4.5'],
  /** Vergleichen: a balance scale (concept gegenstand-weg E4, proposed; ⇄ stays for ship switch). */
  compare: ['M12 4v16M8 20h8', 'M5 7h14', 'M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z'],
  /** "Ich habe diese" (owned blueprint): a check in a circle. */
  owned: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M8 12.5l2.7 2.7L16 9.5'],
  /** Verwalten: two sliders. */
  manage: ['M4 7h9M17 7h3', 'M4 17h3M11 17h9', 'M15 4.5v5', 'M9 14.5v5'],
} as const;
