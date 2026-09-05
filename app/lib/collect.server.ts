import { recordRun } from "./runs.server";

export type CollectMessage = { sourceIds: number[] };

/**
 * Collect consumer. One message carries a batch of source ids — see the note in
 * the scheduler on why batching keeps this inside the free queue allowance.
 *
 * v0.1.0 proves the wiring and the failure accounting; fetching and parsing
 * land in v0.2.0.
 */
export async function runCollectBatch(
  batch: MessageBatch<CollectMessage>,
  env: Env,
): Promise<void> {
  const started = Date.now();
  let ok = 0;
  let failed = 0;

  // Per-message try/catch: an uncaught error retries the whole batch and
  // re-polls sources that already succeeded.
  for (const message of batch.messages) {
    try {
      for (const sourceId of message.body.sourceIds) {
        await touchSource(env, sourceId);
        ok++;
      }
      message.ack();
    } catch (error) {
      failed++;
      console.error("collect failed", message.body.sourceIds, error);
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
