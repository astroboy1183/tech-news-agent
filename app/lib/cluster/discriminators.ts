/**
 * Identifier conflicts — the free guard that makes embedding similarity safe.
 *
 * Measured cosines put "CVE-2026-31847 vs CVE-2026-31999" at 0.853, above two
 * genuinely-same pairs. Every near-miss of that kind shares one shape: one
 * subject, two events, told apart only by an identifier. iOS 26.2 vs 26.3.
 * Rust 1.94 vs 1.95. Two CVEs in one product.
 *
 * Semantic similarity cannot see that difference — to an embedding those
 * titles *are* nearly the same sentence. A string match can see it exactly,
 * and costs nothing.
 *
 * The rule: if both titles carry identifiers of the same kind and the two sets
 * do not intersect, they are different stories however close the vectors sit.
 * Overlap is enough; equality is not required, so "Top 10 features of iOS 26"
 * and "iOS 26 ships today" still merge on the shared 26.
 *
 * The bias is deliberate. Refusing a true merge shows one story twice, which
 * is untidy. Allowing a false merge hides a story entirely, which is a product
 * failure. When the identifiers disagree, we decline.
 */

export type DiscriminatorKind = "cve" | "version" | "quarter" | "number";

const PATTERNS: [DiscriminatorKind, RegExp][] = [
  ["cve", /\bCVE-\d{4}-\d{4,7}\b/gi],
  // Dotted versions: 6.19, 26.2, 1.94.0. Also catches GPT-5.5 and iOS 18.1.
  ["version", /\b\d+\.\d+(?:\.\d+)?\b/g],
  ["quarter", /\bQ[1-4]\b/gi],
  // Bare integers of two digits or more: model numbers (RTX 5090), headcounts
  // (200 staff), generations (Ryzen 7500). Single digits are too noisy —
  // "3 things" and "5 ways" say nothing about which story this is.
  ["number", /\b\d{2,}\b/g],
];

/** Identifiers in one title, grouped by kind. Lower-cased for comparison. */
export function extractDiscriminators(title: string): Map<DiscriminatorKind, Set<string>> {
  const found = new Map<DiscriminatorKind, Set<string>>();
  let remaining = title;

  for (const [kind, pattern] of PATTERNS) {
    const matches = remaining.match(pattern);
    if (!matches) continue;
    found.set(kind, new Set(matches.map((m) => m.toLowerCase())));
    // Consume what matched so a CVE's digits are not re-read as bare numbers,
    // and a version's "6.19" does not also register as the number 19.
    remaining = remaining.replace(pattern, " ");
  }
  return found;
}

/**
 * True when the two titles name different things of the same kind — the signal
 * to refuse a merge no matter what the vectors say.
 */
export function discriminatorsConflict(a: string, b: string): boolean {
  const left = extractDiscriminators(a);
  const right = extractDiscriminators(b);

  for (const [kind, values] of left) {
    const other = right.get(kind);
    // A kind only decides when both sides use it. One title mentioning a
    // version and the other not is silence, not disagreement.
    if (!other || other.size === 0) continue;
    let intersects = false;
    for (const v of values) {
      if (other.has(v)) {
        intersects = true;
        break;
      }
    }
    if (!intersects) return true;
  }
  return false;
}
