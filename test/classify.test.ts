import { describe, expect, it } from "vitest";
import { classify } from "../app/lib/classify";

const base = { sourceSection: "software", sourceWeight: 1.0, now: 1_757_000_000 };

describe("classify", () => {
  it("routes a kernel story to os even from a hardware-seeded source", () => {
    const { section } = classify({
      ...base,
      sourceSection: "hardware",
      title: "Linux 6.19 merge window opens with the scheduler rewrite landing",
      excerpt: "The kernel scheduler replacement is merged.",
    });
    expect(section).toBe("os");
  });

  it("routes a GPU benchmark to hardware even from an os-seeded source", () => {
    const { section } = classify({
      ...base,
      sourceSection: "os",
      title: "RDNA5 GPU benchmarks: the new silicon tested",
      excerpt: "We benchmark the chipset across twelve titles.",
    });
    expect(section).toBe("hardware");
  });

  it("treats a CVE as security regardless of the source", () => {
    const { section, topics } = classify({
      ...base,
      sourceSection: "consumer",
      title: "CVE-2026-31847: unauthenticated RCE in ScreenConnect",
    });
    expect(section).toBe("security");
    expect(topics).toContain("vulnerabilities");
  });

  it("falls back to the source section when the text says nothing", () => {
    const { section } = classify({ ...base, sourceSection: "gaming", title: "Weekly roundup" });
    expect(section).toBe("gaming");
  });

  it("extracts sub-topics", () => {
    const { topics } = classify({
      ...base,
      sourceSection: "ai",
      title: "A vision transformer matches specialists on computer vision benchmarks",
    });
    expect(topics).toContain("computer vision");
  });

  it("scores a fresh, trusted, corroborated story above an old weak one", () => {
    const strong = classify({
      ...base,
      sourceWeight: 1.5,
      publishedAt: base.now - 600,
      engagement: 400,
      title: "Linux kernel scheduler rewrite lands",
    });
    const weak = classify({
      ...base,
      sourceWeight: 0.5,
      publishedAt: base.now - 3600 * 72,
      title: "Weekly roundup",
    });
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.score).toBeGreaterThan(50);
    expect(weak.score).toBeLessThan(35);
  });

  it("keeps every score inside 0–100", () => {
    const extreme = classify({
      ...base,
      sourceWeight: 2,
      publishedAt: base.now,
      engagement: 100_000,
      title: "Linux kernel CVE-2026-1 GPU quantum kubernetes rust benchmark",
    });
    expect(extreme.score).toBeGreaterThanOrEqual(0);
    expect(extreme.score).toBeLessThanOrEqual(100);
  });
});
