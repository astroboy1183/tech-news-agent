-- 0002 changed how often we poll, but not when each source is next due.
-- Sources carried a next_poll_at computed from their old interval, so the
-- twelve-hourly tier would have waited up to twelve more hours before feeling
-- the change. Pull every future due-time back into the new cadence.

UPDATE sources
   SET next_poll_at = MIN(next_poll_at, unixepoch() + 120)
 WHERE active = 1;
