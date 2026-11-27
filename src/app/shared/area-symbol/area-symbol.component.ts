import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * One symbol per loadout area (feedback #330, concept
 * `docs/concepts/2026-11-10-bereichs-symbole-umrandung.html`, iteration 4).
 *
 * The four Holotable areas (offensive / defensive / movement / signature) and
 * every block of the ship loadout (`ShipModuleSection` plus the merged
 * `systems` group) share this ONE set, so a symbol means the same thing in
 * the classic view and on the Holotable. Paths are the concept's, drawn on a
 * 24-unit grid as 1.7-wide strokes in `currentColor`; the colour comes from
 * the area tokens (`--sc-area-*` in styles.scss) through the host's `color`.
 *
 * Decorative: the area's name always stands next to it as text, so the
 * symbol is `aria-hidden` and carries no label of its own.
 */
export type AreaSymbolKey =
  | 'offensive'
  | 'defensive'
  | 'movement'
  | 'signature'
  | 'weapons'
  | 'remoteTurrets'
  | 'mannedTurrets'
  | 'missiles'
  | 'pod'
  | 'shields'
  | 'systems'
  | 'countermeasures'
  | 'structure'
  | 'powerPlants'
  | 'quantum'
  | 'coolers'
  | 'radar'
  | 'lifeSupport'
  | 'thrusters';

/** `main` follows the area colour; `ice` is the fixed light blue (cooler flake). */
interface AreaSymbolPaths {
  main: string;
  ice?: string;
}

export const AREA_SYMBOLS: Readonly<Record<AreaSymbolKey, AreaSymbolPaths>> = {
  // Fadenkreuz in Raute
  offensive: { main: 'M12 2l10 10-10 10L2 12z M12 7v3 M12 14v3 M7 12h3 M14 12h3' },
  // Schild
  defensive: { main: 'M12 2L20 5V11C20 16 16.4 20 12 22C7.6 20 4 16 4 11V5Z' },
  // Doppel-Chevron
  movement: { main: 'M5 6l6 6-6 6 M13 6l6 6-6 6' },
  // Signaturwellen
  signature: {
    main: 'M12 12h.01 M8.5 8.5a5 5 0 0 0 0 7 M15.5 8.5a5 5 0 0 1 0 7 M5.6 5.6a9 9 0 0 0 0 12.8 M18.4 5.6a9 9 0 0 1 0 12.8',
  },
  // Kanonenlauf auf Halterung
  weapons: { main: 'M3 9.5h11v4H3z M14 10.5h7 M14 12.5h7 M7.5 13.5v3.5 M4 17h7' },
  // Turm mit Fernsteuerung
  remoteTurrets: {
    main: 'M3 21h16 M5.5 21a5.5 5.5 0 0 1 11 0 M8.2 16.6L4 10.6 M9.7 15.6L5.5 9.6 M21.5 2.5h.01 M17.5 2.5a4 4 0 0 0 4 4 M13.5 2.5a8 8 0 0 0 8 8',
  },
  // Turm mit Schütze
  mannedTurrets: {
    main: 'M3 21h16 M5.5 21a5.5 5.5 0 0 1 11 0 M8.2 16.6L4 10.6 M9.7 15.6L5.5 9.6 M17 4.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M15.5 12.5a3.5 3.5 0 0 1 7 0',
  },
  // Rakete
  missiles: { main: 'M12 2c2 2 3 4.5 3 7.5V17H9V9.5C9 6.5 10 4 12 2z M9 13l-3 3v4l3-2 M15 13l3 3v4l-3-2 M10.5 20.5h3' },
  // Kapsel mit Plus
  pod: {
    main: 'M8 2h8a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3z M5 6.5h14 M5 12.5h14 M12 14.8v4.6 M9.7 17.1h4.6',
  },
  // Schild mit Power
  shields: { main: 'M12 2L20 5V11C20 16 16.4 20 12 22C7.6 20 4 16 4 11V5Z M9.5 9.8a3.5 3.5 0 1 0 5 0 M12 7.5v4.5' },
  // Zwei Zahnräder
  systems: {
    main:
      'M14.04 8.21L15.7 8.33L15.7 10.67L14.04 10.79L13.48 12.15L14.56 13.41L12.91 15.06L11.65 13.98L10.29 14.54L10.17 16.2L7.83 16.2L7.71 14.54L6.35 13.98L5.09 15.06L3.44 13.41L4.52 12.15L3.96 10.79L2.3 10.67L2.3 8.33L3.96 8.21L4.52 6.85L3.44 5.59L5.09 3.94L6.35 5.02L7.71 4.46L7.83 2.8L10.17 2.8L10.29 4.46L11.65 5.02L12.91 3.94L14.56 5.59L13.48 6.85Z M6.9 9.5a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0 -4.2 0 M20.84 17.62L21.81 18.27L20.81 20.01L19.76 19.5L18.69 20.12L18.6 21.28L16.6 21.28L16.51 20.12L15.44 19.5L14.39 20.01L13.39 18.27L14.36 17.62L14.36 16.38L13.39 15.73L14.39 13.99L15.44 14.5L16.51 13.88L16.6 12.72L18.6 12.72L18.69 13.88L19.76 14.5L20.81 13.99L21.81 15.73L20.84 16.38Z M16.3 17a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0',
  },
  // Drei Leuchtsterne, versetzt nach unten fallend wie abgeworfene Flares
  // (admin note on iteration 4: "drei mini sternchen asymmetrisch nach unten").
  countermeasures: {
    main: 'M8 1.3c.22 2.24.96 2.98 3.2 3.2c-2.24.22-2.98.96-3.2 3.2c-.22-2.24-.96-2.98-3.2-3.2c2.24-.22 2.98-.96 3.2-3.2z M16 7.7c.19 1.96.84 2.61 2.8 2.8c-1.96.19-2.61.84-2.8 2.8c-.19-1.96-.84-2.61-2.8-2.8c1.96-.19 2.61-.84 2.8-2.8z M11 15.5c.2 2.1.9 2.8 3 3c-2.1.2-2.8.9-3 3c-.2-2.1-.9-2.8-3-3c2.1-.2 2.8-.9 3-3z',
  },
  // Spantgitter
  structure: { main: 'M4 4h16v16H4z M4 12h16 M12 4v16 M4 4l8 8 M20 20l-8-8' },
  // Blitz
  powerPlants: { main: 'M13 2L4 14H10L9 22L20 9H13Z' },
  // Quantenring
  quantum: { main: 'M12 9A3 3 0 1 1 11.99 9 M4 12C8 8.6 16 8.6 20 12C16 15.4 8 15.4 4 12 M10.3 4.3C13.7 8.3 13.7 15.7 10.3 19.7' },
  // Thermometer mit hellblauer Flocke
  coolers: {
    main: 'M5.5 5.5a1.75 1.75 0 0 1 3.5 0v8.6a3.5 3.5 0 1 1-3.5 0z M7.25 10v6.5',
    ice: 'M17 2.4L17 11.6 M13.02 4.7L20.98 9.3 M13.02 9.3L20.98 4.7 M15.7 3.25L17 4L18.3 3.25 M13.1 6.25L14.4 5.5L14.4 4 M14.4 10L14.4 8.5L13.1 7.75 M18.3 10.75L17 10L15.7 10.75 M20.9 7.75L19.6 8.5L19.6 10 M19.6 4L19.6 5.5L20.9 6.25',
  },
  // Radarschirm
  radar: { main: 'M12 12l6.4-6.4 M20 12a8 8 0 1 1-8-8 M16 12a4 4 0 1 1-4-4 M12 12h.01' },
  // ds-new: Energie-Symbole — Triebwerksdüse for the energy columns (concept holotisch-kategorien r3); the other five energy groups reuse the symbols above
  thrusters: { main: 'M8 3H16L14.5 13H9.5Z M9.5 13C9.5 17 8.5 19 12 22C15.5 19 14.5 17 14.5 13' },
  // O₂
  lifeSupport: { main: 'M3 11.5a6 6 0 1 0 12 0a6 6 0 1 0-12 0 M16.8 15.6a2.1 2.1 0 1 1 3.4 1.7L16.8 21H21' },
};

@Component({
  selector: 'sc-area-symbol',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'sc-area-symbol' },
  template: `
    @if (paths(); as p) {
      <svg viewBox="0 0 24 24" focusable="false">
        <path [attr.d]="p.main" />
        @if (p.ice) { <path class="ice" [attr.d]="p.ice" /> }
      </svg>
    }
  `,
  styles: [
    `
      :host { display: inline-flex; flex: none; inline-size: 1.15em; block-size: 1.15em; line-height: 0; }
      svg { inline-size: 100%; block-size: 100%; fill: none; stroke: currentColor; stroke-width: 1.7;
        stroke-linecap: round; stroke-linejoin: round; overflow: visible; }
      .ice { stroke: var(--sc-area-ice); }
    `,
  ],
})
export class AreaSymbolComponent {
  /** Which area or block; an unknown key renders nothing. */
  readonly area = input.required<string>();

  protected readonly paths = computed<AreaSymbolPaths | null>(
    () => AREA_SYMBOLS[this.area() as AreaSymbolKey] ?? null,
  );
}
