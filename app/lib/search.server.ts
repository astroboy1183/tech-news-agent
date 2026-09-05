/**
 * Full-text search over everything collected.
 *
 * Results are grouped to stories rather than articles, for the same reason the
 * front page is: searching "steamdb" should return the acquisition once, with
 * the six outlets that covered it, not six rows saying the same thing.
 */

import type { Story } from "./sections";

export type SearchHit = Story & {
  /** The matching text with the query terms marked, for highlighting. */
  snippet: string;
  matchCount: number;
};

/**
 * FTS5's query language is exposed directly to whatever a reader types, and
 * almost every punctuation mark means something in it — a stray quote or a
 * bare `-` is a syntax error, and `NEAR` or `*` would let a search box drive
 * the query planner. So the input is not escaped, it is discarded: words and
 * numbers are extracted and requoted, and nothing else survives.
 *
 * The final token gets a prefix match, so "postgr" finds Postgres while the
 * reader is still typing.
 */
export function toFtsQuery(raw: string): string | null {
  const tokens = raw.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._+-]*/gu);
  if (!tokens || tokens.length === 0) return null;

  const cleaned = tokens
    .map((t) => t.replace(/["]/g, "").replace(/[-+.]+$/, ""))
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (cleaned.length === 0) return null;

  return cleaned
    .map((token, i) =>
      i === cleaned.length - 1 && token.length >= 3 ? `"${token}"*` : `"${token}"`,
    )
    .join(" AND ");
}

type Row = {
  cluster_id: number | null;
  article_id: number;
  headline: string;
  section: string;
  url_canonical: string;
  excerpt: string | null;
  image_url: string | null;
  published_at: number | null;
  fetched_at: number;
  source_name: string;
  source_count: number | null;
  summary: string | null;
  why_it_matters: string | null;
  topics_json: string | null;
  snippet: string;
};

function topics(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export async function search(
  env: Env,
  query: string,
  options: { section?: string; limit?: number } = {},
): Promise<{ hits: SearchHit[]; total: number; parsed: string | null }> {
  const parsed = toFtsQuery(query);
  if (!parsed) return { hits: [], total: 0, parsed: null };

  const limit = Math.min(options.limit ?? 40, 100);
  const sectionFilter = options.section ? "AND a.section = ?3" : "";

  // bm25 ranks by relevance; recency then breaks ties the way a news reader
  // expects, so last week's exact match does not bury today's.
  const rows = await env.DB.prepare(
    `SELECT a.cluster_id, a.id AS article_id,
            COALESCE(c.headline, a.title) AS headline,
            COALESCE(c.section, a.section) AS section,
            a.url_canonical, a.excerpt, a.image_url, a.published_at, a.fetched_at,
            s.name AS source_name, c.source_count,
            e.summary, e.why_it_matters, e.topics_json,
            snippet(articles_fts, -1, '[[', ']]', '…', 14) AS snippet
       FROM articles_fts
       JOIN articles a ON a.id = articles_fts.rowid
       JOIN sources s ON s.id = a.source_id
       LEFT JOIN clusters c ON c.id = a.cluster_id
       LEFT JOIN enrichments e ON e.cluster_id = a.cluster_id
      WHERE articles_fts MATCH ?1 ${sectionFilter}
      ORDER BY bm25(articles_fts) + (unixepoch() - a.fetched_at) / 864000.0 ASC
      LIMIT ?2`,
  )
    .bind(...(options.section ? [parsed, limit * 3, options.section] : [parsed, limit * 3]))
    .all<Row>();

  // One row per story: the best-ranked article stands for its cluster.
  const seen = new Map<string, SearchHit>();
  for (const row of rows.results ?? []) {
    const key = row.cluster_id ? `c${row.cluster_id}` : `a${row.article_id}`;
    const existing = seen.get(key);
    if (existing) {
      existing.matchCount++;
      continue;
    }
    seen.set(key, {
      id: row.cluster_id ?? row.article_id,
      headline: row.headline,
      url: row.url_canonical,
      excerpt: row.excerpt,
      imageUrl: row.image_url,
      section: row.section,
      summary: row.summary,
      whyItMatters: row.why_it_matters,
      topics: topics(row.topics_json),
      sourceCount: row.source_count ?? 1,
      sources: [row.source_name],
      velocity: 0,
      score: 0,
      firstSeenAt: row.fetched_at,
      lastSeenAt: row.fetched_at,
      publishedAt: row.published_at,
      snippet: row.snippet,
      matchCount: 1,
    });
    if (seen.size >= limit) break;
  }

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM articles_fts WHERE articles_fts MATCH ?1`,
  )
    .bind(parsed)
    .first<{ n: number }>();

  return { hits: [...seen.values()], total: total?.n ?? 0, parsed };
}
