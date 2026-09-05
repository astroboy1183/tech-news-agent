-- Remove clusters that ended up with no articles.
--
-- v0.3.0 was developed against live data, and re-running clustering after a
-- rule change leaves the previous run's clusters behind with every member
-- reassigned. They are derived rows — everything in `clusters` is recomputable
-- from `articles` — but while they linger they are counted in averages and
-- offered as merge candidates under headlines nothing points to any more.
--
-- Worth keeping as a migration rather than a one-off: any future change to the
-- merge rules needs the same cleanup.

DELETE FROM clusters
 WHERE id NOT IN (SELECT cluster_id FROM articles WHERE cluster_id IS NOT NULL);
