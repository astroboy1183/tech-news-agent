import { describe, expect, it } from "vitest";
import {
  compareTitles,
  jaccard,
  normalizeForCompare,
  trigrams,
} from "../app/lib/cluster/similarity";

describe("normalizeForCompare", () => {
  it("strips punctuation, case and stopwords", () => {
    expect(normalizeForCompare("The New AMD Ryzen 5 7500 is Out!")).toBe("amd ryzen 5 7500");
  });
});

describe("compareTitles", () => {
  it("merges near-identical coverage of one story", () => {
    // Both seen live, from TechPowerUp and r/hardware.
    const { verdict } = compareTitles(
      "AMD Reportedly Prepares New Ryzen 5 7500 Six-Core CPU for AM5 Socket",
      "AMD reportedly prepares new Ryzen 5 7500 six-core CPU for AM5 socket",
    );
    expect(verdict).toBe("same");
  });

  it("merges a reworded headline about the same announcement", () => {
    const { verdict } = compareTitles(
      "Linux 6.19 merge window opens with the scheduler rewrite landing",
      "Linux 6.19 merge window opens, scheduler rewrite lands",
    );
    expect(verdict).toBe("same");
  });

  it("keeps two different stories about the same company apart", () => {
    const { verdict } = compareTitles(
      "Nvidia announces its next datacentre GPU",
      "Nvidia delays its consumer graphics refresh",
    );
    expect(verdict).not.toBe("same");
  });

  it("keeps two different CVEs apart", () => {
    const { verdict } = compareTitles(
      "CVE-2026-31847: unauthenticated RCE in ScreenConnect",
      "CVE-2026-31999: privilege escalation in ScreenConnect",
    );
    expect(verdict).not.toBe("same");
  });

  it("does not pretend to catch a heavy reword — that is the embedding pass's job", () => {
    // Measured at 0.198, below two genuinely different pairs. Lexical
    // similarity cannot see this; vector search over the section window can.
    const { score, verdict } = compareTitles(
      "EU begins enforcing the AI Act against general-purpose models",
      "European Commission opens AI Act enforcement for foundation models",
    );
    expect(verdict).toBe("different");
    expect(score).toBeLessThan(0.42);
  });

  it("stays below the merge threshold for every measured different-story pair", () => {
    const different: [string, string][] = [
      ["Nvidia announces its next datacentre GPU", "Nvidia delays its consumer graphics refresh"],
      [
        "CVE-2026-31847: unauthenticated RCE in ScreenConnect",
        "CVE-2026-31999: privilege escalation in ScreenConnect",
      ],
      ["Rust 1.94 stabilises async closures", "Rust 1.95 stabilises const generics"],
    ];
    for (const [a, b] of different) {
      expect(compareTitles(a, b).score).toBeLessThan(0.72);
    }
  });

  it("treats an empty or stopword-only title as different", () => {
    expect(compareTitles("", "anything").verdict).toBe("different");
    expect(compareTitles("the and of", "the and of").verdict).toBe("different");
  });

  it("jaccard is symmetric and bounded", () => {
    const a = trigrams("linux kernel scheduler");
    const b = trigrams("kernel scheduler rewrite");
    expect(jaccard(a, b)).toBeCloseTo(jaccard(b, a));
    expect(jaccard(a, a)).toBe(1);
  });
});
