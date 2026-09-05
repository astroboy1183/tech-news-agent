import { Link } from "react-router";
import { Masthead } from "../components/masthead";
import { cloudflare } from "../context";
import { SECTIONS } from "../lib/classify";
import { composeFrontPage } from "../lib/compose.server";
import { formatCount } from "../lib/format";
import { SECTION_BLURBS, SECTION_LABELS } from "../lib/sections";
import type { Route } from "./+types/sections";

export function meta() {
  return [{ title: "All sections — Tech News Agent" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);
  const rows = await env.DB.prepare(
    `SELECT section, COUNT(*) AS stories,
            SUM(CASE WHEN source_count > 1 THEN 1 ELSE 0 END) AS corroborated
       FROM clusters GROUP BY section`,
  ).all<{ section: string; stories: number; corroborated: number }>();

  const bySection = new Map((rows.results ?? []).map((r) => [r.section, r]));
  const front = await composeFrontPage(env);
  return {
    counts: front.counts,
    sections: SECTIONS.map((section) => ({
      section,
      label: SECTION_LABELS[section],
      blurb: SECTION_BLURBS[section],
      stories: bySection.get(section)?.stories ?? 0,
      corroborated: bySection.get(section)?.corroborated ?? 0,
    })),
  };
}

export default function Sections({ loaderData }: Route.ComponentProps) {
  const { sections, counts } = loaderData;
  return (
    <>
      <Masthead counts={counts} current="sections" />
      <main className="wrap" style={{ paddingBottom: 60 }}>
        <div style={{ padding: "22px 0 14px" }}>
          <h1
            className="ser"
            style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.028em", margin: 0 }}
          >
            The ten sections
          </h1>
          <p style={{ margin: "8px 0 0", color: "var(--ink-2)", maxWidth: "72ch" }}>
            No section has a colour of its own. Beyond about six, categorical hues stop separating
            reliably for colourblind readers — that was measured, not assumed. Identity lives in the
            name and its position instead, which leaves the single accent free to mean one thing:
            this is worth your attention.
          </p>
        </div>
        <div className="rule-heavy" />
        {sections.map(({ section, label, blurb, stories, corroborated }, i) => (
          <Link
            key={section}
            to={`/s/${section}`}
            style={{
              display: "grid",
              gridTemplateColumns: "26px minmax(0,1.1fr) minmax(0,1.7fr) 92px",
              gap: 14,
              alignItems: "baseline",
              padding: "13px 0",
              borderBottom: "1px solid var(--hair)",
            }}
          >
            <span className="meta" style={{ color: "var(--ink-4)" }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.012em" }}>
              {label}
            </span>
            <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{blurb}</span>
            <span className="meta" style={{ textAlign: "right" }}>
              {formatCount(stories)} ·{" "}
              <span style={{ color: "var(--accent)" }}>{corroborated}</span>
            </span>
          </Link>
        ))}
      </main>
    </>
  );
}
