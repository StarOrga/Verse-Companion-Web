-- Search misses move to PostHog (concept 2026-11-15 batch, B4.8).
--
-- The admin card "Häufig ohne Treffer" read public.search_misses through
-- admin_search_misses(); the web client wrote it through search_log_miss().
-- The owner asked for a complete move to PostHog: the client now sends the
-- zero-hit search text with the consent-gated event `search:miss_show`
-- (term + area), and the dashboard "Wird es genutzt?" carries the tile
-- "Suchen ohne Treffer". Nothing reads or writes the table any more.
--
-- Alpha-phase data policy: the counter rows are dropped, not migrated
-- (anonymous counts only; the 1292 "gladius" rows of 2026-11-15 were written
-- by unit-test runs against the cloud project, see B4.9, so the data is not
-- worth keeping). search_opens / search_log_open / search_popularity stay:
-- they rank the search and are not part of this move.

drop function if exists public.admin_search_misses(int);
drop function if exists public.search_log_miss(text);
drop table if exists public.search_misses;

notify pgrst, 'reload schema';
