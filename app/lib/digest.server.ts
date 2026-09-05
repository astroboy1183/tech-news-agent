/**
 * The daily digest.
 *
 * A different object from the front page. The front page answers "what is
 * happening now" and is rebuilt every ninety seconds; the digest answers "what
 * did I miss since yesterday" and is written once. So it is composed over a
 * fixed 24-hour window rather than a decaying score, and it leans harder on
 * corroboration — for a once-a-day summary, the stories many newsrooms
 * independently thought worth covering are exactly the right filter.
 */

import { SECTIONS, type Section } from "./classify";
import { SECTION_LABELS, type Story, usableExcerpt } from "./sections";

/** Stories in the digest overall, and the most any one section may take. */
const MAX_STORIES = 18;
const MAX_PER_SECTION = 3;

export type Digest = {
  date: string;
  lead: Story | null;
  sections: { section: Section; label: string; stories: Story[] }[];
  counts: { stories: number; articles: number; corroborated: number };
};

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
};

function toStory(r: Row): Story {
  return {
    id: r.id,
    headline: r.headline,
    url: r.url_canonical,
    excerpt: usableExcerpt(r.excerpt),
    imageUrl: r.image_url,
    section: r.section,
    summary: r.summary,
    whyItMatters: r.why_it_matters,
    topics: [],
    sourceCount: r.source_count,
    sources: [],
    velocity: r.velocity,
    score: r.score,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    publishedAt: r.published_at,
  };
}

export async function composeDigest(env: Env, now = new Date()): Promise<Digest> {
  const end = Math.floor(now.getTime() / 1000);
  const start = end - 86400;

  const rows = await env.DB.prepare(
    `SELECT c.id, c.headline, c.section, c.source_count, c.velocity, c.score,
            c.first_seen_at, c.last_seen_at,
            a.url_canonical, a.excerpt, a.image_url, a.published_at,
            e.summary, e.why_it_matters
       FROM clusters c
       JOIN articles a ON a.id = c.primary_article_id
       LEFT JOIN enrichments e ON e.cluster_id = c.id
      WHERE c.first_seen_at >= ?1 AND c.first_seen_at < ?2
      ORDER BY (c.score + (c.source_count - 1) * 12.0) DESC
      LIMIT 200`,
  )
    .bind(start, end)
    .all<Row>();

  const stories = (rows.results ?? []).map(toStory);
  const lead = stories[0] ?? null;

  const used = new Set<number>(lead ? [lead.id] : []);
  const sections = SECTIONS.map((section) => {
    const picked: Story[] = [];
    for (const story of stories) {
      if (picked.length >= MAX_PER_SECTION) break;
      if (used.has(story.id) || story.section !== section) continue;
      used.add(story.id);
      picked.push(story);
    }
    return { section, label: SECTION_LABELS[section], stories: picked };
  }).filter((block) => block.stories.length > 0);

  // Trim to the overall cap, dropping from the least represented sections last
  // so a digest never becomes three sections deep and seven empty.
  let total = (lead ? 1 : 0) + sections.reduce((n, s) => n + s.stories.length, 0);
  while (total > MAX_STORIES) {
    const biggest = sections.reduce((a, b) => (b.stories.length > a.stories.length ? b : a));
    if (biggest.stories.length === 0) break;
    biggest.stories.pop();
    total--;
  }

  const counts = await env.DB.prepare(
    `SELECT COUNT(*) AS stories,
            SUM(source_count) AS articles,
            SUM(CASE WHEN source_count > 1 THEN 1 ELSE 0 END) AS corroborated
       FROM clusters WHERE first_seen_at >= ?1 AND first_seen_at < ?2`,
  )
    .bind(start, end)
    .first<{ stories: number; articles: number; corroborated: number }>();

  return {
    date: new Date(end * 1000).toISOString().slice(0, 10),
    lead,
    sections: sections.filter((s) => s.stories.length > 0),
    counts: {
      stories: counts?.stories ?? 0,
      articles: counts?.articles ?? 0,
      corroborated: counts?.corroborated ?? 0,
    },
  };
}
