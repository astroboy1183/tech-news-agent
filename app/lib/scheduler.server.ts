import { pruneOldArticles, runAgentPass } from "./agent.server";
import { pruneVectors, runClusterPass } from "./cluster/index";
import { composeDigest } from "./digest.server";
import { reconcileSubscriptions } from "./feeds/websub.server";
import { recordRun } from "./runs.server";
import { dispatchForSummary } from "./select.server";
import { deliverToSlack, NoWebhook } from "./slack.server";

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
    case "*/10 * * * *": {
      const outcomes = await Promise.allSettled([
        reconcileSubscriptions(env, CALLBACK_BASE),
        spendBudget(env),
      ]);
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") console.error(String(outcome.reason));
      }
      return;
    }
    case "0 2 * * *":
      // v0.5.0 will compose the daily digest here. For now the daily slot is
      // where housekeeping lives.
      return maintain(env);
    case "30 2 * * *":
      return deliver(env);
    case "0 3 * * 1":
      return weeklyPass(env);
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

/**
 * Spend what today's budget still allows on the stories most worth it.
 *
 * Runs on its own ten-minute beat rather than with collection, so a burst of
 * arrivals cannot drag summarization along with it and empty the day's budget
 * in an hour.
 */
async function spendBudget(env: Env): Promise<void> {
  const startedAt = Date.now();
  try {
    const { queued, reason, remainingMicros } = await dispatchForSummary(env);
    if (queued > 0 || reason !== "nothing-eligible") {
      await recordRun(env, {
        stage: "select",
        startedAt,
        counts: { queued, remainingMicros },
      });
    }
  } catch (error) {
    console.error(`summary selection failed: ${String(error)}`);
    await recordRun(env, { stage: "select", startedAt, error: String(error) });
  }
}

/**
 * Publish the day's digest to whichever channels are configured.
 *
 * A channel nobody set up is not a failure, so an unconfigured Slack webhook
 * is recorded and passed over rather than raised. Email waits on a domain:
 * there is nowhere to send from until one exists.
 */
async function deliver(env: Env): Promise<void> {
  const startedAt = Date.now();
  try {
    const digest = await composeDigest(env);
    if (digest.counts.stories === 0) {
      await recordRun(env, { stage: "deliver", startedAt, counts: { skipped: 1 } });
      return;
    }

    let slack = 0;
    let configured = 0;
    try {
      const result = await deliverToSlack(env, digest, CALLBACK_BASE);
      configured = 1;
      slack = result.delivered ? 1 : 0;
      if (!result.delivered) {
        console.warn(`slack rejected the digest with ${result.status}`);
      }
    } catch (error) {
      if (!(error instanceof NoWebhook)) throw error;
    }

    await recordRun(env, {
      stage: "deliver",
      startedAt,
      counts: { stories: digest.counts.stories, slack, configured },
    });
  } catch (error) {
    console.error(`delivery failed: ${String(error)}`);
    await recordRun(env, { stage: "deliver", startedAt, error: String(error) });
  }
}

/**
 * The weekly pass: reweight sources from evidence, retire what has stopped
 * answering, and trim history past the retention window.
 *
 * Weekly rather than nightly on purpose. Trust should move slowly — a source
 * having a quiet week is not a source that has become untrustworthy — and a
 * cadence this slow makes the change visible in the run log rather than lost
 * in the noise of a daily job.
 */
async function weeklyPass(env: Env): Promise<void> {
  const startedAt = Date.now();
  try {
    await runAgentPass(env);
    const pruned = await pruneOldArticles(env);
    if (pruned.articles > 0 || pruned.clusters > 0) {
      await recordRun(env, { stage: "prune", startedAt, counts: pruned });
    }
  } catch (error) {
    console.error(`weekly pass failed: ${String(error)}`);
    await recordRun(env, { stage: "agent", startedAt, error: String(error) });
  }
}
