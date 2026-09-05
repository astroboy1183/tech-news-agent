-- Poll every source every two minutes.
--
-- The original tiering (5/15/60/720 min) rationed a scarce budget: on the free
-- plan an every-minute cron was not available account-wide, so low-frequency
-- blogs were parked on long intervals. Conditional GET makes the steady state
-- cheap — a source that has not published answers 304 with no body — so the
-- real cost of uniform polling is queue operations, not bandwidth.
--
-- Sources that fail still back off exponentially (up to 6h, honouring
-- Retry-After), so a rate-limiting origin removes itself from the fast lane
-- without any tier to maintain.

UPDATE sources SET poll_interval = 120;
