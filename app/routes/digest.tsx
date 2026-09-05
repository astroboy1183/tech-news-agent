import { Link } from "react-router";
import { Masthead } from "../components/masthead";
import { Row } from "../components/story";
import { cloudflare } from "../context";
import { siteCounts } from "../lib/compose.server";
import { composeDigest } from "../lib/digest.server";
import { formatCount } from "../lib/format";
import type { Route } from "./+types/digest";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `Digest ${loaderData?.digest.date ?? ""} — Tech News Agent` }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);
  const [digest, counts] = await Promise.all([composeDigest(env), siteCounts(env)]);
  return { digest, counts };
}

/**
 * What you missed since yesterday.
 *
 * The front page answers "what is happening now" and rebuilds constantly; this
 * answers a different question over a fixed 24-hour window, and leans harder
 * on corroboration — for a once-a-day read, the stories many newsrooms
 * independently covered are the right filter.
 */
export default function DigestPage({ loaderData }: Route.ComponentProps) {
  const { digest, counts } = loaderData;

  return (
    <>
      <Masthead counts={counts} current="digest" />
      <main className="wrap" style={{ paddingBottom: 60 }}>
        <div style={{ padding: "22px 0 14px" }}>
          <h1
            className="ser"
            style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.028em", margin: 0 }}
          >
            The last 24 hours
          </h1>
          <span className="meta">
            {digest.date.toUpperCase()} · {formatCount(digest.counts.stories)} STORIES ·{" "}
            {formatCount(digest.counts.corroborated)} COVERED BY MORE THAN ONE OUTLET
          </span>
        </div>
        <div className="rule-heavy" />

        {digest.lead ? (
          <article style={{ padding: "20px 0", borderBottom: "1px solid var(--rule)" }}>
            <span className="kicker">The day's lead</span>
            <Link
              to={`/story/${digest.lead.id}`}
              className="ser"
              style={{
                display: "block",
                fontSize: "clamp(22px,3vw,30px)",
                fontWeight: 700,
                lineHeight: 1.12,
                letterSpacing: "-0.025em",
                paddingTop: 8,
                textWrap: "balance",
              }}
            >
              {digest.lead.headline}
            </Link>
            {(digest.lead.summary ?? digest.lead.excerpt) ? (
              <p className="standfirst clamp-3">{digest.lead.summary ?? digest.lead.excerpt}</p>
            ) : null}
          </article>
        ) : (
          <p style={{ padding: "40px 0", color: "var(--ink-3)" }}>
            Nothing new in the last 24 hours.
          </p>
        )}

        <div className="section-grid">
          {digest.sections.map((block) => (
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
              {block.stories.map((s) => (
                <Row key={s.id} story={s} />
              ))}
            </div>
          ))}
        </div>

        <p style={{ paddingTop: 24, fontSize: 12, color: "var(--ink-3)", maxWidth: "70ch" }}>
          Delivered to Slack each morning when a webhook is configured. Email waits on a domain —
          there is nowhere to send from until one exists. The same content is available as{" "}
          <Link to="/feed.xml" style={{ color: "var(--accent)" }}>
            RSS
          </Link>
          .
        </p>
      </main>
    </>
  );
}
