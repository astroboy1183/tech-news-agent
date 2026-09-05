import { Link } from "react-router";
import { Masthead } from "../components/masthead";
import { Feature, Lead, Row } from "../components/story";
import { cloudflare } from "../context";
import { composeFrontPage } from "../lib/compose.server";
import { formatCount } from "../lib/format";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Tech News Agent — one stop for everything technology" },
    {
      name: "description",
      content:
        "Technology news gathered from hundreds of sources every two minutes, grouped so one story is one story.",
    },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  return composeFrontPage(context.get(cloudflare).env);
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { lead, hero, across, sections, latest, counts } = loaderData;

  return (
    <>
      <Masthead counts={counts} />

      <main className="wrap">
        {lead ? (
          <div className="hero">
            <div className="hero-lead">
              <Lead story={lead} />
            </div>
            <div className="divider" />
            <div className="hero-side">
              {hero.map((story, i) => (
                <div
                  key={story.id}
                  style={{
                    paddingTop: i === 0 ? 0 : 16,
                    paddingBottom: i === 0 ? 16 : 0,
                    borderBottom: i === 0 ? "1px solid var(--rule)" : undefined,
                  }}
                >
                  <Feature story={story} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p style={{ padding: "60px 0", color: "var(--ink-3)" }}>
            No stories yet — the collector is still filling the database.
          </p>
        )}

        {across.length > 0 ? (
          <section style={{ paddingTop: 22 }}>
            <div className="rule" />
            <div className="across">
              {across.map((story) => (
                <Feature key={story.id} story={story} size="sm" />
              ))}
            </div>
          </section>
        ) : null}

        <section style={{ paddingTop: 26 }}>
          <div className="rule-heavy" />
          <div className="section-grid">
            {sections.map((block) => (
              <div className="section-col" key={block.section}>
                <div className="section-head">
                  <span className="section-name">{block.label}</span>
                  <Link
                    className="meta"
                    to={`/s/${block.section}`}
                    style={{ letterSpacing: "0.1em" }}
                  >
                    MORE →
                  </Link>
                </div>
                {block.stories.map((story, i) => (
                  <Row key={story.id} story={story} thumb={i === 0} />
                ))}
              </div>
            ))}
          </div>
        </section>

        {latest.length > 0 ? (
          <section style={{ paddingTop: 10, paddingBottom: 40 }}>
            <div className="rule-heavy" />
            <div className="section-head" style={{ border: 0, paddingTop: 14 }}>
              <span className="section-name">Latest</span>
              <span className="meta" style={{ letterSpacing: "0.1em" }}>
                NEWEST FIRST · REFRESHED EVERY MINUTE
              </span>
            </div>
            <div className="latest">
              {latest.map((story) => (
                <Row key={story.id} story={story} />
              ))}
            </div>
          </section>
        ) : null}

        <footer
          style={{
            borderTop: "1px solid var(--rule)",
            padding: "18px 0 50px",
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <span className="meta">
            {formatCount(counts.articles)} ARTICLES GROUPED INTO {formatCount(counts.stories)}{" "}
            STORIES · {formatCount(counts.corroborated)} CONFIRMED BY MORE THAN ONE OUTLET
          </span>
          <span className="meta">TECH NEWS AGENT · v0.5.0</span>
        </footer>
      </main>
    </>
  );
}
