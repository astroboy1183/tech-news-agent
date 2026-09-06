import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import { Masthead } from "../components/masthead";
import { cloudflare } from "../context";
import { siteCounts } from "../lib/compose.server";
import { POLL_INTERVAL_SECONDS } from "../lib/constants";
import { formatCount, timeAgo } from "../lib/format";
import { loadPulse } from "../lib/pulse.server";
import type { Route } from "./+types/pulse";

export function meta() {
  return [{ title: "Pulse — Tech News Agent" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare);
  const [pulse, counts] = await Promise.all([loadPulse(env), siteCounts(env)]);
  return { pulse, counts };
}

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

/**
 * A bar per minute for the last half hour.
 *
 * Deliberately not a single "articles per hour" number: a stall shows up here
 * as a visible gap in a row of bars, which is recognisable at a glance in a way
 * a figure that merely drifts downward is not. Height is relative to the
 * busiest minute, so quiet periods still render rather than vanishing.
 */
function Arrivals({ buckets }: { buckets: { minute: number; articles: number }[] }) {
  const peak = Math.max(1, ...buckets.map((b) => b.articles));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60 }}>
      {buckets.map((b) => {
        const height = b.articles === 0 ? 2 : Math.max(4, (b.articles / peak) * 58);
        return (
          <div
            key={b.minute}
            title={`${b.minute}m ago · ${b.articles} article${b.articles === 1 ? "" : "s"}`}
            style={{
              flex: 1,
              height,
              minWidth: 3,
              borderRadius: 1,
              background: b.articles === 0 ? "var(--rule)" : "var(--accent)",
              opacity: b.articles === 0 ? 1 : 0.35 + 0.65 * (b.articles / peak),
            }}
          />
        );
      })}
    </div>
  );
}

export default function Pulse({ loaderData }: Route.ComponentProps) {
  const { pulse, counts } = loaderData;
  const revalidator = useRevalidator();
  const [countdown, setCountdown] = useState(pulse.sweep.nextTickIn);

  // The page is about a thing that happens every minute, so it refreshes on
  // that beat. Hidden tabs are skipped — nobody is reading them.
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (document.visibilityState === "visible") revalidator.revalidate();
          return 60;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [revalidator]);

  const { sweep, capacity, ticks, collects, arrivals } = pulse;
  const sinceArticle = pulse.lastArticleAt ? pulse.now - pulse.lastArticleAt : null;
  const sinceSchedule = pulse.lastScheduleAt ? pulse.now - pulse.lastScheduleAt : null;

  const scheduleLevel =
    sinceSchedule === null
      ? "bad"
      : sinceSchedule > 180
        ? "bad"
        : sinceSchedule > 90
          ? "warn"
          : "ok";
  const sweepLevel =
    sweep.healthy === 0
      ? "bad"
      : sweep.withinInterval / sweep.healthy >= 0.95
        ? "ok"
        : sweep.withinInterval / sweep.healthy >= 0.8
          ? "warn"
          : "bad";

  return (
    <>
      <Masthead counts={counts} current="pulse" />
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
              Pulse
            </h1>
            <span className="meta">
              EVERY SOURCE, EVERY {POLL_INTERVAL_SECONDS} SECONDS · THIS PAGE REFRESHES ITSELF
            </span>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div
              className="mono"
              style={{ fontSize: 34, fontWeight: 500, lineHeight: 1, color: "var(--accent)" }}
            >
              {countdown}s
            </div>
            <span className="meta">TO THE NEXT DISPATCH</span>
          </div>
        </div>
        <div className="rule-heavy" />

        <div className="section-grid">
          <div className="section-col">
            <div className="section-head">
              <span className="section-name">The sweep</span>
              <span className="meta">{formatCount(sweep.active)} SOURCES</span>
            </div>
            <div style={{ padding: "12px 0", borderBottom: "1px solid var(--hair)" }}>
              <div className="meta">POLLED WITHIN {POLL_INTERVAL_SECONDS}s</div>
              <div className="mono" style={{ fontSize: 25, paddingTop: 4 }}>
                {sweep.withinInterval} / {sweep.healthy}
              </div>
              <div style={{ fontSize: 12, paddingTop: 3 }}>
                <Status level={sweepLevel}>
                  {sweep.healthy > 0
                    ? `${Math.round((sweep.withinInterval / sweep.healthy) * 100)}% inside the interval`
                    : "nothing polled yet"}
                </Status>
              </div>
            </div>
            <div style={{ padding: "12px 0", borderBottom: "1px solid var(--hair)" }}>
              <div className="meta">AGE SINCE LAST FETCH</div>
              <div className="mono" style={{ fontSize: 25, paddingTop: 4 }}>
                {sweep.meanAge}s
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", paddingTop: 3 }}>
                worst {sweep.worstAge}s
              </div>
            </div>
            <div style={{ padding: "12px 0" }}>
              <div className="meta">DUE RIGHT NOW</div>
              <div className="mono" style={{ fontSize: 25, paddingTop: 4 }}>
                {sweep.dueNow}
              </div>
              <div style={{ fontSize: 12, paddingTop: 3 }}>
                {sweep.overdue > 0 ? (
                  <Status level="warn">{sweep.overdue} overdue by more than one interval</Status>
                ) : (
                  <Status level="ok">nothing overdue</Status>
                )}
              </div>
            </div>
          </div>

          <div className="section-col">
            <div className="section-head">
              <span className="section-name">Capacity</span>
              <span className="meta">PER TICK</span>
            </div>
            <div style={{ padding: "12px 0", borderBottom: "1px solid var(--hair)" }}>
              <div className="meta">DISPATCH LIMIT</div>
              <div className="mono" style={{ fontSize: 25, paddingTop: 4 }}>
                {capacity.perTick}
              </div>
              <div style={{ fontSize: 12, paddingTop: 3 }}>
                {capacity.sufficient ? (
                  <Status level="ok">covers the {capacity.neededPerTick} a full sweep needs</Status>
                ) : (
                  <Status level="bad">below the {capacity.neededPerTick} needed</Status>
                )}
              </div>
            </div>
            <div style={{ padding: "12px 0", borderBottom: "1px solid var(--hair)" }}>
              <div className="meta">LAST DISPATCH</div>
              <div className="mono" style={{ fontSize: 25, paddingTop: 4 }}>
                {sinceSchedule === null ? "never" : `${sinceSchedule}s`}
              </div>
              <div style={{ fontSize: 12, paddingTop: 3 }}>
                <Status level={scheduleLevel}>
                  {scheduleLevel === "ok" ? "on the minute" : "the scheduler is behind"}
                </Status>
              </div>
            </div>
            <div style={{ padding: "12px 0" }}>
              <div className="meta">NEWEST ARTICLE</div>
              <div className="mono" style={{ fontSize: 25, paddingTop: 4 }}>
                {sinceArticle === null ? "none" : timeAgo(pulse.lastArticleAt ?? 0)}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", paddingTop: 3 }}>
                quiet gaps are normal — most polls return 304
              </div>
            </div>
          </div>

          <div className="section-col">
            <div className="section-head">
              <span className="section-name">Arrivals</span>
              <span className="meta">LAST 30 MINUTES</span>
            </div>
            <div style={{ padding: "14px 0" }}>
              <Arrivals buckets={arrivals} />
              <div
                className="meta"
                style={{ display: "flex", justifyContent: "space-between", paddingTop: 6 }}
              >
                <span>30m AGO</span>
                <span>{formatCount(arrivals.reduce((n, b) => n + b.articles, 0))} ARTICLES</span>
                <span>NOW</span>
              </div>
            </div>
          </div>
        </div>

        <section style={{ paddingTop: 20 }}>
          <div className="rule-heavy" />
          <div className="section-head" style={{ border: 0, paddingTop: 14 }}>
            <span className="section-name">Recent dispatches</span>
            <span className="meta">ONE PER MINUTE</span>
          </div>
          {ticks.length === 0 ? (
            <p style={{ color: "var(--ink-3)", padding: "16px 0" }}>No dispatch recorded yet.</p>
          ) : (
            ticks.map((t) => (
              <div
                key={t.startedAt}
                style={{
                  display: "grid",
                  gridTemplateColumns: "96px 1fr 110px",
                  gap: 12,
                  alignItems: "center",
                  padding: "7px 0",
                  borderBottom: "1px solid var(--hair)",
                }}
              >
                <span className="meta">{timeAgo(t.startedAt)}</span>
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
                      width: `${Math.min(100, (t.dispatched / Math.max(1, t.limit ?? capacity.perTick)) * 100)}%`,
                      height: "100%",
                      background: "var(--accent)",
                    }}
                  />
                </div>
                <span className="mono" style={{ fontSize: 11, textAlign: "right" }}>
                  {t.dispatched}
                  {t.limit ? ` / ${t.limit}` : ""}
                </span>
              </div>
            ))
          )}
        </section>

        <section style={{ paddingTop: 20 }}>
          <div className="rule-heavy" />
          <div className="section-head" style={{ border: 0, paddingTop: 14 }}>
            <span className="section-name">Recent fetches</span>
            <span className="meta">FETCHED · NEW · UNCHANGED · FAILED</span>
          </div>
          {collects.slice(0, 12).map((c) => (
            <div
              key={`${c.startedAt}-${c.fetched}-${c.inserted}`}
              style={{
                display: "grid",
                gridTemplateColumns: "96px 60px repeat(4, minmax(0,1fr))",
                gap: 10,
                alignItems: "baseline",
                padding: "7px 0",
                borderBottom: "1px solid var(--hair)",
              }}
            >
              <span className="meta">{timeAgo(c.startedAt)}</span>
              <span className="meta">{c.durationSeconds}s</span>
              <span className="mono" style={{ fontSize: 11 }}>
                {c.fetched}
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>
                +{c.inserted}
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {c.unchanged}
              </span>
              <span
                className="mono"
                style={{ fontSize: 11, color: c.failed > 0 ? "#E86A6A" : "var(--ink-4)" }}
              >
                {c.failed}
              </span>
            </div>
          ))}
        </section>

        <p style={{ paddingTop: 20, fontSize: 12, color: "var(--ink-3)", maxWidth: "72ch" }}>
          A quiet stretch is not a fault. Every poll is a conditional request, so a publisher that
          has not posted answers <code>304</code> with no body — most fetches are meant to find
          nothing. What matters is that dispatches keep landing on the minute and that ages stay
          inside {POLL_INTERVAL_SECONDS} seconds.
        </p>
      </main>
    </>
  );
}
