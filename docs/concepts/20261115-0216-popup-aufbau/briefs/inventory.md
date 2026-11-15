**Conclusions**
- Only a few popups use a shared frame today:
  - `sc-overlay-frame` (X in its head): stock_popup, upcoming, news_item.
  - `sc-confirm-dialog` (no X).
  - HQ_DIALOG_STYLES (default width 560px at `hq/plan/hq-dialog.styles.ts:8`): event_claim, nachschub_target, nachschub_remove, reserve, blueprint_picker, nachschub_flow, wish_cart.
- Everything else has its own CSS ("own").
- Many own stacks already use the `--sc-ov-*` tokens defined in `src/styles.scss:536-539`. I count those as no hard width. `--sc-ov-menu` is 20rem, `--sc-ov-s` 28rem, `--sc-ov-m` 48rem, and `--sc-ov-area` is `min(100% - 2rem, 60rem)`.
- Six popups use the `.cm-panel`, `.pick-win` or `.qs-*` stacks. Their widths are tokens, not hard-coded:
  - **component_modal** (`.cm-panel`): `--sc-ov-m`.
  - **swap_picker** (`.pick-win`): `--sc-ov-area`.
  - **quick_search** (`.qs-*`): `--sc-ov-m`.
  - **column_menu**: it uses a `.cm-panel` class too, but that is its own component CSS, not the codex modal. Width is `--sc-ov-menu`.
  - **account_menu**: `--sc-ov-menu`.
  - **admin_menu**: `--sc-ov-menu`.
- I did not verify every X button in the template. Where I list a "no", I grepped each file for close, ✕ and × and found nothing.
- `core/handoff/handoff.component.ts` is a routed page (`app.routes.ts:59`), not a popup. The "Aufs Handy" panel is `shell/corners/handoff-button.component.ts`.

## Table

All paths are under `src/app/`.

| id | files | stack | X today | hard width |
|---|---|---|---|---|
| apps_menu | `shell/apps-menu.component.ts` | own dropdown | no | `apps-menu.component.ts:129` 22rem |
| account_menu | `shell/shell.component.ts` (`#accountMenu`, `.dropdown`) | own | no | none (`--sc-ov-menu`, `shell.component.ts:726`) |
| admin_menu | `shell/shell.component.ts` (`.admin-dropdown`) | own | no | none (token, `shell.component.ts:682`) |
| column_menu | `shared/column-menu.component.ts` | own (class `.cm-panel`, not the codex modal) | no | none (token, `column-menu.component.ts:157`) |
| hangar_menu | `codex/holo/codex-holo-hangar-menu.component.ts` | own | no | `codex-holo-hangar-menu.component.ts:156` 290px |
| place_select | `hq/stock/hq-place-select.component.ts` | own | no | `hq-place-select.component.ts:61` panel `max(100%,16rem)`; `:53` host 11–18rem |
| merkliste | `shell/merkliste/merkliste.component.ts` | own | no | `merkliste.component.ts:111` 27rem |
| beta | `shell/corners/beta-fab.component.ts` | own | no | `beta-fab.component.ts:87` min-width 220px (max is the token) |
| handoff | `shell/corners/handoff-button.component.ts` | own | no (Esc and outside click only) | `handoff-button.component.ts:102` 440px |
| footer_bubble | `shell/footer.component.ts` | own | no | `footer.component.ts:173` 380px |
| item_path | `shared/item-path/item-path.component.ts` (`.rp` popover) | own | no | `item-path.component.ts:303` 310px (`:342` mobile `100vw-16px`) |
| hero_part | `codex/detail/codex-hero-part-popup.component.ts` | own | yes (`.hpp-close`, `:129`) | `codex-hero-part-popup.component.ts:114` 360px |
| holo_overlay | `codex/detail/codex-hero-holo-overlay.component.ts` | own (`.hho sc-card`) | yes (`.hho-close`) | none (fills its host) |
| browse_sheet | `codex/codex-browse.component.ts` (`.sheet`, `:858`) | own mobile bottom sheet | yes (`.sheet-close`, `:478`, plus a Done button) | none (full width, max-height 85vh) |
| landing_news | `codex/landing/codex-landing-news.component.ts` | own | no | `codex-landing-news.component.ts:62` 390px |
| missions_popover | `hq/now/hq-missions-popover.component.ts` | own | no | `hq-missions-popover.component.ts:65` 320px |
| live_ticker | `hq/now/hq-live-ticker.component.ts` | own | yes (`.a-x`, `:38`) | panel `:143` is `var(--sc-ov-menu, 20rem)`, so effectively none; the dock chip is capped at 36rem (`:94`, `:100`) |
| status_chip | `news/verse-status-chip.component.ts` | own | no | `verse-status-chip.component.ts:165` max 360px |
| star_dome | `verse/starmap/star-dome.component.ts` (`.card`) | own | yes (`.x`, `:178`) | `star-dome.component.ts:167` 280px |
| starmap_tour | `verse/starmap/starmap-tour.component.ts` | own | no (text Close and Done buttons) | `starmap-tour.component.ts:79` 380px |
| confirm | `shared/dialog/sc-confirm-dialog.component.ts` | sc-confirm-dialog | no | none (`--sc-ov-s`, `:73`) |
| add_to_set | `codex/set/add-to-set.component.ts` | own (`.ats-pop sc-card`, non-modal) | no X glyph (it has a text close button) | `add-to-set.component.ts:144` 300px |
| event_claim | `hq/events/hq-event-claim-dialog.component.ts` | HQ_DIALOG_STYLES | no | default 560px (`hq-dialog.styles.ts:8`) |
| nachschub_target | `hq/nachschub/nachschub-target-dialog.component.ts` | HQ_DIALOG_STYLES | yes (`:34`) | default 560px |
| nachschub_remove | `hq/plan/hq-nachschub-dialogs.component.ts` (`sc-hq-nachschub-remove-dialog`, also holds the archive dialog) | HQ_DIALOG_STYLES | no | default 560px |
| reserve | `hq/stock/hq-reserve-dialog.component.ts` | HQ_DIALOG_STYLES | yes (`:35`) | default 560px |
| einsatz_pick | `hq/plan/hq-einsatz-pick-dialog.component.ts` | own (`sc-card` + tokens) | no | none (`--sc-ov-s`, `:58`) |
| log_dialog | `hq/now/hq-log-dialog.component.ts` | own | no (text button) | `hq-log-dialog.component.ts:60` 560px |
| hq_stats | `hq/stats/hq-stats.component.ts` (`.dialog`, `.overlay`) | own | no (text button) | `hq-stats.component.ts:222` max 34rem; `:205` 30rem (what it sizes is not confirmed) |
| social_vis | `social/social-visibility-dialog.component.ts` | own | no (Done button) | `social-visibility-dialog.component.ts:104` 600px |
| desktop_dl | `desktop/desktop-download.component.ts` (`.hx-dialog` history dialog) | own | yes (`.hx-close`, `:126`) | `desktop-download.component.ts:184` 1100px |
| api_tokens | `admin/api-tokens/api-tokens.component.ts` (create and reveal dialogs) | own | no (Cancel button, `:190`) | `api-tokens.component.ts:396` 560px |
| wish_cart | `shell/cart/wish-cart-dialog.component.ts` | HQ_DIALOG_STYLES + override | yes (`:50`) | `wish-cart-dialog.component.ts:171` 1180px × 860px |
| component_modal | `codex/codex-component-modal.component.ts` | `.cm-panel` | yes (`.cm-close`, `:231`) | none (`--sc-ov-m`, `:202`) |
| swap_picker | `codex/codex-swap-picker.component.ts` | `.pick-win` | yes (`.pick-close`, `:524`) | none (`--sc-ov-area`, `:508`); inner column popup 220px at `:576` |
| compare_tray | `codex/codex-compare-tray.component.ts` | own docked tray | no (only a clear button and per-chip X) | none (chip `max-width` 280px at `:154`, marked "overlay-size: exception") |
| upcoming | `codex/upcoming-detail.component.ts` (+ `upcoming-route.component.ts`) | sc-overlay-frame | yes | none (`--sc-ov-area`, `overlay-frame.component.ts:75`) |
| nachschub_flow | `hq/plan/hq-nachschub-flow.component.ts` | HQ_DIALOG_STYLES + override | yes (`:108`) | `hq-nachschub-flow.component.ts:419` 1040px × 760px |
| blueprint_picker | `hq/stock/hq-blueprint-picker.component.ts` | HQ_DIALOG_STYLES | no | default 560px |
| stock_popup | `hq/stock/hq-stock-popup.component.ts` (same frame also used by `hq-stock-shared.component.ts:35`) | sc-overlay-frame | yes | none |
| patch_dossier | `news/patch-dossier.component.ts` | own `.scrim/.panel` (tokens) | yes (`:137`, `:418`) | none (`--sc-ov-area`, `:435`) |
| news_item | `verse/pages/verse-news-item.component.ts` | sc-overlay-frame | yes | none |
| news_item (alt) | `news/news-list.component.ts` (`.nd-panel`) | own | no (text "← back") | `news-list.component.ts:778` 900px; `:782` height 720px |
| star_toast | `shared/star-toast/star-toast.component.ts` | own | yes (`:42`) | `star-toast.component.ts:54` `--sc-toast-w`, fallback 24rem |
| undo_toast | `shared/undo-toast/undo-toast.component.ts` | own | no (Undo button) | `undo-toast.component.ts:36` same 24rem fallback |
| app_launch | `hq/hq-app-launch.component.ts` | own | yes (`:74`) | `hq-app-launch.component.ts:105` same 24rem fallback |
| app_notice | `desktop/app-notice.component.ts` | own | yes (`:58`) | `app-notice.component.ts:78` same 24rem fallback |
| quick_search | `shell/quick-search.component.ts` | `.qs-*` | yes (`.qs-close`, `:138`) | none (`--sc-ov-m`, `:124`); the beta-bar search in `shell/fusion-bar/fusion-search.component.ts:511` has 860px, marked as an exception |
| lightbox | `shared/lightbox/lightbox.component.ts` | own | yes (`:100`) | `lightbox.component.ts:124` 1480px, marked "overlay-size: exception" |

## Bundles (disjoint)

**A — HQ.** All of `src/app/hq/**`, except `hq/plan/hq-dialog.styles.ts` (shared).
- Popups: place_select, missions_popover, live_ticker, log_dialog, hq_stats, app_launch, stock_popup (and hq-stock-shared), blueprint_picker, reserve, event_claim, nachschub_target, nachschub_remove (and archive), nachschub_flow, einsatz_pick.

**B — Codex.** `src/app/codex/**` plus `shared/column-menu.component.ts`, which only the swap picker uses.
- Popups: browse_sheet, component_modal, swap_picker, compare_tray, upcoming, hero_part, holo_overlay, hangar_menu, landing_news, add_to_set, column_menu.

**C — Shell, menus, notices.**
- `shell/shell.component.ts`: account_menu and admin_menu.
- `shell/apps-menu.component.ts`
- `shell/footer.component.ts`
- `shell/merkliste/merkliste.component.ts`
- `shell/corners/beta-fab.component.ts`
- `shell/corners/handoff-button.component.ts`
- `shell/cart/wish-cart-dialog.component.ts`
- `shared/star-toast/*`
- `shared/undo-toast/*`
- `desktop/app-notice.component.ts`

**D — Everything else.**
- `shell/quick-search.component.ts`
- `shared/lightbox/*`
- `news/verse-status-chip.component.ts`
- `news/patch-dossier.component.ts`
- `news/news-list.component.ts`
- `verse/pages/verse-news-item.component.ts`
- `verse/starmap/star-dome.component.ts`
- `verse/starmap/starmap-tour.component.ts`
- `social/social-visibility-dialog.component.ts`
- `desktop/desktop-download.component.ts`
- `admin/api-tokens/api-tokens.component.ts`
- `shared/overlay-frame/overlay-frame.component.ts`, `shared/dialog/sc-confirm-dialog.component.ts` and the other `shared/dialog/*` files. These two are the shared frames; I put them in D but list them below as shared.

## Shared — migrate in foundation wave
- **`hq/plan/hq-dialog.styles.ts`**: A defines it, but `shell/cart/wish-cart-dialog.component.ts` (C) also imports it.
- **`shared/overlay-frame/overlay-frame.component.ts`** (plus `overlay-origin.service.ts` and `child-route.service.ts`): used by A (stock popup, stock-shared), B (upcoming) and D (news item).
- **`shared/dialog/*`**: `sc-confirm-dialog`, `sc-dialog.directive` and `modal-inert.service` are used by nearly every popup in all four bundles.
- **`shared/item-path/item-path.component.ts`**: the item_path popover. It is imported by A (stock popup), B (swap picker, hero part, others), C and D. C's import is `shell/fusion-bar/fusion-search.component.ts`. D's are `social/social-friend.component.ts` and `hangar/hangar-dashboard.component.ts`.
- **`src/styles.scss:536-539`**: the `--sc-ov-*` tokens.
- **Toast width fallback**: the `--sc-toast-w` 24rem fallback is duplicated in `star-toast.component.ts:54`, `undo-toast.component.ts:36` and `app-notice.component.ts:78` (all C), and in `hq-app-launch.component.ts:105` (A). Extract it once.
- **`shell/quick-search.component.ts` (D)** imports `codex/search/codex-search-results.component.ts` (B). This is a dependency only, not a popup CSS overlap.
