-- Wishes assigned to an Operation (concept 20261117-1110-pfad-stationen, A1 / A11).
--
-- A wish now stays on the wishlist when it is assigned to a Nachschub ("Operation" in the UI); the open line of the
-- Nachschub is the assignment. Such a line carries the new source value 'wish', so the client can tell an
-- assignment from a Bestand pick-up line or a reward line (all three used 'search' so far).
--
-- Existing data (A11) is NOT rewritten here: wish lines created before this change had their quantity moved off the
-- wishlist, and ship wishes live in two places (a hangar row with status 'wishlist' or extra copies on
-- search_wishlist) that only the client resolves correctly. The client therefore runs a one-time reconcile
-- (NachschubService.reconcileLegacyWishLines): open 'search' lines without pick-up stops in active NORMAL
-- Nachschuebe are counted back onto the wishlist and relabelled 'wish'. The relabel is the idempotency marker; it
-- syncs to every device. Closed lines and event / sightseeing / verkauf lines stay untouched.
--
-- Deploy order: push this migration BEFORE the client that writes 'wish', or every supplies push fails the check.
-- Alpha data policy: no table is dropped.

alter table public.hq_supplies drop constraint if exists hq_supplies_source;
alter table public.hq_supplies
  add constraint hq_supplies_source check (source in ('manual', 'set', 'search', 'live', 'wish'));
