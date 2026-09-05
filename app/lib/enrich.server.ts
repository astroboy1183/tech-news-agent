/**
 * The enrich consumer — turns a queued cluster id into a summary.
 *
 * Failure handling matters more than usual here because every retry costs
 * money. A budget refusal is not an error and must never be retried; a
 * malformed response is worth one retry; a missing key means the feature is
 * simply switched off and the queue should drain quietly rather than pile up.
 */

import { recordRun } from "./runs.server";
import { BudgetExhausted, type ClusterInput, NoApiKey, summarizeCluster } from "./summarize.server";

export type EnrichMessage = { clusterId: number };

/** Members of one cluster, best-scoring outlet first. */
async function loadCluster(env: Env, clusterId: number): Promise<ClusterInput | null> {
  const cluster = await env.DB.prepare(
    `SELECT id, section, source_count FROM clusters WHERE id = ?`,
  )
    .bind(clusterId)
    .first<{ id: number; section: string; source_count: number }>();
  if (!cluster) return null;

  const rows = await env.DB.prepare(
    `SELECT a.title, a.excerpt, s.name AS source_name
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.cluster_id = ?
      ORDER BY a.heuristic_score DESC
      LIMIT 8`,
  )
    .bind(clusterId)
    .all<{ title: string; excerpt: string | null; source_name: string }>();

  const articles = (rows.results ?? []).map((r) => ({
    title: r.title,
    excerpt: r.excerpt,
    sourceName: r.source_name,
  }));
  if (articles.length === 0) return null;

  return {
    clusterId: cluster.id,
    section: cluster.section,
    sourceCount: cluster.source_count,
    articles,
  };
}

export async function runEnrichBatch(env: Env, batch: MessageBatch<EnrichMessage>): Promise<void> {
  const startedAt = Date.now();
  let summarized = 0;
  let skipped = 0;
  let failed = 0;
  let halted = false;

  for (const message of batch.messages) {
    if (halted) {
      // The cap is a property of the day, not of this message: retrying the
      // rest now would only burn queue attempts. Drop them; the selector will
      // offer the same stories again tomorrow.
      message.ack();
      skipped++;
      continue;
    }

    try {
      const input = await loadCluster(env, message.body.clusterId);
      if (!input) {
        message.ack();
        skipped++;
        continue;
      }
      await summarizeCluster(env, input);
      summarized++;
      message.ack();
    } catch (error) {
      if (error instanceof BudgetExhausted || error instanceof NoApiKey) {
        halted = true;
        message.ack();
        skipped++;
        continue;
      }
      failed++;
      // One retry: a transient API error is worth a second attempt, an
      // unparseable response usually is not, and both cost the same to find out.
      if (message.attempts >= 2) message.ack();
      else message.retry();
    }
  }

  if (summarized > 0 || failed > 0) {
    await recordRun(env, {
      stage: "enrich",
      startedAt,
      counts: { summarized, skipped, failed },
    });
  }
}
