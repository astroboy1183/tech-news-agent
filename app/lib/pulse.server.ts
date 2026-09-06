/**
 * The collection cycle, as it happens.
 *
 * `/ops` answers "is anything broken". This answers a different question —
 * "is it running *right now*, and is it keeping to two minutes" — which is the
 * one that gets asked when the front page looks stale and nothing is obviously
 * on fire.
 *
 * Everything here is measured from what the pipeline already records: the
 * `runs` table and the poll timestamps on `sources`. Nothing is instrumented
 * specially, so this page cannot report health the pipeline does not have.
 */

import { POLL_INTERVAL_SECONDS } from "./constants";

export { POLL_INTERVAL_SECONDS };

export type Tick = {
  startedAt: number;
  durationSeconds: number;
  dispatched: number;
  limit: number | null;
};

export type CollectRun = {
  startedAt: number;
  durationSeconds: number;
  fetched: number;
  inserted: number;
  unchanged: number;
  failed: number;
};

export type ArrivalBucket = { minute: number; articles: number };

export type Pulse = {
  now: number;
  sweep: {
    /** Sources whose poll is due but not yet dispatched. */
    dueNow: number;
    /** Due for longer than the interval — the sweep is behind. */
    overdue: number;
    meanAge: number;
    worstAge: number;
    withinInterval: number;
    healthy: number;
    active: number;
    /** Seconds until the next scheduler tick. */
    nextTickIn: number;
  };
  capacity: { perTick: number; neededPerTick: number; sufficient: boolean };
  ticks: Tick[];
  collects: CollectRun[];
  arrivals: ArrivalBucket[];
  lastScheduleAt: number | null;
  lastCollectAt: number | null;
  lastArticleAt: number | null;
};

function counts(json: string | null): Record<string, number> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export async function loadPulse(env: Env): Promise<Pulse> {
  const now = Math.floor(Date.now() / 1000);

  const [sweep, ticksRows, collectRows, arrivalRows, lastArticle] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS active,
              SUM(CASE WHEN consecutive_failures = 0 AND last_fetched_at IS NOT NULL
                       THEN 1 ELSE 0 END) AS healthy,
              SUM(CASE WHEN next_poll_at <= ?1 THEN 1 ELSE 0 END) AS due_now,
              SUM(CASE WHEN next_poll_at <= ?1 - ?2 THEN 1 ELSE 0 END) AS overdue,
              AVG(CASE WHEN consecutive_failures = 0 AND last_fetched_at IS NOT NULL
                       THEN ?1 - last_fetched_at END) AS mean_age,
              MAX(CASE WHEN consecutive_failures = 0 AND last_fetched_at IS NOT NULL
                       THEN ?1 - last_fetched_at END) AS worst_age,
              SUM(CASE WHEN consecutive_failures = 0 AND last_fetched_at IS NOT NULL
                        AND ?1 - last_fetched_at <= ?2 THEN 1 ELSE 0 END) AS within
         FROM sources WHERE active = 1`,
    )
      .bind(now, POLL_INTERVAL_SECONDS)
      .first<{
        active: number;
        healthy: number;
        due_now: number;
        overdue: number;
        mean_age: number | null;
        worst_age: number | null;
        within: number;
      }>(),

    env.DB.prepare(
      `SELECT started_at, ended_at, counts_json FROM runs
        WHERE stage = 'schedule' ORDER BY id DESC LIMIT 20`,
    ).all<{ started_at: number; ended_at: number | null; counts_json: string | null }>(),

    env.DB.prepare(
      `SELECT started_at, ended_at, counts_json FROM runs
        WHERE stage = 'collect' ORDER BY id DESC LIMIT 20`,
    ).all<{ started_at: number; ended_at: number | null; counts_json: string | null }>(),

    // Arrivals per minute for the last half hour, so a stall is visible as a
    // gap rather than having to be inferred from a single number.
    env.DB.prepare(
      `SELECT (?1 - fetched_at) / 60 AS minutes_ago, COUNT(*) AS n
         FROM articles WHERE fetched_at >= ?1 - 1800
        GROUP BY minutes_ago ORDER BY minutes_ago ASC`,
    )
      .bind(now)
      .all<{ minutes_ago: number; n: number }>(),

    env.DB.prepare(`SELECT MAX(fetched_at) AS t FROM articles`).first<{ t: number | null }>(),
  ]);

  const ticks: Tick[] = (ticksRows.results ?? []).map((r) => {
    const c = counts(r.counts_json);
    return {
      startedAt: r.started_at,
      durationSeconds: Math.max(0, (r.ended_at ?? r.started_at) - r.started_at),
      dispatched: c.dispatched ?? 0,
      limit: c.limit ?? null,
    };
  });

  const collects: CollectRun[] = (collectRows.results ?? []).map((r) => {
    const c = counts(r.counts_json);
    return {
      startedAt: r.started_at,
      durationSeconds: Math.max(0, (r.ended_at ?? r.started_at) - r.started_at),
      fetched: c.fetched ?? 0,
      inserted: c.inserted ?? 0,
      unchanged: c.unchanged ?? 0,
      failed: c.failed ?? 0,
    };
  });

  const byMinute = new Map((arrivalRows.results ?? []).map((r) => [r.minutes_ago, r.n]));
  const arrivals: ArrivalBucket[] = [];
  for (let m = 29; m >= 0; m--) arrivals.push({ minute: m, articles: byMinute.get(m) ?? 0 });

  const active = sweep?.active ?? 0;
  const neededPerTick = Math.ceil(active / 2);
  const perTick = Math.min(400, Math.max(60, Math.ceil(neededPerTick * 1.25)));

  return {
    now,
    sweep: {
      dueNow: sweep?.due_now ?? 0,
      overdue: sweep?.overdue ?? 0,
      meanAge: Math.round(sweep?.mean_age ?? 0),
      worstAge: sweep?.worst_age ?? 0,
      withinInterval: sweep?.within ?? 0,
      healthy: sweep?.healthy ?? 0,
      active,
      // Cron fires on the minute, so the next tick is however long is left of it.
      nextTickIn: 60 - (now % 60),
    },
    capacity: { perTick, neededPerTick, sufficient: perTick >= neededPerTick },
    ticks,
    collects,
    arrivals,
    lastScheduleAt: ticks[0]?.startedAt ?? null,
    lastCollectAt: collects[0]?.startedAt ?? null,
    lastArticleAt: lastArticle?.t ?? null,
  };
}
