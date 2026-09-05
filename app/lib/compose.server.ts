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
import { chooseLead, currentPin, type Rejection, readLeadHistory, recordLead } from "./lead.server";
import {
  type FrontPageCounts,
  SECTION_LABELS,
  type SectionBlock,
  type Story,
  usableExcerpt,
} from "./sections";

export type { SectionBlock, Story } from "./sections";
export { SECTION_LABELS } from "./sections";

export type FrontPage = {
  lead: Story | null;
  /** True when an editor pinned this lead rather than the gates choosing it. */
  leadPinned: boolean;
  /** Why the stories above the chosen lead were passed over. */
  leadRejections: Rejection[];
  composedAt: number;
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
  summary: string | null;
  why_it_matters: string | null;
  topics_json: string | null;
};

/**
 * How a story is ranked.
 *
 * Cluster scores are computed when the cluster is written and never change, so
 * ordering on them alone means a story that scored well two days ago still
 * outranks this morning's news forever. The front page filled with stale
 * high-scorers and the lead gates were left rejecting every good story for
 * being old — the age gate was papering over a missing decay term.
 *
 * Corroboration is added before the decay, not after: several newsrooms
 * agreeing is a durable fact about a story, while its urgency is not.
 *
 * Halving every 24 hours, measured from the most recent arrival, so a story
 * still being filed stays fresh while one nobody has touched since yesterday
 * falls away.
 */
const RANK = `(c.score + (c.source_count - 1) * 6.0)
              * POW(0.5, (unixepoch() - c.last_seen_at) / 86400.0)`;

const SELECT = `
  SELECT c.id, c.headline, c.section, c.source_count, c.velocity, c.score,
         c.first_seen_at, c.last_seen_at,
         a.url_canonical, a.excerpt, a.image_url, a.published_at,
         e.summary, e.why_it_matters, e.topics_json
    FROM clusters c
    JOIN articles a ON a.id = c.primary_article_id
    LEFT JOIN enrichments e ON e.cluster_id = c.id`;

function parseTopics(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function toStory(row: ClusterRow, sources: string[]): Story {
  return {
    id: row.id,
    headline: row.headline,
    url: row.url_canonical,
    excerpt: usableExcerpt(row.excerpt),
    imageUrl: row.image_url,
    section: row.section,
    summary: row.summary,
    whyItMatters: row.why_it_matters,
    topics: parseTopics(row.topics_json),
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

/**
 * How long a composed front page is served from KV.
 *
 * Short on purpose. Sources are polled every two minutes and clustering runs
 * every minute, so a ten-minute cache would routinely serve a page older than
 * the news it describes — which is the one thing this portal is meant not to
 * do. Ninety seconds removes nearly all the database work without the page
 * ever being visibly behind.
 */
const CACHE_TTL_SECONDS = 90;
const CACHE_KEY = "frontpage:v1";
const COUNTS_KEY = "counts:v1";

/** The cached front page, composing it only when the cache is cold. */
export async function frontPage(env: Env): Promise<FrontPage & { cached: boolean }> {
  const hit = await env.CACHE.get(CACHE_KEY);
  if (hit) {
    try {
      return { ...(JSON.parse(hit) as FrontPage), cached: true };
    } catch {
      /* a corrupt cache entry is a reason to recompose, not to fail */
    }
  }
  const page = await composeFrontPage(env);
  await env.CACHE.put(CACHE_KEY, JSON.stringify(page), {
    expirationTtl: CACHE_TTL_SECONDS,
  });
  return { ...page, cached: false };
}

/**
 * Masthead numbers only.
 *
 * Every page shows these, and the section and live pages were composing an
 * entire front page — three hundred clusters and their outlet lists — purely
 * to fill five figures in a header.
 */
export async function siteCounts(env: Env): Promise<FrontPageCounts> {
  const cached = await env.CACHE.get(COUNTS_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as FrontPageCounts;
    } catch {
      /* recompute rather than fail on a corrupt entry */
    }
  }
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM articles) AS articles,
            (SELECT COUNT(*) FROM articles WHERE fetched_at > ?1) AS today,
            (SELECT COUNT(*) FROM clusters) AS stories,
            (SELECT COUNT(*) FROM clusters WHERE source_count > 1) AS corroborated,
            (SELECT COUNT(*) FROM sources WHERE active = 1) AS sources,
            (SELECT COUNT(*) FROM enrichments) AS summarized`,
  )
    .bind(Math.floor(Date.now() / 1000) - 86400)
    .first<FrontPageCounts>();

  const counts: FrontPageCounts = {
    articles: row?.articles ?? 0,
    today: row?.today ?? 0,
    stories: row?.stories ?? 0,
    corroborated: row?.corroborated ?? 0,
    sources: row?.sources ?? 0,
    summarized: row?.summarized ?? 0,
  };
  await env.CACHE.put(COUNTS_KEY, JSON.stringify(counts), { expirationTtl: 90 });
  return counts;
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
      ORDER BY ${RANK} DESC
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

  const [history, pinnedId] = await Promise.all([readLeadHistory(env), currentPin(env, now)]);
  const choice = chooseLead(candidates, history, pinnedId, now);
  const lead = choice.lead ? (take(choice.lead) ?? null) : null;
  if (lead) await recordLead(env, lead.id, now);

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
            (SELECT COUNT(*) FROM sources WHERE active = 1) AS sources,
            (SELECT COUNT(*) FROM enrichments) AS summarized`,
  )
    .bind(now - 86400)
    .first<{
      articles: number;
      today: number;
      stories: number;
      corroborated: number;
      sources: number;
      summarized: number;
    }>();

  return {
    lead,
    leadPinned: choice.pinned,
    leadRejections: choice.rejected.slice(0, 12),
    composedAt: now,
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
      summarized: counts?.summarized ?? 0,
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
      ORDER BY ${RANK} DESC
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
