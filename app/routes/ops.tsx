import { Masthead } from "../components/masthead";
import { cloudflare } from "../context";
import { siteCounts } from "../lib/compose.server";
import { formatCount, timeAgo } from "../lib/format";
import { loadOps } from "../lib/ops.server";
import type { Route } from "./+types/ops";

export function meta() {
  return [{ title: "Operations — Tech News Agent" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);
  const [ops, counts] = await Promise.all([loadOps(env), siteCounts(env)]);
  return { ops, counts };
}

/** Status never rides on colour alone — an icon and a word carry it too. */
function Status({ level, children }: { level: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  const colour = level === "ok" ? "#5BC48A" : level === "warn" ? "var(--accent)" : "#E86A6A";
  const mark = level === "ok" ? "✓" : level === "warn" ? "!" : "×";
  return (
    <span style={{ color: colour, display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span aria-hidden="true">{mark}</span>
      {children}
    </span>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div style={{ padding: "14px 0", borderBottom: "1px solid var(--hair)" }}>
      <div className="meta" style={{ letterSpacing: "0.12em" }}>
        {label}
      </div>
      <div
        className="mono"
        style={{ fontSize: 25, fontWeight: 500, lineHeight: 1.2, paddingTop: 4 }}
      >
        {value}
      </div>
      {detail ? (
        <div style={{ fontSize: 12, color: "var(--ink-3)", paddingTop: 3 }}>{detail}</div>
      ) : null}
    </div>
  );
}

export default function Ops({ loaderData }: Route.ComponentProps) {
  const { ops, counts } = loaderData;
  const { sources, pipeline, budget, stages } = ops;

  // A pipeline that has collected nothing for an hour is broken, whatever the
  // individual bindings report.
  const collecting = pipeline.articlesLastHour > 0;

  return (
    <>
      <Masthead counts={counts} current="ops" />
      <main className="wrap" style={{ paddingBottom: 60 }}>
        <div style={{ padding: "22px 0 14px" }}>
          <h1
            className="ser"
            style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.028em", margin: 0 }}
          >
            Operations
          </h1>
          <span className="meta">
            {collecting ? (
              <Status level="ok">COLLECTING · {pipeline.articlesLastHour} IN THE LAST HOUR</Status>
            ) : (
              <Status level="bad">NOTHING COLLECTED IN AN HOUR</Status>
            )}
          </span>
        </div>
        <div className="rule-heavy" />

        <div className="section-grid">
          <div className="section-col">
            <div className="section-head">
              <span className="section-name">Sources</span>
              <span className="meta">{formatCount(sources.active)} ACTIVE</span>
            </div>
            <Stat
              label="HEALTHY"
              value={`${sources.healthy} / ${sources.active}`}
              detail={
                sources.stale > 0 ? (
                  <Status level="warn">{sources.stale} healthy but not polled in 15 min</Status>
                ) : (
                  <Status level="ok">all polled within 15 minutes</Status>
                )
              }
            />
            <Stat
              label="BACKING OFF"
              value={sources.backingOff}
              detail="one or two consecutive failures — retrying with delay"
            />
            <Stat
              label="FAILING"
              value={sources.failing}
              detail={
                sources.failing > 0 ? (
                  <Status level="bad">three or more failures in a row</Status>
                ) : (
                  <Status level="ok">none</Status>
                )
              }
            />
            {sources.neverFetched > 0 ? (
              <Stat
                label="NEVER FETCHED"
                value={sources.neverFetched}
                detail="added but not yet polled"
              />
            ) : null}
          </div>

          <div className="section-col">
            <div className="section-head">
              <span className="section-name">Pipeline</span>
              <span className="meta">LAST 24H</span>
            </div>
            <Stat
              label="ARTICLES COLLECTED"
              value={formatCount(pipeline.articlesToday)}
              detail={`${formatCount(pipeline.articles)} in total`}
            />
            <Stat
              label="STORIES"
              value={formatCount(pipeline.clusters)}
              detail={`${pipeline.averageMembers.toFixed(2)} articles per story on average`}
            />
            <Stat
              label="CORROBORATED"
              value={formatCount(pipeline.corroborated)}
              detail={`covered by more than one outlet · biggest has ${pipeline.biggestCluster}`}
            />
            <Stat
              label="AWAITING CLUSTERING"
              value={formatCount(pipeline.unclustered)}
              detail={
                pipeline.unclustered > 200 ? (
                  <Status level="warn">a backlog is building</Status>
                ) : (
                  <Status level="ok">keeping up</Status>
                )
              }
            />
          </div>

          <div className="section-col">
            <div className="section-head">
              <span className="section-name">Budget</span>
              <span className="meta">{budget.day}</span>
            </div>
            <Stat
              label="SPENT TODAY"
              value={budget.spent}
              detail={`of ${budget.cap} · ${budget.remaining} left`}
            />
            <div style={{ padding: "4px 0 14px" }}>
              <div
                style={{
                  height: 6,
                  background: "var(--sunken)",
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, budget.percentUsed)}%`,
                    height: "100%",
                    background: budget.percentUsed > 90 ? "#E86A6A" : "var(--accent)",
                  }}
                />
              </div>
            </div>
            <Stat
              label="SUMMARIES TODAY"
              value={formatCount(budget.summariesToday)}
              detail={`${formatCount(pipeline.summarized)} stories summarized in total`}
            />
            <Stat
              label="SUMMARIZER"
              value={pipeline.summarized > 0 || budget.summariesToday > 0 ? "running" : "idle"}
              detail="idle means no API key, or nothing eligible"
            />
          </div>
        </div>

        <section style={{ paddingTop: 22 }}>
          <div className="rule-heavy" />
          <div className="section-head" style={{ border: 0, paddingTop: 14 }}>
            <span className="section-name">Stages</span>
            <span className="meta">RUNS IN THE LAST 24 HOURS</span>
          </div>
          {stages.map((s) => (
            <div
              key={s.stage}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 70px 84px minmax(0,1fr)",
                gap: 12,
                alignItems: "baseline",
                padding: "9px 0",
                borderBottom: "1px solid var(--hair)",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.stage}</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {formatCount(s.runs)}
              </span>
              <span className="meta">{s.lastRun ? timeAgo(s.lastRun) : "never"}</span>
              <span
                className="mono clamp-2"
                style={{ fontSize: 11, color: s.lastError ? "#E86A6A" : "var(--ink-3)" }}
              >
                {s.lastError ?? s.lastCounts ?? ""}
              </span>
            </div>
          ))}
        </section>

        {sources.worst.length > 0 ? (
          <section style={{ paddingTop: 22 }}>
            <div className="rule-heavy" />
            <div className="section-head" style={{ border: 0, paddingTop: 14 }}>
              <span className="section-name">Sources needing attention</span>
              <span className="meta">{sources.worst.length} WITH FAILURES</span>
            </div>
            {sources.worst.map((s) => (
              <div
                key={s.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 60px 84px minmax(0,1.4fr)",
                  gap: 12,
                  alignItems: "baseline",
                  padding: "9px 0",
                  borderBottom: "1px solid var(--hair)",
                }}
              >
                <span className="clamp-2" style={{ fontSize: 13, fontWeight: 600 }}>
                  {s.name}
                </span>
                <span className="meta">
                  <Status level={s.consecutiveFailures >= 3 ? "bad" : "warn"}>
                    {s.consecutiveFailures}
                  </Status>
                </span>
                <span className="meta">{s.lastFetchedAt ? timeAgo(s.lastFetchedAt) : "never"}</span>
                <span className="mono clamp-2" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  {s.lastError ?? ""}
                </span>
              </div>
            ))}
          </section>
        ) : null}

        <p style={{ paddingTop: 24, fontSize: 12, color: "var(--ink-3)", maxWidth: "70ch" }}>
          Read-only. Pinning a lead writes to the database and so needs authentication, which
          arrives with the domain — until then a pin is set directly against D1.
        </p>
      </main>
    </>
  );
}
