import { useEffect, useState } from "react";
import { useNavigate, useRevalidator } from "react-router";

/** How often the page quietly re-checks for newer stories. */
const AUTO_REVALIDATE_MS = 60_000;

function ago(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/**
 * Freshness, and a way to insist on more of it.
 *
 * The front page is composed at most every 90 seconds, so "updated 2m ago" is
 * a real thing a reader can see and want to change. Two behaviours:
 *
 * - **Automatic**, every minute, silently. A news page that needs reloading to
 *   show news is a news page that is usually wrong.
 * - **Manual**, on the button, which adds `?refresh` so the loader skips the
 *   cache entirely and recomposes from the database.
 *
 * The manual path is floored server-side at one recomposition every 15
 * seconds, so holding the button down costs one query set rather than one per
 * press.
 */
export function Refresh({ composedAt, cached }: { composedAt: number; cached: boolean }) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const busy = revalidator.state !== "idle";

  // A ticking clock, so the label ages in front of the reader rather than
  // freezing at whatever it said when the page rendered.
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      // Revalidating a hidden tab wastes a request on a page nobody is reading.
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, AUTO_REVALIDATE_MS);
    return () => clearInterval(timer);
  }, [revalidator]);

  const age = Math.max(0, now - composedAt);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      <span className="meta" title={cached ? "served from cache" : "composed for this request"}>
        UPDATED {ago(age).toUpperCase()}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => navigate("/?refresh", { replace: true })}
        aria-label="Refresh the front page now"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "5px 9px",
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 9,
          letterSpacing: "0.08em",
          color: busy ? "var(--ink-4)" : "var(--ink-2)",
          background: "var(--card)",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          cursor: busy ? "default" : "pointer",
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          aria-hidden="true"
          style={busy ? { animation: "spin 900ms linear infinite" } : undefined}
        >
          <title>Refresh</title>
          <path d="M20 12a8 8 0 11-2.34-5.66" />
          <path d="M20 4v5h-5" />
        </svg>
        {busy ? "REFRESHING" : "REFRESH"}
      </button>
    </span>
  );
}
