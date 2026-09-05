import { recordRun } from "./runs.server";

/**
 * Workers Free restricts every-minute crons per account, so the portal runs on
 * a single five-minute trigger and branches on the clock here. Each stage keeps
 * its own cadence; they simply share one trigger.
 */
export async function runScheduled(_cron: string, env: Env): Promise<void> {
  const now = new Date();
  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();

  // Every tick: keep the feed moving.
  await dispatchDueSources(env);

  // Every ten minutes: spend what is left of the day's summary budget.
  if (minute % 10 === 0) {
    // v0.4.0
  }

  // 02:00 UTC / 07:30 IST — compose the daily digest.
  if (hour === 2 && minute === 0) {
    // v0.5.0
  }

  // 02:30 UTC / 08:00 IST — deliver to Slack and email.
  if (hour === 2 && minute === 30) {
    // v0.9.0
  }
}

/**
 * Sources dispatched per tick, sized by the free plan's two binding limits.
 *
 * Queues allow 10,000 operations a day and a message costs about three (write,
 * read, delete). At 288 ticks a day, ten messages per tick is 2,880 messages
 * ≈ 8,600 operations — inside the allowance with room to spare.
 *
 * One message per source, with the consumer batching two, keeps each consumer
 * invocation parsing two feeds and therefore inside the 10ms CPU budget.
 *
 * The result: 102 sources each polled roughly every 51 minutes. WebSub push
 * still delivers instantly for the feeds that support it.
 */
const SOURCES_PER_TICK = 10;

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

  await env.COLLECT_Q.sendBatch(ids.map((sourceId) => ({ body: { sourceIds: [sourceId] } })));

  await recordRun(env, {
    stage: "schedule",
    startedAt: started,
    counts: { dispatched: ids.length },
  });
}
