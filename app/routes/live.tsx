import { Masthead } from "../components/masthead";
import { cloudflare } from "../context";
import type { Section } from "../lib/classify";
import { siteCounts } from "../lib/compose.server";
import { timeAgo } from "../lib/format";
import { SECTION_LABELS } from "../lib/sections";
import type { Route } from "./+types/live";

export function meta() {
  return [{ title: "Live — Tech News Agent" }];
}

type FeedRow = {
  id: number;
  title: string;
  url_canonical: string;
  section: string;
  fetched_at: number;
  published_at: number | null;
  source_name: string;
  source_count: number | null;
};

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);
  const rows = await env.DB.prepare(
    `SELECT a.id, a.title, a.url_canonical, a.section, a.fetched_at, a.published_at,
            s.name AS source_name, c.source_count
       FROM articles a
       JOIN sources s ON s.id = a.source_id
       LEFT JOIN clusters c ON c.id = a.cluster_id
      ORDER BY a.fetched_at DESC, a.id DESC
      LIMIT 120`,
  ).all<FeedRow>();
  const counts = await siteCounts(env);
  return { rows: rows.results ?? [], counts };
}

/**
 * Everything, newest first, exactly as it arrived.
 *
 * The front page is edited — ranked, grouped, four across. This is the
 * opposite: the raw arrival order, so you can watch the collector work and see
 * a story land before anything has decided what it is worth.
 */
export default function Live({ loaderData }: Route.ComponentProps) {
  const { rows, counts } = loaderData;
  let lastDay = "";

  return (
    <>
      <Masthead counts={counts} current="live" />
      <main className="wrap" style={{ paddingBottom: 60 }}>
        <div style={{ padding: "22px 0 14px" }}>
          <h1
            className="ser"
            style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.028em", margin: 0 }}
          >
            Live feed
          </h1>
          <span className="meta">
            EVERY ARRIVAL, NEWEST FIRST · {counts.sources} SOURCES POLLED EVERY TWO MINUTES
          </span>
        </div>
        <div className="rule-heavy" />

        {rows.map((row) => {
          const day = new Date(row.fetched_at * 1000).toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
          });
          const newDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={row.id}>
              {newDay ? (
                <div
                  className="meta"
                  style={{
                    padding: "18px 0 6px",
                    letterSpacing: "0.14em",
                    color: "var(--ink-4)",
                    borderBottom: "1px solid var(--rule)",
                  }}
                >
                  {day.toUpperCase()}
                </div>
              ) : null}
              <article
                style={{
                  display: "grid",
                  gridTemplateColumns: "58px minmax(0,1fr) auto",
                  gap: 14,
                  alignItems: "baseline",
                  padding: "9px 0",
                  borderBottom: "1px solid var(--hair)",
                }}
              >
                <span className="meta" style={{ color: "var(--ink-4)" }}>
                  {timeAgo(row.fetched_at)}
                </span>
                <a
                  className="clamp-2"
                  href={row.url_canonical}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}
                >
                  {row.title}
                </a>
                <span className="meta" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {SECTION_LABELS[row.section as Section] ?? row.section} · {row.source_name}
                  {row.source_count && row.source_count > 1 ? (
                    <span style={{ color: "var(--accent)" }}> · {row.source_count} src</span>
                  ) : null}
                </span>
              </article>
            </div>
          );
        })}
      </main>
    </>
  );
}
