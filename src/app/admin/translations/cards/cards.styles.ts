/**
 * Shared look of the Karteikarten tab (concept karteikarten-neu r5 d1 „Duell-Karte“). Card face, the two halves,
 * the quiet head/foot lines and the key caps; the violet/gold game colours come from the tab root
 * (`--tc-pu`, `--tc-pu-hi`, `--tc-gold`, set in TranslationCardsComponent).
 */
export const CARD_STYLES = `
  :host { display: block; min-width: 0; }
  .card {
    position: relative; z-index: 1; display: grid; gap: 16px; width: 100%; box-sizing: border-box;
    padding: 20px 24px 16px; border: 1px solid color-mix(in srgb, var(--sc-accent) 22%, transparent); border-radius: 18px;
    background: linear-gradient(170deg, color-mix(in srgb, var(--sc-bg-1) 92%, var(--sc-accent) 8%), var(--sc-bg-1) 60%, var(--sc-bg-0));
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.42); color: var(--sc-fg-0);
  }
  .chead { display: flex; justify-content: space-between; align-items: baseline; gap: 4px 14px; min-width: 0; flex-wrap: wrap; }
  .q { margin: 0; min-width: 0; flex: 1 1 14em; font: 600 0.95rem/1.4 var(--sc-font-body, inherit); letter-spacing: 0; color: var(--sc-fg-1); overflow-wrap: anywhere; }
  .count { flex: none; font-size: max(0.75rem, var(--sc-fs-floor, 0.75rem)); line-height: 1.4; color: var(--sc-fg-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .count .warn { color: var(--sc-warning); }
  .duel { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr); column-gap: 12px; }
  .or { background: linear-gradient(180deg, color-mix(in srgb, var(--tc-pu) 32%, transparent) 70%, transparent); }
  .half {
    position: relative; display: grid; align-content: start; gap: 10px; min-width: 0; margin: 0; padding: 8px 10px 10px;
    border: 0; border-radius: 12px; background: none; color: inherit; font: inherit; text-align: start; cursor: pointer; white-space: normal;
    transition: background 0.15s ease, box-shadow 0.15s ease;
  }
  .half:hover { background: color-mix(in srgb, var(--sc-accent) 6%, transparent); }
  .half:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
  .half:disabled { cursor: progress; }
  .half.pick { background: color-mix(in srgb, var(--sc-success) 9%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-success) 45%, transparent); }
  .half.pick .name { color: color-mix(in srgb, var(--sc-success) 35%, var(--sc-fg-0)); }
  .opt { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .half.r .opt .kbd { order: 3; margin-inline-start: auto; }
  .name { min-width: 0; font: 700 1.375rem/1.2 var(--sc-font-body, inherit); color: var(--sc-fg-0); overflow-wrap: anywhere; }
  .cnt { flex: none; align-self: baseline; margin-top: 6px; font-size: 0.75rem; color: var(--sc-fg-2); white-space: nowrap; }
  /* One grid for the three examples, so the code column takes the widest code („PT-BR“) and the texts line up. */
  .ex { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: baseline; gap: 2px 6px; font-size: 0.8125rem; line-height: 1.45; color: var(--sc-fg-1); }
  .ex li { display: contents; }
  .ex small { font: 600 0.6rem/1.4 var(--sc-font-display, inherit); letter-spacing: 0.05em; color: var(--sc-fg-2); white-space: nowrap; }
  .ex span { min-width: 0; overflow-wrap: anywhere; }
  .ex.ctx { grid-template-columns: minmax(0, max-content) minmax(0, 1fr); column-gap: 8px; }
  .ex.ctx small.where { max-width: 9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 400 0.75rem/1.45 var(--sc-font-body, inherit); letter-spacing: 0; }
  .cfoot { display: flex; justify-content: space-between; align-items: baseline; gap: 4px 14px; font-size: 0.75rem; line-height: 1.5; color: var(--sc-fg-2); }
  .cmeta { display: flex; flex-wrap: wrap; min-width: 0; }
  .cmeta > span:not(:last-child)::after { content: '·'; margin: 0 7px; color: color-mix(in srgb, var(--sc-fg-1) 50%, transparent); }
  .cmeta .ac { color: var(--sc-accent); }
  .cmeta .exc { color: var(--tc-pu-hi); }
  .cmeta svg { width: 13px; height: 13px; margin-inline-end: 4px; vertical-align: -2px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .kbd {
    display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); border-radius: 4px; background: var(--sc-sub-kbd);
    color: var(--sc-fg-1); font: 600 0.65rem/1 var(--font-monospace, ui-monospace, monospace); letter-spacing: 0; box-shadow: 0 1px 0 rgba(0, 0, 0, 0.5);
  }
  /* Key caps are a desktop thing: a touch screen has no keys to press. */
  @media (hover: none), (pointer: coarse) { .desk { display: none !important; } }
  @media (max-width: 520px) {
    .card { padding: 16px 12px 12px; gap: 14px; }
    .q { font-size: 0.875rem; }
    .duel { column-gap: 6px; }
    .half { padding: 6px 6px 8px; gap: 8px; }
    .name { font-size: 1.125rem; }
    .ex { column-gap: 4px; font-size: 0.75rem; }
    .ex.ctx { column-gap: 5px; }
    .ex.ctx small.where { max-width: 6.5em; font-size: 0.6875rem; }
    .cfoot { font-size: 0.72rem; }
  }
  @media (prefers-reduced-motion: reduce) { .half { transition: none; } }
`;
