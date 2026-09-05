import { describe, expect, it } from "vitest";
import { decodeEntities, normalizeTitle } from "../app/lib/feeds/normalize";

describe("normalizeTitle", () => {
  it("removes an appended outlet name", () => {
    expect(normalizeTitle("Linux 6.19 lands the scheduler - Phoronix", "Phoronix").title).toBe(
      "Linux 6.19 lands the scheduler",
    );
    expect(normalizeTitle("Zen 6 leaks | TechPowerUp", "TechPowerUp").title).toBe("Zen 6 leaks");
  });

  it("lifts a kicker into a badge", () => {
    const { title, badge } = normalizeTitle("EXCLUSIVE — Nvidia delays its next part");
    expect(badge).toBe("EXCLUSIVE");
    expect(title).toBe("Nvidia delays its next part");
  });

  it("calms an all-caps headline", () => {
    expect(normalizeTitle("NVIDIA DELAYS ITS NEXT DATACENTRE PART").title).toBe(
      "Nvidia delays its next datacentre part",
    );
  });

  it("leaves acronyms in a normal headline alone", () => {
    const { title } = normalizeTitle("CISA adds two Ivanti flaws to the KEV catalog");
    expect(title).toBe("CISA adds two Ivanti flaws to the KEV catalog");
  });

  it("decodes entities and collapses whitespace", () => {
    expect(normalizeTitle("Rust  &amp;   Go&#39;s  future").title).toBe("Rust & Go's future");
  });

  it("drops a trailing ellipsis", () => {
    expect(normalizeTitle("The story continues...").title).toBe("The story continues");
  });

  it("keeps a colon-prefixed CVE intact", () => {
    const { title, badge } = normalizeTitle("CVE-2026-31847: unauthenticated RCE in ScreenConnect");
    expect(badge).toBeNull();
    expect(title).toBe("CVE-2026-31847: unauthenticated RCE in ScreenConnect");
  });

  it("decodes numeric and named entities", () => {
    expect(decodeEntities("a &mdash; b &#8212; c &amp; d")).toBe("a — b — c & d");
  });
});
