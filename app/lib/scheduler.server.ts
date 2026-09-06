import { pruneOldArticles, runAgentPass } from "./agent.server";
import { pruneVectors, runClusterPass } from "./cluster/index";
import { composeDigest } from "./digest.server";
import { discoverSources } from "./discover.server";
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
 * Dispatch capacity, derived rather than fixed.
 *
 * The scheduler ticks every minute and every source is on a two-minute
 * interval, so a full sweep needs half the fleet per tick. A hard-coded number
 * silently breaks that the moment the source list grows past it — and the list
 * is meant to grow, since discovery adds sources every week. So the limit is
 * computed from the live count with headroom for sources that come due late.
 *
 * The floor keeps small deployments responsive; the ceiling is a guard against
 * a runaway source list rather than a target.
 */
const MIN_PER_TICK = 60;
const MAX_PER_TICK = 400;
const TICK_HEADROOM = 1.25;

function dispatchLimit(activeSources: number): number {
  const needed = Math.ceil((activeSources / 2) * TICK_HEADROOM);
  return Math.min(MAX_PER_TICK, Math.max(MIN_PER_TICK, needed));
}

/**
 * Sources bundled into one queue message.
 *
 * Queues bill per message, so at a two-minute cadence across hundreds of
 * sources this multiplier is worth real money: one source per message put
 * queue operations second only to Workers itself on the bill. The consumer
 * fetches the group in parallel, so a bigger group is not a slower one.
 */
const SOURCES_PER_MESSAGE = 4;

/** Queues refuses a sendBatch carrying more than 100 messages. */
const SEND_CHUNK = 100;

/**
 * Ids claimed per statement.
 *
 * D1 caps a statement at 100 bound parameters and the claim binds one per id
 * plus a timestamp, so this stays well clear of the edge rather than at it.
 */
const CLAIM_CHUNK = 80;

async function dispatchDueSources(env: Env): Promise<void> {
  const started = Date.now();
  const now = Math.floor(started / 1000);

  const active = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sources WHERE active = 1`).first<{
    n: number;
  }>();
  const limit = dispatchLimit(active?.n ?? 0);

  const due = await env.DB.prepare(
    `SELECT id FROM sources
      WHERE active = 1 AND next_poll_at <= ?
      ORDER BY next_poll_at ASC
      LIMIT ?`,
  )
    .bind(now, limit)
    .all<{ id: number }>();

  const ids = (due.results ?? []).map((r) => r.id);
  if (ids.length === 0) return;

  // Claim them before enqueueing so an overlapping tick cannot double-dispatch.
  //
  // Chunked because D1 refuses a statement carrying more than 100 bound
  // parameters, and this one binds every id plus the timestamp. Raising the
  // per-tick cap past that limit made this throw on every single tick — and
  // because the claim happens before the enqueue, nothing was dispatched at
  // all and collection stopped dead while the rest of the cron kept running.
  const claims: D1PreparedStatement[] = [];
  for (let i = 0; i < ids.length; i += CLAIM_CHUNK) {
    const chunk = ids.slice(i, i + CLAIM_CHUNK);
    claims.push(
      env.DB.prepare(
        `UPDATE sources SET next_poll_at = ? + poll_interval
          WHERE id IN (${chunk.map(() => "?").join(",")})`,
      ).bind(now, ...chunk),
    );
  }
  await env.DB.batch(claims);

  // Several sources per message rather than one each. Queue operations are
  // billed per message, and at a two-minute cadence across a few hundred
  // sources one-per-message is the single largest line item after Workers
  // itself — this cuts it by the group size. The consumer guards each source
  // separately, so grouping costs nothing in retry precision.
  const groups: number[][] = [];
  for (let i = 0; i < ids.length; i += SOURCES_PER_MESSAGE) {
    groups.push(ids.slice(i, i + SOURCES_PER_MESSAGE));
  }
  const messages = groups.map((sourceIds) => ({ body: { sourceIds } }));
  for (let i = 0; i < messages.length; i += SEND_CHUNK) {
    await env.COLLECT_Q.sendBatch(messages.slice(i, i + SEND_CHUNK));
  }

  await recordRun(env, {
    stage: "schedule",
    startedAt: started,
    counts: { dispatched: ids.length, limit, active: active?.n ?? 0 },
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
    // Discovery runs after reweighting so a source added this week is judged
    // on its own record next week rather than on a fortnight it did not exist
    // for. Failing here must not cost the prune.
    try {
      await discoverSources(env);
    } catch (error) {
      console.error(`discovery failed: ${String(error)}`);
      await recordRun(env, { stage: "discover", startedAt, error: String(error) });
    }
    const pruned = await pruneOldArticles(env);
    if (pruned.articles > 0 || pruned.clusters > 0) {
      await recordRun(env, { stage: "prune", startedAt, counts: pruned });
    }
  } catch (error) {
    console.error(`weekly pass failed: ${String(error)}`);
    await recordRun(env, { stage: "agent", startedAt, error: String(error) });
  }
}
