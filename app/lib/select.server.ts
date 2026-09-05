/**
 * Choosing what gets summarized.
 *
 * The budget buys a few hundred summaries a day against a few hundred new
 * stories, so this is a rationing problem, and ranking by score alone gets it
 * wrong: AI and hardware produce the loudest headlines, so a pure merit order
 * would summarize those two sections and leave Science and Cloud permanently
 * blank. A portal with two well-covered sections is not a portal.
 *
 * So every section is guaranteed a floor of its own each day, and only what is
 * left over is competed for on merit. A quiet section gets its stories
 * summarized even when they would never win an open ranking; a loud one still
 * takes most of the pool, because most of the news really is there.
 */

import { ESTIMATED_SUMMARY_MICROS, readSpend } from "./budget.server";
import { SECTIONS } from "./classify";

/** Guaranteed summaries per section per day, before merit. */
const SECTION_FLOOR = 10;

/** Ceiling per tick, so one burst cannot drain the day's budget in a minute. */
const PER_TICK = 12;

/** Stories older than this are not worth paying to summarize. */
const MAX_AGE_SECONDS = 36 * 3600;

export type Candidate = {
  id: number;
  section: string;
  score: number;
  source_count: number;
  last_seen_at: number;
};

export type Selection = {
  chosen: Candidate[];
  reason: "ok" | "budget-exhausted" | "nothing-eligible";
  affordable: number;
  remainingMicros: number;
};

export async function selectForSummary(env: Env): Promise<Selection> {
  const spend = await readSpend(env);
  const affordable = Math.floor(spend.remainingMicros / ESTIMATED_SUMMARY_MICROS);
  if (affordable <= 0) {
    return {
      chosen: [],
      reason: "budget-exhausted",
      affordable: 0,
      remainingMicros: spend.remainingMicros,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const since = now - MAX_AGE_SECONDS;

  // Corroboration counts here as it does on the front page: a story four
  // newsrooms ran is likelier to be worth the spend than a higher-scoring one
  // only a single blog posted.
  const pool = await env.DB.prepare(
    `SELECT c.id, c.section, c.score, c.source_count, c.last_seen_at
       FROM clusters c
       LEFT JOIN enrichments e ON e.cluster_id = c.id
      WHERE e.cluster_id IS NULL
        AND c.last_seen_at >= ?
      ORDER BY (c.score + (c.source_count - 1) * 8.0)
               * POW(0.5, (unixepoch() - c.last_seen_at) / 86400.0) DESC
      LIMIT 300`,
  )
    .bind(since)
    .all<Candidate>();

  const candidates = pool.results ?? [];
  if (candidates.length === 0) {
    return {
      chosen: [],
      reason: "nothing-eligible",
      affordable,
      remainingMicros: spend.remainingMicros,
    };
  }

  // How much of each section's floor today has already used up.
  const dayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
  const doneRows = await env.DB.prepare(
    `SELECT section, COUNT(*) AS n FROM enrichments
      WHERE created_at >= ? GROUP BY section`,
  )
    .bind(dayStart)
    .all<{ section: string; n: number }>();
  const done = new Map((doneRows.results ?? []).map((r) => [r.section, r.n]));

  const budget = Math.min(PER_TICK, affordable);
  const chosen: Candidate[] = [];
  const taken = new Set<number>();

  // Pass one — sections still short of their floor, best story first in each.
  // Round-robin rather than section-by-section, so a tick that runs out of
  // budget has still touched several sections instead of filling one.
  const bySection = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = bySection.get(c.section);
    if (list) list.push(c);
    else bySection.set(c.section, [c]);
  }

  const shortfall = new Map<string, number>();
  for (const section of SECTIONS) {
    const already = done.get(section) ?? 0;
    if (already < SECTION_FLOOR) shortfall.set(section, SECTION_FLOOR - already);
  }

  let progressed = true;
  while (chosen.length < budget && progressed) {
    progressed = false;
    for (const [section, remaining] of shortfall) {
      if (chosen.length >= budget) break;
      if (remaining <= 0) continue;
      const next = bySection.get(section)?.find((c) => !taken.has(c.id));
      if (!next) continue;
      taken.add(next.id);
      chosen.push(next);
      shortfall.set(section, remaining - 1);
      progressed = true;
    }
  }

  // Pass two — whatever budget is left goes to the best stories anywhere.
  for (const candidate of candidates) {
    if (chosen.length >= budget) break;
    if (taken.has(candidate.id)) continue;
    taken.add(candidate.id);
    chosen.push(candidate);
  }

  return { chosen, reason: "ok", affordable, remainingMicros: spend.remainingMicros };
}

/** Hand the selection to the enrich queue, one message per story. */
export async function dispatchForSummary(env: Env): Promise<{
  queued: number;
  reason: Selection["reason"];
  remainingMicros: number;
}> {
  const selection = await selectForSummary(env);
  if (selection.chosen.length > 0) {
    await env.ENRICH_Q.sendBatch(selection.chosen.map((c) => ({ body: { clusterId: c.id } })));
  }
  return {
    queued: selection.chosen.length,
    reason: selection.reason,
    remainingMicros: selection.remainingMicros,
  };
}
