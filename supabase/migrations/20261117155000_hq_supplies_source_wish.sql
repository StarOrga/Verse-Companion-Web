-- Wishes assigned to an Operation (concept 20261117-1110-pfad-stationen, A1 / A8 / A11).
--
-- A wish now stays on the wishlist when it is assigned to a Nachschub ("Operation" in the UI); the open line of a
-- NORMAL Nachschub is the assignment. Two new source values carry that state:
--   'wish'      the line is an assignment of a wish (its pieces count as assigned, the wish keeps them);
--   'wish_met'  the line was reached and its wish was lowered by it (A8). Back to 'wish' when the line is reopened.
-- The client moves a line between 'search' / 'wish' / 'wish_met' only with a conditional update
-- (`update ... where source = <old>`, HqSuppliesService.casSource): the row that changed is the exactly-once marker,
-- so a wish is moved once per transition even with two devices, a retry or an old client in play.
--
-- Existing data (A11) is NOT rewritten here: ship wishes live in two places (a hangar row with status 'wishlist' or
-- extra copies on search_wishlist) that only the client resolves, and only lines that are certainly old wish lines
-- may be counted back. NachschubService.reconcileLegacyWishLines does that per wish (CAS 'search' -> 'wish' first,
-- then the wishlist write, the label reverted when that write fails). Event / sightseeing / verkauf lines and closed
-- lines stay untouched.
--
-- Deploy order: push this migration BEFORE the client that writes 'wish' / 'wish_met', or every supplies push fails
-- the check. Alpha data policy: no table is dropped, no row is changed.

alter table public.hq_supplies drop constraint if exists hq_supplies_source;
alter table public.hq_supplies
  add constraint hq_supplies_source check (source in ('manual', 'set', 'search', 'live', 'wish', 'wish_met'));
