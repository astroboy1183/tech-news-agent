import { cloudflare } from "../context";
import { composeFrontPage } from "../lib/compose.server";
import type { Route } from "./+types/raw";

export function meta() {
  return [{ title: "raw — composition check" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  return composeFrontPage(context.get(cloudflare).env);
}

/**
 * The reality check.
 *
 * Deliberately unstyled: every slot the front page will have, filled with live
 * data, so real headlines meet a real layout on day four rather than day
 * fourteen. Anything that looks wrong here is a bug in the data or the ranking,
 * not in the CSS — because there isn't any.
 */
export default function Raw({ loaderData }: Route.ComponentProps) {
  const { lead, hero, across, sections, latest, counts } = loaderData;

  const line = (s: {
    title: string;
    sourceName: string;
    section: string;
    score: number;
    badge: string | null;
    imageUrl: string | null;
  }) =>
    `[${s.score}] ${s.badge ? `${s.badge} · ` : ""}${s.title} — ${s.sourceName} (${s.section})${s.imageUrl ? " [img]" : ""}`;

  return (
    <main
      style={{ fontFamily: "monospace", fontSize: 13, lineHeight: 1.6, padding: 20, maxWidth: 900 }}
    >
      <h1 style={{ fontSize: 16 }}>RAW COMPOSITION CHECK</h1>
      <p>
        {counts.total} articles · {counts.today} in the last 24h · no styling by design
      </p>

      <h2 style={{ fontSize: 14 }}>LEAD</h2>
      {lead ? (
        <div>
          <div>{line(lead)}</div>
          <div style={{ color: "#555" }}>{lead.excerpt?.slice(0, 220) ?? "(no excerpt)"}</div>
          <div style={{ color: "#888" }}>{lead.url}</div>
        </div>
      ) : (
        <div>(no story cleared the bar)</div>
      )}

      <h2 style={{ fontSize: 14 }}>HERO ({hero.length}/2)</h2>
      <ol>
        {hero.map((s) => (
          <li key={s.id}>{line(s)}</li>
        ))}
      </ol>

      <h2 style={{ fontSize: 14 }}>ACROSS ({across.length}/4)</h2>
      <ol>
        {across.map((s) => (
          <li key={s.id}>{line(s)}</li>
        ))}
      </ol>

      <h2 style={{ fontSize: 14 }}>SECTIONS</h2>
      {sections.map(({ section, stories }) => (
        <div key={section}>
          <h3 style={{ fontSize: 13, marginBottom: 2 }}>
            {section.toUpperCase()} ({stories.length}/5)
          </h3>
          <ol style={{ marginTop: 0 }}>
            {stories.map((s) => (
              <li key={s.id}>{line(s)}</li>
            ))}
          </ol>
        </div>
      ))}

      <h2 style={{ fontSize: 14 }}>LATEST ({latest.length}/12)</h2>
      <ol>
        {latest.map((s) => (
          <li key={s.id}>{line(s)}</li>
        ))}
      </ol>
    </main>
  );
}
