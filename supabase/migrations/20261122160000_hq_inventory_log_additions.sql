-- Admin feedback #354 (concept d83b72d8): the Ladeprotokoll beside the Lager search records EVERY change, not only
-- removals. hq_inventory_removals so far allowed only take / delete / reduce / handout; this widens its kind check by
-- two values so the same owner-only log also holds the additions:
--   add   = stored (Einlagern: manual add, +1 stepper, the search's one-click Einlagern)
--   raise = the amount corrected upwards
-- Additive only: no column, no policy, no grant changes. RLS stays owner-only (select / insert / delete own rows); the
-- cap trigger (200 per user) and the 90-day retention job cover the new rows as they are.
--
-- Readers: the app's "zuletzt aufgebraucht" (lastRemovals) filters to the four removal kinds, so additions never count
-- as used up. A frontend build older than this migration simply never writes the new kinds.
--
-- ROLLBACK:
--   delete from public.hq_inventory_removals where kind in ('add', 'raise');
--   alter table public.hq_inventory_removals drop constraint if exists hq_inv_rem_kind;
--   alter table public.hq_inventory_removals add constraint hq_inv_rem_kind check (kind in ('take', 'delete', 'reduce', 'handout'));

alter table public.hq_inventory_removals drop constraint if exists hq_inv_rem_kind;
alter table public.hq_inventory_removals
  add constraint hq_inv_rem_kind check (kind in ('take', 'delete', 'reduce', 'handout', 'add', 'raise'));

comment on table public.hq_inventory_removals is
  'Manual changes of the Bestand: removals (take out, delete, reduction, handed-out reservation) feed "zuletzt aufgebraucht" '
  '= last ten removals; additions (add, raise) feed the Ladeprotokoll only. Owner-only. Cap 200 per user (oldest pruned), 90 days retention.';
