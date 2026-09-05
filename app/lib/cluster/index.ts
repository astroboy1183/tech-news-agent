/**
 * Clustering — group the same news event across outlets.
 *
 * This is the step that makes the budget work. Eight outlets covering one
 * announcement become one cluster, and the summarizer then spends a single
 * Claude call on all eight rather than eight calls. Everything downstream
 * (front-page composition, corroboration scoring, velocity) reads clusters,
 * not articles.
 *
 * Three tiers, cheapest first:
 *
 *  1. LEXICAL (free). Trigram overlap on titles. Measured: reliable only above
 *     0.72, where it catches syndication and near-identical reposts. It cannot
 *     see rewording at all — a reworded pair scored 0.198, *below* two
 *     genuinely different pairs — so it is a fast path, never a filter.
 *  2. IDENTIFIER GUARD (free). Refuses any merge where both titles name
 *     different versions, CVEs or model numbers. This is what makes tier 3
 *     safe; see discriminators.ts.
 *  3. SEMANTIC (cheap). bge-small embeddings resolved through Vectorize,
 *     within one section and a 48-hour window. Measured cosines put every
 *     genuinely-same pair at 0.783 or above and every surviving different pair
 *     at 0.764 or below.
 *
 * Thresholds and the evidence for them: docs/CLUSTERING.md.
 */

import { isBoilerplate } from "./boilerplate";
import { discriminatorsConflict } from "./discriminators";
import { compareFingerprints, fingerprint, type TitleFingerprint } from "./similarity";

/** Stories older than this are settled; nothing new joins them. */
const WINDOW_SECONDS = 48 * 3600;

/**
 * Cosine at or above this is one story.
 *
 * Set from live data rather than the synthetic probes. Re-measuring the real
 * pairs the first run produced put the one clear false merge — an HBM roadmap
 * piece against a Linux virtual-memory explainer, colliding on "memory" — at
 * 0.817, while the two weakest merges worth keeping (Google/Apple Maps on one
 * renaming, two HBM roadmap stories) sat at 0.841 and 0.838. 0.83 is the cut
 * between them.
 *
 * The recall this gives up costs a duplicate on the page. A false merge hides
 * a story completely, so that is the cheap direction to be wrong in, and every
 * threshold here leans the same way.
 */
const MERGE_THRESHOLD = 0.83;

/** Articles handled per pass. A minute of arrivals, with headroom. */
const BATCH_SIZE = 40;

/**
 * How far back clusters are compared in memory rather than through Vectorize.
 *
 * The index is eventually consistent, so a cluster opened moments ago may not
 * be findable yet — and coverage of one event arrives in a burst, which is
 * precisely that window. Three hours covers the burst comfortably while
 * keeping the number of vectors loaded per pass in the low hundreds.
 */
const HOT_SECONDS = 3 * 3600;

/**
 * Ceiling on clusters compared in memory. Steady state sits far below this —
 * roughly a hundred and fifty clusters open in three hours — but a backlog
 * being worked through opens thousands at once, all stamped with the same
 * `last_seen_at`. Each carries a 2 KB vector, so the cap is what stops one
 * unusual pass from loading megabytes.
 */
const HOT_LIMIT = 400;

/**
 * Nearest neighbours to consider.
 *
 * Generous because the index outlives the window: it holds vectors for
 * clusters that have since closed, and a popular story leaves several of them
 * scoring highly. Ten slots were filled by those before a live cluster could
 * be reached. pruneVectors keeps the residue bounded; this keeps a busy story
 * findable in the meantime.
 */
const TOP_K = 25;

/**
 * Vectorize lookups in flight at once.
 *
 * Run one after another these were the entire cost of the pass: forty round
 * trips took 26 seconds, and the cron invocation was killed before it could
 * record anything at all.
 */
const QUERY_CONCURRENCY = 10;

const EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";

type PendingArticle = {
  id: number;
  title: string;
  section: string;
  source_id: number;
  published_at: number | null;
  fetched_at: number;
  heuristic_score: number;
};

type ClusterRow = {
  id: number;
  headline: string;
  section: string;
  first_seen_at: number;
  last_seen_at: number;
};

/** An open cluster with its headline pre-shingled for the pass. */
type OpenCluster = ClusterRow & { fingerprint: TitleFingerprint };

/** A cluster this pass is about to open, before it has an id. */
type FreshCluster = {
  seed: PendingArticle;
  vector: number[] | null;
  id: number | null;
};

/**
 * A cluster held in memory for direct comparison — either recently opened and
 * read back from D1, or opened by this very pass. `freshIndex` points into the
 * pass's own list for the latter, whose id does not exist yet.
 */
type HotCluster = {
  id: number | null;
  freshIndex: number | null;
  title: string;
  vector: number[];
  sources: Set<number>;
};

export type ClusterPassResult = {
  considered: number;
  joinedLexical: number;
  joinedSemantic: number;
  joinedRecent: number;
  joinedWithinBatch: number;
  created: number;
  blockedByGuard: number;
  boilerplate: number;
};

export async function runClusterPass(env: Env): Promise<ClusterPassResult> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - WINDOW_SECONDS;

  const pending = await env.DB.prepare(
    `SELECT id, title, section, source_id, published_at, fetched_at, heuristic_score
       FROM articles
      WHERE cluster_id IS NULL AND status = 'live' AND fetched_at >= ?
      ORDER BY COALESCE(published_at, fetched_at) ASC
      LIMIT ?`,
  )
    .bind(since, BATCH_SIZE)
    .all<PendingArticle>();

  const articles = pending.results ?? [];
  const result: ClusterPassResult = {
    considered: articles.length,
    joinedLexical: 0,
    joinedSemantic: 0,
    joinedRecent: 0,
    joinedWithinBatch: 0,
    created: 0,
    blockedByGuard: 0,
    boilerplate: 0,
  };
  if (articles.length === 0) return result;

  // Open clusters, held in memory for the pass. The vector index returns ids;
  // this map is what turns an id into a section and a headline to check.
  const openRows = await env.DB.prepare(
    `SELECT id, headline, section, first_seen_at, last_seen_at
       FROM clusters WHERE last_seen_at >= ?`,
  )
    .bind(since)
    .all<ClusterRow>();
  // Headlines are shingled once here rather than on every comparison.
  // Which outlets are already in each open cluster. One outlet never files the
  // same story twice, so this is the strongest false-merge guard available —
  // see the note on findLexicalMatch.
  const clusterSources = await loadClusterSources(env, since);

  const open = new Map<number, OpenCluster>();
  const openList: OpenCluster[] = [];
  for (const c of openRows.results ?? []) {
    const entry: OpenCluster = { ...c, fingerprint: fingerprint(c.headline) };
    open.set(c.id, entry);
    openList.push(entry);
  }

  const assignments: { articleId: number; clusterId: number }[] = [];
  const articleFingerprints: Record<number, TitleFingerprint> = {};
  for (const article of articles) articleFingerprints[article.id] = fingerprint(article.title);

  // Tier 1 — lexical. Free, so it runs first and shrinks the embedding batch.
  const unresolved: PendingArticle[] = [];
  for (const article of articles) {
    // Standing community furniture gets a cluster of its own and is never
    // offered as a match to anything else.
    if (isBoilerplate(article.title)) {
      const solo = await createSolo(env, article, now);
      if (solo) assignments.push({ articleId: article.id, clusterId: solo });
      result.boilerplate++;
      continue;
    }

    const hit = findLexicalMatch(
      article,
      articleFingerprints[article.id] as TitleFingerprint,
      openList,
      clusterSources,
    );
    if (hit === "blocked") result.blockedByGuard++;
    if (typeof hit === "number") {
      assignments.push({ articleId: article.id, clusterId: hit });
      result.joinedLexical++;
    } else {
      unresolved.push(article);
    }
  }

  if (unresolved.length > 0) {
    const vectors = await embed(
      env,
      unresolved.map((a) => a.title),
    );
    const neighbours = await mapWithConcurrency(vectors, QUERY_CONCURRENCY, (vector) =>
      vector ? env.VECTORS.query(vector, { topK: TOP_K }) : Promise.resolve(null),
    );

    // Recently opened clusters, compared directly instead of through the
    // index. This is what makes a burst of coverage cluster: the index cannot
    // be trusted to have caught up, and these are exactly the clusters an
    // arriving article is most likely to belong to.
    const hot: HotCluster[] = [];
    for (const row of (await loadHotClusters(env, now, clusterSources)).values()) hot.push(row);

    const fresh: FreshCluster[] = [];
    const deferred: { article: PendingArticle; freshIndex: number }[] = [];

    for (const [i, article] of unresolved.entries()) {
      const vector = vectors[i] ?? null;
      const match = pickMatch(article, neighbours[i] ?? null, open, clusterSources);
      if (match === "blocked") result.blockedByGuard++;

      if (typeof match === "number") {
        assignments.push({ articleId: article.id, clusterId: match });
        result.joinedSemantic++;
        continue;
      }

      const near = vector === null ? null : findInMemory(article, vector, hot);
      if (near) {
        near.sources.add(article.source_id);
        if (near.id !== null) {
          assignments.push({ articleId: article.id, clusterId: near.id });
          result.joinedRecent++;
        } else if (near.freshIndex !== null) {
          deferred.push({ article, freshIndex: near.freshIndex });
          result.joinedWithinBatch++;
        }
        continue;
      }

      fresh.push({ seed: article, vector, id: null });
      deferred.push({ article, freshIndex: fresh.length - 1 });
      if (vector) {
        hot.push({
          id: null,
          freshIndex: fresh.length - 1,
          title: article.title,
          vector,
          sources: new Set([article.source_id]),
        });
      }
    }

    // One round trip for every new cluster, instead of one each.
    await createClusters(env, fresh, now);
    result.created = fresh.length;

    for (const { article, freshIndex } of deferred) {
      const clusterId = fresh[freshIndex]?.id;
      if (clusterId) assignments.push({ articleId: article.id, clusterId });
    }

    // One upsert for the whole pass, likewise. Vectorize serves the tail
    // beyond HOT_SECONDS, where its indexing delay no longer matters.
    const seeds = fresh
      .filter((f) => f.id !== null && f.vector !== null)
      .map((f) => ({
        id: vectorId(f.id as number),
        values: f.vector as number[],
        metadata: { section: f.seed.section },
      }));
    if (seeds.length > 0) await env.VECTORS.upsert(seeds);
  }

  await applyAssignments(env, assignments);
  await refreshClusters(env, [...new Set(assignments.map((a) => a.clusterId))], now);
  return result;
}

/**
 * Trigram match against every open cluster. Returns a cluster id, "blocked"
 * when identifiers disagreed on an otherwise-strong match, or null when
 * nothing was close enough.
 */
function findLexicalMatch(
  article: PendingArticle,
  own: TitleFingerprint,
  candidates: OpenCluster[],
  clusterSources: Map<number, Set<number>>,
): number | "blocked" | null {
  let best: { id: number; score: number } | null = null;
  let blocked = false;

  for (const cluster of candidates) {
    if (sameSource(article, cluster.id, clusterSources)) continue;
    const { verdict, score } = compareFingerprints(own, cluster.fingerprint);
    if (verdict !== "same") continue;
    if (discriminatorsConflict(article.title, cluster.headline)) {
      blocked = true;
      continue;
    }
    if (!best || score > best.score) best = { id: cluster.id, score };
  }

  if (best) return best.id;
  return blocked ? "blocked" : null;
}

/** Best neighbour that clears the threshold, the section and the guard. */
function pickMatch(
  article: PendingArticle,
  neighbours: VectorizeMatches | null,
  open: Map<number, OpenCluster>,
  clusterSources: Map<number, Set<number>>,
): number | "blocked" | null {
  let blocked = false;
  for (const match of neighbours?.matches ?? []) {
    if (match.score < MERGE_THRESHOLD) break; // matches come back sorted
    const clusterId = Number(match.id.replace(/^c:/, ""));
    const cluster = open.get(clusterId);
    // Absent from the map means the cluster has closed — the vector index has
    // no notion of the window, so D1 is the authority on what is still open.
    //
    // Section is deliberately NOT checked. One story reaches us through feeds
    // that sit in different lanes: the Nexus Mods/SteamDB acquisition arrived
    // classified industry, gaming and consumer by six outlets, and requiring a
    // section match left it as six separate clusters. The section is a guess
    // about a feed; the cluster is the evidence. The cluster wins, and
    // refreshClusters re-derives the section from its members.
    if (!cluster) continue;
    if (sameSource(article, clusterId, clusterSources)) continue;
    if (discriminatorsConflict(article.title, cluster.headline)) {
      blocked = true;
      continue;
    }
    return clusterId;
  }
  return blocked ? "blocked" : null;
}

/** Closest in-memory cluster clearing the threshold and the guard, if any. */
function findInMemory(
  article: PendingArticle,
  vector: number[],
  hot: HotCluster[],
): HotCluster | null {
  let best: HotCluster | null = null;
  let bestScore = MERGE_THRESHOLD;

  for (const candidate of hot) {
    if (candidate.sources.has(article.source_id)) continue;
    const score = cosine(vector, candidate.vector);
    if (score < bestScore) continue;
    if (discriminatorsConflict(article.title, candidate.title)) continue;
    best = candidate;
    bestScore = score;
  }
  return best;
}

/**
 * One outlet does not file the same story twice.
 *
 * This is the single most effective false-merge guard measured. A newsroom
 * publishes serial content under one template — "Hot Chips 2026: <company>",
 * "Dev snapshot: Godot 4.8 dev <n>", "CISA Adds <n> Known Exploited
 * Vulnerabilities" — and to an embedding those headlines are nearly the same
 * sentence. Four separate Hot Chips talks landed in one cluster this way.
 *
 * Of 21 same-source merges in the first live spot-check, about 19 were wrong.
 * All 10 cross-source merges were right. Clustering exists to gather
 * corroboration across outlets, so declining same-source merges costs almost
 * nothing and removes almost every false merge.
 */
function sameSource(
  article: PendingArticle,
  clusterId: number,
  clusterSources: Map<number, Set<number>>,
): boolean {
  return clusterSources.get(clusterId)?.has(article.source_id) ?? false;
}

/** Which outlets already appear in each cluster inside the window. */
async function loadClusterSources(env: Env, since: number): Promise<Map<number, Set<number>>> {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT cluster_id, source_id
       FROM articles
      WHERE cluster_id IS NOT NULL AND fetched_at >= ?`,
  )
    .bind(since)
    .all<{ cluster_id: number; source_id: number }>();

  const out = new Map<number, Set<number>>();
  for (const row of rows.results ?? []) {
    const set = out.get(row.cluster_id);
    if (set) set.add(row.source_id);
    else out.set(row.cluster_id, new Set([row.source_id]));
  }
  return out;
}

/** Recent clusters with a stored seed vector, ready for direct comparison. */
async function loadHotClusters(
  env: Env,
  now: number,
  clusterSources: Map<number, Set<number>>,
): Promise<Map<number, HotCluster>> {
  const rows = await env.DB.prepare(
    `SELECT id, headline, seed_vector
       FROM clusters
      WHERE last_seen_at >= ? AND seed_vector IS NOT NULL
      ORDER BY last_seen_at DESC, id DESC
      LIMIT ?`,
  )
    .bind(now - HOT_SECONDS, HOT_LIMIT)
    .all<{ id: number; headline: string; seed_vector: string }>();

  const out = new Map<number, HotCluster>();
  for (const row of rows.results ?? []) {
    const vector = decodeVector(row.seed_vector);
    if (vector.length > 0) {
      out.set(row.id, {
        id: row.id,
        freshIndex: null,
        title: row.headline,
        vector,
        sources: new Set(clusterSources.get(row.id) ?? []),
      });
    }
  }
  return out;
}

/** Float32 little-endian, base64 — 384 dimensions in about 2 KB of text. */
function encodeVector(values: number[]): string {
  const bytes = new Uint8Array(new Float32Array(values).buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeVector(encoded: string): number[] {
  try {
    const binary = atob(encoded);
    if (binary.length % 4 !== 0) return [];
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return Array.from(new Float32Array(bytes.buffer));
  } catch {
    return [];
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const magnitude = Math.sqrt(na) * Math.sqrt(nb);
  return magnitude === 0 ? 0 : dot / magnitude;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

async function embed(env: Env, texts: string[]): Promise<(number[] | null)[]> {
  try {
    const response = (await env.AI.run(EMBEDDING_MODEL, { text: texts })) as {
      data?: number[][];
    };
    const data = response.data ?? [];
    return texts.map((_, i) => data[i] ?? null);
  } catch (error) {
    // A failed embedding is not a failed pass: every article still gets a
    // cluster of its own, and nothing is lost but some merging.
    console.warn(`embedding failed for ${texts.length} titles: ${String(error)}`);
    return texts.map(() => null);
  }
}

/** A cluster of exactly one article, for headlines that must never merge. */
async function createSolo(env: Env, article: PendingArticle, now: number): Promise<number | null> {
  const row = await env.DB.prepare(
    `INSERT INTO clusters
       (primary_article_id, headline, section, source_count, first_seen_at, last_seen_at, score)
     VALUES (?, ?, ?, 1, ?, ?, ?)
     RETURNING id`,
  )
    .bind(
      article.id,
      article.title,
      article.section,
      article.published_at ?? article.fetched_at,
      now,
      article.heuristic_score,
    )
    .first<{ id: number }>();
  return row?.id ?? null;
}

/** Creates one cluster per entry and writes the new ids back into `fresh`. */
async function createClusters(env: Env, fresh: FreshCluster[], now: number): Promise<void> {
  if (fresh.length === 0) return;
  const rows = await env.DB.batch<{ id: number }>(
    fresh.map(({ seed, vector }) =>
      env.DB.prepare(
        `INSERT INTO clusters
           (primary_article_id, headline, section, source_count, first_seen_at,
            last_seen_at, score, seed_vector)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)
         RETURNING id`,
      ).bind(
        seed.id,
        seed.title,
        seed.section,
        seed.published_at ?? seed.fetched_at,
        now,
        seed.heuristic_score,
        vector === null ? null : encodeVector(vector),
      ),
    ),
  );

  for (const [i, row] of rows.entries()) {
    const id = row.results?.[0]?.id;
    const entry = fresh[i];
    if (entry && id) entry.id = id;
  }
}

async function applyAssignments(
  env: Env,
  assignments: { articleId: number; clusterId: number }[],
): Promise<void> {
  if (assignments.length === 0) return;
  await env.DB.batch(
    assignments.map(({ articleId, clusterId }) =>
      env.DB.prepare(`UPDATE articles SET cluster_id = ? WHERE id = ?`).bind(clusterId, articleId),
    ),
  );
}

/**
 * Recompute what a cluster is worth from its members.
 *
 * Corroboration is the point: a story eight independent outlets ran is more
 * likely to matter than one a single blog posted, whatever either headline
 * claims. It saturates — the eighth outlet says much less than the second —
 * so it is scaled logarithmically rather than linearly.
 *
 * Velocity separates breaking news from slow accumulation. Five outlets within
 * an hour is a different event from five across two days, and only the first
 * deserves to interrupt the front page.
 */
async function refreshClusters(env: Env, clusterIds: number[], now: number): Promise<void> {
  if (clusterIds.length === 0) return;

  await env.DB.batch(
    clusterIds.map((id) =>
      env.DB.prepare(
        `WITH members AS (
           SELECT a.id, a.source_id, a.title, a.section, a.heuristic_score,
                  COALESCE(a.published_at, a.fetched_at) AS seen_at, a.fetched_at,
                  -- Aggregators repost other people's work, so they make poor
                  -- fronts for a story: their headline is someone else's and
                  -- their excerpt is usually "submitted by /u/...".
                  CASE WHEN s.kind IN ('reddit', 'hn') THEN 1 ELSE 0 END AS is_aggregator
             FROM articles a JOIN sources s ON s.id = a.source_id
            WHERE a.cluster_id = ?1
         ),
         agg AS (
           SELECT COUNT(DISTINCT source_id) AS sources,
                  MIN(seen_at)              AS first_seen,
                  MAX(fetched_at)           AS last_seen,
                  MAX(heuristic_score)      AS best_score
             FROM members
         )
         UPDATE clusters SET
           source_count  = (SELECT sources FROM agg),
           first_seen_at = (SELECT first_seen FROM agg),
           last_seen_at  = (SELECT last_seen FROM agg),
           headline      = COALESCE(
                             (SELECT title FROM members
                               ORDER BY is_aggregator ASC, heuristic_score DESC LIMIT 1),
                             headline),
           -- The story fronts with its best-scoring member, so the link, image
           -- and byline the page shows come from the outlet that told it best
           -- rather than merely first.
           primary_article_id = COALESCE(
                             (SELECT id FROM members
                               ORDER BY is_aggregator ASC, heuristic_score DESC LIMIT 1),
                             primary_article_id),
           -- The lane the story belongs in is whichever its members mostly
           -- agree on, not whichever outlet happened to file first.
           section       = COALESCE(
                             (SELECT section FROM members
                               GROUP BY section
                               ORDER BY COUNT(*) DESC, MAX(heuristic_score) DESC
                               LIMIT 1),
                             section),
           velocity      = (SELECT sources FROM agg)
                           / MAX((?2 - (SELECT first_seen FROM agg)) / 3600.0, 0.25),
           score         = (SELECT best_score FROM agg) * 0.70
                         + MIN(1.0, LOG2(MAX((SELECT sources FROM agg), 1)) / 3.0) * 20.0
                         + MIN(1.0, ((SELECT sources FROM agg)
                                     / MAX((?2 - (SELECT first_seen FROM agg)) / 3600.0, 0.25)) / 4.0)
                           * 10.0
         WHERE id = ?1`,
      ).bind(id, now),
    ),
  );
}

function vectorId(clusterId: number): string {
  return `c:${clusterId}`;
}

/** Vectorize rejects a delete carrying more than 100 ids. */
const PRUNE_BATCH = 100;

/** Retries per batch when Vectorize rate-limits a long prune, and the step. */
const PRUNE_RETRIES = 4;
const PRUNE_BACKOFF_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drop vectors that can no longer produce a merge.
 *
 * A seed vector exists only to match arrivals inside the 48-hour window. Once
 * a cluster ages out — or is deleted outright, as happens when clustering is
 * re-run after a rule change — its vector is dead weight that still competes
 * for the nearest-neighbour slots of every later query.
 *
 * Ids are dense (`c:<autoincrement>`), so the set to remove can be derived by
 * walking the range and subtracting what is still live, without needing to
 * have recorded what was written.
 */
export async function pruneVectors(
  env: Env,
): Promise<{ deleted: number; failed: number; reason?: string }> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - WINDOW_SECONDS;

  const highest = await env.DB.prepare(
    `SELECT seq FROM sqlite_sequence WHERE name = 'clusters'`,
  ).first<{ seq: number }>();
  if (!highest?.seq) return { deleted: 0, failed: 0 };

  const live = await env.DB.prepare(`SELECT id FROM clusters WHERE last_seen_at >= ?`)
    .bind(since)
    .all<{ id: number }>();
  const keep = new Set((live.results ?? []).map((r) => r.id));

  const stale: string[] = [];
  for (let id = 1; id <= highest.seq; id++) {
    if (!keep.has(id)) stale.push(vectorId(id));
  }

  let deleted = 0;
  let failed = 0;
  let reason: string | undefined;
  for (let i = 0; i < stale.length; i += PRUNE_BATCH) {
    const batch = stale.slice(i, i + PRUNE_BATCH);
    let attempt = 0;
    for (;;) {
      try {
        await env.VECTORS.deleteByIds(batch);
        deleted += batch.length;
        break;
      } catch (error) {
        // Vectorize rate-limits a long prune, which is expected rather than
        // exceptional: the nightly run deletes thousands of ids in sequence.
        // Back off and retry a few times before giving up on the batch.
        attempt++;
        if (attempt > PRUNE_RETRIES) {
          // Deleting an id that was never written is not worth failing over —
          // absent either way — but anything else must be visible rather than
          // silently counted as done.
          failed += batch.length;
          reason ??= String(error);
          console.warn(`vector prune batch failed: ${String(error)}`);
          break;
        }
        await sleep(PRUNE_BACKOFF_MS * attempt);
      }
    }
  }
  return { deleted, failed, reason };
}
