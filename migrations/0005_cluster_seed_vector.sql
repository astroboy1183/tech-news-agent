-- Keep each cluster's seed embedding alongside the cluster.
--
-- Vectorize is eventually consistent: a vector upserted in one pass is not
-- reliably queryable in the next. That is invisible most of the time and
-- catastrophic exactly when it matters — six outlets filed the Nexus Mods /
-- SteamDB acquisition within 78 seconds and produced five clusters, because
-- each pass created a cluster the following pass could not yet see.
--
-- Breaking news arrives in bursts, so the window where the index lags is the
-- window clustering exists to serve. Holding the seed vector here lets recent
-- clusters be compared in memory, with no dependence on index freshness.
-- Vectorize still serves the older tail, where seconds no longer matter.

ALTER TABLE clusters ADD COLUMN seed_vector TEXT;
