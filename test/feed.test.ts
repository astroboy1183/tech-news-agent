import { describe, expect, it } from "vitest";
import { cleanXml, escapeXml, renderRss } from "../app/lib/feed.server";
import type { Story } from "../app/lib/sections";

function story(over: Partial<Story> & { id: number }): Story {
  return {
    headline: "A headline",
    url: "https://example.com/a",
    excerpt: null,
    imageUrl: null,
    section: "ai",
    summary: null,
    whyItMatters: null,
    topics: [],
    sourceCount: 1,
    sources: ["Example"],
    velocity: 0,
    score: 50,
    firstSeenAt: 1_800_000_000,
    lastSeenAt: 1_800_000_000,
    publishedAt: 1_800_000_000,
    ...over,
  };
}

describe("escapeXml", () => {
  it("escapes every character XML cannot carry as text", () => {
    expect(escapeXml(`AT&T said "<hi>" & 'bye'`)).toBe(
      "AT&amp;T said &quot;&lt;hi&gt;&quot; &amp; &apos;bye&apos;",
    );
  });

  it("escapes the ampersand first, so escapes are not double-escaped", () => {
    expect(escapeXml("a < b")).toBe("a &lt; b");
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });
});

describe("cleanXml", () => {
  it("removes control characters, which are illegal even when escaped", () => {
    // Written as escapes: a literal control byte in a source file is
    // invisible and travels badly through tooling.
    expect(cleanXml("head\u0000line\u0007 here")).toBe("headline here");
  });

  it("keeps tabs and newlines, which are legal", () => {
    expect(cleanXml("a\tb\nc")).toBe("a\tb\nc");
  });
});

describe("renderRss", () => {
  const origin = "https://news.example";

  it("produces a document with one item per story", () => {
    const xml = renderRss([story({ id: 1 }), story({ id: 2 })], { origin });
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml).toContain('<guid isPermaLink="false">tech-news-agent:story:1</guid>');
  });

  it("survives a headline full of XML metacharacters", () => {
    const xml = renderRss([story({ id: 1, headline: `AT&T & <script>alert("x")</script>` })], {
      origin,
    });
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("AT&amp;T &amp; &lt;script&gt;");
  });

  it("links to the story page only when there is more to show", () => {
    const solo = renderRss([story({ id: 1 })], { origin });
    expect(solo).toContain("<link>https://example.com/a</link>");

    const covered = renderRss([story({ id: 2, sourceCount: 4 })], { origin });
    expect(covered).toContain(`<link>${origin}/story/2</link>`);
  });

  it("credits the outlets that filed it", () => {
    const xml = renderRss([story({ id: 1, sourceCount: 3, sources: ["A", "B", "C"] })], { origin });
    expect(xml).toContain("Reported by 3 outlets: A, B, C.");
  });

  it("prefers the summary over the feed's own excerpt", () => {
    const xml = renderRss(
      [story({ id: 1, excerpt: "raw excerpt", summary: "the written summary" })],
      { origin },
    );
    expect(xml).toContain("the written summary");
    expect(xml).not.toContain("raw excerpt");
  });

  it("names the section feed as its own canonical location", () => {
    const xml = renderRss([story({ id: 1 })], { origin, section: "security" });
    expect(xml).toContain(`href="${origin}/feed/security.xml"`);
    expect(xml).toContain("Tech News Agent — Security");
  });

  it("renders a valid empty channel when there is nothing to publish", () => {
    const xml = renderRss([], { origin });
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
  });
});
