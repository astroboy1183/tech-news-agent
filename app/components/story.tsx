import type { Section } from "../lib/classify";
import { hostOf, timeAgo } from "../lib/format";
import { SECTION_LABELS, type Story } from "../lib/sections";

/**
 * Story cards.
 *
 * Corroboration is the thing these are built to show. A headline six
 * newsrooms filed is a different object from one a single blog posted, so the
 * outlet strip and the source count are part of the card rather than a detail
 * hidden on a story page.
 */

function label(section: string): string {
  return SECTION_LABELS[section as Section] ?? section;
}

/** "6 SOURCES · 2m", or just the age when nobody corroborated it. */
function Meta({ story }: { story: Story }) {
  const age = timeAgo(story.publishedAt ?? story.firstSeenAt);
  return (
    <span className="meta">
      {story.sourceCount > 1 ? `${story.sourceCount} SOURCES · ` : ""}
      {age.toUpperCase()}
    </span>
  );
}

/** The outlets that filed it, best first, truncated with a count. */
function Sources({ story, max = 4 }: { story: Story; max?: number }) {
  if (story.sources.length === 0) return null;
  const shown = story.sources.slice(0, max);
  const rest = story.sources.length - shown.length;
  return (
    <div className="sources">
      {shown.map((name, i) => (
        <span key={name} className="src" style={i === 0 ? { color: "var(--ink-2)" } : undefined}>
          {name}
        </span>
      ))}
      {rest > 0 ? <span className="src src-more">+{rest}</span> : null}
    </div>
  );
}

function Thumb({ story, height }: { story: Story; height: number }) {
  return (
    <div className="thumb" style={{ height }}>
      {story.imageUrl ? (
        <img src={story.imageUrl} alt="" loading="lazy" />
      ) : (
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ink-4)"
          strokeWidth="1.3"
          aria-hidden="true"
        >
          <title>No image</title>
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <circle cx="8.5" cy="9.5" r="1.8" />
          <path d="M3 16l5-4 4 3 3-2 6 5" />
        </svg>
      )}
    </div>
  );
}

/** The lead: the one story the page is led by. */
export function Lead({ story }: { story: Story }) {
  return (
    <article>
      <Thumb story={story} height={290} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 0 8px" }}>
        {story.sourceCount > 2 ? <span className="dot" /> : null}
        <span className="kicker">
          {story.sourceCount > 2 ? "Developing · " : ""}
          {label(story.section)}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <Meta story={story} />
        </span>
      </div>
      <a
        className="lead-headline clamp-4"
        href={story.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {story.headline}
      </a>
      {story.excerpt ? <p className="standfirst clamp-3">{story.excerpt}</p> : null}
      <Sources story={story} max={5} />
    </article>
  );
}

/** A feature card — the two beside the lead, and the four across. */
export function Feature({ story, size = "md" }: { story: Story; size?: "md" | "sm" }) {
  const big = size === "md";
  return (
    <article style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
      <Thumb story={story} height={big ? 126 : 104} />
      <span className="kicker">{label(story.section)}</span>
      <a
        className="clamp-3"
        href={story.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontFamily: "Literata, Georgia, serif",
          fontSize: big ? 19 : 16,
          fontWeight: 600,
          lineHeight: 1.24,
          letterSpacing: "-0.015em",
        }}
      >
        {story.headline}
      </a>
      {story.excerpt && big ? (
        <p
          className="clamp-2"
          style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}
        >
          {story.excerpt}
        </p>
      ) : null}
      <span className="meta">
        {(story.sources[0] ?? hostOf(story.url)).toLowerCase()} ·{" "}
        {timeAgo(story.publishedAt ?? story.firstSeenAt)}
        {story.sourceCount > 1 ? (
          <span style={{ color: "var(--accent)" }}> · {story.sourceCount} src</span>
        ) : null}
      </span>
    </article>
  );
}

/** A dense list row, for section columns and the latest rail. */
export function Row({ story, thumb = false }: { story: Story; thumb?: boolean }) {
  return (
    <article className="row">
      {thumb ? (
        <div style={{ width: 62 }}>
          <Thumb story={story} height={46} />
        </div>
      ) : null}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <a
          className="row-headline clamp-3"
          href={story.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {story.headline}
        </a>
        <span className="meta">
          {(story.sources[0] ?? hostOf(story.url)).toLowerCase()} ·{" "}
          {timeAgo(story.publishedAt ?? story.firstSeenAt)}
          {story.sourceCount > 1 ? (
            <span style={{ color: "var(--accent)" }}> · {story.sourceCount} src</span>
          ) : null}
        </span>
      </div>
    </article>
  );
}
