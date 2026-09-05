import { useEffect, useState } from "react";
import { Form, Link } from "react-router";
import { SECTIONS } from "../lib/classify";
import { formatCount } from "../lib/format";
import { SECTION_LABELS } from "../lib/sections";

/**
 * Paper is the default and Ink is the dark theme, but the viewer's own choice
 * wins over both. It is stamped on <html> so the CSS variables switch without
 * React re-rendering anything, and stored per-browser — a preference is a
 * convenience, not state worth syncing anywhere.
 */
function ThemeToggle() {
  const [theme, setTheme] = useState<"paper" | "ink" | null>(null);

  useEffect(() => {
    const stored = document.documentElement.dataset.theme;
    if (stored === "paper" || stored === "ink") setTheme(stored);
    else setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "ink" : "paper");
  }, []);

  const choose = (next: "paper" | "ink") => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private windows refuse storage; the choice still applies this visit */
    }
  };

  return (
    <div className="toggle">
      <button type="button" aria-pressed={theme === "paper"} onClick={() => choose("paper")}>
        PAPER
      </button>
      <button type="button" aria-pressed={theme === "ink"} onClick={() => choose("ink")}>
        INK
      </button>
    </div>
  );
}

export type MastheadCounts = {
  articles: number;
  today: number;
  stories: number;
  corroborated: number;
  sources: number;
};

/** Sections shown inline; the rest live on the index page. */
const PRIMARY = ["ai", "software", "hardware", "security", "consumer", "os"] as const;

export function Masthead({ counts, current }: { counts: MastheadCounts; current?: string }) {
  return (
    <header className="wrap">
      <div className="masthead">
        <Link to="/" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="wordmark">Tech News Agent</span>
          <span
            className="meta"
            style={{ fontSize: 8.5, letterSpacing: "0.14em", color: "var(--ink-3)" }}
          >
            ONE STOP FOR EVERYTHING TECHNOLOGY
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span
            className="meta"
            style={{ textAlign: "right", lineHeight: 1.7, letterSpacing: "0.07em" }}
          >
            {formatCount(counts.sources)} SOURCES · EVERY 2 MIN
            <br />
            <span style={{ color: "var(--accent)" }}>●</span> {formatCount(counts.today)} TODAY ·{" "}
            {formatCount(counts.corroborated)} CORROBORATED
          </span>
          <Form
            method="get"
            action="/search"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              border: "1px solid var(--rule)",
              borderRadius: 4,
              padding: "6px 10px",
              background: "var(--card)",
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--ink-4)"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <title>Search</title>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="search"
              name="q"
              placeholder="Search stories"
              aria-label="Search stories"
              style={{
                border: 0,
                outline: "none",
                background: "transparent",
                color: "var(--ink)",
                fontFamily: "inherit",
                fontSize: 12.5,
                width: 132,
              }}
            />
          </Form>
          <ThemeToggle />
        </div>
      </div>

      <div className="rule-heavy" />

      <nav className="nav">
        <Link to="/" aria-current={current ? undefined : "page"}>
          Front page
        </Link>
        {PRIMARY.map((section) => (
          <Link
            key={section}
            to={`/s/${section}`}
            aria-current={current === section ? "page" : undefined}
          >
            {SECTION_LABELS[section]}
          </Link>
        ))}
        <Link to="/sections" aria-current={current === "sections" ? "page" : undefined}>
          All {SECTIONS.length} →
        </Link>
        <span style={{ marginLeft: "auto", display: "flex", gap: 16 }}>
          <Link className="meta" to="/live" style={{ letterSpacing: "0.1em" }}>
            <span style={{ color: "var(--accent)" }}>●</span> LIVE
          </Link>
          <Link className="meta" to="/digest" style={{ letterSpacing: "0.1em" }}>
            DIGEST
          </Link>
          <Link className="meta" to="/archive" style={{ letterSpacing: "0.1em" }}>
            ARCHIVE
          </Link>
          <Link className="meta" to="/saved" style={{ letterSpacing: "0.1em" }}>
            SAVED
          </Link>
          <Link className="meta" to="/ops" style={{ letterSpacing: "0.1em" }}>
            OPS
          </Link>
          <Link className="meta" to="/ops" style={{ letterSpacing: "0.1em" }}>
            OPS
          </Link>
        </span>
      </nav>
      <div className="rule" />
    </header>
  );
}
