# Design system — Web and Data Uploader

Decided 2026-11-21 (concept "Design-System Angleichung"). The shared rules live in
StarUI: `docs/DESIGN-RULES.md`, `docs/CATALOG.md` (source `catalog/catalog.json`)
in `StarOrga/StarUI` (installed copy: `node_modules/@starorga/star-ui/`).
This file says how this repo applies them.

## Where things come from

| What | Source of truth | Here |
|---|---|---|
| Tokens (colour, type families, shadow) | StarUI `lib/design-tokens.css` (core layer) | aliased as `--sc-*` in `src/styles.scss`; uploader: `data-uploader/src/renderer/styles.css` |
| Brand (logo, marks, app icon) | StarUI `assets/brand/` | `public/brand/`, `public/icons/brand/` are copies. The product marks are still web-only (catalog `core.brand.marks`, experimental) and move to StarUI next |
| Web look (scAction tiers, page frame, page header, dialogs) | this repo, root `CLAUDE.md` Key Rules | registered in the StarUI catalog as `web.*`, status experimental, home `web` |
| Uploader look (`.btn`, `.btn-primary`) | `data-uploader/src/renderer/styles.css` | catalog `desktop.uploader-buttons`, experimental; moves onto the StarUI desktop button tiers in phase 2 |
| Shared scales: radius 2 / 4 / 8 / pill, type floor 13px, 4px spacing steps | StarUI `lib/scale.experimental.css` (`--ds-*`) | not read yet; new code may use them |

The web and the uploader keep their own look. StarUI shares the system, not one look.

## Rules for every UI change

1. **Look it up first.** Catalog entry → use it. Token → use it. Only then build new.
2. **New is allowed, hidden is not.** Something the catalog lacks, a variant, or a value
   off the scale gets a pragma at its definition:
   - `/* ds-new: <reason> */` (`<!-- ds-new: … -->` in templates) — a candidate for StarUI.
     Also add an `experimental` entry to the StarUI catalog, or name it as a follow-up.
   - `/* ds-ok: <reason> */` — a deliberate local look that stays here.
3. **Say it.** Every reply and PR that touches UI lists "new / deviates from StarUI: …"
   (or "no deviations").
4. **Scales.** Radius 2 / 4 / 8 / pill. UI text ≥ 13px (a smaller size only for a
   non-text mark, with `ds-ok`). Spacing on the 4px steps.
5. **Promotion** to StarUI stable happens once two surfaces need the same thing. For
   spacing that means the same step for the same role, not the same pixel number.
6. **Not too strict.** A good new idea is never dropped because the catalog lacks it.

## Checks

- `npm run check:design` — report-only drift scan of `src/app` and the uploader
  (radius off the scale, sub-13px type, raw hex colours; lines with `ds-new`/`ds-ok`,
  `color-literal-ok` are skipped). It prints counts and the top files and exits 0.
- `scripts/check-brand-upstream.mjs` (prebuild) — the vendored `vc-mark.svg` must
  match the desktop app (fails) and should match StarUI (notice only until StarUI
  carries the current mark).
- Full cross-surface inventory: StarUI `npm run inventory`.

## Scope notes (2026-11-21)

- Changes to the web look happen in the beta view only (shell beta, `sc.beta` in
  localStorage). Holo table and other beta content are fine to touch.
- **Leave the ship detail page alone for now**, classic and beta.
- Admin pages: unnest box-in-box layouts in the beta view (phase 2).
- Tabs are being reworked in parallel; align them after that lands.
