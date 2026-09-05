/**
 * Lexical title similarity — the free tier of clustering.
 *
 * MEASURED, not assumed. Scored against known pairs (scripts/probe-similarity):
 *
 *   0.895  SAME story, light reword
 *   0.333  DIFFERENT stories, shared vocabulary
 *   0.311  DIFFERENT CVEs
 *   0.226  SAME story, different angle
 *   0.198  SAME story, heavy reword
 *
 * Same-story pairs sit on *both* sides of every different-story pair, so no
 * threshold separates them and a middle "candidate" band would contain more
 * false pairs than true ones.
 *
 * The conclusion this forces: trigrams are only trustworthy at the top of the
 * range, where they catch syndication and near-identical reposts for free.
 * Everything else is a job for embeddings — which is why the embedding pass
 * runs over a section-and-time window rather than over pairs this module
 * escalates.
 */

/** Words that carry no signal about *which* story this is. */
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "will",
  "has",
  "have",
  "had",
  "new",
  "now",
  "says",
  "said",
  "after",
  "over",
  "into",
  "up",
  "out",
]);

export function normalizeForCompare(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !STOPWORDS.has(word))
    .join(" ")
    .trim();
}

export function trigrams(text: string): Set<string> {
  const padded = ` ${text} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Jaccard: shared trigrams over total distinct trigrams. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Distinctive tokens — long words, version numbers, identifiers. Two headlines
 * about different Nvidia announcements share plenty of trigrams but rarely
 * share these.
 */
export function keyTokens(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter((w) => w.length >= 5 || /\d/.test(w)));
}

export type SimilarityVerdict = "same" | "different";

/**
 * Deliberately conservative: a missed merge shows one story twice, which is
 * untidy; a false merge hides a story entirely, which is a product failure.
 * Anything short of near-certainty is left to the embedding pass.
 */
export function compareTitles(a: string, b: string): { score: number; verdict: SimilarityVerdict } {
  return compareFingerprints(fingerprint(a), fingerprint(b));
}

/**
 * A title reduced to everything the comparison needs.
 *
 * Worth naming because the caller compares one article against every open
 * cluster: without this the cluster side is re-normalised and re-shingled on
 * every comparison, which at forty articles and a thousand clusters is forty
 * thousand redundant passes over the same strings.
 */
export type TitleFingerprint = {
  normalized: string;
  trigrams: Set<string>;
  keyTokens: Set<string>;
};

export function fingerprint(title: string): TitleFingerprint {
  const normalized = normalizeForCompare(title);
  return {
    normalized,
    trigrams: trigrams(normalized),
    keyTokens: keyTokens(normalized),
  };
}

export function compareFingerprints(
  a: TitleFingerprint,
  b: TitleFingerprint,
): { score: number; verdict: SimilarityVerdict } {
  if (!a.normalized || !b.normalized) return { score: 0, verdict: "different" };
  if (a.normalized === b.normalized) return { score: 1, verdict: "same" };

  const score = jaccard(a.trigrams, b.trigrams);

  // Distinctive-token overlap guards against high trigram scores between two
  // different stories that happen to share vocabulary.
  let sharedKeys = 0;
  for (const token of a.keyTokens) if (b.keyTokens.has(token)) sharedKeys++;
  const smaller = Math.min(a.keyTokens.size, b.keyTokens.size);
  const keyOverlap = smaller > 0 ? sharedKeys / smaller : 0;

  // 0.72 sits above every measured different-story pair (max 0.333) with a
  // wide margin, and the key-token check guards the remaining overlap cases.
  if (score >= 0.72 && keyOverlap >= 0.6) return { score, verdict: "same" };
  return { score, verdict: "different" };
}
