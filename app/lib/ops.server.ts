/**
 * Operational truth about the pipeline.
 *
 * Written to answer the questions that actually get asked when something looks
 * wrong: is anything still being collected, which sources have gone quiet, is
 * clustering merging anything, and what has today cost. Each is a number that
 * can be checked rather than a status light that says "healthy".
 */

import { formatMicros, readSpend } from "./budget.server";

export type SourceHealth = {
  id: number;
  name: string;
  section: string;
  lastFetchedAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  articles: number;
};

export type StageRun = {
  stage: string;
  runs: number;
  lastRun: number | null;
  lastCounts: string | null;
  lastError: string | null;
};

export type Ops = {
  sources: {
    active: number;
    healthy: number;
    backingOff: number;
    failing: number;
    neverFetched: number;
    stale: number;
    worst: SourceHealth[];
  };
  pipeline: {
    articles: number;
    articlesToday: number;
    articlesLastHour: number;
    clusters: number;
    corroborated: number;
    biggestCluster: number;
    averageMembers: number;
    unclustered: number;
    summarized: number;
  };
  budget: {
    day: string;
    spent: string;
    cap: string;
    remaining: string;
    summariesToday: number;
    percentUsed: number;
  };
  stages: StageRun[];
  generatedAt: number;
};

/** Not fetched in this long, while healthy, means something is wrong. */
const STALE_SECONDS = 15 * 60;

export async function loadOps(env: Env): Promise<Ops> {
  const now = Math.floor(Date.now() / 1000);

  const [sourceStats, worst, pipeline, stages, spend] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS active,
              SUM(CASE WHEN consecutive_failures = 0 THEN 1 ELSE 0 END) AS healthy,
              SUM(CASE WHEN consecutive_failures BETWEEN 1 AND 2 THEN 1 ELSE 0 END) AS backing_off,
              SUM(CASE WHEN consecutive_failures >= 3 THEN 1 ELSE 0 END) AS failing,
              SUM(CASE WHEN last_fetched_at IS NULL THEN 1 ELSE 0 END) AS never_fetched,
              SUM(CASE WHEN consecutive_failures = 0
                        AND last_fetched_at IS NOT NULL
                        AND last_fetched_at < ?1 THEN 1 ELSE 0 END) AS stale
         FROM sources WHERE active = 1`,
    )
      .bind(now - STALE_SECONDS)
      .first<{
        active: number;
        healthy: number;
        backing_off: number;
        failing: number;
        never_fetched: number;
        stale: number;
      }>(),

    env.DB.prepare(
      `SELECT s.id, s.name, s.section, s.last_fetched_at, s.consecutive_failures, s.last_status,
              (SELECT COUNT(*) FROM articles a WHERE a.source_id = s.id) AS articles
         FROM sources s
        WHERE s.active = 1 AND s.consecutive_failures > 0
        ORDER BY s.consecutive_failures DESC, s.name ASC
        LIMIT 25`,
    ).all<{
      id: number;
      name: string;
      section: string;
      last_fetched_at: number | null;
      consecutive_failures: number;
      last_status: string | null;
      articles: number;
    }>(),

    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM articles) AS articles,
              (SELECT COUNT(*) FROM articles WHERE fetched_at > ?1) AS articles_today,
              (SELECT COUNT(*) FROM articles WHERE fetched_at > ?2) AS articles_hour,
              (SELECT COUNT(*) FROM clusters) AS clusters,
              (SELECT COUNT(*) FROM clusters WHERE source_count > 1) AS corroborated,
              (SELECT MAX(source_count) FROM clusters) AS biggest,
              (SELECT COUNT(*) FROM articles WHERE cluster_id IS NULL) AS unclustered,
              (SELECT COUNT(*) FROM enrichments) AS summarized`,
    )
      .bind(now - 86400, now - 3600)
      .first<{
        articles: number;
        articles_today: number;
        articles_hour: number;
        clusters: number;
        corroborated: number;
        biggest: number;
        unclustered: number;
        summarized: number;
      }>(),

    env.DB.prepare(
      `SELECT stage, COUNT(*) AS runs, MAX(started_at) AS last_run
         FROM runs WHERE started_at > ?1 GROUP BY stage ORDER BY last_run DESC`,
    )
      .bind(now - 86400)
      .all<{ stage: string; runs: number; last_run: number }>(),

    readSpend(env),
  ]);

  // The most recent row per stage, for its counts and any error.
  const latest = await env.DB.prepare(
    `SELECT r.stage, r.counts_json, r.error
       FROM runs r
       JOIN (SELECT stage, MAX(id) AS id FROM runs GROUP BY stage) m ON m.id = r.id`,
  ).all<{ stage: string; counts_json: string | null; error: string | null }>();
  const byStage = new Map((latest.results ?? []).map((r) => [r.stage, r]));

  const clusters = pipeline?.clusters ?? 0;
  const articlesClustered = (pipeline?.articles ?? 0) - (pipeline?.unclustered ?? 0);

  return {
    sources: {
      active: sourceStats?.active ?? 0,
      healthy: sourceStats?.healthy ?? 0,
      backingOff: sourceStats?.backing_off ?? 0,
      failing: sourceStats?.failing ?? 0,
      neverFetched: sourceStats?.never_fetched ?? 0,
      stale: sourceStats?.stale ?? 0,
      worst: (worst.results ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        section: r.section,
        lastFetchedAt: r.last_fetched_at,
        consecutiveFailures: r.consecutive_failures,
        lastError: r.last_status,
        articles: r.articles,
      })),
    },
    pipeline: {
      articles: pipeline?.articles ?? 0,
      articlesToday: pipeline?.articles_today ?? 0,
      articlesLastHour: pipeline?.articles_hour ?? 0,
      clusters,
      corroborated: pipeline?.corroborated ?? 0,
      biggestCluster: pipeline?.biggest ?? 0,
      averageMembers: clusters > 0 ? articlesClustered / clusters : 0,
      unclustered: pipeline?.unclustered ?? 0,
      summarized: pipeline?.summarized ?? 0,
    },
    budget: {
      day: spend.day,
      spent: formatMicros(spend.spentMicros),
      cap: formatMicros(spend.capMicros),
      remaining: formatMicros(spend.remainingMicros),
      summariesToday: spend.summaries,
      percentUsed: spend.capMicros > 0 ? (spend.spentMicros / spend.capMicros) * 100 : 0,
    },
    stages: (stages.results ?? []).map((s) => ({
      stage: s.stage,
      runs: s.runs,
      lastRun: s.last_run,
      lastCounts: byStage.get(s.stage)?.counts_json ?? null,
      lastError: byStage.get(s.stage)?.error ?? null,
    })),
    generatedAt: now,
  };
}
