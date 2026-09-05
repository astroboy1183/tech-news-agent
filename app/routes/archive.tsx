import { Form, Link } from "react-router";
import { Masthead } from "../components/masthead";
import { Row } from "../components/story";
import { cloudflare } from "../context";
import type { Section } from "../lib/classify";
import { siteCounts } from "../lib/compose.server";
import { formatCount } from "../lib/format";
import { SECTION_LABELS, type Story } from "../lib/sections";
import type { Route } from "./+types/archive";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.date ?? "Archive"} — Tech News Agent` }];
}

type ArchiveRow = {
  id: number;
  headline: string;
  section: string;
  source_count: number;
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

function toStory(r: ArchiveRow): Story {
  return {
    id: r.id,
    headline: r.headline,
    url: r.url_canonical,
    excerpt: r.excerpt,
    imageUrl: r.image_url,
    section: r.section,
    summary: r.summary,
    whyItMatters: r.why_it_matters,
    topics: [],
    sourceCount: r.source_count,
    sources: [],
    velocity: 0,
    score: r.score,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    publishedAt: r.published_at,
  };
}

const DAY = 86400;

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);
  const url = new URL(request.url);
  const requested = url.searchParams.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested)
    ? requested
    : new Date().toISOString().slice(0, 10);

  const start = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
  const end = start + DAY;

  const rows = await env.DB.prepare(
    `SELECT c.id, c.headline, c.section, c.source_count, c.score,
            c.first_seen_at, c.last_seen_at,
            a.url_canonical, a.excerpt, a.image_url, a.published_at,
            e.summary, e.why_it_matters
       FROM clusters c
       JOIN articles a ON a.id = c.primary_article_id
       LEFT JOIN enrichments e ON e.cluster_id = c.id
      WHERE c.first_seen_at >= ?1 AND c.first_seen_at < ?2
      ORDER BY (c.score + (c.source_count - 1) * 6.0) DESC
      LIMIT 120`,
  )
    .bind(start, end)
    .all<ArchiveRow>();

  // Days that actually have something, so the picker never offers a blank one.
  const days = await env.DB.prepare(
    `SELECT date(first_seen_at, 'unixepoch') AS day, COUNT(*) AS n
       FROM clusters
      WHERE first_seen_at > ?
      GROUP BY day ORDER BY day DESC LIMIT 30`,
  )
    .bind(Math.floor(Date.now() / 1000) - 30 * DAY)
    .all<{ day: string; n: number }>();

  const counts = await siteCounts(env);
  const stories = (rows.results ?? []).map(toStory);
  return { date, stories, days: days.results ?? [], counts };
}

export default function Archive({ loaderData }: Route.ComponentProps) {
  const { date, stories, days, counts } = loaderData;
  const bySection = new Map<string, Story[]>();
  for (const s of stories) {
    const list = bySection.get(s.section);
    if (list) list.push(s);
    else bySection.set(s.section, [s]);
  }

  return (
    <>
      <Masthead counts={counts} current="archive" />
      <main className="wrap" style={{ paddingBottom: 60 }}>
        <div
          style={{
            padding: "22px 0 14px",
            display: "flex",
            alignItems: "flex-end",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1
              className="ser"
              style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.028em", margin: 0 }}
            >
              {new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })}
            </h1>
            <span className="meta">
              {formatCount(stories.length)} STORIES THAT FIRST APPEARED THIS DAY
            </span>
          </div>
          <Form method="get" style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <input
              type="date"
              name="date"
              defaultValue={date}
              aria-label="Choose a day"
              style={{
                padding: "8px 10px",
                fontSize: 13,
                fontFamily: "inherit",
                color: "var(--ink)",
                background: "var(--card)",
                border: "1px solid var(--rule)",
                borderRadius: 4,
              }}
            />
            <button
              type="submit"
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                color: "var(--ground)",
                background: "var(--ink)",
                border: 0,
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Go
            </button>
          </Form>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingBottom: 14 }}>
          {days.map((d) => (
            <Link
              key={d.day}
              to={`/archive?date=${d.day}`}
              className="meta"
              style={{
                border: "1px solid var(--rule)",
                borderRadius: 3,
                padding: "4px 8px",
                color: d.day === date ? "var(--ground)" : "var(--ink-2)",
                background: d.day === date ? "var(--ink)" : "transparent",
              }}
            >
              {d.day.slice(5)} · {d.n}
            </Link>
          ))}
        </div>

        <div className="rule-heavy" />

        {stories.length === 0 ? (
          <p style={{ padding: "40px 0", color: "var(--ink-3)" }}>
            Nothing was first seen on this day.
          </p>
        ) : (
          <div className="section-grid">
            {[...bySection.entries()].map(([section, list]) => (
              <div className="section-col" key={section}>
                <div className="section-head">
                  <span className="section-name">
                    {SECTION_LABELS[section as Section] ?? section}
                  </span>
                  <span className="meta">{list.length}</span>
                </div>
                {list.map((s) => (
                  <Row key={s.id} story={s} />
                ))}
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
