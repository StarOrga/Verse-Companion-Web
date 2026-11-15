**Scan result:** the scaffold itself is used consistently. No footer has two simultaneous `tier="primary"` actions, and no visible "Nur Admin" text appears in scope. The problems are in popup bodies and in a few consistency gaps.

I read in full only the popup bodies of the codex, hq-dialogs, desktop, cart, merkliste, social, menus and corner files. For these I only grepped: `item-path`, `lightbox`, `quick-search`, `patch-dossier`, `footer`, `hq-live-ticker`, `hq-missions-popover`, `hq-log-dialog`, `hq-stats`, `hq-blueprint-picker`, `hq-stock-popup`, `star-dome`, `starmap-tour`, `verse-news-item`. I did not scan `src/app/shared/popup-motion/`. `hq-dialog.styles.ts` is listed in scope but the file no longer exists.

## Clean checks
- **Footer primaries:** `hq-nachschub-flow.component.ts:333-348` renders three `primary` buttons, but they sit in mutually exclusive `@if` branches, so only one shows at a time. Every other footer has at most one (high confidence).
- **"Nur Admin" text:** all admin and collaborator wording in scope is `.sc-sr-only` (`shell.component.ts:211-221,373-431`; `beta-fab.component.ts:49,54`). The only visible-text candidates in `de.json` (`:199`, `:209`, `:1082`) are not used in scope files (high).

## #8 UI rules (R0–R8) and #1 state visuals
1. **R7: "Abbrechen" on a dialog that has already saved.** `hq-reserve-dialog.component.ts:106` shows `common.dialog.cancel` but emits `closed.emit(changed())`. Edit, release and handout act immediately (`:42-48`), so the button really means "Schließen". High, safe (swap the key).
2. **R7: other non-standard close and cancel wording.**
   - `api-tokens.component.ts:198-199` uses its own key `admin.tokens.dialog.cancel` instead of `common.dialog.cancel`, and it has no `tier`. Medium, safe.
   - `app-notice.component.ts:65` labels the "snooze for ~14 days" button `appNotice.close`, which reads "Schließen". "Später" (`de.json:96`) would fit better. Medium, safe.
   - `hq-app-launch.component.ts:79` uses `hq.app.close` for the same dismiss. Low, safe.
3. **R8: clipped nested menu.** `codex-swap-picker.component.ts:285,548` puts an absolutely positioned `<sc-popup kind="menu">` inside a `bodyFill` large popup whose body scrolls and clips. A menu up to 320 px tall will be cut off when the body is short. Medium, not a one-line fix (needs an anchored overlay or a different placement).
4. **R8: cart tiles at 375 px.** `wish-cart-dialog.component.ts:164,172,221` keeps `--n` tile columns inside a full-width group. On phones each stepper button grows to 44 px and the row holds 3 buttons plus a remove button (about 150 px), which overflows a tile of about 110 px when `--n` is 3 or more. Medium (not measured). Fix: collapse to 1–2 columns at ≤749 px, which is safe.
5. **R8: left-edge risk on phones.** The menu in `codex-holo-hangar-menu.component.ts:160` is `absolute; right:0` with a 20rem frame and `max-width: calc(100vw - 24px)`. If the trigger is not right-aligned at 375 px, the menu runs off the left edge. `verse-status-chip.component.ts:167` anchors the same way. Low–medium, not verified.
6. **Nested scrollers.** `codex-holo-hangar-menu.component.ts:161` gives `[role=menu]` its own `max-height` and `overflow:auto` inside the scaffold's scrolling body, which can produce two scrollbars. Low, safe.
7. **Icon-only buttons without `[scTooltip]`** (they have `aria-label` but no tooltip):
   - The quantity steppers at `wish-cart-dialog.component.ts:84,88` and `merkliste.component.ts:66,70`. High, safe.
   - `codex-compare-tray.component.ts:55-57` has a tooltip but the label is a bare "Entfernen" with no item name, so many identical buttons. It is also a roughly 20 px tap target (`:164`). Medium, safe.
8. **Missing `:focus-visible` on interactive items.**
   - `codex-swap-picker.component.ts`: `.pick-cols-sum` (`:545`), `.pc-reset` (`:557`) and `.fc button` (`:642`). High, safe.
   - `codex-component-modal.component.ts:97,101`: `.hs` and `.derived` have `tabindex=0` but no focus style. High, safe.
   - `column-menu.component.ts:183-185`: `.cm-clear` and the `.cm-range input` have none; focus styles cover only the label, kebab, sort buttons and secondary button (`:147`). Medium, safe.
9. **R6: hover not wrapped in `@media (hover:hover)`.** Examples: `codex-holo-hangar-menu.component.ts:167`, `beta-fab.component.ts:96`, `hq-einsatz-pick-dialog.component.ts:75`, `codex-landing-news.component.ts:50`, `wish-cart-dialog.component.ts:186`. Medium. A global sweep is safe, but I only sampled these and did not confirm the rule applies to each.
10. **Tap targets below the floor.**
    - `column-menu.component.ts:154,171,183`: 4px/6px padding with no `--sc-tap-min`.
    - `codex-swap-picker.component.ts:557`: `.pc-reset` at 4px/8px padding.
    - `codex-swap-picker.component.ts:642`: `.fc button` has `padding:0`.
    Medium, safe.
11. **Font floor.** `hq-place-select.component.ts:67,68` (0.62rem and 0.7rem) and `apps-menu.component.ts:149,152` (0.76rem and 0.72rem) skip `max(…, var(--sc-fs-floor))`. Low–medium, safe.
12. **Modal dialog without a backdrop.** `hq-einsatz-pick-dialog.component.ts:28` is `kind="dialog" size="s" [backdrop]="false"` and is not a menu. If this is intentional it deserves a comment. Low.
13. **Phone sizing of embedded panels (needs a design call).** `codex-hero-holo-overlay.component.ts` and `codex-hero-part-popup.component.ts` use `kind="panel"` with `size="fill"`. If the ≤720 px full-screen rule also applies to `fill` panels, they would cover the hero on phones. I did not verify this against `sc-popup.scss`. Low.

## #2 Consistency drift
14. **Eyebrow wording differs across areas.**
    - HQ dialogs all use `hq.title`.
    - `hq-reserve-dialog.component.ts:29` uses `subtitle()`, and `nachschub-target-dialog.component.ts:28` uses the intent text.
    - Codex popups use "Waffe", "Bauteil" or `eyebrow(t)` (`de.json:776,1666`).
    - `codex-landing-news.component.ts:27` uses "KI-Zusammenfassung", which is a source line (`de.json:353`), not an eyebrow.
    - `add-to-set.component.ts:56` uses the item name.
    - `api-tokens.component.ts:153` uses "API-Tokens" (`de.json:4008`).
    - Unlike merkliste (`quick.wish`), `wish-cart-dialog.component.ts:40` has no eyebrow.
    - `hq-overview.component.ts:37` uses `hq.eyebrow`, while its sibling `hq-ops.component.ts:13` uses `hq.title`.
    Medium. Aligning wording is safe, but picking the convention is a product call.
15. **Eyebrow missing entirely** on `codex-browse.component.ts:472` (filter popup), `codex-compare-tray.component.ts:79`, `codex-hero-holo-overlay.component.ts` and `handoff-button.component.ts:38`. Medium, safe.
16. **Retry wording and keys.** `errors.retry` (`add-to-set.component.ts:64`, `social-visibility-dialog.component.ts:39`), `codex.error.retry` (`codex-swap-picker.component.ts:244`) and `hq.app.retry` ("Schon installiert? Erneut starten", `de.json:6948`) differ. The first two both read "Erneut versuchen". Low, safe.
17. **Raw buttons instead of `scAction`.**
    - `desktop-download.component.ts:103` uses `class="sc-btn micro"` and has no `type="button"`. High, safe.
    - `codex-swap-picker.component.ts:244,309`, `column-menu.component.ts:137`, `add-to-set.component.ts:64` and `verse-status-chip.component.ts:93` use hand-styled buttons or links. Medium.
18. **Footer for a destructive confirm.** `hq-nachschub-dialogs.component.ts:33` makes the destructive action `secondary` + `tone="danger"` with no primary. `sc-confirm-dialog.component.ts:55-56` uses `primary` + `danger`. Medium, safe.
19. **Dialogs with no footer close.** `social-visibility-dialog.component.ts` (switches save immediately), `hq-nachschub-dialogs.component.ts:60` (archive) and the read-only popups rely on ✕ only. This is acceptable under the scaffold, but the wording for "done" differs elsewhere (`starmap.tour.done` "Fertig"). Low, no change recommended.

## #3 Hardcoded values → token candidates
20. **Off-scale inline gap.** `codex-swap-picker.component.ts:217` sets `--sc-popup-body-gap: 10px`. Use `var(--sc-space-2)` or `var(--sc-space-3)`. High, safe.
21. **Off-scale spacing and px in popup bodies** (6/10/14 px values instead of `--sc-space-*`):
    - `hq-einsatz-pick-dialog.component.ts:59,65`
    - `social-visibility-dialog.component.ts:104,107`
    - `wish-cart-dialog.component.ts:159,161,200`
    - `codex-weapon-detail.component.ts` (the `val-card` padding of 10 px)
    - `codex-holo-hangar-menu.component.ts:164`
    - `api-tokens.component.ts` (reveal-warning margin of 16 px)
    Medium, safe.
22. **Hard px widths inside overlays.**
    - `api-tokens.component.ts` `.scope-code` `min-width:130px`.
    - `codex-swap-picker.component.ts:518` (`max-width:220px`).
    - `column-menu.component.ts:175,178` (`width:54px`, `max-height:160px`).
    - `wish-cart-dialog.component.ts:164` (`168px`).
    - `codex-swap-picker.component.ts:576`, `.wt min-inline-size:1080px`, sits inside its own scroller, so it is acceptable.
    - `hq-nachschub-flow.component.ts:436` (`max-width:460px`) is a max-width only, so it is acceptable.
    Low–medium.
23. **Literal colours instead of tokens.**
    - `codex-landing-news.component.ts:45,51,55`: `rgba(82,193,230,…)` and `#0b1f2c`.
    - `social-visibility-dialog.component.ts:105,117`: `rgba(248,113,113,…)` and `rgba(0,212,255,…)`.
    - `desktop-download.component.ts:128`: `rgba(248,113,113,…)`.
    - `shell.component.ts:578`: a drop-shadow `rgba`.
    Medium, safe.
24. **Dead CSS.** `app-notice.component.ts:102,105` defines `@keyframes notice-in` and `notice-fade`, and nothing references them. Low, safe.

## #7 Component architecture
25. **Duplicated stepper.** The `.step` markup and CSS are copied in `wish-cart-dialog.component.ts:83-91,184-191` and `merkliste.component.ts:65-73,122-128` ("same look as the cart dialog's"). Extract one component and add the tooltip once. Medium. It is a structural change, so propose only.
26. **Duplicated pill-radio patterns.** `hq-event-claim-dialog.component.ts:29-33` and `nachschub-target-dialog.component.ts:36-45` hand-roll segmented pills with `aria-pressed` or `role=radio`. The target dialog has no arrow-key handling. `ScSegmentedComponent` already exists (`social-visibility-dialog.component.ts:27`). Medium. Propose only.
27. **Oversized file.** `codex-browse.component.ts` is about 2.7k lines and `codex-swap-picker.component.ts` is large with inline styles. Consider splitting. Low, propose only.
28. **Menu hand-rolled in-feature.** `hq-place-select.component.ts` and `codex-holo-hangar-menu.component.ts` each implement their own arrow-key menu navigation (`:250`) on top of `kind="menu"`. A shared menu-navigation directive would remove the duplication. Low, propose only.

## #4 Functionality gaps and a11y
29. **Pressed toggle with a changing label.** `codex-compare-tray.component.ts:130-131` sets `aria-pressed` and also changes the label text between "Alle zeigen" and "Nur Unterschiede". Screen readers read this as a double state. Use one fixed label. Low, safe.
30. **Disabled link semantics.** `wish-cart-dialog.component.ts:137` is an anchor with `role="link"` and `aria-disabled` (and a null `routerLink`). It behaves, but it is the only footer primary that is not a `<button>`. Low.
31. **Label wrapping a button.** `api-tokens.component.ts:214-221` wraps the token text and a copy button in one `<label>`, which makes the label click target ambiguous. Low, safe.

## #5 Backend UI-impact, #6 Structural smells
32. **#5:** nothing found in scope. The i18n keys these dialogs read (`admin.tokens.*`, `appNotice.*`, `hq.*`) all exist in `de.json` where I checked them.
33. **#6:** nothing beyond #25–#28.
