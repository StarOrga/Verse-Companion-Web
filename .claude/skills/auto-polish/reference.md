# auto-polish — Verse Companion Web + Data Uploader

Project extension for the devops `auto-polish` skill. The design-system rules
are in `.claude/deep-knowledge/design-system.md`; read it before the first edit.

## Add before Step 1

- Run `npm run check:design` and keep its output: it is the drift baseline for
  this pass (radius off-scale, sub-13px type, raw hex per file, `ds-new` register).
- Open StarUI's catalog (`node_modules/@starorga/star-ui/docs/CATALOG.md`) for the
  building blocks that exist.

## Rules for this repo

- **Web: beta view only.** Polish targets the beta shell (`sc.beta`). The classic
  view stays as it is. **Do not touch the ship detail page** (classic or beta)
  until Jerry lifts that.
- **Uploader:** small polishes only (spacing, borders, type floor); its colours
  and background stay.
- Snap values to the StarUI scales where the change is invisible or a clear
  improvement: radius 2 / 4 / 8 / pill, text ≥ 13px, spacing on 4px steps.
  Anything that would change the look noticeably is proposed, not applied.
- A deviation that stays gets `ds-ok: <reason>`; a new pattern gets
  `ds-new: <reason>` and an experimental catalog entry proposal for StarUI.
- Never swap a token for a literal; never introduce a new hex colour when a
  `--sc-*` token fits.

## Add after the last step

- Run `npm run check:design` again and put the before/after counts in the
  completion card, plus the list "new / deviates from StarUI".
