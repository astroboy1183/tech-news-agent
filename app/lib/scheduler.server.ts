import { recordRun } from "./runs.server";

/**
 * Cron dispatcher. Each schedule maps to one stage, and every handler enqueues
 * work rather than performing it, so no single invocation can exceed its CPU
 * budget however far behind the queue falls.
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
 * Sources dispatched per tick.
 *
 * Polling is tiered, so this is a ceiling rather than a target: a source only
 * becomes due when its own interval elapses. Across the seeded set that works
 * out at roughly 5,700 polls a day — fast movers every 5 minutes, the long
 * tail every few hours.
 *
 * The cap exists so a backlog (after a deploy, or an outage) drains steadily
 * instead of dispatching thousands of messages in one tick.
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

  const ids = (due.results ?? []).map((r) => r.id);
  if (ids.length === 0) return;

  // Claim them before enqueueing so an overlapping tick cannot double-dispatch.
  const placeholders = ids.map(() => "?").join(",");
  await env.DB.prepare(
    `UPDATE sources SET next_poll_at = ? + poll_interval WHERE id IN (${placeholders})`,
  )
    .bind(now, ...ids)
    .run();

  // One message per source: a poisoned feed retries alone rather than dragging
  // its batch with it.
  await env.COLLECT_Q.sendBatch(ids.map((sourceId) => ({ body: { sourceIds: [sourceId] } })));

  await recordRun(env, {
    stage: "schedule",
    startedAt: started,
    counts: { dispatched: ids.length },
  });
}
