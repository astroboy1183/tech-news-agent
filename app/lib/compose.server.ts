import { SECTIONS, type Section } from "./classify";

export type Story = {
  id: number;
  title: string;
  badge: string | null;
  url: string;
  excerpt: string | null;
  imageUrl: string | null;
  section: string;
  topics: string[];
  score: number;
  sourceName: string;
  publishedAt: number | null;
  fetchedAt: number;
};

export type FrontPage = {
  lead: Story | null;
  hero: Story[];
  across: Story[];
  sections: { section: Section; stories: Story[] }[];
  latest: Story[];
  counts: { total: number; today: number };
};

type Row = {
  id: number;
  title: string;
  badge: string | null;
  url_canonical: string;
  excerpt: string | null;
  image_url: string | null;
  section: string;
  topics_json: string;
  heuristic_score: number;
  published_at: number | null;
  fetched_at: number;
  source_name: string;
};

function toStory(row: Row): Story {
  let topics: string[] = [];
  try {
    topics = JSON.parse(row.topics_json) as string[];
  } catch {
    /* a malformed topics blob should not break the page */
  }
  return {
    id: row.id,
    title: row.title,
    badge: row.badge,
    url: row.url_canonical,
    excerpt: row.excerpt,
    imageUrl: row.image_url,
    section: row.section,
    topics,
    score: row.heuristic_score,
    sourceName: row.source_name,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
  };
}

const SELECT = `SELECT a.id, a.title, a.badge, a.url_canonical, a.excerpt, a.image_url,
                       a.section, a.topics_json, a.heuristic_score, a.published_at,
                       a.fetched_at, s.name AS source_name
                  FROM articles a JOIN sources s ON s.id = a.source_id`;

/**
 * Fill the front page's slots, in order, never repeating a story.
 *
 * v0.5.0 adds the five lead gates, the manual pin and cluster awareness. This
 * is the honest minimum needed to see real headlines in a real layout.
 */
export async function composeFrontPage(env: Env): Promise<FrontPage> {
  const pool = await env.DB.prepare(
    `${SELECT} WHERE a.fetched_at > ? ORDER BY a.heuristic_score DESC LIMIT 400`,
  )
    .bind(Math.floor(Date.now() / 1000) - 3 * 86400)
    .all<Row>();

  const candidates = (pool.results ?? []).map(toStory);
  const used = new Set<number>();
  const take = (story: Story | undefined) => {
    if (!story) return undefined;
    used.add(story.id);
    return story;
  };
  const available = () => candidates.filter((s) => !used.has(s.id));

  const lead = take(available()[0]) ?? null;

  // Hero and across deliberately pull from sections the lead did not use, so
  // the top of the page is never three versions of the same story.
  const heroSections = new Set<string>(lead ? [lead.section] : []);
  const hero: Story[] = [];
  for (const story of available()) {
    if (hero.length >= 2) break;
    if (heroSections.has(story.section)) continue;
    heroSections.add(story.section);
    hero.push(take(story)!);
  }

  const across: Story[] = [];
  for (const story of available()) {
    if (across.length >= 4) break;
    if (heroSections.has(story.section)) continue;
    heroSections.add(story.section);
    across.push(take(story)!);
  }

  const sections = SECTIONS.map((section) => ({
    section,
    stories: available()
      .filter((s) => s.section === section)
      .slice(0, 5)
      .map((s) => take(s)!),
  }));

  const latest = await env.DB.prepare(`${SELECT} ORDER BY a.fetched_at DESC LIMIT 12`).all<Row>();

  const counts = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN fetched_at > ? THEN 1 ELSE 0 END) AS today
       FROM articles`,
  )
    .bind(Math.floor(Date.now() / 1000) - 86400)
    .first<{ total: number; today: number }>();

  return {
    lead,
    hero,
    across,
    sections,
    latest: (latest.results ?? []).map(toStory),
    counts: { total: counts?.total ?? 0, today: counts?.today ?? 0 },
  };
}
