import { Masthead } from "../components/masthead";
import { Feature, Lead, Row } from "../components/story";
import { cloudflare } from "../context";
import { SECTIONS, type Section } from "../lib/classify";
import { composeSection, siteCounts } from "../lib/compose.server";
import { SECTION_LABELS } from "../lib/sections";
import type { Route } from "./+types/section";

export function meta({ params }: Route.MetaArgs) {
  const label = SECTION_LABELS[params.section as Section] ?? "Section";
  return [{ title: `${label} — Tech News Agent` }];
}

export async function loader({ context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);
  const slug = params.section as Section;
  if (!SECTIONS.includes(slug)) throw new Response("No such section", { status: 404 });

  // The masthead needs the same counts everywhere, so it is composed here too
  // rather than duplicated into a layout that would query on every navigation.
  const [{ lead, stories }, counts] = await Promise.all([
    composeSection(env, slug),
    siteCounts(env),
  ]);
  return { section: slug, label: SECTION_LABELS[slug], lead, stories, counts };
}

export default function SectionPage({ loaderData }: Route.ComponentProps) {
  const { section, label, lead, stories, counts } = loaderData;
  const features = stories.slice(0, 4);
  const rest = stories.slice(4);

  return (
    <>
      <Masthead counts={counts} current={section} />
      <main className="wrap">
        <div style={{ padding: "22px 0 14px" }}>
          <h1
            className="ser"
            style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.028em", margin: 0 }}
          >
            {label}
          </h1>
          <span className="meta">
            {stories.length + (lead ? 1 : 0)} STORIES IN THE LAST SEVEN DAYS
          </span>
        </div>
        <div className="rule-heavy" />

        {lead ? (
          <div className="hero">
            <div className="hero-lead">
              <Lead story={lead} />
            </div>
            <div className="divider" />
            <div className="hero-side">
              {features.slice(0, 2).map((story, i) => (
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
          <p style={{ padding: "60px 0", color: "var(--ink-3)" }}>Nothing in this section yet.</p>
        )}

        {features.length > 2 ? (
          <section style={{ paddingTop: 22 }}>
            <div className="rule" />
            <div className="across">
              {features.slice(2).map((story) => (
                <Feature key={story.id} story={story} size="sm" />
              ))}
            </div>
          </section>
        ) : null}

        {rest.length > 0 ? (
          <section style={{ paddingTop: 24, paddingBottom: 50 }}>
            <div className="rule-heavy" />
            <div className="section-head" style={{ border: 0, paddingTop: 14 }}>
              <span className="section-name">More in {label}</span>
            </div>
            <div className="section-grid">
              {[0, 1, 2].map((column) => (
                <div className="section-col" key={column} style={{ paddingTop: 0 }}>
                  {rest
                    .filter((_, i) => i % 3 === column)
                    .map((story) => (
                      <Row key={story.id} story={story} thumb />
                    ))}
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
