import { describe, expect, it } from "vitest";
import { discriminatorsConflict, extractDiscriminators } from "../app/lib/cluster/discriminators";

describe("extractDiscriminators", () => {
  it("reads a CVE without also reading its digits as bare numbers", () => {
    const found = extractDiscriminators("CVE-2026-31847: unauthenticated RCE in ScreenConnect");
    expect(found.get("cve")).toEqual(new Set(["cve-2026-31847"]));
    expect(found.get("number")).toBeUndefined();
  });

  it("reads a dotted version without splitting it into numbers", () => {
    const found = extractDiscriminators("Linux 6.19 merge window opens");
    expect(found.get("version")).toEqual(new Set(["6.19"]));
    expect(found.get("number")).toBeUndefined();
  });

  it("ignores single digits, which say nothing about which story this is", () => {
    expect(extractDiscriminators("5 ways to speed up your build").get("number")).toBeUndefined();
  });
});

describe("discriminatorsConflict", () => {
  // The four pairs the embedding probe scored dangerously high (0.595–0.853).
  it.each([
    [
      "two CVEs in one product",
      "CVE-2026-31847: unauthenticated RCE in ScreenConnect",
      "CVE-2026-31999: privilege escalation in ScreenConnect",
    ],
    [
      "consecutive OS versions",
      "Apple releases iOS 26.2 with security fixes",
      "Apple releases iOS 26.3 with a redesigned Control Centre",
    ],
    [
      "adjacent language releases",
      "Rust 1.94 stabilises async closures",
      "Rust 1.95 stabilises const generics",
    ],
    [
      "same event type, different headcounts",
      "Google lays off 200 staff in its cloud division",
      "Amazon cuts 300 roles at AWS",
    ],
  ])("blocks %s", (_label, a, b) => {
    expect(discriminatorsConflict(a, b)).toBe(true);
  });

  // ...and none of the genuinely-same pairs, which is what makes it usable.
  it.each([
    [
      "identical identifiers",
      "AMD Reportedly Prepares New Ryzen 5 7500 Six-Core CPU for AM5 Socket",
      "AMD reportedly prepares new Ryzen 5 7500 six-core CPU for AM5 socket",
    ],
    [
      "shared version, different wording",
      "Linux 6.19 merge window opens with the scheduler rewrite landing",
      "Linux 6.19 merge window opens, scheduler rewrite lands",
    ],
    ["no identifiers at all", "Signal ships a post-quantum ratchet", "Signal rolls out PQ crypto"],
  ])("allows %s", (_label, a, b) => {
    expect(discriminatorsConflict(a, b)).toBe(false);
  });

  it("treats one side naming a version as silence, not disagreement", () => {
    // An analysis piece rarely repeats the version number the announcement led
    // with. Refusing that merge would undo most of what embeddings buy us.
    expect(
      discriminatorsConflict(
        "OpenAI launches GPT-5.5 with improved reasoning",
        "OpenAI's new model tops every reasoning benchmark we ran",
      ),
    ).toBe(false);
  });

  it("merges on overlap without demanding the identifier sets match", () => {
    expect(discriminatorsConflict("Top 10 features of iOS 26", "iOS 26 ships today")).toBe(false);
  });
});
