/**
 * One story, and the record of how it reached us.
 *
 * The arrival timeline is the part worth having. A cluster knows which outlet
 * filed first and how the rest followed, which is ordinary provenance a normal
 * aggregator throws away — and it answers the question a reader of an
 * aggregated page actually has: who reported this, and who is just repeating it?
 */

import { type Story, usableExcerpt } from "./sections";

export type Arrival = {
  articleId: number;
  title: string;
  url: string;
  sourceName: string;
  sourceHomepage: string | null;
  publishedAt: number | null;
  fetchedAt: number;
  /** Seconds after the first outlet filed. 0 for the one that broke it. */
  afterFirst: number;
};

export type StoryPage = {
  story: Story;
  arrivals: Arrival[];
  related: Story[];
};

const STORY_SELECT = `
  SELECT c.id, c.headline, c.section, c.source_count, c.velocity, c.score,
         c.first_seen_at, c.last_seen_at,
         a.url_canonical, a.excerpt, a.image_url, a.published_at,
         e.summary, e.why_it_matters, e.topics_json
    FROM clusters c
    JOIN articles a ON a.id = c.primary_article_id
    LEFT JOIN enrichments e ON e.cluster_id = c.id`;

type Row = {
  id: number;
  headline: string;
  section: string;
  source_count: number;
  velocity: number;
  score: number;
  first_seen_at: number;
  last_seen_at: number;
  url_canonical: string;
  excerpt: string | null;
  image_url: string | null;
  published_at: number | null;
  summary: string | null;
  why_it_matters: string | null;
  topics_json: string | null;
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

function toStory(row: Row, sources: string[]): Story {
  return {
    id: row.id,
    headline: row.headline,
    url: row.url_canonical,
    excerpt: usableExcerpt(row.excerpt),
    imageUrl: row.image_url,
    section: row.section,
    summary: row.summary,
    whyItMatters: row.why_it_matters,
    topics: topics(row.topics_json),
    sourceCount: row.source_count,
    sources,
    velocity: row.velocity,
    score: row.score,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    publishedAt: row.published_at,
  };
}

export async function loadStory(env: Env, clusterId: number): Promise<StoryPage | null> {
  const row = await env.DB.prepare(`${STORY_SELECT} WHERE c.id = ?`).bind(clusterId).first<Row>();
  if (!row) return null;

  const memberRows = await env.DB.prepare(
    `SELECT a.id, a.title, a.url_canonical, a.published_at, a.fetched_at,
            s.name AS source_name, s.homepage
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.cluster_id = ?
      ORDER BY COALESCE(a.published_at, a.fetched_at) ASC`,
  )
    .bind(clusterId)
    .all<{
      id: number;
      title: string;
      url_canonical: string;
      published_at: number | null;
      fetched_at: number;
      source_name: string;
      homepage: string | null;
    }>();

  const members = memberRows.results ?? [];
  const first = members[0] ? (members[0].published_at ?? members[0].fetched_at) : 0;
  const arrivals: Arrival[] = members.map((m) => ({
    articleId: m.id,
    title: m.title,
    url: m.url_canonical,
    sourceName: m.source_name,
    sourceHomepage: m.homepage || null,
    publishedAt: m.published_at,
    fetchedAt: m.fetched_at,
    afterFirst: Math.max(0, (m.published_at ?? m.fetched_at) - first),
  }));

  // Same section, recent, not this story — enough to keep reading.
  const relatedRows = await env.DB.prepare(
    `${STORY_SELECT}
      WHERE c.section = ? AND c.id != ? AND c.last_seen_at > ?
      ORDER BY (c.score + (c.source_count - 1) * 6.0)
               * POW(0.5, (unixepoch() - c.last_seen_at) / 86400.0) DESC
      LIMIT 6`,
  )
    .bind(row.section, clusterId, Math.floor(Date.now() / 1000) - 5 * 86400)
    .all<Row>();

  return {
    story: toStory(
      row,
      arrivals.map((a) => a.sourceName),
    ),
    arrivals,
    related: (relatedRows.results ?? []).map((r) => toStory(r, [])),
  };
}
