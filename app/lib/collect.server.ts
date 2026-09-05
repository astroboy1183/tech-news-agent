import { recordRun } from "./runs.server";

/**
 * Collect consumer. v0.1.0 proves the queue wiring and the failure accounting;
 * feed fetching and parsing land in v0.2.0.
 */
export async function runCollectBatch(
  batch: MessageBatch<{ sourceId: number }>,
  env: Env,
): Promise<void> {
  const started = Date.now();
  let ok = 0;
  let failed = 0;

  // Per-message try/catch: an uncaught error would retry the whole batch and
  // re-fetch sources that already succeeded.
  for (const message of batch.messages) {
    try {
      await touchSource(env, message.body.sourceId);
      ok++;
      message.ack();
    } catch (error) {
      failed++;
      console.error(`collect failed for source ${message.body.sourceId}`, error);
      message.retry();
    }
  }

  await recordRun(env, { stage: "collect", startedAt: started, counts: { ok, failed } });
}

async function touchSource(env: Env, sourceId: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    `UPDATE sources
        SET last_fetched_at = ?, last_status = 'ok', consecutive_failures = 0
      WHERE id = ?`,
  )
    .bind(now, sourceId)
    .run();

  if (!result.meta.changed_db) throw new Error(`no such source: ${sourceId}`);
}
