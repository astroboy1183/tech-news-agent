/**
 * Feeds are inconsistent about headlines: some append the outlet, some shout in
 * capitals, some prefix a kicker. Normalising on ingest keeps the front page
 * typography from having to cope with all of it — and the raw title is kept so
 * nothing is lost.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  middot: "·",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

/** Kickers worth lifting out of the headline and showing as a badge. */
const BADGES = [
  "exclusive",
  "breaking",
  "analysis",
  "opinion",
  "review",
  "interview",
  "report",
  "update",
  "deal",
  "guide",
  "explainer",
  "editorial",
];

const BADGE_PREFIX = new RegExp(`^\\s*(${BADGES.join("|")})\\s*[:\\-–—|]\\s*`, "i");

function toSentenceCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
}

export type NormalizedTitle = { title: string; badge: string | null };

/**
 * @param raw   the headline exactly as the feed supplied it
 * @param source the outlet name, so an appended " - The Verge" can be removed
 */
export function normalizeTitle(raw: string, source?: string): NormalizedTitle {
  let title = decodeEntities(raw).replace(/\s+/g, " ").trim();

  let badge: string | null = null;
  const badgeMatch = BADGE_PREFIX.exec(title);
  if (badgeMatch?.[1]) {
    badge = badgeMatch[1].toUpperCase();
    title = title.slice(badgeMatch[0].length).trim();
  }

  // " ... - The Verge" / " ... | Ars Technica"
  if (source) {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    title = title.replace(new RegExp(`\\s*[-–—|]\\s*${escaped}\\s*$`, "i"), "").trim();
  }

  // Shouty headlines are a house-style artefact, not emphasis. Only rewrite
  // when the title is genuinely mostly capitals, so acronyms survive.
  const letters = title.replace(/[^a-z]/gi, "");
  if (letters.length > 8 && letters === letters.toUpperCase()) {
    title = toSentenceCase(title);
  }

  // Reddit flair tags ride along in the title: "… Attention [R]", "… [D]".
  title = title.replace(/\s*\[[A-Z]{1,3}\]\s*$/, "").trim();

  title = title.replace(/[…]+$|\.{3,}$/, "").trim();

  return { title, badge };
}
