import { recordRun } from "./runs.server";

/**
 * Cron dispatcher. Each schedule maps to one stage; the handler enqueues work
 * rather than performing it, so no single invocation can exceed its CPU budget.
 */
export async function runScheduled(cron: string, env: Env): Promise<void> {
  switch (cron) {
    case "* * * * *":
      return dispatchDueSources(env);
    case "*/10 * * * *":
      // v0.4.0 — select what the remaining daily budget can afford.
      return;
    case "0 2 * * *":
      // v0.5.0 — compose the daily digest.
      return;
    case "30 2 * * *":
      // v0.9.0 — deliver to Slack and email.
      return;
    default:
      console.warn(`unrecognised cron schedule: ${cron}`);
  }
}

/**
 * Take the sources whose next poll is due, oldest first, and hand them to the
 * collect queue. The slice keeps one tick well inside the subrequest budget
 * even when a backlog has built up.
 */
const SOURCES_PER_TICK = 40;

async function dispatchDueSources(env: Env): Promise<void> {
  const started = Date.now();
  const now = Math.floor(started / 1000);

  const due = await env.DB.prepare(
    `SELECT id FROM sources
      WHERE active = 1 AND next_poll_at <= ?
      ORDER BY next_poll_at ASC
      LIMIT ?`,
  )
    .bind(now, SOURCES_PER_TICK)
    .all<{ id: number }>();

  const rows = due.results ?? [];
  if (rows.length === 0) return;

  // Claim them up front so an overlapping tick cannot enqueue the same source.
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  await env.DB.prepare(
    `UPDATE sources SET next_poll_at = ? + poll_interval WHERE id IN (${placeholders})`,
  )
    .bind(now, ...ids)
    .run();

  await env.COLLECT_Q.sendBatch(ids.map((sourceId) => ({ body: { sourceId } })));

  await recordRun(env, {
    stage: "schedule",
    startedAt: started,
    counts: { dispatched: ids.length },
  });
}
