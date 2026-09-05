/**
 * The weekly pass that lets the portal improve without being told to.
 *
 * Two things get adjusted, and both are derived from evidence the pipeline
 * already produces rather than from anything anyone has to rate by hand.
 *
 * **Weight** is trust, and clustering measures it for free. When a source
 * files a story and several independent newsrooms file the same story, that
 * source reported something real. When a source files hundreds of items that
 * nobody else ever touches, it is a firehose, a blog, or a press-release pipe
 * — still worth carrying, but not worth ranking highly. Being *first* into a
 * cluster others later join is the strongest signal available: that source
 * broke it.
 *
 * **Activity** is self-repair. A feed that has failed every attempt for days
 * is not coming back on its own, and leaving it in the rotation wastes a slot
 * every two minutes forever. It is retired, and retried once a week in case
 * the outage was long rather than permanent.
 */

import { recordRun } from "./runs.server";

/** Weight bounds. Never zero: a quiet source should rank low, not vanish. */
const MIN_WEIGHT = 0.3;
const MAX_WEIGHT = 2.0;

/** Below this many articles there is not enough evidence to judge a source. */
const MIN_SAMPLE = 8;

/** Consecutive failures before a source is retired from the rotation. */
const RETIRE_AFTER_FAILURES = 24;

/** How much history the pass considers. */
const WINDOW_DAYS = 14;

/** Retired sources given another chance each week. */
const REVIVE_PER_WEEK = 8;

export type SourceVerdict = {
  id: number;
  name: string;
  articles: number;
  corroborated: number;
  broke: number;
  oldWeight: number;
  newWeight: number;
};

export type AgentReport = {
  reweighted: SourceVerdict[];
  retired: { id: number; name: string; failures: number }[];
  revived: { id: number; name: string }[];
  evaluated: number;
};

type Stats = {
  id: number;
  name: string;
  weight: number;
  articles: number;
  corroborated: number;
  broke: number;
};

/**
 * Trust from evidence.
 *
 * Corroboration says the source reports real events; breaking says it gets
 * there first. Both are rates rather than counts, so a small careful outlet is
 * not punished for publishing less than an aggregator.
 */
export function weigh(stats: Stats): number {
  if (stats.articles < MIN_SAMPLE) return stats.weight;

  const corroborationRate = stats.corroborated / stats.articles;
  const breakingRate = stats.broke / Math.max(1, stats.corroborated);

  // A source whose stories are never corroborated sits at the floor; one whose
  // stories are usually corroborated, and which often gets there first, earns
  // its way toward the ceiling.
  const target = 0.55 + corroborationRate * 1.1 + breakingRate * 0.45;

  // Move a third of the way each week, so one odd fortnight cannot swing a
  // source from trusted to ignored.
  const eased = stats.weight + (target - stats.weight) / 3;
  return Math.round(Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, eased)) * 100) / 100;
}

export async function runAgentPass(env: Env): Promise<AgentReport> {
  const startedAt = Date.now();
  const since = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;

  const rows = await env.DB.prepare(
    `SELECT s.id, s.name, s.weight,
            COUNT(a.id) AS articles,
            SUM(CASE WHEN c.source_count > 1 THEN 1 ELSE 0 END) AS corroborated,
            SUM(CASE WHEN c.source_count > 1 AND c.primary_article_id = a.id THEN 1 ELSE 0 END)
              AS broke
       FROM sources s
       JOIN articles a ON a.source_id = s.id AND a.fetched_at >= ?1
       LEFT JOIN clusters c ON c.id = a.cluster_id
      WHERE s.active = 1
      GROUP BY s.id`,
  )
    .bind(since)
    .all<Stats>();

  const stats = rows.results ?? [];
  const reweighted: SourceVerdict[] = [];
  const updates: D1PreparedStatement[] = [];

  for (const source of stats) {
    const newWeight = weigh(source);
    if (Math.abs(newWeight - source.weight) < 0.01) continue;
    reweighted.push({
      id: source.id,
      name: source.name,
      articles: source.articles,
      corroborated: source.corroborated,
      broke: source.broke,
      oldWeight: source.weight,
      newWeight,
    });
    updates.push(
      env.DB.prepare(`UPDATE sources SET weight = ? WHERE id = ?`).bind(newWeight, source.id),
    );
  }

  // Retire what has stopped answering. Recorded as inactive rather than
  // deleted: a retired source keeps its articles, its history and its place in
  // the seed list, and can come back.
  const dead = await env.DB.prepare(
    `SELECT id, name, consecutive_failures FROM sources
      WHERE active = 1 AND consecutive_failures >= ?`,
  )
    .bind(RETIRE_AFTER_FAILURES)
    .all<{ id: number; name: string; consecutive_failures: number }>();

  const retired = (dead.results ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    failures: d.consecutive_failures,
  }));
  for (const source of retired) {
    updates.push(env.DB.prepare(`UPDATE sources SET active = 0 WHERE id = ?`).bind(source.id));
  }

  // Give retired sources another chance, a few at a time. An outage that
  // lasted two days should not cost a publisher its place permanently.
  //
  // Capped because a permanently dead feed would otherwise flap forever:
  // revived on Monday, failing all week, retired again, revived next Monday.
  // At this rate the whole retired set is retried over a couple of months
  // while a genuinely dead one costs a handful of wasted polls a week.
  const sleeping = await env.DB.prepare(
    `SELECT id, name FROM sources WHERE active = 0 ORDER BY id LIMIT ?`,
  )
    .bind(REVIVE_PER_WEEK)
    .all<{ id: number; name: string }>();

  const revived = (sleeping.results ?? []).map((s) => ({ id: s.id, name: s.name }));
  for (const source of revived) {
    updates.push(
      env.DB.prepare(
        `UPDATE sources SET active = 1, consecutive_failures = 0, next_poll_at = 0 WHERE id = ?`,
      ).bind(source.id),
    );
  }

  if (updates.length > 0) await env.DB.batch(updates);

  const report: AgentReport = {
    reweighted,
    retired,
    revived,
    evaluated: stats.length,
  };

  await recordRun(env, {
    stage: "agent",
    startedAt,
    counts: {
      evaluated: report.evaluated,
      reweighted: reweighted.length,
      retired: retired.length,
      revived: revived.length,
    },
  });

  return report;
}

/**
 * Retention.
 *
 * A year of history, because the archive is a feature and D1 has room for it:
 * at roughly 800 articles a day that is about 300,000 rows, well inside the
 * database's limits. Deleting is still bounded per run so one pass can never
 * lock the table, and clusters go with their last article rather than being
 * left behind pointing at nothing.
 */
const RETENTION_DAYS = 365;
const DELETE_BATCH = 500;

export async function pruneOldArticles(env: Env): Promise<{ articles: number; clusters: number }> {
  const cutoff = Math.floor(Date.now() / 1000) - RETENTION_DAYS * 86400;

  const articles = await env.DB.prepare(
    `DELETE FROM articles WHERE id IN (
       SELECT id FROM articles WHERE fetched_at < ?1 LIMIT ?2
     )`,
  )
    .bind(cutoff, DELETE_BATCH)
    .run();

  const clusters = await env.DB.prepare(
    `DELETE FROM clusters WHERE id IN (
       SELECT c.id FROM clusters c
        WHERE c.last_seen_at < ?1
          AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.cluster_id = c.id)
        LIMIT ?2
     )`,
  )
    .bind(cutoff, DELETE_BATCH)
    .run();

  return {
    articles: articles.meta.changes ?? 0,
    clusters: clusters.meta.changes ?? 0,
  };
}
