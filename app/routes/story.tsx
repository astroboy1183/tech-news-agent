import { Link } from "react-router";
import { Masthead } from "../components/masthead";
import { SaveButton } from "../components/save-button";
import { Row } from "../components/story";
import { cloudflare } from "../context";
import type { Section } from "../lib/classify";
import { siteCounts } from "../lib/compose.server";
import { timeAgo } from "../lib/format";
import { SECTION_LABELS } from "../lib/sections";
import { loadStory } from "../lib/story.server";
import type { Route } from "./+types/story";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.story.headline} — Tech News Agent` : "Story" }];
}

export async function loader({ context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);
  const id = Number.parseInt(params.id ?? "", 10);
  if (!Number.isFinite(id)) throw new Response("Not found", { status: 404 });

  const [page, counts] = await Promise.all([loadStory(env, id), siteCounts(env)]);
  if (!page) throw new Response("Not found", { status: 404 });
  return { ...page, counts };
}

/** "broke it" for the first outlet, then how far behind the rest were. */
function lag(seconds: number): string {
  if (seconds === 0) return "broke it";
  if (seconds < 60) return `+${seconds}s`;
  if (seconds < 3600) return `+${Math.round(seconds / 60)}m`;
  return `+${(seconds / 3600).toFixed(1)}h`;
}

export default function StoryPage({ loaderData }: Route.ComponentProps) {
  const { story, arrivals, related, counts } = loaderData;

  return (
    <>
      <Masthead counts={counts} current={story.section} />
      <main className="wrap" style={{ paddingBottom: 60 }}>
        <div
          style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 34 }}
        >
          <article style={{ paddingTop: 24, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, paddingBottom: 10 }}>
              <Link className="kicker" to={`/s/${story.section}`}>
                {SECTION_LABELS[story.section as Section] ?? story.section}
              </Link>
              <span className="meta" style={{ marginLeft: "auto" }}>
                {story.sourceCount > 1 ? `${story.sourceCount} OUTLETS · ` : ""}
                {timeAgo(story.publishedAt ?? story.firstSeenAt).toUpperCase()}
              </span>
            </div>

            <h1
              className="ser"
              style={{
                fontSize: "clamp(26px,3.4vw,34px)",
                fontWeight: 700,
                lineHeight: 1.11,
                letterSpacing: "-0.028em",
                textWrap: "balance",
                margin: 0,
              }}
            >
              {story.headline}
            </h1>

            {story.imageUrl ? (
              <div className="thumb" style={{ height: 300, marginTop: 18 }}>
                <img src={story.imageUrl} alt="" />
              </div>
            ) : null}

            {story.summary ? (
              <p className="standfirst" style={{ fontStyle: "normal", fontSize: 17 }}>
                {story.summary}
              </p>
            ) : story.excerpt ? (
              <p className="standfirst">{story.excerpt}</p>
            ) : (
              <p style={{ color: "var(--ink-3)", marginTop: 16 }}>
                Not summarized yet — the budget goes to the stories most outlets covered first.
                Every outlet's own report is listed on the right.
              </p>
            )}

            {story.whyItMatters ? (
              <p
                style={{
                  margin: "16px 0 0",
                  paddingLeft: 13,
                  borderLeft: "2px solid var(--accent)",
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: "var(--ink-2)",
                }}
              >
                {story.whyItMatters}
              </p>
            ) : null}

            {story.topics.length > 0 ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 18 }}>
                {story.topics.map((t) => (
                  <span
                    key={t}
                    className="meta"
                    style={{
                      border: "1px solid var(--rule)",
                      borderRadius: 3,
                      padding: "3px 7px",
                      color: "var(--ink-2)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                paddingTop: 22,
                flexWrap: "wrap",
              }}
            >
              <a
                href={story.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)", fontWeight: 600 }}
              >
                Read the full report →
              </a>
              <SaveButton storyId={story.id} />
            </div>
          </article>

          <aside style={{ paddingTop: 24, minWidth: 0 }}>
            <div className="section-head">
              <span className="section-name">How it arrived</span>
              <span className="meta">{arrivals.length} REPORTS</span>
            </div>
            <p
              style={{ fontSize: 12, color: "var(--ink-3)", margin: "8px 0 4px", lineHeight: 1.5 }}
            >
              Ordered by publication, so the outlet that broke it is first and the rest are shown by
              how far behind they followed.
            </p>
            {arrivals.map((a) => (
              <div
                key={a.articleId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "62px minmax(0,1fr)",
                  gap: 11,
                  padding: "10px 0",
                  borderBottom: "1px solid var(--hair)",
                }}
              >
                <span
                  className="meta"
                  style={{ color: a.afterFirst === 0 ? "var(--accent)" : "var(--ink-4)" }}
                >
                  {lag(a.afterFirst)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <a
                    className="clamp-3"
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 }}
                  >
                    {a.title}
                  </a>
                  <div className="meta" style={{ paddingTop: 3 }}>
                    {a.sourceName}
                  </div>
                </div>
              </div>
            ))}

            {related.length > 0 ? (
              <div style={{ paddingTop: 26 }}>
                <div className="section-head">
                  <span className="section-name">
                    More in {SECTION_LABELS[story.section as Section] ?? story.section}
                  </span>
                </div>
                {related.map((r) => (
                  <Row key={r.id} story={r} />
                ))}
              </div>
            ) : null}
          </aside>
        </div>
      </main>
    </>
  );
}
