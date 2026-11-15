# Wave 2 — shared rules for the four migration agents

Read first, completely: `briefs/implement.md` (binding brief, user words verbatim, checklist), `briefs/inventory.md` (file map of the 48 popups), `parity.md`, and the header comment + public API of `src/app/shared/popup/sc-popup.component.ts` (the scaffold you migrate onto; its spec `sc-popup.component.spec.ts` shows how it is driven). Design spec: `rounds/01.html`, `section[data-design="d3"]`.

## Setup (your own worktree)

1. Your worktree may have been cut from `origin/main`. Before anything: `git fetch origin` and `git checkout -B <your sub-branch> origin/claude/modest-napier-9d1e5a`; assert `src/app/shared/popup/sc-popup.component.ts` exists.
2. Install deps in YOUR worktree: `npm ci --cache P:/packages/npm --no-audit --no-fund` (never junction node_modules from another checkout).

## Per popup

- Render the popup through `<sc-popup>` with the kind from the mapping in `implement.md` (Menü→`menu`, Panel→`panel`, Dialog→`dialog`, Großfenster→`large`, Hinweis→`notice`; Sonderform → keep the own frame, share only scrim + ✕ look).
- Remove the popup's own frame CSS (container, head, close button, footer, border/shadow/radius, width) — keep only content-area CSS. Hard-coded widths go: the width comes from the kind default or `size` (`menu | s | m | area`). A width that is genuinely driven from outside keeps an `overlay-size: exception - <reason>` comment (see `scripts/check-overlay-sizes.mjs`).
- Head: `title` (the popup's one heading) + `eyebrow` (area or object, e.g. "Nachschub", "Waffe · S3 · Nase"). No subtitle line in the head (r1-head without `sub`) — context that used to be a subtitle goes into the eyebrow or the body.
- ✕: panel / dialog / large have it (from the scaffold); menus and notices not. Remove duplicated own close buttons; a text "Schließen"/"Fertig" button may stay only if it is a real footer action.
- Footer: actions in `popupActions`, primary first, left; status text in `popupStatus`. `scAction` tiers, at most one `primary` per popup; destructive = `tone="danger"` on the button (the rail never turns red).
- Role edge: a popup only admins can reach → `access="admin"`; admin + collaborator → `access="collab"`.
- Popups that already own a URL (wish cart `?cart=1`, overlay-frame child routes) → `[backClose]="false"`.
- Form fields inside popups: use the `.sc-float-field` / `.sc-float-label` in-field label pattern from `src/styles.scss` where the popup has labelled inputs.
- Keep behaviour: every popup still opens, closes (✕ / Escape / Abbrechen; modals never on a scrim click), keeps focus handling, and its existing specs stay green (update specs that asserted the old markup).
- Navigations stay real anchors; no native dialogs / `title` tooltips / native `<select>`; no `console.*`.

## Do NOT edit

`src/app/shared/popup/**`, `src/app/shared/dialog/**`, `src/app/shared/popup-motion/**` (owned by another session — never touch, keep any `[scPopupMotion]` usage as it is), `src/styles.scss`, `public/i18n/*.json`, any file of another bundle. If you need a scaffold change, describe it in your report instead. If you need new i18n keys, use them in templates and list each key with its DE and EN text in your report — the orchestrator adds them before the merge. Keep any `sc-scene-pushin` usage as it is.

## Checks and commits

- Commit `wip(<scope>): <what>` on your sub-branch after every green sub-step and at the latest every ~10 file-changing tool calls; push the sub-branch (`git push -u origin <sub-branch>`) after each commit. Never commit on main or on `claude/modest-napier-9d1e5a` itself. Message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before you report: `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test -- --include=app/<your areas>/**/*.spec.ts` — each runner in its own Bash call, never chained with `&&`.

## Report

Acceptance table: one row per popup you own → done / partial / not done → evidence (file:line of the `<sc-popup>`, removed width line, spec name). Plus: needed i18n keys (key · DE · EN), any scaffold change you would need, final commit SHA and sub-branch name.
