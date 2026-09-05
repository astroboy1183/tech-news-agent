/** Presentation helpers shared by every surface. */

/**
 * Compact relative time: 2m, 3h, 4d.
 *
 * A news page shows dozens of these at once, so they stay short enough to sit
 * in a mono meta line without wrapping. Anything older than a week is a date,
 * because "9d" stops meaning anything.
 */
export function timeAgo(seconds: number | null, now = Date.now() / 1000): string {
  if (!seconds) return "";
  const delta = Math.max(0, Math.floor(now - seconds));
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  if (delta < 7 * 86400) return `${Math.floor(delta / 86400)}d`;
  return new Date(seconds * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Host of a URL, for when an outlet name is missing. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
