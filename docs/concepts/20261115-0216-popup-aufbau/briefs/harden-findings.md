Nothing here was run or exercised in a browser. The findings come from reading the scaffold and about 25 of the 83 changed files, so treat the "dead" and "trapped" claims as code-reading results. The list is ordered most severe first within each group.

## 1. Bugs

1. **High.** The admin menu is dead to Escape. `shell/shell.component.ts:205` has `<sc-popup kind="menu" access="admin">` with no `(closed)` handler. `[scDialog]` consumes Escape on the frame and stops it, so `onAdminMenuKeydown`'s Escape branch (`:1453`) and `@HostListener('document:keydown.escape')` (`:1513`) never fire. Escape does nothing and focus is not returned to the button. The account menu at `:316` does handle `closed`.
2. **Medium-high.** The ✕ on the token reveal dialog does nothing until the token is copied. `admin/api-tokens/api-tokens.component.ts:567` ignores every `closed` reason unless `tokenCopied()` is true, and the scaffold always renders ✕ on a dialog.
   - On phones, `'back'` has already popped the history entry, so the popup stays open with no entry. The same is true of `onCreateEscape` (`:556`) while `creating()` is true.
3. **Medium-high.** The HQ app-status popup can push a history entry for a hidden popup. `hq/now/hq-live-ticker.component.ts:174-179` auto-opens it. At ≤749px the CSS hides it with `.dock .aussicht { display:none }` (`:145`), but the `<sc-popup kind="panel">` stays mounted.
   - At ≤720px `ngOnInit` pushes a history entry for the invisible panel, so the first Back press does nothing visible.
   - The visible chip also toggles it when the state is `tracking`.
4. **Medium.** Closing the pinned footer bubble re-opens it as a peek. `shell/footer.component.ts:36` has `(focus)="peek()"`. Closing the popup returns focus to the badge button, which sets the bubble to `'peek'` again.
5. **Medium.** `shared/popup/popup-history.ts:60-67` has a race when one popup closes and another opens in the same tick.
   - `releasePopupEntry` queues `history.back()` and increments `ownPops`. The next popup's `pushState` runs before the traversal.
   - If the traversal is cancelled or lands elsewhere, `ownPops` stays at 1. It then swallows the next real Back, or Back leaves the page instead of closing the popup.
   - Concrete case: `api-tokens.component.ts:587-588` closes the create dialog and opens the reveal dialog on phone.
6. **Low-medium.** `popup-history.ts:60-64` leaves a stale entry when a lower popup is destroyed while a higher one stays open (it is spliced, but the marker doesn't match, so there is no `back()`). The result is one dead Back step later.
7. **Low-medium.** A host that ignores `closed('back')` loses its entry. `onPopstate` (`popup-history.ts:38`) has already popped the stack, so Back can no longer close that popup. Affected: `api-tokens` (`:556`, `:567`) and `codex-swap-picker.dismiss` while `dismissing` is true (`:711`).
8. **Medium.** `shared/lightbox/lightbox.component.ts:59` closes on a scrim click (`(click)="closed.emit()"`) even though the stage is `aria-modal`. The comment at `:122` still says the scaffold owns the scrim, but the lightbox doesn't use `sc-popup`.
9. **Medium-low.** Non-modal panels on phones are full screen but have no Tab trap, so focus can reach inert-looking page content behind them. See `sc-popup.scss:175` and `isModal` in `sc-popup.component.ts:248`. This hits `verse-status-chip`, `add-to-set`, `merkliste`, `hq-missions-popover` and `footer`.
10. **Medium-low.** The phone full-screen frame is `position: fixed` inside a host wrapper that has its own z-index. It is capped at that wrapper's level instead of the 1300 popup layer, and an ancestor transform would also re-anchor it. Wrappers:
    - `codex-hero-holo-overlay.component.ts:65` (z 5)
    - `codex-hero-part-popup.component.ts:98` (z 6)
    - `footer.component.ts:174` (z 5)
    - `add-to-set.component.ts:139` (z 20)
    - `codex-landing-news.component.ts:58` (z 8)
    - `hq-live-ticker.component.ts:86` (z 4)

    The hero overlay uses `size="fill"` to cover the hero picture, and the phone rule overrides that with a full-viewport takeover.
11. **Medium-low.** `hq/plan/hq-nachschub-flow.component.ts:93,348` and `hq/stock/hq-reserve-dialog.component.ts:29,106` emit close from Escape, ✕ or Back even while `busy()` is true. `large` always takes a history entry, so a desktop Back gesture discards a multi-step wizard with no confirmation.
12. **Low-medium.** `codex/holo/codex-holo-hangar-menu.component.ts:235` runs `queueMicrotask(focusItem)` before the popup has rendered, so the "focus the checked item" intent is lost. Focus falls back to the scaffold's first tabbable element.
13. **Low-medium.** `codex-swap-picker.component.ts:708-714` never resets `dismissing` if `m.exit()` rejects or never resolves, so the picker can no longer close.
14. **Low.** `hq/hq-app-launch.component.ts:57,59` nests the notice's `role="status"` inside `<div class="live" role="status">`, which can double-announce. `void this.start()` (`:150`) has no catch around `launcher.launch`, so status can stay `'starting'`.
15. **Low (about 0.3).** `shared/dialog/modal-inert.service.ts:34-68` only recomputes `inert` on register and unregister. If `.cdk-overlay-container` already exists when a modal opens, it is marked inert. The `sc-column-menu` overlay inside the swap-picker (`column-menu.component.ts:257`) may then be unclickable.
16. **Low.** `api-tokens.component.ts:632` has an uncleared `setTimeout`, and the clipboard `catch` (`:633`) swallows the error.
17. **Low.** `hq-place-select.component.ts:147` has a dead Escape branch, because the frame's `scDialog` handles Escape first. Menu frames have `role=null` with an `aria-label` (`sc-popup.component.ts:169,253`), which is not valid ARIA.
18. **Low-medium.** `codex-browse.component.ts:472` uses `kind="panel" [modal]="true"` for a full-screen filter sheet, which fits `dialog` better.
19. **Not a defect.** `column-menu.component.ts:308` handles Escape on a child of the frame, so it runs before `scDialog` and no double-close occurs.

## 2. Architecture smells

20. **High.** Four `.scp-b` selectors never match. The components use emulated encapsulation and `sc-popup` uses `ViewEncapsulation.None`, so the compiled selector needs an attribute that `.scp-b` doesn't have. The intended flex layout and gap are not applied.
    - `shell/apps-menu.component.ts:132`
    - `codex/codex-swap-picker.component.ts:548`
    - `shell/corners/beta-fab.component.ts:88`
    - `shell/shell.component.ts:730`

    Fix by setting these on a wrapper element inside the popup body.
21. **Medium.** `beta-fab.component.ts` still has `.note` and `.only` rules. I did not see matching elements in the template.
22. **Low-medium.** `hq/plan/hq-popup-content.styles.ts` is included wholesale by five components, but `hq-blueprint-picker` only uses `.pbody`, and `hq-reserve-dialog` uses neither `.opt` nor `.dlg-msg`. The `.opt` rule (`:9`) hard-codes `border-radius: 10px`. The old `hq-dialog.styles.ts` is gone and I found no leftover imports.
23. **Low.** `column-menu.component.ts:141` and `swap-picker` use a local `.sr-only` instead of the global `.sc-sr-only`.
24. **Unverified.** `public/i18n/en.json` ~`:8665` (`cart.close`) looked unreferenced in `src`, but I did not confirm which object that line belongs to or check the other keys.

## 3. State-visual gaps

25. `column-menu.component.ts:143-180`:
    - `.cm-label`, `.cm-kebab`, `.cm-sortbtn` and `.cm-secondary` have no `:focus-visible`.
    - `.cm-sortbtn` and `.cm-secondary` also have no `:hover`.
    - The icon-only `<summary>` kebab (`:83`) has an `aria-label` but no `[scTooltip]`.
26. `codex/codex-compare-tray.component.ts:163-169` has no `:focus-visible` on `.chip-link`, `.chip-x`, `.toggle` or `.clear`.
27. I grepped for native `title=` and `<select>` but never triaged the results, so I make no claim there.

## 4. Consistency drift

28. `desktop/desktop-download.component.ts:144` has a `:hover` colour of `--sc-accent-hot` on a normal link. This is from memory of a grep line; I did not re-read the file. Medium-low.
29. `shell/apps-menu.component.ts:151-155` paints `.entry.elevated` with `--sc-accent-collab`, while the comment at `:49` says "hot". It is outside role-edge use. Low-medium.
30. `codex-compare-tray.component.ts:182` hard-codes `#8fe5b5` and `#5fd698` (use `--sc-success`).
31. `shared/popup/sc-popup.scss`:
    - `:97`, `:127` and `:161` hard-code 10.5px, 17px and 12px with no `max(…, var(--sc-fs-floor))`.
    - `:35` uses `100vw - 32px` where `--sc-rand` fits.
    - The 46px and 36px rail widths are literals.
32. Hard-coded z-index and size values:
    - `lightbox.component.ts:120` (`z-index: 1200`)
    - `lightbox.component.ts:154` (`right: 120px`)
    - `hq-app-launch.component.ts:108` (`z-index: 1440`)

## 5. Coverage gaps

33. There is no `popup-history.spec.ts`. `sc-popup.component.spec.ts` covers a large entry with Back, close via ✕, no entry for desktop dialog/menu/URL-owning popups, and Back on stacked popups (`:286-343`). These are untested:
    - the phone auto-entry for dialog and panel (`wantsHistoryEntry` via `matchMedia`)
    - out-of-order destroy leaving a stale entry
    - close then open in the same tick, and `ownPops` leaking
    - `backClose=true` on a menu or notice, which is silently ignored
    - a host ignoring `'back'`
    - navigating away while a popup is open
    - focus return and `returnFocus`
    - `size` overrides, `dialogRole`, `describedBy` and `initialFocus="container"`
34. Nothing tests the admin menu's Escape and focus-return path, which is finding 1.

## Not checked

I never opened these changed files:
- About 55 of the 83, including most specs.
- `quick-search`, `wish-cart-dialog` beyond a grep, and `social-visibility-dialog`.
- `desktop-download`, `app-notice`, `undo-toast` and `star-toast`.
- `hq-stats`, `hq-stock-popup`, `hq-blueprint-picker`, `hq-log-dialog`, `hq-missions-popover`, `hq-einsatz-pick-dialog` and `nachschub-target-dialog`.
- `codex-component-modal`, `codex-weapon-detail`, `merkliste`, `handoff-button`, `star-dome` and `starmap-tour`.
- `news-list` beyond `closeDetail`, `verse-news-item`, `item-path` beyond its popup template, and `styles.scss`.

I also did not triage:
- the native `title=` and `<select>` grep
- the full i18n orphan check
- `scPopoverDismiss` internals
- `ScDialogDirective`'s `cdkFocusInitial` handling
- real browser history-traversal timing for finding 5
