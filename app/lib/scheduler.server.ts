import { pruneVectors, runClusterPass } from "./cluster/index";
import { reconcileSubscriptions } from "./feeds/websub.server";
import { recordRun } from "./runs.server";

/**
 * Cron dispatcher. Each schedule maps to one stage, and every handler enqueues
 * work rather than performing it, so no single invocation can exceed its CPU
 * budget however far behind the queue falls.
 */
const CALLBACK_BASE = "https://tech-news-agent.jayanthapalla.workers.dev";

export async function runScheduled(cron: string, env: Env): Promise<void> {
  switch (cron) {
    case "* * * * *": {
      // Independent on purpose. Clustering reads what earlier ticks stored, so
      // it has no reason to wait for this tick's dispatch — and if one of them
      // fails, the other must still run. Both record their own outcome.
      const outcomes = await Promise.allSettled([dispatchDueSources(env), clusterRecent(env)]);
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") console.error(String(outcome.reason));
      }
      return;
    }
    case "*/10 * * * *":
      // Keep hub subscriptions alive; v0.4.0 adds budget selection here too.
      return reconcileSubscriptions(env, CALLBACK_BASE);
    case "0 2 * * *":
      // v0.5.0 will compose the daily digest here. For now the daily slot is
      // where housekeeping lives.
      return maintain(env);
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
 * Every source polls every two minutes, so a full sweep needs half the fleet
 * each tick. This sits above that with headroom, and stays a ceiling rather
 * than a target: a source is only picked up once its own interval elapses.
 * The cap still matters after a deploy or an outage, when everything is due at
 * once and the backlog should drain steadily instead of in one burst.
 *
 * The cap exists so a backlog (after a deploy, or an outage) drains steadily
 * instead of dispatching thousands of messages in one tick.
 */
const SOURCES_PER_TICK = 60;

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

/**
 * Group the last couple of minutes of arrivals into stories.
 *
 * Isolated on purpose: clustering spends Workers AI, and a bad day there must
 * not stop sources being polled. An article that fails to cluster is still
 * collected, classified and visible — it simply stands alone until the next
 * pass picks it up.
 */
async function clusterRecent(env: Env): Promise<void> {
  const startedAt = Date.now();
  try {
    const counts = await runClusterPass(env);
    if (counts.considered > 0) {
      await recordRun(env, { stage: "cluster", startedAt, counts });
    }
  } catch (error) {
    console.error(`cluster pass failed: ${String(error)}`);
    await recordRun(env, { stage: "cluster", startedAt, error: String(error) });
  }
}

/** Nightly housekeeping. Currently just keeping the vector index honest. */
async function maintain(env: Env): Promise<void> {
  const startedAt = Date.now();
  try {
    const { deleted, failed, reason } = await pruneVectors(env);
    await recordRun(env, {
      stage: "maintain",
      startedAt,
      counts: { deleted, failed },
      error: reason,
    });
  } catch (error) {
    console.error(`maintenance failed: ${String(error)}`);
    await recordRun(env, { stage: "maintain", startedAt, error: String(error) });
  }
}
