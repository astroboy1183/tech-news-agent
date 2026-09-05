/**
 * Front-page composition.
 *
 * The page is built from clusters, not articles. That is the whole point of
 * v0.3.0: six outlets filing the Nexus Mods/SteamDB acquisition is one story
 * that six newsrooms thought worth covering, and both halves of that sentence
 * belong on the page. Composing from articles instead would print it six
 * times and lose the corroboration that makes it the lead.
 */

import { SECTIONS, type Section } from "./classify";
import { type FrontPageCounts, SECTION_LABELS, type SectionBlock, type Story } from "./sections";

export type { SectionBlock, Story } from "./sections";
export { SECTION_LABELS } from "./sections";

export type FrontPage = {
  lead: Story | null;
  hero: Story[];
  across: Story[];
  sections: SectionBlock[];
  latest: Story[];
  counts: FrontPageCounts;
};

type ClusterRow = {
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
};

const SELECT = `
  SELECT c.id, c.headline, c.section, c.source_count, c.velocity, c.score,
         c.first_seen_at, c.last_seen_at,
         a.url_canonical, a.excerpt, a.image_url, a.published_at
    FROM clusters c
    JOIN articles a ON a.id = c.primary_article_id`;

function toStory(row: ClusterRow, sources: string[]): Story {
  return {
    id: row.id,
    headline: row.headline,
    url: row.url_canonical,
    excerpt: row.excerpt,
    imageUrl: row.image_url,
    section: row.section,
    sourceCount: row.source_count,
    sources,
    velocity: row.velocity,
    score: row.score,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    publishedAt: row.published_at,
  };
}

/** D1 refuses a statement carrying more than 100 bound parameters. */
const ID_CHUNK = 80;

/** Outlet names per cluster, best-scoring article first. */
async function loadSources(env: Env, clusterIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (clusterIds.length === 0) return out;

  const chunks: number[][] = [];
  for (let i = 0; i < clusterIds.length; i += ID_CHUNK) {
    chunks.push(clusterIds.slice(i, i + ID_CHUNK));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      env.DB.prepare(
        `SELECT a.cluster_id, s.name, MAX(a.heuristic_score) AS best
           FROM articles a JOIN sources s ON s.id = a.source_id
          WHERE a.cluster_id IN (${chunk.map(() => "?").join(",")})
          GROUP BY a.cluster_id, s.name
          ORDER BY best DESC`,
      )
        .bind(...chunk)
        .all<{ cluster_id: number; name: string }>(),
    ),
  );

  for (const rows of results) {
    for (const row of rows.results ?? []) {
      const list = out.get(row.cluster_id);
      if (list) list.push(row.name);
      else out.set(row.cluster_id, [row.name]);
    }
  }
  return out;
}

export async function composeFrontPage(env: Env): Promise<FrontPage> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - 3 * 86400;

  // Corroboration is worth real weight in the ordering, not just a label: a
  // story four newsrooms ran outranks a slightly higher-scoring one that only
  // a single blog posted.
  const pool = await env.DB.prepare(
    `${SELECT}
      WHERE c.last_seen_at > ?
      ORDER BY (c.score + (c.source_count - 1) * 6.0) DESC
      LIMIT 300`,
  )
    .bind(since)
    .all<ClusterRow>();

  const rows = pool.results ?? [];
  const sourceMap = await loadSources(
    env,
    rows.slice(0, 140).map((r) => r.id),
  );
  const candidates = rows.map((r) => toStory(r, sourceMap.get(r.id) ?? []));

  const used = new Set<number>();
  const take = (story: Story | undefined): Story | undefined => {
    if (!story) return undefined;
    used.add(story.id);
    return story;
  };
  const available = () => candidates.filter((s) => !used.has(s.id));

  const lead = take(available()[0]) ?? null;

  // The top of the page never runs three versions of one subject: hero and
  // across both skip sections already spoken for above them.
  const spoken = new Set<string>(lead ? [lead.section] : []);
  const fill = (count: number): Story[] => {
    const out: Story[] = [];
    for (const story of available()) {
      if (out.length >= count) break;
      if (spoken.has(story.section)) continue;
      spoken.add(story.section);
      const taken = take(story);
      if (taken) out.push(taken);
    }
    return out;
  };

  const hero = fill(2);
  const across = fill(4);

  const sections: SectionBlock[] = SECTIONS.map((section) => ({
    section,
    label: SECTION_LABELS[section],
    stories: available()
      .filter((s) => s.section === section)
      .slice(0, 5)
      .map((s) => take(s) as Story),
  })).filter((block) => block.stories.length > 0);

  const latestRows = await env.DB.prepare(
    `${SELECT} ORDER BY c.last_seen_at DESC LIMIT 14`,
  ).all<ClusterRow>();
  const latest = (latestRows.results ?? []).map((r) => toStory(r, sourceMap.get(r.id) ?? []));

  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM articles) AS articles,
            (SELECT COUNT(*) FROM articles WHERE fetched_at > ?1) AS today,
            (SELECT COUNT(*) FROM clusters) AS stories,
            (SELECT COUNT(*) FROM clusters WHERE source_count > 1) AS corroborated,
            (SELECT COUNT(*) FROM sources WHERE active = 1) AS sources`,
  )
    .bind(now - 86400)
    .first<{
      articles: number;
      today: number;
      stories: number;
      corroborated: number;
      sources: number;
    }>();

  return {
    lead,
    hero,
    across,
    sections,
    latest,
    counts: {
      articles: counts?.articles ?? 0,
      today: counts?.today ?? 0,
      stories: counts?.stories ?? 0,
      corroborated: counts?.corroborated ?? 0,
      sources: counts?.sources ?? 0,
    },
  };
}

/** One section's stories, for /s/:section. */
export async function composeSection(
  env: Env,
  section: Section,
  limit = 40,
): Promise<{ lead: Story | null; stories: Story[] }> {
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const pool = await env.DB.prepare(
    `${SELECT}
      WHERE c.section = ? AND c.last_seen_at > ?
      ORDER BY (c.score + (c.source_count - 1) * 6.0) DESC
      LIMIT ?`,
  )
    .bind(section, since, limit)
    .all<ClusterRow>();

  const rows = pool.results ?? [];
  const sourceMap = await loadSources(
    env,
    rows.map((r) => r.id),
  );
  const stories = rows.map((r) => toStory(r, sourceMap.get(r.id) ?? []));
  return { lead: stories[0] ?? null, stories: stories.slice(1) };
}
