import { Form, Link, useNavigation } from "react-router";
import { Masthead } from "../components/masthead";
import { cloudflare } from "../context";
import { SECTIONS, type Section } from "../lib/classify";
import { siteCounts } from "../lib/compose.server";
import { formatCount, timeAgo } from "../lib/format";
import { search } from "../lib/search.server";
import { SECTION_LABELS } from "../lib/sections";
import type { Route } from "./+types/search";

export function meta({ loaderData }: Route.MetaArgs) {
  const q = loaderData?.query;
  return [{ title: q ? `${q} — search — Tech News Agent` : "Search — Tech News Agent" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").slice(0, 120);
  const section = url.searchParams.get("section") ?? "";

  const counts = await siteCounts(env);
  if (!query.trim()) {
    return { query, section, hits: [], total: 0, parsed: null, counts };
  }
  const { hits, total, parsed } = await search(env, query, {
    section: SECTIONS.includes(section as Section) ? section : undefined,
  });
  return { query, section, hits, total, parsed, counts };
}

/**
 * The snippet arrives with matches wrapped in [[…]] rather than HTML, so it
 * can be rendered as text. Returning markup from the database and injecting it
 * would make every headline a potential script.
 */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\[\[|\]\])/);
  let on = false;
  return (
    <>
      {parts.map((part, i) => {
        if (part === "[[") {
          on = true;
          return null;
        }
        if (part === "]]") {
          on = false;
          return null;
        }
        const key = `${i}-${part.slice(0, 8)}`;
        return on ? (
          <mark
            key={key}
            style={{ background: "transparent", color: "var(--accent)", fontWeight: 600 }}
          >
            {part}
          </mark>
        ) : (
          <span key={key}>{part}</span>
        );
      })}
    </>
  );
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { query, section, hits, total, counts } = loaderData;
  const busy = useNavigation().state !== "idle";

  return (
    <>
      <Masthead counts={counts} current="search" />
      <main className="wrap" style={{ paddingBottom: 60 }}>
        <div style={{ padding: "22px 0 14px" }}>
          <h1
            className="ser"
            style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.028em", margin: 0 }}
          >
            Search
          </h1>
          <span className="meta">
            {formatCount(counts.articles)} ARTICLES · TITLES AND OPENINGS
          </span>
        </div>

        <Form
          method="get"
          style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingBottom: 16 }}
        >
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="nvidia, postgres, CVE-2026…"
            aria-label="Search stories"
            style={{
              flex: "1 1 280px",
              padding: "10px 12px",
              fontSize: 14,
              fontFamily: "inherit",
              color: "var(--ink)",
              background: "var(--card)",
              border: "1px solid var(--rule)",
              borderRadius: 4,
            }}
          />
          <select
            name="section"
            defaultValue={section}
            aria-label="Limit to a section"
            style={{
              padding: "10px 12px",
              fontSize: 13,
              fontFamily: "inherit",
              color: "var(--ink)",
              background: "var(--card)",
              border: "1px solid var(--rule)",
              borderRadius: 4,
            }}
          >
            <option value="">Every section</option>
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {SECTION_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            style={{
              padding: "10px 18px",
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
            {busy ? "Searching…" : "Search"}
          </button>
        </Form>

        <div className="rule-heavy" />

        {query.trim() === "" ? (
          <p style={{ padding: "40px 0", color: "var(--ink-3)", maxWidth: "62ch" }}>
            Search titles and openings across everything collected. Results are grouped into
            stories, so a story six outlets covered appears once rather than six times.
          </p>
        ) : hits.length === 0 ? (
          <p style={{ padding: "40px 0", color: "var(--ink-3)" }}>
            Nothing matched <strong>{query}</strong>. Every word has to appear, so fewer words
            usually finds more.
          </p>
        ) : (
          <>
            <p className="meta" style={{ padding: "12px 0" }}>
              {formatCount(hits.length)} STORIES
              {total > hits.length ? ` FROM ${formatCount(total)} MATCHING ARTICLES` : ""}
            </p>
            {hits.map((hit) => (
              <article
                key={`${hit.id}-${hit.headline.slice(0, 12)}`}
                style={{ padding: "14px 0", borderBottom: "1px solid var(--hair)" }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <Link className="kicker" to={`/s/${hit.section}`}>
                    {SECTION_LABELS[hit.section as Section] ?? hit.section}
                  </Link>
                  <span className="meta" style={{ marginLeft: "auto" }}>
                    {hit.sources[0]} · {timeAgo(hit.publishedAt ?? hit.firstSeenAt)}
                    {hit.sourceCount > 1 ? (
                      <span style={{ color: "var(--accent)" }}> · {hit.sourceCount} src</span>
                    ) : null}
                  </span>
                </div>
                {hit.sourceCount > 1 || hit.summary ? (
                  <Link
                    to={`/story/${hit.id}`}
                    className="ser"
                    style={{
                      fontSize: 18,
                      fontWeight: 600,
                      lineHeight: 1.28,
                      letterSpacing: "-0.015em",
                    }}
                  >
                    {hit.headline}
                  </Link>
                ) : (
                  <a
                    href={hit.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ser"
                    style={{
                      fontSize: 18,
                      fontWeight: 600,
                      lineHeight: 1.28,
                      letterSpacing: "-0.015em",
                    }}
                  >
                    {hit.headline}
                  </a>
                )}
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: 13,
                    color: "var(--ink-2)",
                    lineHeight: 1.5,
                  }}
                >
                  <Highlighted text={hit.snippet} />
                </p>
              </article>
            ))}
          </>
        )}
      </main>
    </>
  );
}
