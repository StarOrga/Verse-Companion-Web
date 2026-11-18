# Implement brief — supabase-io-last, round 1

Decisions: [`../../20261118-2335-supabase-io-last-decisions.json`](../../20261118-2335-supabase-io-last-decisions.json)
(submission `sub-mwmq7e71-i5mwabcn`, 2026-11-18T23:01:55Z, action `implement`).

The user wrote no comment, no note and set no pin in this round. Every line below quotes the option the
user selected, word for word (label, then consequence). A line is judged against its quote.

## Checklist

1. **d-agents — automatic browser runs** (value `warm`, the recommendation)
   > Bei der Live-Datenbank bleiben, gedrosselt und mit warmem Cache
   > Kleinster Umbau: Läufe nacheinander statt parallel, das Browser-Profil mit geladenem Katalog wird
   > wiederverwendet. Die Last sinkt, verschwindet aber nicht.
   - [ ] Agent browser runs against the live database run one after another, not in parallel.
   - [ ] The browser profile that already holds the catalog is reused instead of a fresh one per run.

2. **d-ram — memory of the instance** (value `buffers`, the recommendation)
   > Postgres-Puffer von 224 auf 128 MB senken und messen
   > Kostenlos und umkehrbar, braucht einen Neustart von etwa einer Minute. Wirkung ungewiss: Ich messe
   > vorher und nachher und drehe es zurück, wenn es nichts bringt.
   - [ ] `shared_buffers` is 128 MB on the live instance.
   - [ ] Measured before and after with the same procedure.
   - [ ] Rolled back when the measurement shows no gain.

3. **d-cache — cache for catalog lists** (value `snapshot`; the user chose this over the recommended `slim`)
   > Katalog-Listen als feste Dateien pro Build ausliefern
   > Größter Gewinn: Listen kommen aus dem Datei-Speicher mit Dauer-Cache, die Datenbank sieht sie nicht
   > mehr. Mittlerer bis großer Umbau an Upload und Lesepfad.
   - [ ] Catalog lists are served as fixed files per build from the file store, with a permanent cache.
   - [ ] The database no longer sees list reads.
   - Not chosen, so not built: the Redis cache; the slim database query as a separate step.

Fixed by the page without a question: the Vercel Redis database `db-redis-main` is unused and is left to be
archived; the cron rework drafted earlier is dropped.
